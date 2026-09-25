import type { ExtractedQuestion } from "@/types/extractor";
import type { Question } from "@/types/quiz";

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
    type: "single_choice",
    options: q.options.map((opt) => ({
      id: opt.id,
      content: opt.content,
    })),
    correctAnswers: q.correctAnswers && q.correctAnswers.length > 0 ? q.correctAnswers : ["A"],
    explanation: q.explanation || "",
    points: q.points || 1,
  }));
}
