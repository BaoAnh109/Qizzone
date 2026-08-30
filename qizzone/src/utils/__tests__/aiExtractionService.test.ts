import { describe, it, expect } from "vitest";
import { getGeminiApiKey, AI_CONFIG } from "@/config/aiConfig";
import { extractQuizWithAI } from "@/services/aiExtractionService";

describe("AI Configuration & Extraction Service Unit Tests", () => {
  it("Cung cấp cấu hình mặc định cho mô hình mạnh nhất", () => {
    expect(AI_CONFIG.DEFAULT_MODEL).toBe("gemini-2.0-flash");
    expect(AI_CONFIG.FALLBACK_MODEL).toBe("gemini-1.5-flash");
    expect(AI_CONFIG.TEMPERATURE).toBe(0.1);
  });

  it("Hàm getGeminiApiKey trả về chuỗi API Key từ config hoặc env", () => {
    const key = getGeminiApiKey();
    expect(typeof key).toBe("string");
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
    expect(result.questions[0].detectionStrategy).toBe("underline");
  });
});
