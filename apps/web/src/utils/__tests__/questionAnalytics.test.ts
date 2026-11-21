import { describe, expect, it } from "vitest";
import type { ExamResult } from "@/types/exam";
import type { Question } from "@/types/quiz";
import {
  buildQuestionAnalyticsCsv,
  calculateQuestionAnalytics,
} from "@/utils/questionAnalytics";

const questions: Question[] = [
  {
    id: "q-1",
    order: 1,
    content: "Thủ đô của Pháp là gì?",
    type: "single_choice",
    options: [
      { id: "A", content: "London" },
      { id: "B", content: "Paris" },
      { id: "C", content: "Berlin" },
      { id: "D", content: "Rome" },
    ],
    correctAnswers: ["B"],
    points: 1,
  },
  {
    id: "q-2",
    order: 2,
    content: 'Tìm x, rồi ghi "kết quả"',
    type: "multiple_choice",
    options: [
      { id: "A", content: "A" },
      { id: "B", content: "B" },
    ],
    correctAnswers: ["A", "B"],
    points: 1,
  },
];

function result(
  id: string,
  details: ExamResult["details"],
): ExamResult {
  return {
    id,
    quizId: "quiz-1",
    quizTitle: "Kiểm tra Toán",
    subject: "Toán",
    roomCode: "QZ1234",
    studentId: `student-${id}`,
    studentName: `Học sinh ${id}`,
    totalQuestions: 2,
    answeredCount: 1,
    correctCount: 1,
    incorrectCount: 0,
    skippedCount: 1,
    score: 5,
    totalPointsEarned: 1,
    maxTotalPoints: 2,
    percentage: 50,
    isPassed: true,
    passPercentage: 50,
    academicRank: "Trung bình",
    timeSpentSeconds: 30,
    details,
    submittedAt: "2026-10-01T10:00:00.000Z",
  };
}

const questionDetail = (
  questionId: string,
  selectedAnswers: ExamResult["details"][number]["selectedAnswers"],
  isCorrect: boolean,
): ExamResult["details"][number] => ({
  questionId,
  order: questionId === "q-1" ? 1 : 2,
  content: "Nội dung câu",
  options: questions.find((question) => question.id === questionId)!.options,
  selectedAnswers,
  correctAnswers: questionId === "q-1" ? ["B"] : ["A", "B"],
  isCorrect,
  pointsEarned: isCorrect ? 1 : 0,
  maxPoints: 1,
});

describe("question analytics", () => {
  it("counts correct, incorrect, skipped attempts and option selections per question", () => {
    const analytics = calculateQuestionAnalytics(questions, [
      result("1", [questionDetail("q-1", ["B"], true), questionDetail("q-2", [], false)]),
      result("2", [questionDetail("q-1", ["A"], false), questionDetail("q-2", ["A", "B"], true)]),
      result("3", [questionDetail("q-1", [], false), questionDetail("q-2", ["A"], false)]),
    ]);

    expect(analytics[0]).toMatchObject({
      attemptCount: 3,
      answeredCount: 2,
      correctCount: 1,
      skippedCount: 1,
      accuracyPercent: 33,
      optionCounts: { A: 1, B: 1, C: 0, D: 0 },
    });
    expect(analytics[1]).toMatchObject({
      attemptCount: 3,
      answeredCount: 2,
      correctCount: 1,
      skippedCount: 1,
      optionCounts: { A: 2, B: 1, C: 0, D: 0 },
    });
  });

  it("excludes results without question details instead of counting them as skipped", () => {
    const analytics = calculateQuestionAnalytics(questions, [result("legacy", [])]);
    expect(analytics[0].attemptCount).toBe(0);
    expect(analytics[0].skippedCount).toBe(0);
  });

  it("exports counts with CSV quoting and formula protection without answer keys", () => {
    const analytics = calculateQuestionAnalytics(questions, [
      result("1", [questionDetail("q-1", ["B"], true)]),
    ]);
    const csv = buildQuestionAnalyticsCsv("=Đề, \"Toán\"", analytics);

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("'=Đề, \"\"Toán\"\"");
    expect(csv).toContain('"Thủ đô của Pháp là gì?"');
    expect(csv).toContain('"Lượt chọn B"');
    expect(csv).not.toContain('"Đáp án đúng"');
    expect(csv).not.toContain('"correctAnswers"');
  });
});
