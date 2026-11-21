import type { ExtractedQuestion } from "@qizzone/domain";
import type { Question } from "@qizzone/domain";

/**
 * Maps an array of ExtractedQuestion (from file extraction / AI) to standard Quiz Question objects.
 */
export function mapExtractedQuestionsToQuizQuestions(
  extractedQuestions: ExtractedQuestion[]
): Question[] {
  return extractedQuestions.map((q, idx) => ({
    id: q.id || `q-ext-${Date.now().toString(36)}-${idx}`,
    order: idx + 1,
    content: q.content,
    ...(q.images?.length ? { images: q.images } : {}),
    type: "single_choice",
    options: q.options.map((opt) => ({
      id: opt.id,
      content: opt.content,
      ...(opt.images?.length ? { images: opt.images } : {}),
    })),
    correctAnswers: q.correctAnswers || [],
    explanation: q.explanation || "",
    points: q.points || 1,
  }));
}
