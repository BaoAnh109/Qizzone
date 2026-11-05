import type { ExtractedQuestion } from "@/types/extractor";
import type { OptionId, Question, QuestionType } from "@/types/quiz";

/**
 * Diagnostic do mapper phát hiện khi câu trích xuất chưa đủ điều kiện
 * xuất bản. Mapper KHÔNG tự sửa dữ liệu (không gán đáp án giả) — nó
 * chỉ báo cáo, để flow finalization (BatchActionBar / CreateQuiz)
 * quyết định chặn xuất bản hay yêu cầu giáo viên chọn đáp án.
 */
export type MappingDiagnosticCode =
  | "missing_answer"
  | "insufficient_options"
  | "answer_not_in_options"
  | "type_answer_mismatch"
  | "unknown_type";

export type QuestionTypeSource =
  | "explicit"
  | "inferred_true_false"
  | "inferred_multiple"
  | "fallback_single";

export interface ResolvedQuestionType {
  type: QuestionType;
  source: QuestionTypeSource;
}

const VALID_QUESTION_TYPES: ReadonlySet<string> = new Set([
  "single_choice",
  "multiple_choice",
  "true_false",
]);

/** Chuẩn hóa nội dung phương án để nhận diện cặp Đúng/Sai (bỏ khoảng trắng thừa, chữ hoa, dấu câu cuối). */
function normalizeOptionText(content: string): string {
  return content
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.:;)\]]+$/g, "");
}

/**
 * Bước 12: xác định type câu hỏi ở tầng map — KHÔNG ép mọi câu thành
 * single_choice như trước. Thứ tự ưu tiên (phân loại dữ liệu đã có, không
 * bịa đáp án hay phương án):
 * 1. `questionType` tường minh từ nguồn (AI passthrough, parser bước 13/14) nếu hợp lệ.
 * 2. Đúng 2 phương án với nội dung là cặp {đúng, sai} → true_false
 *    (quy ước fixture f06: Đúng=A, Sai=B).
 * 3. Hơn 1 đáp án đúng → multiple_choice (câu một đáp án không thể có
 *    2 đáp án đúng — suy luận này là bắt buộc, không phải phỏng đoán).
 * 4. Còn lại → single_choice theo hành vi cũ của main (fallback).
 */
export function resolveQuestionType(
  q: Pick<ExtractedQuestion, "questionType" | "options" | "correctAnswers">
): ResolvedQuestionType {
  if (q.questionType && VALID_QUESTION_TYPES.has(q.questionType)) {
    return { type: q.questionType, source: "explicit" };
  }
  const options = q.options || [];
  if (options.length === 2) {
    const texts = options.map((opt) => normalizeOptionText(opt.content));
    if (
      texts.includes("đúng") &&
      texts.includes("sai") &&
      new Set(texts).size === 2
    ) {
      return { type: "true_false", source: "inferred_true_false" };
    }
  }
  const answers = q.correctAnswers || [];
  if (answers.length > 1) {
    return { type: "multiple_choice", source: "inferred_multiple" };
  }
  return { type: "single_choice", source: "fallback_single" };
}

export interface MappingDiagnostic {
  questionId: string;
  order: number;
  code: MappingDiagnosticCode;
  message: string;
  /** true = finalization phải chặn xuất bản khi diagnostic này còn tồn tại. */
  blocksPublish: boolean;
}

export function validateExtractedQuestions(
  extractedQuestions: ExtractedQuestion[]
): MappingDiagnostic[] {
  const diagnostics: MappingDiagnostic[] = [];
  extractedQuestions.forEach((q, idx) => {
    const order = q.order || idx + 1;
    const questionId = q.id || `q-ext-${idx}`;
    const optionIds = new Set<OptionId>(q.options.map((opt) => opt.id));
    if (q.options.length < 2) {
      diagnostics.push({
        questionId,
        order,
        code: "insufficient_options",
        message: `Câu ${order} có dưới 2 phương án (${q.options.length}) — không đủ để xuất bản.`,
        blocksPublish: true,
      });
    }
    const answers = q.correctAnswers || [];
    // Bước 12: type một đáp án (single/true_false) nhưng có nhiều đáp án
    // đúng là dữ liệu mâu thuẫn — chặn xuất bản để giáo viên sửa type
    // hoặc đáp án, không tự cắt đáp án hay tự đổi type. multiple_choice
    // với nhiều đáp án là hợp lệ nên không chẩn đoán ở đây.
    const resolved = resolveQuestionType(q);
    if (
      answers.length > 1 &&
      (resolved.type === "single_choice" || resolved.type === "true_false")
    ) {
      diagnostics.push({
        questionId,
        order,
        code: "type_answer_mismatch",
        message: `Câu ${order} là loại ${resolved.type} nhưng có ${answers.length} đáp án đúng — cần sửa loại câu hoặc đáp án trước khi xuất bản.`,
        blocksPublish: true,
      });
    }
    if (answers.length === 0) {
      diagnostics.push({
        questionId,
        order,
        code: "missing_answer",
        message: `Câu ${order} chưa có đáp án từ tài liệu — cần giáo viên chọn hoặc giải bằng AI, không tự gán đáp án.`,
        blocksPublish: true,
      });
    } else {
      for (const answer of answers) {
        if (!optionIds.has(answer)) {
          diagnostics.push({
            questionId,
            order,
            code: "answer_not_in_options",
            message: `Câu ${order} có đáp án ${answer} không nằm trong các phương án — cần giáo viên sửa.`,
            blocksPublish: true,
          });
        }
      }
    }
  });
  return diagnostics;
}

/** Các diagnostic chặn xuất bản (bước 04: mọi diagnostic hiện có đều chặn). */
export function getPublishBlockers(
  diagnostics: MappingDiagnostic[]
): MappingDiagnostic[] {
  return diagnostics.filter((d) => d.blocksPublish);
}

/**
 * Maps an array of ExtractedQuestion (from file extraction / AI) to standard Quiz Question objects.
 *
 * KHÔNG fallback đáp án: câu chưa có đáp án giữ nguyên `correctAnswers: []`.
 * Trước đây mapper tự biến [] thành ["A"] — đáp án giả, vi phạm nguyên tắc
 * Extraction ≠ Solving của PLAN_MAIN (bước 04). Việc chặn xuất bản hay yêu
 * cầu giáo viên chọn đáp án thuộc về flow finalization, dựa trên
 * validateExtractedQuestions() / getPublishBlockers().
 *
 * Bước 12: type được giữ theo resolveQuestionType() — KHÔNG còn ép mọi
 * câu thành single_choice. Chỉ fallback về single_choice khi nguồn không
 * cho biết type và dữ liệu cũng không suy ra được loại khác.
 */
export function mapExtractedQuestionsToQuizQuestions(
  extractedQuestions: ExtractedQuestion[]
): Question[] {
  return extractedQuestions.map((q, idx) => ({
    id: q.id || `q-ext-${Date.now().toString(36)}-${idx}`,
    order: idx + 1,
    content: q.content,
    type: resolveQuestionType(q).type,
    options: q.options.map((opt) => ({
      id: opt.id,
      content: opt.content,
    })),
    correctAnswers: q.correctAnswers ? [...q.correctAnswers] : [],
    explanation: q.explanation || "",
    points: q.points || 1,
  }));
}
