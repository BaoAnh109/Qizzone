import { z } from "zod";
import type { ExtractionResult } from "@/types/extractor";
import {
  parseExtractionV2Result,
  type ExtractionV2Result,
} from "@/types/extractionV2";
import { fromV1Result } from "./v2Adapter";
import {
  assessExtractionQuality,
  type QualityGateIssue,
  type QualityGateStatus,
} from "./qualityGate";
import {
  validateEvidence,
  type EvidenceValidationResult,
} from "./evidenceValidator";

/**
 * Bước 18 (PLAN_MAIN, giai đoạn E): structured outputs cho đường AI
 * extraction — output thô của AI phải khớp schema chặt trước khi được
 * parse thành ExtractionResult. Nguyên tắc phân tầng (giữ hành vi các
 * bước trước, không sửa lặng lẽ):
 *
 * - Tầng schema (ở đây): chỉ kiểm tra HÌNH THỨC — kiểu dữ liệu và giá
 *   trị enum mà prompt đã khai báo (id phương án A–D, origin bằng chứng
 *   trong tập cho phép, questions là mảng không rỗng). Output không khớp
 *   → bị TỪ CHỐI toàn bộ (parseAIResult trả null) → nhánh fallback của
 *   extractQuizWithAI (text → parser luật, ảnh → throw). KHÔNG retry
 *   bằng cách gọi lại model: lỗi schema không phải lỗi transient, gọi
 *   lại chỉ tốn quota mà không sửa được output sai dạng.
 * - Tầng ngữ nghĩa (parseAIResult, bước 12/17): type lạ → mapper suy
 *   luận, confidence ngoài 0–1 → 0, đáp án không bằng chứng → [], đáp
 *   án ngoài phương án → lược. Các trường scalar không có thì chấp nhận
 *   null (AI hay trả null) và để tầng dưới điền mặc định — đó KHÔNG phải
 *   "sửa lặng lẽ thành đáp án hợp lệ" vì không đáp án nào được bịa thêm.
 *
 * Vì vậy schema cố tình KHÔNG siết: khoảng giá trị confidence (tầng dưới
 * clamp), giá trị type (tầng dưới normalize), order (tầng dưới fallback
 * theo vị trí). Những gì schema siết là thứ mà tầng dưới không thể sửa
 * an toàn: id/enum sai tập, kiểu trường sai, questions không phải mảng.
 */

/** Origin bằng chứng mà prompt extraction cho phép AI khai báo. */
const aiAnswerOriginSchema = z.enum([
  "answer_table",
  "answer_line",
  "marker",
  "underline",
  "highlight",
  "bold",
  "solution",
  "none",
  "null",
]);

const aiAnswerEvidenceSchema = z.object({
  origin: aiAnswerOriginSchema,
  excerpt: z.string().nullish(),
});

const aiQuestionPayloadSchema = z.object({
  order: z.number().int().nullish(),
  content: z.string(),
  type: z.string().nullish(),
  options: z.array(
    z.object({ id: z.enum(["A", "B", "C", "D"]), content: z.string() })
  ),
  correctAnswers: z.array(z.enum(["A", "B", "C", "D"])).nullish(),
  explanation: z.string().nullish(),
  confidenceScore: z.number().nullish(),
  /** Trường do AI tự gửi — schema chấp nhận nhưng tầng parse BỎ QUA (bước 17). */
  detectionStrategy: z.string().nullish(),
  answerEvidence: aiAnswerEvidenceSchema.nullable().optional(),
});

/** Schema output thô của AI extraction — đúng schema mà SYSTEM_PROMPT khai báo. */
export const aiExtractionOutputSchema = z.object({
  title: z.string().nullish(),
  subject: z.string().nullish(),
  questions: z.array(aiQuestionPayloadSchema).min(1),
});

export type AIStructuredOutput = z.infer<typeof aiExtractionOutputSchema>;

export type AIStructuredParseResult =
  | { ok: true; data: AIStructuredOutput }
  | { ok: false; issues: string[] };

/**
 * Validate output thô của AI theo schema chặt. Trả issues dạng
 * "đường_dẫn: thông_báo" để log/fallback có lý do rõ ràng, không throw.
 * Hàm thuần, export để test đơn vị mà không cần gọi Gemini thật.
 */
export function parseAIStructuredOutput(
  data: unknown
): AIStructuredParseResult {
  const parsed = aiExtractionOutputSchema.safeParse(data);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    }),
  };
}

export interface AIValidationReport {
  /** false khi V2 không qua được Zod (không xảy ra với output đã qua parseAIResult — guard phòng thủ). */
  valid: boolean;
  v2: ExtractionV2Result | null;
  qualityStatus: QualityGateStatus | null;
  qualityIssues: QualityGateIssue[];
  evidenceSummary: EvidenceValidationResult["summary"] | null;
}

/**
 * Bước 18: validate kết quả AI (đã qua parseAIResult) bằng Zod V2 +
 * Quality Gate (bước 10) + Evidence Validator (bước 11) TRƯỚC khi đưa
 * vào store. Hàm thuần, không gọi AI, không đọc file.
 *
 * - V2 không qua Zod → valid: false (caller coi như từ chối).
 * - Quality Gate / Evidence Validator ở đây chỉ ĐO và báo cáo: các vấn
 *   đề mềm (thiếu đáp án, needs_review, unchecked) đã nằm trong
 *   warningFlags/status từng câu và KHÔNG chặn kết quả — chặn xuất bản
 *   là việc của gate publish (bước 04/08/25). Chỉ quality "failed" mới
 *   là tín hiệu từ chối ở caller.
 * - Evidence Validator chạy KHÔNG context nguồn (AI path không có flag
 *   định dạng gốc) nên verdict "unchecked" là bình thường, không phải lỗi.
 */
export function validateAIExtractionResult(
  v1: ExtractionResult
): AIValidationReport {
  const v2 = fromV1Result(v1);
  const parsed = parseExtractionV2Result(v2);
  if (!parsed) {
    return {
      valid: false,
      v2: null,
      qualityStatus: null,
      qualityIssues: [],
      evidenceSummary: null,
    };
  }
  const quality = assessExtractionQuality(parsed);
  const evidence = validateEvidence(parsed);
  return {
    valid: true,
    v2: parsed,
    qualityStatus: quality.status,
    qualityIssues: quality.issues,
    evidenceSummary: evidence.summary,
  };
}
