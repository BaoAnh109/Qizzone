import { describe, expect, it, vi } from "vitest";
import { orchestrateExtraction } from "@/services/extraction/hybridOrchestrator";
import { runHybridOrFallback } from "@/services/extraction/rollback";
import type {
  ExtractedQuestion,
  ExtractionResult,
} from "@/types/extractor";

/**
 * Bước 33: test rollback. Chỉ test quyết định đường đi (flag OFF →
 * không chạy orchestrator; orchestrator throw → giữ V1) — không gọi AI,
 * không chạm store/UI thật.
 */

function makeQuestion(
  overrides: Partial<ExtractedQuestion> & { order: number }
): ExtractedQuestion {
  const { order } = overrides;
  return {
    id: `q-${order}`,
    tempId: `t-${order}`,
    content: `Câu hỏi ${order}?`,
    options: [
      { id: "A", content: "Phương án A", rawContent: "A. Phương án A" },
      { id: "B", content: "Phương án B", rawContent: "B. Phương án B" },
    ],
    correctAnswers: ["A"],
    points: 1,
    confidenceScore: 0.99,
    detectionStrategy: "answer_table",
    rawTextSegment: `Câu hỏi ${order}`,
    ...overrides,
  };
}

function makeResult(questions: ExtractedQuestion[]): ExtractionResult {
  return {
    fileName: "de-thi.docx",
    fileType: "docx",
    fileSize: 1000,
    title: "Đề thi",
    subject: "Toán học",
    totalQuestionsDetected: questions.length,
    questions,
    hasAnswerKeyTable: true,
    warningsCount: 0,
    extractedAt: new Date().toISOString(),
  };
}

describe("runHybridOrFallback", () => {
  it("flag OFF → KHÔNG chạy orchestrator, hybrid null, rolledBack + flag-off", () => {
    const run = vi.fn();
    const out = runHybridOrFallback(
      { result: makeResult([makeQuestion({ order: 1 })]) },
      false,
      run
    );
    expect(run).not.toHaveBeenCalled();
    expect(out.hybrid).toBeNull();
    expect(out.rolledBack).toBe(true);
    expect(out.fallbackReason).toBe("flag-off");
    expect(out.orchestratorLatencyMs).toBe(0);
  });

  it("flag ON + orchestrator OK → trả hybrid, không rollback", () => {
    const out = runHybridOrFallback(
      { result: makeResult([makeQuestion({ order: 1 })]) },
      true
    );
    expect(out.hybrid).not.toBeNull();
    expect(out.hybrid?.v1.questions.length).toBe(1);
    expect(out.rolledBack).toBe(false);
    expect(out.fallbackReason).toBeNull();
    expect(out.orchestratorLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it("flag ON + orchestrator throw → hybrid null, rolledBack + orchestrator-error, không throw lên caller", () => {
    const run = vi.fn(() => {
      throw new Error("orchestrator nổ");
    });
    const out = runHybridOrFallback(
      { result: makeResult([makeQuestion({ order: 1 })]) },
      true,
      run
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(out.hybrid).toBeNull();
    expect(out.rolledBack).toBe(true);
    expect(out.fallbackReason).toBe("orchestrator-error");
  });

  it("gate failed KHÔNG phải rollback: orchestrator vẫn trả hybrid để guard chặn đúng chỗ", () => {
    // V1 rỗng (PDF scan 0 câu) → gate failed, nhưng orchestrator không
    // throw nên runHybridOrFallback phải TRẢ hybrid (không rollback).
    const out = runHybridOrFallback(
      { result: makeResult([]), totalPages: 1, scanPages: [1] },
      true,
      orchestrateExtraction
    );
    expect(out.hybrid).not.toBeNull();
    expect(out.hybrid?.quality.status).toBe("failed");
    expect(out.rolledBack).toBe(false);
    expect(out.fallbackReason).toBeNull();
  });
});
