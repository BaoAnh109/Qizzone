import type { HybridOrchestrationResult } from "@/services/extraction/hybridOrchestrator";
import type { ReviewDisplaySummary } from "@/services/extraction/reviewDisplay";

/**
 * Bước 24 (PLAN_MAIN, giai đoạn F): Tiến trình thật của màn review.
 *
 * Tiến trình tính từ dữ liệu thật của Hybrid Orchestrator — chunk theo
 * trang/khối (bước 19), trạng thái hiển thị từng câu (bước 23),
 * aiNeeded (bước 21) — không phải tiến trình giả theo số câu giáo viên
 * đã bấm qua. Module thuần: không gọi AI, không đọc file, không mutate
 * input.
 *
 * "Đã xác minh" ở đây nghĩa hẹp: câu ở trạng thái display verified
 * (bằng chứng gốc + đủ phương án, bước 23). Tỉ lệ verified/total chỉ
 * là tỉ lệ đếm, không phải điểm chất lượng.
 */

export interface FailedChunkInfo {
  chunkIndex: number;
  page?: number;
  questionCount: number;
  reason?: string;
}

export interface ReviewProgress {
  totalQuestions: number;
  verified: number;
  likely: number;
  needsReview: number;
  invalid: number;
  /** Số câu chưa có đáp án (từ display byFlag, fallback đếm V2). */
  missingAnswers: number;
  /** Số câu cần AI lấp (aiNeeded bước 21) + order của chúng. */
  aiNeededCount: number;
  aiNeededOrders: number[];
  chunksTotal: number;
  chunksComplete: number;
  chunksPartial: number;
  chunksFailed: number;
  failedChunks: FailedChunkInfo[];
  /** Trang scan cần OCR (aiNeeded.ocrNeededPages bước 16/21). */
  ocrNeededPages: number[];
}

export function buildReviewProgress(
  hybrid: HybridOrchestrationResult,
  summary: ReviewDisplaySummary
): ReviewProgress {
  const chunks = hybrid.v2.chunks ?? [];
  const failedChunks: FailedChunkInfo[] = chunks
    .filter((c) => c.status === "failed")
    .map((c) => ({
      chunkIndex: c.chunkIndex,
      page: c.page,
      questionCount: c.questionOrders?.length ?? 0,
      reason: c.reason,
    }));

  const missingFromFlag = summary.byFlag["missing_answer"];
  const missingAnswers =
    missingFromFlag !== undefined
      ? missingFromFlag
      : hybrid.v2.questions.filter(
          (q) => !q.correctAnswers || q.correctAnswers.length === 0
        ).length;

  return {
    totalQuestions: summary.total,
    verified: summary.verified,
    likely: summary.likely,
    needsReview: summary.needs_review,
    invalid: summary.invalid,
    missingAnswers,
    aiNeededCount: hybrid.aiNeeded.questions.length,
    aiNeededOrders: hybrid.aiNeeded.questions.map((q) => q.order),
    chunksTotal: chunks.length,
    chunksComplete: chunks.filter((c) => c.status === "complete").length,
    chunksPartial: chunks.filter((c) => c.status === "partial").length,
    chunksFailed: failedChunks.length,
    failedChunks,
    ocrNeededPages: [...(hybrid.aiNeeded.ocrNeededPages ?? [])].sort(
      (a, b) => a - b
    ),
  };
}
