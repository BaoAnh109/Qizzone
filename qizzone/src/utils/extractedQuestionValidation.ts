import type { ExtractedQuestion } from "@/types/extractor";

/**
 * Validates extracted questions BEFORE converting them to Quiz entities.
 * Incomplete extraction must remain in review; it must not be saved as a
 * published quiz with guessed answers or fabricated options.
 */
export function getExtractedQuestionIssues(questions: readonly ExtractedQuestion[]): string[] {
  const issues: string[] = [];

  questions.forEach((question, index) => {
    const label = `Câu ${question.order || index + 1}`;
    const content = question.content.trim();
    if (!content || content.startsWith("Nhập nội dung câu hỏi mới tại đây")) {
      issues.push(`${label}: thiếu nội dung câu hỏi hợp lệ.`);
    }

    if (question.options.length < 2 || question.options.length > 4) {
      issues.push(`${label}: cần từ 2 đến 4 phương án được nhận diện.`);
    }

    const ids = question.options.map((option) => option.id);
    if (new Set(ids).size !== ids.length) {
      issues.push(`${label}: phương án trùng ký hiệu A/B/C/D.`);
    }
    if (question.options.some((option) =>
      !option.content.trim() || /^Lựa chọn [A-D]$/.test(option.content.trim())
    )) {
      issues.push(`${label}: có phương án trống hoặc chỉ chứa nội dung mẫu.`);
    }

    if (question.correctAnswers.length === 0) {
      issues.push(`${label}: chưa có đáp án đúng.`);
    } else if (question.correctAnswers.some((answer) => !ids.includes(answer))) {
      issues.push(`${label}: đáp án đúng không tồn tại trong các phương án.`);
    }

    // The current mapper produces single-choice questions only. Do not silently
    // publish a multi-answer question as single-choice until type support exists.
    if (question.correctAnswers.length > 1) {
      issues.push(`${label}: có nhiều đáp án; cần hỗ trợ loại câu multiple_choice trước khi lưu.`);
    }
  });

  return issues;
}
