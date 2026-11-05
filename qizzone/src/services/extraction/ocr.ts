import { parseRawExamText } from "@/utils/parsers/ruleExtractor";
import { fromV1Result } from "@/services/extraction/v2Adapter";
import type {
  ExtractionV2Result,
  V2DocumentQuality,
} from "@/types/extractionV2";

/**
 * Bước 16 (PLAN_MAIN): Scan/image và PDF chỉ có ảnh — tầng OCR.
 *
 * Chuỗi đã có trước bước này:
 * - PDF text layer → parsePdfFile (bước 15), có `hasTextLayer` làm tín
 *   hiệu vào: false = PDF scan/chỉ có ảnh, text path trả 0 câu và KHÔNG
 *   bịa text.
 * - Ảnh → extractQuizWithAI (đường AI có sẵn của main, bước 17 mới tách
 *   extraction khỏi solving; bước này KHÔNG đổi đường ảnh).
 *
 * Chuỗi bước 16 thêm vào (chỉ cục bộ, không API trả phí):
 *   render trang PDF → ảnh → OcrEngine → text OCR → parseRawExamText
 *   (cùng pipeline tách câu của text path, bước 13 IR) → V2 với
 *   engine "ocr", status needs_review, quality partial.
 *
 * PHẦN CHƯA XONG, NÓI RÕ (không tuyên bố xong OCR thật):
 * - Chưa có engine OCR thật nào được cài/kiểm chứng end-to-end trong
 *   repo này: `tesseract.js` KHÔNG nằm trong package.json. Muốn kích
 *   hoạt: `npm install tesseract.js`, implement `OcrEngine` (wrapper
 *   quanh worker Tesseract, lang "eng" mặc định, "vie" cho đề tiếng
 *   Việt), rồi gọi `registerOcrEngine()` lúc khởi động app.
 * - Khi chưa có engine đăng ký, `runOcrPages` throw `OcrUnavailableError`
 *   rõ ràng — KHÔNG trả text giả, KHÔNG coi scan là file rỗng.
 * - Render trang PDF → Blob ở browser đã có sẵn qua
 *   `renderPdfPageToImageBlob` (pdfParser); ở Node (test) hàm đó throw
 *   vì không có DOM — test chỉ kiểm chứng routing + pipeline text OCR,
 *   không kiểm chứng render thật.
 */

// ---------------------------------------------------------------------------
// Engine abstraction
// ---------------------------------------------------------------------------

/** Đầu vào OCR cho một trang/ảnh. `image` là Blob (browser) hoặc data URL. */
export interface OcrPageInput {
  pageNumber: number;
  image: Blob | string;
}

/** Kết quả OCR cho một trang/ảnh. `text` là text thô OCR được. */
export interface OcrPageResult {
  pageNumber: number;
  text: string;
  /** Độ tin cậy trung bình 0–1 nếu engine báo; vắng mặt = không đo được. */
  meanConfidence?: number;
}

/**
 * Engine OCR có thể thay thế: Tesseract.js (client), hoặc bất kỳ engine
 * nào khác. Engine KHÔNG được tự sửa/gán đáp án — nó chỉ trả text thô;
 * việc tách câu và gán đáp án do pipeline ruleExtractor làm như text path.
 */
export interface OcrEngine {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  recognizePage(input: OcrPageInput): Promise<OcrPageResult>;
}

/** Lỗi khi chưa có engine OCR nào được đăng ký/khả dụng. */
export class OcrUnavailableError extends Error {
  constructor() {
    super(
      "Chưa có engine OCR nào khả dụng — cần cài và đăng ký engine OCR " +
        "(vd Tesseract.js) trước khi trích xuất PDF scan/ảnh bằng OCR."
    );
    this.name = "OcrUnavailableError";
  }
}

let registeredEngine: OcrEngine | null = null;

/** Đăng ký engine OCR dùng cho toàn app (gọi lúc khởi động). */
export function registerOcrEngine(engine: OcrEngine | null): void {
  registeredEngine = engine;
}

/** Engine OCR hiện đăng ký, hoặc null khi chưa có. */
export function getOcrEngine(): OcrEngine | null {
  return registeredEngine;
}

// ---------------------------------------------------------------------------
// Routing: PDF đi đường text hay đường OCR?
// ---------------------------------------------------------------------------

export type PdfOcrRoute =
  | { route: "text" }
  | { route: "ocr-needed"; ocrPages: number[] }
  | { route: "mixed"; ocrPages: number[] };

/**
 * Quyết định đường đi cho một file PDF đã parse text layer.
 * - `scanPages` (1-based, từ parsePdfFile) là nguồn chính xác nhất khi có.
 * - Không có `scanPages`: `hasTextLayer=false` → toàn bộ trang cần OCR;
 *   `hasTextLayer=true` → đường text (không đoán trang nào là scan).
 * Không bao giờ trả "text" cho file toàn scan, và không bao giờ đoán
 * trang scan khi không có dữ liệu từng trang.
 */
export function decidePdfOcrRoute(input: {
  hasTextLayer: boolean;
  totalPages: number;
  scanPages?: number[];
}): PdfOcrRoute {
  const { hasTextLayer, totalPages } = input;
  if (input.scanPages !== undefined) {
    const ocrPages = [...input.scanPages].sort((a, b) => a - b);
    if (ocrPages.length === 0) return { route: "text" };
    if (ocrPages.length >= totalPages) return { route: "ocr-needed", ocrPages };
    return { route: "mixed", ocrPages };
  }
  if (!hasTextLayer) {
    const ocrPages = Array.from({ length: totalPages }, (_, i) => i + 1);
    return { route: "ocr-needed", ocrPages };
  }
  return { route: "text" };
}

// ---------------------------------------------------------------------------
// Chạy OCR theo từng trang (lỗi từng trang không làm mất trang khác)
// ---------------------------------------------------------------------------

/**
 * Chạy engine OCR trên từng trang theo thứ tự. Trang lỗi được ghi vào
 * `failedPages` và KHÔNG chặn các trang còn lại (đúng yêu cầu DONE bước
 * 16: ghi số trang lỗi, lỗi một chunk tạo partial thay vì complete).
 * Chưa có engine → throw OcrUnavailableError (không bịa text).
 */
export async function runOcrPages(
  engine: OcrEngine | null,
  inputs: OcrPageInput[]
): Promise<{ pages: OcrPageResult[]; failedPages: number[] }> {
  if (!engine || !(await engine.isAvailable())) {
    throw new OcrUnavailableError();
  }
  const pages: OcrPageResult[] = [];
  const failedPages: number[] = [];
  for (const input of inputs) {
    try {
      pages.push(await engine.recognizePage(input));
    } catch {
      failedPages.push(input.pageNumber);
    }
  }
  pages.sort((a, b) => a.pageNumber - b.pageNumber);
  failedPages.sort((a, b) => a - b);
  return { pages, failedPages };
}

// ---------------------------------------------------------------------------
// Text OCR → V2 (cùng pipeline tách câu của text path)
// ---------------------------------------------------------------------------

export const OCR_WARNING =
  "Trích xuất từ OCR — văn bản nhận diện có thể sai ký tự, cần giáo viên xác minh trước khi xuất bản.";

function normForPageMatch(s: string): string {
  return (s ?? "")
    .replace(/<[^>]*>/g, " ")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Gắn số trang cho câu OCR bằng cách khớp 40 ký tự chữ/số đầu của stem
 * với text OCR từng trang — cùng luật với `findQuestionPage` bước 15
 * (không import pdfParser để module này không kéo pdfjs-dist vào).
 * Không khớp → page null (không đoán trang).
 */
function findOcrQuestionPage(
  content: string,
  pageTexts: { pageNumber: number; text: string }[]
): number | null {
  const needle = normForPageMatch(content).slice(0, 40);
  if (needle.length < 10) return null;
  for (const p of pageTexts) {
    if (normForPageMatch(p.text).includes(needle)) return p.pageNumber;
  }
  return null;
}

export interface OcrToV2Meta {
  fileName: string;
  fileSize: number;
  fileType: "pdf" | "image";
  engineName: string;
}

/**
 * Đưa text OCR qua cùng pipeline tách câu của text path rồi ép metadata
 * OCR lên kết quả V2:
 * - Mọi câu đều `engine: "ocr"`, `status: "needs_review"`, quality
 *   partial kèm lý do OCR — KỂ CẢ câu mà waterfall bắt được đáp án từ
 *   text OCR (đáp án OCR chưa xác minh thì không bao giờ là verified).
 * - documentQuality: có câu → partial, 0 câu → failed (scan không bị
 *   xem là file rỗng thành công, cũng không bị xem là file lỗi rỗng —
 *   trạng thái failed ở đây nghĩa là "chưa trích được câu nào, cần xem
 *   lại", kèm lý do và danh sách trang lỗi).
 * - `ocr.failedPages` ghi số trang OCR lỗi (DONE bước 16: ghi số trang lỗi).
 */
export function ocrPagesToV2Result(
  pages: OcrPageResult[],
  failedPages: number[],
  meta: OcrToV2Meta
): ExtractionV2Result {
  const sortedPages = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const joinedText = sortedPages.map((p) => p.text).join("\n\n");
  const parsed = parseRawExamText(joinedText, {
    fileName: meta.fileName,
    fileType: meta.fileType,
  });

  const pageTexts = sortedPages.map((p) => ({
    pageNumber: p.pageNumber,
    text: p.text,
  }));
  const questionsWithPages = parsed.questions.map((q) => ({
    ...q,
    page: findOcrQuestionPage(q.content, pageTexts) ?? undefined,
  }));

  const base = fromV1Result(
    { ...parsed, questions: questionsWithPages },
    undefined
  );

  const failedNote =
    failedPages.length > 0
      ? ` Trang OCR lỗi: ${failedPages.join(", ")}.`
      : "";
  const confidences = sortedPages
    .map((p) => p.meanConfidence)
    .filter((c): c is number => typeof c === "number" && isFinite(c));
  const meanConfidence =
    confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : undefined;

  const questions = base.questions.map((q) => ({
    ...q,
    engine: "ocr" as const,
    status: "needs_review" as const,
    quality: {
      status: "partial" as const,
      reasons: [...q.quality.reasons, OCR_WARNING],
    },
    warnings: [...q.warnings, OCR_WARNING],
  }));

  const documentQuality: V2DocumentQuality =
    questions.length === 0
      ? {
          status: "failed" as const,
          parsedQuestions: 0,
          reasons: [
            "OCR không trích được câu hỏi nào từ trang scan." + failedNote,
          ],
        }
      : {
          status: "partial" as const,
          parsedQuestions: questions.length,
          reasons: [OCR_WARNING + failedNote],
        };

  return {
    ...base,
    fileName: meta.fileName,
    fileSize: meta.fileSize,
    fileType: meta.fileType,
    totalQuestionsDetected: questions.length,
    questions,
    documentQuality,
    warnings: [
      ...base.warnings,
      OCR_WARNING + (failedNote ? failedNote : ""),
    ],
    ocr: {
      engineName: meta.engineName,
      failedPages: [...failedPages].sort((a, b) => a - b),
      ...(meanConfidence !== undefined ? { meanConfidence } : {}),
    },
  };
}
