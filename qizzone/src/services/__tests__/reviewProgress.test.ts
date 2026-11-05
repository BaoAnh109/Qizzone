import { describe, it, expect } from "vitest";
import type { V2ChunkStatus } from "@/types/extractionV2";
import type { HybridOrchestrationResult } from "@/services/extraction/hybridOrchestrator";
import type { ReviewDisplaySummary } from "@/services/extraction/reviewDisplay";
import { buildReviewProgress } from "@/services/extraction/reviewProgress";

/**
 * Bước 24: test tiến trình thật. Điểm khóa: tiến trình đếm từ chunk +
 * display summary + aiNeeded thật, không đếm theo số câu đã bấm qua.
 */

function makeChunk(
  overrides: Partial<V2ChunkStatus> = {}
): V2ChunkStatus {
  return { chunkIndex: 0, status: "complete", ...overrides };
}

function makeHybrid(overrides: Partial<HybridOrchestrationResult> = {}) {
  return {
    v2: {
      questions: [],
      chunks: [],
    },
    aiNeeded: { needed: false, questions: [], ocrNeededPages: [] },
    ...overrides,
  } as unknown as HybridOrchestrationResult;
}

function makeSummary(
  overrides: Partial<ReviewDisplaySummary> = {}
): ReviewDisplaySummary {
  return {
    total: 0,
    verified: 0,
    likely: 0,
    needs_review: 0,
    invalid: 0,
    byFlag: {},
    ...overrides,
  };
}

describe("reviewProgress — đếm từ dữ liệu thật", () => {
  it("đếm đúng chunk complete/partial/failed và liệt kê chunk failed", () => {
    const p = buildReviewProgress(
      makeHybrid({
        v2: {
          questions: [],
          chunks: [
            makeChunk({ chunkIndex: 0, page: 1 }),
            makeChunk({ chunkIndex: 1, page: 2, status: "partial" }),
            makeChunk({
              chunkIndex: 2,
              page: 3,
              status: "failed",
              questionOrders: [],
              reason: "Trang scan",
            }),
          ],
        } as never,
      }),
      makeSummary()
    );
    expect(p.chunksTotal).toBe(3);
    expect(p.chunksComplete).toBe(1);
    expect(p.chunksPartial).toBe(1);
    expect(p.chunksFailed).toBe(1);
    expect(p.failedChunks).toEqual([
      { chunkIndex: 2, page: 3, questionCount: 0, reason: "Trang scan" },
    ]);
  });

  it("đếm đúng trạng thái câu từ display summary", () => {
    const p = buildReviewProgress(
      makeHybrid(),
      makeSummary({
        total: 10,
        verified: 6,
        likely: 1,
        needs_review: 2,
        invalid: 1,
        byFlag: { missing_answer: 2 },
      })
    );
    expect(p.totalQuestions).toBe(10);
    expect(p.verified).toBe(6);
    expect(p.likely).toBe(1);
    expect(p.needsReview).toBe(2);
    expect(p.invalid).toBe(1);
    expect(p.missingAnswers).toBe(2);
  });

  it("thiếu byFlag thì fallback đếm câu V2 không đáp án", () => {
    const p = buildReviewProgress(
      makeHybrid({
        v2: {
          questions: [
            { correctAnswers: [] },
            { correctAnswers: ["A"] },
            { correctAnswers: [] },
          ],
          chunks: [],
        } as never,
      }),
      makeSummary({ total: 3 })
    );
    expect(p.missingAnswers).toBe(2);
  });

  it("aiNeeded và trang scan cần OCR lấy từ hybrid", () => {
    const p = buildReviewProgress(
      makeHybrid({
        aiNeeded: {
          needed: true,
          questions: [
            { questionIndex: 0, order: 1, reasons: ["missing_answer"] },
            { questionIndex: 2, order: 3, reasons: ["insufficient_options"] },
          ],
          ocrNeededPages: [4, 2],
        },
      }),
      makeSummary()
    );
    expect(p.aiNeededCount).toBe(2);
    expect(p.aiNeededOrders).toEqual([1, 3]);
    expect(p.ocrNeededPages).toEqual([2, 4]);
  });
});
