import mammoth from "mammoth";
import { parseRawExamText } from "./ruleExtractor";
import { parseDocxDirectAst } from "./docxAstParser";
import type { ExtractionResult } from "@/types/extractor";

export interface DocxParseOutput {
  rawHtml: string;
  rawText: string;
  result: ExtractionResult;
  extractedImages?: Record<string, string>;
}

/**
 * Phân tích tệp đề thi Word (.docx) bằng kiến trúc Hybrid Dual-Engine:
 * 1. Tier 1: Direct OpenXML AST Parser (Chuyển đổi công thức Toán OMML sang LaTeX, bảo toàn Bold/Underline/Highlight/Red Color/Tables & Hình ảnh)
 * 2. Tier 2: Mammoth Transformer Fallback (Đảm bảo khả năng tương thích 100% với mọi phiên bản Word cũ/mới)
 */
export async function parseDocxFile(file: File): Promise<DocxParseOutput> {
  const arrayBuffer = await file.arrayBuffer();

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

      // Nếu bóc tách thành công ít nhất 1 câu hỏi từ Direct AST
      if (result.questions.length > 0) {
        return {
          rawHtml: ast.fullHtml,
          rawText: ast.fullText,
          result,
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
  };
}
