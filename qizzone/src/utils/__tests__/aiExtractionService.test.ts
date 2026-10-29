import { describe, it, expect } from "vitest";
import { AI_CONFIG } from "@/config/aiConfig";
import { extractQuizWithAI } from "@/services/aiExtractionService";

describe("AI Configuration & Extraction Service Unit Tests", () => {
  it("Cung cấp cấu hình mặc định cho mô hình mạnh nhất", () => {
    expect(AI_CONFIG.DEFAULT_MODEL).toBe("gemini-3.6-flash");
    expect(AI_CONFIG.MAX_RETRIES).toBe(3);
    expect(AI_CONFIG.TEMPERATURE).toBe(0.1);
    expect(AI_CONFIG.BATCH_SIZE).toBe(12);
    expect(AI_CONFIG.FALLBACK_MODELS.length).toBeGreaterThan(0);
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

  it("Xử lý chia đợt (batching) khi số lượng câu hỏi lớn và báo cáo tiến trình", async () => {
    const { solveMissingAnswersWithAI } = await import("@/services/aiExtractionService");
    const progressReports: string[] = [];
    const manyQuestions = Array.from({ length: 25 }, (_, i) => ({
      id: `q-${i + 1}`,
      tempId: `t-${i + 1}`,
      order: i + 1,
      content: `Câu hỏi số ${i + 1}?`,
      options: [
        { id: "A" as const, content: "Đáp án A", rawContent: "A. Đáp án A" },
        { id: "B" as const, content: "Đáp án B", rawContent: "B. Đáp án B" },
      ],
      correctAnswers: [],
      points: 0.4,
      confidenceScore: 0,
      detectionStrategy: "ai_inference" as const,
      rawTextSegment: "...",
    }));

    const res = await solveMissingAnswersWithAI(manyQuestions, (_cur, _tot, msg) => {
      if (msg) progressReports.push(msg);
    });

    expect(res).toBeDefined();
    expect(res.updatedQuestions.length).toBe(25);
    expect(progressReports.length).toBeGreaterThan(1);
    expect(progressReports[0]).toContain("25 câu");
  });
});
