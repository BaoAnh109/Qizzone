import type { Quiz, OptionId } from "@/types/quiz";
import type { ExamResult, QuestionGradingDetail } from "@/types/exam";

export function gradeExamSubmission(params: {
  quiz: Quiz;
  studentId: string;
  studentName: string;
  studentClass?: string;
  answers: Record<string, OptionId[]>;
  timeSpentSeconds: number;
}): ExamResult {
  const { quiz, studentId, studentName, studentClass, answers, timeSpentSeconds } =
    params;

  let totalPointsEarned = 0;
  let maxTotalPoints = 0;
  let correctCount = 0;
  let incorrectCount = 0;
  let skippedCount = 0;
  let answeredCount = 0;

  const details: QuestionGradingDetail[] = quiz.questions.map((q) => {
    const selected = answers[q.id] || [];
    const isAnswered = selected.length > 0;
    const maxPoints = q.points || 1;
    maxTotalPoints += maxPoints;

    if (!isAnswered) {
      skippedCount++;
    } else {
      answeredCount++;
    }

    // Determine correctness (exact match of arrays)
    const sortedSelected = [...selected].sort().join(",");
    const sortedCorrect = [...q.correctAnswers].sort().join(",");
    const isCorrect = isAnswered && sortedSelected === sortedCorrect;

    let pointsEarned = 0;
    if (isCorrect) {
      correctCount++;
      pointsEarned = maxPoints;
      totalPointsEarned += maxPoints;
    } else if (isAnswered) {
      incorrectCount++;
    }

    return {
      questionId: q.id,
      order: q.order,
      content: q.content,
      options: q.options,
      selectedAnswers: selected,
      correctAnswers: q.correctAnswers,
      isCorrect,
      pointsEarned,
      maxPoints,
      explanation: q.explanation,
    };
  });

  // Calculate score scaled to 10 points
  const rawScore =
    maxTotalPoints > 0 ? (totalPointsEarned / maxTotalPoints) * 10 : 0;
  const score = Math.round(rawScore * 100) / 100;
  const percentage = Math.round((totalPointsEarned / maxTotalPoints) * 100);

  const passPercentage = quiz.settings.passPercentage ?? 50;
  const isPassed = percentage >= passPercentage;

  const resultId = `res-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

  return {
    id: resultId,
    quizId: quiz.id,
    quizTitle: quiz.title,
    subject: quiz.subject,
    roomCode: quiz.code,
    studentId,
    studentName,
    studentClass,
    totalQuestions: quiz.questions.length,
    answeredCount,
    correctCount,
    incorrectCount,
    skippedCount,
    score,
    totalPointsEarned,
    maxTotalPoints,
    percentage,
    isPassed,
    passPercentage,
    timeSpentSeconds,
    details,
    submittedAt: new Date().toISOString(),
  };
}
