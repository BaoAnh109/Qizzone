import { describe, expect, it, vi } from "vitest";

const { edgeMock } = vi.hoisted(() => ({ edgeMock: vi.fn() }));
vi.mock("@/lib/cloud", () => ({
  edge: edgeMock,
  errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
}));

import { extractQuizWithAI } from "@/services/aiExtractionService";

describe("Parser-first answer key boundary", () => {
  it("does not send a complete exam with a standalone answer-key section to Gemini", async () => {
    edgeMock.mockClear();
    const result = await extractQuizWithAI({ text: `Câu 1. Vật chất được hiểu là gì?
A. Những gì nhìn thấy trực tiếp.
B. Thực tại khách quan tồn tại độc lập với ý thức.
C. Cảm giác chủ quan.
D. Vật có khối lượng.

ĐÁP ÁN
Câu 1: B
Giải thích ngắn:
1. Vật chất tồn tại khách quan.
` });

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].correctAnswers).toEqual(["B"]);
    expect(result.hasAnswerKeyTable).toBe(true);
    expect(edgeMock).not.toHaveBeenCalled();
  });
});
