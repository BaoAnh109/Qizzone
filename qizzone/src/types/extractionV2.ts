import { z } from "zod";
import type { OptionId, QuestionType } from "./quiz";

/**
 * Bước 09 (PLAN_MAIN, giai đoạn C): ExtractionResult V2.
 *
 * V1 (`src/types/extractor.ts`) thiếu nhiều trường mà giai đoạn C cần:
 * số câu gốc trong tài liệu (sourceNumber), tham chiếu nguồn (sourceRef),
 * nguồn bằng chứng của đáp án (answerOrigin/evidence), trạng thái xác minh
 * từng câu (status), chất lượng tài liệu (documentQuality) và trạng thái
 * từng chunk. V2 bổ sung các trường này BÊN CẠNH V1 — không xóa V1 ngay;
 * UI V1 đọc được qua adapter (`src/services/extraction/v2Adapter.ts`),
 * quiz/DB cũ không cần migration ở bước này.
 *
 * Nguyên tắc giữ nguyên từ các bước trước (Extraction ≠ Solving):
 * - `correctAnswers: []` là hợp lệ khi nguồn thực sự không có đáp án;
 *   adapter KHÔNG tự gán đáp án, KHÔNG tự chèn option.
 * - Đáp án chỉ được coi là `verified` khi có bằng chứng gốc (không phải
 *   `ai_suggested`, không phải suy luận) và câu đủ ≥ 2 phương án.
 * - `type: "unknown"` nghĩa là parser chưa xác định được loại câu — adapter
 *   sang Quiz vẫn map về `single_choice` theo hành vi cũ của main, nhưng
 *   câu đó mang `status: "needs_review"` để bước 12 xử lý loại thật, không
 *   được âm thầm coi "unknown" là single_choice đã xác minh.
 */

/** Nguồn bằng chứng của đáp án — phải đối chiếu được với tài liệu gốc. */
export type AnswerOrigin =
  | "answer_table" // Bảng đáp án cuối đề
  | "answer_line" // Dòng "Đáp án: X" cuối câu
  | "marker" // Ký hiệu tiền tố (*A, ✓A, [x])
  | "underline" // Gạch chân phương án
  | "highlight" // Tô màu highlight / chữ đỏ
  | "bold" // In đậm duy nhất
  | "solution" // Trích từ lời giải ("Chọn A vì...")
  | "teacher_confirmed" // Giáo viên tự chọn/xác nhận thủ công
  | "ai_suggested" // AI giải đề (opt-in, KHÔNG phải bằng chứng gốc)
  | "none"; // Nguồn thực sự không có đáp án

/** Một bằng chứng đáp án: nguồn + độ tin cậy + trích đoạn nguồn (nếu có). */
export interface AnswerEvidence {
  origin: AnswerOrigin;
  /** 0.0–1.0. Với origin "none" luôn là 0. Không dùng làm điều kiện chặn duy nhất (bước 10). */
  confidence: number;
  /** Trích đoạn text gốc làm bằng chứng (vd "Đáp án: B"). Không bịa khi không có. */
  sourceExcerpt?: string;
}

/** Loại câu hỏi trong V2: giữ type gốc; "unknown" = parser chưa xác định được. */
export type V2QuestionType = QuestionType | "unknown";

/**
 * Trạng thái xác minh từng câu:
 * - "verified": có đáp án bằng bằng chứng gốc + đủ ≥ 2 phương án.
 * - "needs_review": mọi trường hợp còn lại (thiếu đáp án, thiếu phương án,
 *   đáp án ai_suggested, nháp tạo tay, type unknown).
 */
export type V2QuestionStatus = "verified" | "needs_review";

/** Chất lượng từng câu (suy ra từ dữ liệu câu, không phải điểm tự khai). */
export interface V2QuestionQuality {
  status: "complete" | "partial";
  /** Lý do bằng tiếng Việt (để UI review hiển thị); rỗng khi complete. */
  reasons: string[];
}

export interface V2Option {
  id: OptionId;
  content: string;
}

export interface ExtractionV2Question {
  id: string;
  /** Thứ tự hiển thị (đánh lại theo vị trí xuất hiện, như V1). */
  order: number;
  /**
   * Số câu in trong tài liệu gốc (vd "Câu 5"). null khi parser không giữ
   * được số gốc — V1 đánh lại order theo vị trí nên khi chuyển từ V1 sang
   * V2 trường này luôn là null; bước 13 (Canonical IR) mới điền được thật.
   * KHÔNG suy ra sourceNumber từ order.
   */
  sourceNumber: number | null;
  /**
   * Tham chiếu vị trí nguồn (vd "docx:paragraph 12", "pdf:page 2").
   * Chưa có IR nên V1 → V2 để trống; không bịa tham chiếu.
   */
  sourceRef?: string;
  content: string;
  type: V2QuestionType;
  options: V2Option[];
  correctAnswers: OptionId[];
  /** Bằng chứng của đáp án; null khi correctAnswers rỗng (origin "none"). */
  answerEvidence: AnswerEvidence | null;
  status: V2QuestionStatus;
  quality: V2QuestionQuality;
  explanation?: string;
  points: number;
  /** Cảnh báo cần review (dùng đúng từ vựng warningFlags của V1). */
  warnings: string[];
  /** Tham chiếu asset (ảnh/công thức đính kèm câu hỏi). */
  assetRefs: string[];
  /**
   * Engine đã tạo ra câu này. Bước 16 thêm "ocr": câu từ text OCR của
   * trang scan/ảnh — luôn needs_review, không bao giờ verified khi chưa
   * có xác minh của giáo viên (xem ocr.ts).
   */
  engine: "rule" | "gemini" | "manual" | "ocr";
  /** Trang nguồn (PDF) nếu xác minh được; DOCX không lưu pagination chắc chắn nên để null. */
  page: number | null;
  /**
   * Bước 19: index (0-based) của chunk chứa câu này, theo chunking.ts.
   * Vắng mặt = câu chưa được gán vào chunk nào (không có page để gán,
   * hoặc số khối/khối câu không đối chiếu được) — KHÔNG đoán chunk.
   */
  chunkIndex?: number;
}

/** Chất lượng toàn tài liệu (bước 07 gắn vào DOCX, bước 10 mở rộng). */
export interface V2DocumentQuality {
  status: "complete" | "partial" | "failed";
  parsedQuestions: number;
  /** Số header câu hỏi quét độc lập được (nếu đo được; DOCX bước 07 có, PDF/text chưa). */
  detectedHeaders?: number;
  /** Số header không trở thành câu hỏi (chỉ báo theo số đếm, không nêu tên số câu). */
  unparsedHeaders?: number;
  /** Order của câu có < 2 options. */
  invalidOptionOrders?: number[];
  reasons: string[];
}

/**
 * Trạng thái từng chunk — điền thật bằng chunking.ts (bước 19).
 * - Chunk theo trang (PDF): `page` là số trang 1-based của chunk.
 * - Chunk theo khối (DOCX/text, từ IR segment): `blockStart`/`blockEnd`
 *   là index block IR đầu/cuối của khối (0-based, theo thứ tự xuất hiện).
 * - `questionOrders` là order hiển thị của các câu gán vào chunk này;
 *   rỗng khi chunk không gán được câu nào (không đoán, xem chunking.ts).
 */
export interface V2ChunkStatus {
  chunkIndex: number;
  status: "complete" | "partial" | "failed";
  reason?: string;
  page?: number;
  blockStart?: number;
  blockEnd?: number;
  questionOrders?: number[];
}

export interface ExtractionV2Result {
  fileName: string;
  fileType: "docx" | "pdf" | "image" | "text";
  fileSize: number;
  title: string;
  subject: string;
  totalQuestionsDetected: number;
  questions: ExtractionV2Question[];
  hasAnswerKeyTable: boolean;
  /** Chất lượng toàn tài liệu; partial/failed thì kết quả vào review, không báo hoàn tất. */
  documentQuality: V2DocumentQuality;
  /** Cảnh báo cấp tài liệu (vd lý do partial do thiếu câu — không gắn được vào câu cụ thể). */
  warnings: string[];
  /**
   * Trạng thái từng chunk; điền bằng chunking.ts (bước 19). Rỗng khi
   * kết quả chưa chạy qua chunking (vd adapter V1 → V2 thuần) — Quality
   * Gate vẫn chạy được, chỉ không có tín hiệu chunk.
   */
  chunks: V2ChunkStatus[];
  /**
   * Metadata OCR (bước 16, tùy chọn — chỉ có khi kết quả đi qua đường
   * OCR): tên engine và danh sách trang OCR lỗi (1-based). Vắng mặt =
   * kết quả không qua OCR.
   */
  ocr?: {
    engineName: string;
    failedPages: number[];
    meanConfidence?: number;
  };
  extractedAt: string;
}

// ---------------------------------------------------------------------------
// Zod schemas — bắt buộc cho dữ liệu AI (PLAN_MAIN bước 09): dữ liệu AI đưa
// vào phải qua safeParse, không tin mù. Schema KHÔNG tự điền đáp án hay
// option: correctAnswers rỗng và options rỗng đều hợp lệ (câu cần review).
// ---------------------------------------------------------------------------

export const answerOriginSchema = z.enum([
  "answer_table",
  "answer_line",
  "marker",
  "underline",
  "highlight",
  "bold",
  "solution",
  "teacher_confirmed",
  "ai_suggested",
  "none",
]);

export const answerEvidenceSchema = z.object({
  origin: answerOriginSchema,
  confidence: z.number().min(0).max(1),
  sourceExcerpt: z.string().optional(),
});

export const extractionV2QuestionSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().positive(),
  sourceNumber: z.number().int().positive().nullable(),
  sourceRef: z.string().optional(),
  content: z.string(),
  type: z.enum(["single_choice", "multiple_choice", "true_false", "unknown"]),
  options: z.array(
    z.object({ id: z.enum(["A", "B", "C", "D"]), content: z.string() })
  ),
  correctAnswers: z.array(z.enum(["A", "B", "C", "D"])),
  answerEvidence: answerEvidenceSchema.nullable(),
  status: z.enum(["verified", "needs_review"]),
  quality: z.object({
    status: z.enum(["complete", "partial"]),
    reasons: z.array(z.string()),
  }),
  explanation: z.string().optional(),
  points: z.number().positive(),
  warnings: z.array(z.string()),
  assetRefs: z.array(z.string()),
  engine: z.enum(["rule", "gemini", "manual", "ocr"]),
  page: z.number().int().positive().nullable(),
  chunkIndex: z.number().int().nonnegative().optional(),
});

export const extractionV2ResultSchema = z.object({
  fileName: z.string(),
  fileType: z.enum(["docx", "pdf", "image", "text"]),
  fileSize: z.number().nonnegative(),
  title: z.string(),
  subject: z.string(),
  totalQuestionsDetected: z.number().int().nonnegative(),
  questions: z.array(extractionV2QuestionSchema),
  hasAnswerKeyTable: z.boolean(),
  documentQuality: z.object({
    status: z.enum(["complete", "partial", "failed"]),
    parsedQuestions: z.number().int().nonnegative(),
    detectedHeaders: z.number().int().nonnegative().optional(),
    unparsedHeaders: z.number().int().nonnegative().optional(),
    invalidOptionOrders: z.array(z.number().int()).optional(),
    reasons: z.array(z.string()),
  }),
  warnings: z.array(z.string()),
  chunks: z.array(
    z.object({
      chunkIndex: z.number().int().nonnegative(),
      status: z.enum(["complete", "partial", "failed"]),
      reason: z.string().optional(),
      page: z.number().int().positive().optional(),
      blockStart: z.number().int().nonnegative().optional(),
      blockEnd: z.number().int().nonnegative().optional(),
      questionOrders: z.array(z.number().int().positive()).optional(),
    })
  ),
  ocr: z
    .object({
      engineName: z.string(),
      failedPages: z.array(z.number().int().positive()),
      meanConfidence: z.number().min(0).max(1).optional(),
    })
    .optional(),
  extractedAt: z.string(),
});

/** Validate dữ liệu V2 (đặc biệt dữ liệu AI) — trả null khi không hợp lệ, không throw. */
export function parseExtractionV2Result(
  data: unknown
): ExtractionV2Result | null {
  const parsed = extractionV2ResultSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
