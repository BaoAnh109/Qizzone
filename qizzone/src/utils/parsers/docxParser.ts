import mammoth from "mammoth";
import JSZip from "jszip";
import { parseRawExamText, romanToInt } from "./ruleExtractor";
import {
  DocxUncompressedSizeError,
  assertDocxUncompressedSize,
  parseDocxDirectAst,
} from "./docxAstParser";
import type { ExtractionResult } from "@/types/extractor";

/**
 * Bước 07 (PLAN_MAIN): trạng thái quality gate sơ bộ cho DOCX.
 * Đây CHƯA phải Quality Gate đầy đủ của bước 10 (so sánh số câu độc lập,
 * số trang chưa xử lý, chunk trùng, mâu thuẫn bảng đáp án) — bước 07 chỉ
 * dùng các tín hiệu đo được ngay từ ExtractionResult + raw text, và KHÔNG
 * dùng confidenceScore hard-coded hay số đáp án thiếu làm điều kiện chặn:
 * thiếu đáp án là việc của validator bước 04 (chặn xuất bản), không phải
 * bằng chứng trích xuất thiếu câu.
 */
export type DocxQualityStatus = "complete" | "partial" | "failed";

export interface DocxQualityAssessment {
  status: DocxQualityStatus;
  /** Số câu parser trả về. */
  parsedQuestions: number;
  /** Số header có nhãn (Câu/Bài/Question/Q + số) distinct quét được trên raw text. */
  detectedHeaders: number;
  /**
   * Số header không trở thành câu hỏi (= detectedHeaders - parsedQuestions
   * khi dương, ngược lại 0). Parser luôn đánh lại order theo vị trí xuất
   * hiện (ruleExtractor: normalizedOrder = i + 1) nên KHÔNG thể nêu tên số
   * câu thiếu cụ thể — chỉ báo thiếu theo số đếm, không bịa số câu.
   * Chiều ngược lại (parsed > headers, vd đề lặp header Câu 1–150 hai lần
   * thành 250 block) không phải tín hiệu thiếu nên không tính.
   */
  unparsedHeaders: number;
  /** Order của câu có < 2 options — nội dung parse chưa đầy đủ. */
  invalidOptionOrders: number[];
  /** Lý do bằng tiếng Việt, ghi rõ số liệu (để UI review/toast hiển thị). */
  reasons: string[];
}

export interface DocxParseOutput {
  rawHtml: string;
  rawText: string;
  result: ExtractionResult;
  /** Bước 07: luôn có — caller không được suy ra "thành công" chỉ từ questions.length > 0. */
  quality: DocxQualityAssessment;
  extractedImages?: Record<string, string>;
}

/**
 * Quét độc lập các header có nhãn trên raw text (plain text, không phải HTML).
 * Chỉ đếm dạng có nhãn (Câu/Bài/Question/Q + số) để tránh nhiễu từ danh sách
 * đánh số trần ("1. ...") trong lời giải hay hướng dẫn. Header trong bảng đáp
 * án cuối đề cũng được đếm — nếu bảng liệt kê nhiều câu hơn số câu parse
 * được thì đó đúng là bằng chứng trích xuất thiếu, không phải false positive.
 * Giới hạn đã biết: câu nhắc "xem Câu 2." trong lời giải có thể bị đếm thừa
 * → chỉ gây partial (đưa vào review), không gây mất dữ liệu hay đáp án giả;
 * bước 13 (Canonical IR) sẽ thay quét regex này bằng đối chiếu theo block.
 * Sau MVP: đếm cả nhãn La Mã ("Câu I/II/III", qua romanToInt — sai chuẩn
 * thì bỏ qua) để đồng bộ với header regex của ruleExtractor.
 */
function scanLabeledHeaders(rawText: string): Set<number> {
  const headers = new Set<number>();
  const re = /(?:Câu|Bài|Question|CÂU|BÀI|QUESTION|Q)\s*(\d+|[IVXLCDM]+)\s*[.:)_-]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawText)) !== null) {
    const raw = m[1];
    const num = /^\d+$/.test(raw) ? Number(raw) : romanToInt(raw);
    if (num !== undefined && num > 0) headers.add(num);
  }
  return headers;
}

export function assessDocxQuality(
  result: ExtractionResult,
  rawText: string
): DocxQualityAssessment {
  const questions = result.questions;

  const headers = scanLabeledHeaders(rawText);
  const unparsedHeaders = Math.max(0, headers.size - questions.length);

  const invalidOptionOrders = questions
    .filter((q) => q.options.length < 2)
    .map((q) => q.order);

  const reasons: string[] = [];
  if (questions.length === 0) {
    reasons.push("Không bóc tách được câu hỏi nào từ file");
  }
  if (unparsedHeaders > 0) {
    reasons.push(
      `Phát hiện ${headers.size} header câu hỏi trong file nhưng chỉ bóc tách được ${questions.length} câu (thiếu ${unparsedHeaders} câu)`
    );
  }
  if (invalidOptionOrders.length > 0) {
    reasons.push(
      `${invalidOptionOrders.length} câu chưa đủ phương án (câu ${invalidOptionOrders.join(", ")} có dưới 2 lựa chọn)`
    );
  }

  const status: DocxQualityStatus =
    questions.length === 0
      ? "failed"
      : reasons.length > 0
        ? "partial"
        : "complete";

  return {
    status,
    parsedQuestions: questions.length,
    detectedHeaders: headers.size,
    unparsedHeaders,
    invalidOptionOrders,
    reasons,
  };
}

/**
 * Phân tích tệp đề thi Word (.docx) bằng kiến trúc Hybrid Dual-Engine:
 * 1. Tier 1: Direct OpenXML AST Parser (Chuyển đổi công thức Toán OMML sang LaTeX, bảo toàn Bold/Underline/Highlight/Red Color/Tables & Hình ảnh)
 * 2. Tier 2: Mammoth Transformer Fallback (Đảm bảo khả năng tương thích 100% với mọi phiên bản Word cũ/mới)
 */
export async function parseDocxFile(file: File): Promise<DocxParseOutput> {
  const arrayBuffer = await file.arrayBuffer();

  // Bước 32 (PLAN_MAIN): pre-scan chống zip bomb TRƯỚC khối try/catch
  // AST → mammoth. Nếu guard nằm trong parseDocxDirectAst mà không có
  // pre-scan ở đây, lỗi vượt ngưỡng sẽ rơi vào catch và bị mammoth
  // fallback giải nén lại — đúng thứ guard cần chặn. Chỉ lỗi vượt ngưỡng
  // được throw tiếp; lỗi load zip khác (file hỏng) vẫn đi luồng cũ.
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    assertDocxUncompressedSize(zip);
  } catch (error) {
    if (error instanceof DocxUncompressedSizeError) throw error;
  }

  // 1. Thử phân tích bằng Bộ phân tích OpenXML AST trực tiếp (Độ chính xác cao nhất cho Math OMML & XML Styles)
  try {
    const ast = await parseDocxDirectAst(arrayBuffer);

    if (ast.fullText.trim().length > 0 || ast.paragraphs.length > 0) {
      const result = parseRawExamText(ast.fullHtml || ast.fullText, {
        fileName: file.name,
        fileType: "docx",
        initialAnswerKey: ast.answerKeyMap,
        extractedImages: ast.extractedImages,
      });

      // Bước 07: bỏ quy tắc "có ít nhất 1 câu → thành công hoàn toàn".
      // Kết quả vẫn được trả về đầy đủ (không mất dữ liệu đã trích) nhưng
      // kèm quality gate — caller phải đọc `quality.status` thay vì chỉ
      // đếm questions.length; câu thiếu → partial, vào review/fallback
      // (bước 21 orchestrator, bước 24 review UI), không toast "thành công".
      if (result.questions.length > 0) {
        return {
          rawHtml: ast.fullHtml,
          rawText: ast.fullText,
          result,
          quality: assessDocxQuality(result, ast.fullText),
          extractedImages: ast.extractedImages,
        };
      }
    }
  } catch {
    // Nếu gặp lỗi ở tầng AST trực tiếp, tự động chuyển sang Mammoth Fallback
  }

  // 2. Fallback sang Mammoth Engine với Style Map mở rộng
  const styleMap = [
    "u => u.is-underline",
    "b => strong.is-bold",
    "strong => strong.is-bold",
    "mark => mark.is-highlighted",
    "span[style*='underline'] => u.is-underline",
    "span[style*='red'] => span.text-color-red",
    "span[style*='#FF0000'] => span.text-color-red",
    "span[style*='#ff0000'] => span.text-color-red",
    "span[style*='#e11d48'] => span.text-color-red",
    "span[style*='yellow'] => mark.is-highlighted",
    "sup => sup",
    "sub => sub",
  ];

  const htmlResult = await mammoth.convertToHtml({
    arrayBuffer,
    styleMap,
  });

  const rawTextResult = await mammoth.extractRawText({ arrayBuffer });

  const rawHtml = htmlResult.value;
  const rawText = rawTextResult.value;

  const result = parseRawExamText(rawHtml || rawText, {
    fileName: file.name,
    fileType: "docx",
  });

  return {
    rawHtml,
    rawText,
    result,
    quality: assessDocxQuality(result, rawText),
  };
}
