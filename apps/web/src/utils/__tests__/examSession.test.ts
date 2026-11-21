import { describe, it, expect } from "vitest";
import { isSessionInProgress } from "@/store/examSessionStore";
import type { ExamSession } from "@/types/exam";

describe("examSession isSessionInProgress Unit Tests", () => {
  it("trả về false khi session undefined", () => {
    expect(isSessionInProgress(undefined)).toBe(false);
  });

  it("trả về false khi session đã được nộp bài (isSubmitted = true)", () => {
    const session: ExamSession = {
      quizId: "q1",
      studentId: "s1",
      studentName: "Test",
      startTime: Date.now() - 10000,
      endTime: Date.now() + 50000,
      durationMinutes: 45,
      answers: {},
      flaggedQuestionIds: [],
      currentQuestionIndex: 0,
      isSubmitted: true,
      lastSavedAt: new Date().toISOString(),
    };
    expect(isSessionInProgress(session)).toBe(false);
  });

  it("trả về true khi đề thi vô thời hạn (durationMinutes = 0) và chưa nộp", () => {
    const session: ExamSession = {
      quizId: "q1",
      studentId: "s1",
      studentName: "Test",
      startTime: Date.now() - 100000,
      endTime: 0,
      durationMinutes: 0,
      answers: {},
      flaggedQuestionIds: [],
      currentQuestionIndex: 0,
      isSubmitted: false,
      lastSavedAt: new Date().toISOString(),
    };
    expect(isSessionInProgress(session)).toBe(true);
  });

  it("trả về true khi thời gian hiện tại còn trong hạn (Date.now() < endTime)", () => {
    const session: ExamSession = {
      quizId: "q1",
      studentId: "s1",
      studentName: "Test",
      startTime: Date.now() - 10000,
      endTime: Date.now() + 100000, // Còn 100s
      durationMinutes: 15,
      answers: {},
      flaggedQuestionIds: [],
      currentQuestionIndex: 0,
      isSubmitted: false,
      lastSavedAt: new Date().toISOString(),
    };
    expect(isSessionInProgress(session)).toBe(true);
  });

  it("trả về false khi đã quá giờ làm bài (Date.now() >= endTime)", () => {
    const session: ExamSession = {
      quizId: "q1",
      studentId: "s1",
      studentName: "Test",
      startTime: Date.now() - 200000,
      endTime: Date.now() - 1000, // Đã hết hạn cách đây 1s
      durationMinutes: 15,
      answers: {},
      flaggedQuestionIds: [],
      currentQuestionIndex: 0,
      isSubmitted: false,
      lastSavedAt: new Date().toISOString(),
    };
    expect(isSessionInProgress(session)).toBe(false);
  });
});
