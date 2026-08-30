import { describe, it, expect } from "vitest";
import { quizSettingsSchema, questionSchema } from "@/lib/validations/quiz";

describe("Quiz Zod Validation Schemas Unit Tests", () => {
  it("chấp nhận maxAttempts = 0 (Vô hạn) và các số nguyên dương", () => {
    const validSettings = {
      durationMinutes: 45,
      shuffleQuestions: true,
      shuffleOptions: true,
      allowReview: true,
      maxAttempts: 0,
      passPercentage: 50,
    };

    const parseResult = quizSettingsSchema.safeParse(validSettings);
    expect(parseResult.success).toBe(true);
  });

  it("từ chối khi maxAttempts là số âm", () => {
    const invalidSettings = {
      durationMinutes: 45,
      shuffleQuestions: false,
      shuffleOptions: false,
      allowReview: true,
      maxAttempts: -1,
      passPercentage: 50,
    };

    const parseResult = quizSettingsSchema.safeParse(invalidSettings);
    expect(parseResult.success).toBe(false);
  });

  it("từ chối khi passPercentage vượt quá 100%", () => {
    const invalidSettings = {
      durationMinutes: 45,
      shuffleQuestions: false,
      shuffleOptions: false,
      allowReview: true,
      maxAttempts: 1,
      passPercentage: 105,
    };

    const parseResult = quizSettingsSchema.safeParse(invalidSettings);
    expect(parseResult.success).toBe(false);
  });

  it("validate câu hỏi trắc nghiệm hợp lệ với đáp án đúng nằm trong options", () => {
    const validQuestion = {
      content: "Tìm nghiệm phương trình $x + 1 = 0$",
      type: "single_choice",
      options: [
        { id: "A", content: "$x = -1$" },
        { id: "B", content: "$x = 1$" },
      ],
      correctAnswers: ["A"],
      points: 1,
    };

    const parseResult = questionSchema.safeParse(validQuestion);
    expect(parseResult.success).toBe(true);
  });

  it("từ chối câu hỏi khi đáp án đúng không tồn tại trong options", () => {
    const invalidQuestion = {
      content: "Câu hỏi lỗi",
      type: "single_choice",
      options: [
        { id: "A", content: "Đáp án A" },
        { id: "B", content: "Đáp án B" },
      ],
      correctAnswers: ["C"], // C không có trong options
      points: 1,
    };

    const parseResult = questionSchema.safeParse(invalidQuestion);
    expect(parseResult.success).toBe(false);
  });
});
