import type { ExamResult } from "@/types/exam";
import type { OptionId, OptionItem, Question } from "@/types/quiz";

export interface QuestionAnalytics {
  questionId: string;
  order: number;
  content: string;
  options: OptionItem[];
  attemptCount: number;
  answeredCount: number;
  correctCount: number;
  skippedCount: number;
  accuracyPercent: number;
  optionCounts: Record<OptionId, number>;
}

const OPTION_IDS: OptionId[] = ["A", "B", "C", "D"];

export function calculateQuestionAnalytics(
  questions: Pick<Question, "id" | "order" | "content" | "options">[],
  results: ExamResult[],
): QuestionAnalytics[] {
  return [...questions]
    .sort((a, b) => a.order - b.order)
    .map((question) => {
      const optionCounts = Object.fromEntries(
        OPTION_IDS.map((id) => [id, 0]),
      ) as Record<OptionId, number>;
      let attemptCount = 0;
      let answeredCount = 0;
      let correctCount = 0;
      let skippedCount = 0;

      for (const result of results) {
        const detail = Array.isArray(result.details)
          ? result.details.find((item) => item.questionId === question.id)
          : undefined;
        if (!detail) continue;

        attemptCount += 1;
        if (detail.selectedAnswers.length === 0) {
          skippedCount += 1;
        } else {
          answeredCount += 1;
        }
        if (detail.isCorrect) correctCount += 1;
        for (const optionId of detail.selectedAnswers) {
          if (OPTION_IDS.includes(optionId)) optionCounts[optionId] += 1;
        }
      }

      return {
        questionId: question.id,
        order: question.order,
        content: question.content,
        options: question.options,
        attemptCount,
        answeredCount,
        correctCount,
        skippedCount,
        accuracyPercent:
          attemptCount === 0 ? 0 : Math.round((correctCount / attemptCount) * 100),
        optionCounts,
      };
    });
}

function csvField(value: string | number): string {
  const raw = String(value);
  const startsWithFormula = /^[=+\-@]/.test(raw.trimStart());
  const safe = startsWithFormula ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildQuestionAnalyticsCsv(
  quizTitle: string,
  analytics: QuestionAnalytics[],
): string {
  const headers = [
    "Câu",
    "Nội dung câu hỏi",
    "Lượt có dữ liệu",
    "Đã trả lời",
    "Đúng",
    "Bỏ trống",
    "Tỷ lệ đúng (%)",
    ...OPTION_IDS.map((id) => `Lượt chọn ${id}`),
  ];
  const rows = analytics.map((item) => [
    item.order,
    item.content,
    item.attemptCount,
    item.answeredCount,
    item.correctCount,
    item.skippedCount,
    item.accuracyPercent,
    ...OPTION_IDS.map((id) => item.optionCounts[id]),
  ]);

  return (
    "\uFEFF" +
    [
      ["Tên đề", csvField(quizTitle)].join(","),
      headers.map(csvField).join(","),
      ...rows.map((row) => row.map(csvField).join(",")),
    ].join("\r\n")
  );
}
