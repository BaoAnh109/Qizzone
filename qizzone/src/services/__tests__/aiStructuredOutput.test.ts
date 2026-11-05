import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock đường Edge Function để kiểm chứng retry/fallback mà KHÔNG gọi
// Gemini thật (chưa có API/quota). aiExtractionService chỉ dùng edge +
// errorMessage từ @/lib/cloud nên mock đúng 2 hàm này là đủ; các module
// khác trong chuỗi import không chạm tới cloud.
const edgeMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/cloud", () => ({
  edge: edgeMock,
  errorMessage: (e: unknown) =>
    e instanceof Error ? e.message : "Lỗi không xác định",
}));

import { parseAIStructuredOutput } from "@/services/extraction/aiStructuredOutput";
import {
  parseAIResult,
  extractQuizWithAI,
} from "@/services/aiExtractionService";
import { validateAIExtractionResult } from "@/services/extraction/aiStructuredOutput";

const baseOptions = [
  { id: "A", content: "Đáp án A" },
  { id: "B", content: "Đáp án B" },
  { id: "C", content: "Đáp án C" },
  { id: "D", content: "Đáp án D" },
];

const validPayload = {
  title: "Đề",
  subject: "Toán",
  questions: [
    {
      order: 1,
      content: "2 + 2 = ?",
      type: "single_choice",
      options: baseOptions,
      correctAnswers: ["C"],
      confidenceScore: 0.95,
      answerEvidence: { origin: "highlight", excerpt: "C. 4" },
    },
  ],
};

describe("Bước 18: schema chặt cho output AI (Zod, không gọi Gemini thật)", () => {
  it("payload đúng schema → ok", () => {
    const parsed = parseAIStructuredOutput(validPayload);
    expect(parsed.ok).toBe(true);
  });

  it("payload đúng schema vẫn ok khi trường không có để null (AI hay trả null)", () => {
    const parsed = parseAIStructuredOutput({
      title: null,
      subject: null,
      questions: [
        {
          order: 1,
          content: "Câu 1?",
          options: baseOptions,
          correctAnswers: [],
          explanation: null,
          confidenceScore: null,
          answerEvidence: null,
        },
      ],
    });
    expect(parsed.ok).toBe(true);
  });

  it.each([
    ["questions không phải mảng", { questions: "không phải mảng" }],
    ["questions rỗng", { questions: [] }],
    ["content không phải chuỗi", {
      questions: [{ content: 123, options: baseOptions }],
    }],
    ["option id ngoài A–D", {
      questions: [{
        content: "Câu 1?",
        options: [{ id: "E", content: "Đáp án E" }],
      }],
    }],
    ["options không phải mảng", {
      questions: [{ content: "Câu 1?", options: null }],
    }],
    ["correctAnswers chứa id ngoài A–D", {
      questions: [{
        content: "Câu 1?", options: baseOptions, correctAnswers: ["E"],
      }],
    }],
    ["answerEvidence origin ngoài tập khai báo", {
      questions: [{
        content: "Câu 1?", options: baseOptions, correctAnswers: ["A"],
        answerEvidence: { origin: "guessed", excerpt: "A" },
      }],
    }],
    ["confidenceScore không phải số", {
      questions: [{
        content: "Câu 1?", options: baseOptions,
        confidenceScore: "cao",
      }],
    }],
  ])("schema từ chối: %s", (_label, payload) => {
    const parsed = parseAIStructuredOutput(payload);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues.length).toBeGreaterThan(0);
  });

  it("issues ghi rõ đường dẫn trường lỗi", () => {
    const parsed = parseAIStructuredOutput({
      questions: [{ content: "Câu 1?", options: [{ id: "E", content: "x" }] }],
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issues.join(" ")).toContain("questions.0.options.0.id");
    }
  });
});

describe("Bước 18: parseAIResult — schema gate + đáp án phải nằm trong phương án", () => {
  it("đáp án ngoài phương án bị lược kèm cờ riêng (không lọt vào store)", () => {
    const result = parseAIResult(
      {
        title: "Đề",
        subject: "Toán",
        questions: [{
          order: 1,
          content: "Câu 1?",
          type: "single_choice",
          options: [
            { id: "A", content: "Đáp án A" },
            { id: "B", content: "Đáp án B" },
          ],
          correctAnswers: ["C"],
          confidenceScore: 0.95,
          answerEvidence: { origin: "highlight", excerpt: "C. x" },
        }],
      },
      "De.docx",
      "docx",
      100,
    );
    expect(result).not.toBeNull();
    expect(result!.questions[0].correctAnswers).toEqual([]);
    expect(result!.questions[0].warningFlags).toContain(
      "Đáp án AI không nằm trong các phương án — cần giáo viên xác nhận",
    );
  });

  it("đáp án nửa ngoài phương án: chỉ giữ đáp án nằm trong phương án + cờ", () => {
    const result = parseAIResult(
      {
        title: "Đề",
        subject: "Toán",
        questions: [{
          order: 1,
          content: "Câu 1?",
          type: "multiple_choice",
          options: [
            { id: "A", content: "Đáp án A" },
            { id: "B", content: "Đáp án B" },
            { id: "C", content: "Đáp án C" },
          ],
          correctAnswers: ["B", "D"],
          confidenceScore: 0.9,
          answerEvidence: { origin: "answer_table", excerpt: "1B 1D" },
        }],
      },
      "De.docx",
      "docx",
      100,
    );
    expect(result!.questions[0].correctAnswers).toEqual(["B"]);
    expect(result!.questions[0].warningFlags).toContain(
      "Đáp án AI không nằm trong các phương án — cần giáo viên xác nhận",
    );
  });
});

describe("Bước 18: validateAIExtractionResult (Zod V2 + Quality Gate + Evidence Validator)", () => {
  it("kết quả AI hợp lệ → valid, quality complete, evidence có 1 câu", () => {
    const v1 = parseAIResult(validPayload, "De.docx", "docx", 100);
    expect(v1).not.toBeNull();
    const report = validateAIExtractionResult(v1!);
    expect(report.valid).toBe(true);
    expect(report.qualityStatus).toBe("complete");
    expect(report.evidenceSummary?.total).toBe(1);
  });

  it("kết quả AI không đáp án → valid, quality không failed (thiếu đáp án là việc của gate publish)", () => {
    const v1 = parseAIResult(
      {
        title: "Đề",
        subject: "Toán",
        questions: [{
          order: 1,
          content: "Câu 1?",
          type: "single_choice",
          options: baseOptions,
          correctAnswers: [],
          answerEvidence: null,
        }],
      },
      "De.docx",
      "docx",
      100,
    );
    const report = validateAIExtractionResult(v1!);
    expect(report.valid).toBe(true);
    expect(report.qualityStatus).not.toBe("failed");
  });

  it("kết quả 0 câu → quality failed (điều kiện từ chối ở caller)", () => {
    const report = validateAIExtractionResult({
      fileName: "Trong.docx",
      fileType: "docx",
      fileSize: 0,
      title: "Trong",
      subject: "Toán",
      totalQuestionsDetected: 0,
      questions: [],
      hasAnswerKeyTable: false,
      warningsCount: 0,
      extractedAt: new Date().toISOString(),
    });
    expect(report.valid).toBe(true);
    expect(report.qualityStatus).toBe("failed");
  });
});

describe("Bước 18: retry/fallback qua edge mock (không gọi Gemini thật)", () => {
  beforeEach(() => {
    edgeMock.mockReset();
  });

  const rawText = `
Câu 1: Cho hàm số $y = f(x)$. Đạo hàm của $x^2$ là:
A. $x$
<u>B. $2x$</u>
C. $3x$
D. $4x$
`;

  it("lỗi transient rồi thành công: đúng 2 lần gọi edge, trả kết quả AI", async () => {
    edgeMock
      .mockRejectedValueOnce(new Error("503 Service Unavailable"))
      .mockResolvedValueOnce({ result: validPayload });
    const result = await extractQuizWithAI({ text: rawText });
    expect(edgeMock).toHaveBeenCalledTimes(2);
    expect(result.questions.length).toBe(1);
    expect(result.questions[0].correctAnswers).toEqual(["C"]);
    expect(result.questions[0].detectionStrategy).toBe("highlight_color");
  }, 15000);

  it("lỗi không transient: đúng 1 lần gọi edge rồi fallback parser luật (text)", async () => {
    edgeMock.mockRejectedValueOnce(new Error("Vui lòng đăng nhập."));
    const result = await extractQuizWithAI({ text: rawText });
    expect(edgeMock).toHaveBeenCalledTimes(1);
    expect(result.questions.length).toBe(1);
    expect(result.questions[0].correctAnswers).toEqual(["B"]);
  });

  it("lỗi transient 2 lần liên tiếp: đúng 2 lần gọi rồi fallback parser luật (text)", async () => {
    edgeMock
      .mockRejectedValueOnce(new Error("503 Service Unavailable"))
      .mockRejectedValueOnce(new Error("503 Service Unavailable"));
    const result = await extractQuizWithAI({ text: rawText });
    expect(edgeMock).toHaveBeenCalledTimes(2);
    expect(result.questions[0].correctAnswers).toEqual(["B"]);
  }, 15000);

  it("output sai schema: đúng 1 lần gọi edge (KHÔNG retry), text fallback parser luật", async () => {
    edgeMock.mockResolvedValueOnce({
      result: {
        questions: [{ content: 123, options: baseOptions }],
      },
    });
    const result = await extractQuizWithAI({ text: rawText });
    expect(edgeMock).toHaveBeenCalledTimes(1);
    expect(result.questions[0].correctAnswers).toEqual(["B"]);
  });

  it("output sai schema với ảnh: đúng 1 lần gọi edge (KHÔNG retry) rồi throw lỗi ảnh", async () => {
    edgeMock.mockResolvedValueOnce({
      result: {
        questions: [{ content: 123, options: baseOptions }],
      },
    });
    await expect(
      extractQuizWithAI({ imageBase64: "data:image/png;base64,xxx" }),
    ).rejects.toThrow("Không thể bóc tách ảnh");
    expect(edgeMock).toHaveBeenCalledTimes(1);
  });

  it("ảnh + output hợp lệ: trả kết quả AI, không fallback", async () => {
    edgeMock.mockResolvedValueOnce({ result: validPayload });
    const result = await extractQuizWithAI({
      imageBase64: "data:image/png;base64,xxx",
    });
    expect(edgeMock).toHaveBeenCalledTimes(1);
    expect(result.questions[0].correctAnswers).toEqual(["C"]);
  });
});
