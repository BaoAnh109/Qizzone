import { describe, it, expect } from "vitest";
import { gradeExamSubmission, calculateAcademicRank } from "@/utils/gradingEngine";
import type { Quiz, OptionId } from "@/types/quiz";

const mockQuiz: Quiz = {
  id: "test-quiz-01",
  title: "Đề thi thử Vitest",
  subject: "Toán học 12",
  teacherId: "teacher-1",
  code: "TEST99",
  status: "published",
  settings: {
    durationMinutes: 45,
    shuffleQuestions: false,
    shuffleOptions: false,
    allowReview: true,
    maxAttempts: 0,
    passPercentage: 50,
  },
  totalQuestions: 4,
  totalPoints: 10,
  createdAt: "2026-08-30T00:00:00Z",
  updatedAt: "2026-08-30T00:00:00Z",
  questions: [
    {
      id: "q1",
      order: 1,
      content: "Câu 1: Đạo hàm của $x^2$ là?",
      type: "single_choice",
      options: [
        { id: "A", content: "$2x$" },
        { id: "B", content: "$x$" },
      ],
      correctAnswers: ["A"],
      points: 2.5,
    },
    {
      id: "q2",
      order: 2,
      content: "Câu 2: Tích phân $\\int 1 dx$ là?",
      type: "single_choice",
      options: [
        { id: "A", content: "$x + C$" },
        { id: "B", content: "$0$" },
      ],
      correctAnswers: ["A"],
      points: 2.5,
    },
    {
      id: "q3",
      order: 3,
      content: "Câu 3: $\\log_2 4$ bằng bao nhiêu?",
      type: "single_choice",
      options: [
        { id: "A", content: "$2$" },
        { id: "B", content: "$4$" },
      ],
      correctAnswers: ["A"],
      points: 2.5,
    },
    {
      id: "q4",
      order: 4,
      content: "Câu 4: $2 + 2 = ?$",
      type: "single_choice",
      options: [
        { id: "A", content: "$4$" },
        { id: "B", content: "$5$" },
      ],
      correctAnswers: ["A"],
      points: 2.5,
    },
  ],
};

describe("gradingEngine Unit Tests", () => {
  it("chấm điểm chính xác 100% khi học sinh trả lời đúng toàn bộ câu hỏi", () => {
    const answers: Record<string, OptionId[]> = {
      q1: ["A"],
      q2: ["A"],
      q3: ["A"],
      q4: ["A"],
    };

    const result = gradeExamSubmission({
      quiz: mockQuiz,
      studentId: "stu-1",
      studentName: "Nguyễn Văn A",
      answers,
      timeSpentSeconds: 600,
    });

    expect(result.score).toBe(10);
    expect(result.correctCount).toBe(4);
    expect(result.incorrectCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(result.percentage).toBe(100);
    expect(result.isPassed).toBe(true);
    expect(result.academicRank).toBe("Xuất sắc");
  });

  it("chấm điểm chính xác khi học sinh trả lời đúng một nửa số câu", () => {
    const answers: Record<string, OptionId[]> = {
      q1: ["A"],
      q2: ["A"],
      q3: ["B"], // Sai
      q4: ["B"], // Sai
    };

    const result = gradeExamSubmission({
      quiz: mockQuiz,
      studentId: "stu-2",
      studentName: "Trần Thị B",
      answers,
      timeSpentSeconds: 800,
    });

    expect(result.score).toBe(5);
    expect(result.correctCount).toBe(2);
    expect(result.incorrectCount).toBe(2);
    expect(result.percentage).toBe(50);
    expect(result.isPassed).toBe(true);
    expect(result.academicRank).toBe("Trung bình");
  });

  it("chấm điểm chính xác khi học sinh bỏ qua một số câu", () => {
    const answers: Record<string, OptionId[]> = {
      q1: ["A"],
      // q2, q3, q4 bỏ qua
    };

    const result = gradeExamSubmission({
      quiz: mockQuiz,
      studentId: "stu-3",
      studentName: "Lê Văn C",
      answers,
      timeSpentSeconds: 300,
    });

    expect(result.score).toBe(2.5);
    expect(result.correctCount).toBe(1);
    expect(result.incorrectCount).toBe(0);
    expect(result.skippedCount).toBe(3);
    expect(result.percentage).toBe(25);
    expect(result.isPassed).toBe(false);
    expect(result.academicRank).toBe("Yếu");
  });

  it("phân loại đúng học lực tương ứng với thang điểm chuẩn", () => {
    expect(calculateAcademicRank(9.5)).toBe("Xuất sắc");
    expect(calculateAcademicRank(9.0)).toBe("Xuất sắc");
    expect(calculateAcademicRank(8.5)).toBe("Giỏi");
    expect(calculateAcademicRank(8.0)).toBe("Giỏi");
    expect(calculateAcademicRank(7.5)).toBe("Khá");
    expect(calculateAcademicRank(6.5)).toBe("Khá");
    expect(calculateAcademicRank(5.0)).toBe("Trung bình");
    expect(calculateAcademicRank(4.5)).toBe("Yếu");
    expect(calculateAcademicRank(0)).toBe("Yếu");
  });
});
