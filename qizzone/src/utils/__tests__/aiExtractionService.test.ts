import { describe, it, expect } from "vitest";
import { AI_CONFIG } from "@/config/aiConfig";
import { extractQuizWithAI } from "@/services/aiExtractionService";

describe("AI Configuration & Extraction Service Unit Tests", () => {
  it("Cung cấp cấu hình mặc định cho mô hình mạnh nhất", () => {
    expect(AI_CONFIG.DEFAULT_MODEL).toBe("gemini-3.6-flash");
    expect(AI_CONFIG.FALLBACK_MODEL).toBe("gemini-2.5-flash");
    expect(AI_CONFIG.TEMPERATURE).toBe(0.1);
  });

  it("Bóc tách văn bản qua AI Service chuyển đổi thành công ExtractionResult", async () => {
    const rawText = `
Câu 1: Cho hàm số $y = f(x)$. Đạo hàm của $x^2$ là:
A. $x$
<u>B. $2x$</u>
C. $3x$
D. $4x$
`;
    const result = await extractQuizWithAI({
      text: rawText,
    });

    expect(result).not.toBeNull();
    expect(result.questions.length).toBe(1);
    expect(result.questions[0].correctAnswers).toEqual(["B"]);
    expect(["underline", "visual_marker", "ai_inference"]).toContain(
      result.questions[0].detectionStrategy
    );
  });

  it("Hàm solveMissingAnswersWithAI xử lý danh sách câu hỏi chưa có đáp án an toàn", async () => {
    const { solveMissingAnswersWithAI } = await import("@/services/aiExtractionService");
    const sampleQuestions = [
      {
        id: "q-1",
        tempId: "t-1",
        order: 1,
        content: "Thủ đô của Pháp là gì?",
        options: [
          { id: "A" as const, content: "London", rawContent: "A. London" },
          { id: "B" as const, content: "Paris", rawContent: "B. Paris" },
          { id: "C" as const, content: "Berlin", rawContent: "C. Berlin" },
          { id: "D" as const, content: "Rome", rawContent: "D. Rome" },
        ],
        correctAnswers: [],
        points: 1,
        confidenceScore: 0,
        detectionStrategy: "ai_inference" as const,
        rawTextSegment: "...",
      },
    ];

    const res = await solveMissingAnswersWithAI(sampleQuestions);
    expect(res).toBeDefined();
    expect(res.updatedQuestions.length).toBe(1);
    expect(res.updatedQuestions[0].options.length).toBe(4);
  }, 20000);
});
