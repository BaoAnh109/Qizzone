import {
  orchestrateExtraction,
  type HybridInput,
  type HybridOrchestrationResult,
} from "@/services/extraction/hybridOrchestrator";

/**
 * Bước 33 (PLAN_MAIN, giai đoạn I): rollback sang đường Rule/Gemini
 * hiện tại của main.
 *
 * ĐƯỜNG VỀ (rollback) có hai nấc, cả hai đều giữ nguyên extractionResult
 * V1 đang có — không xóa câu nào, không đổi quiz đã lưu:
 *  1. Flag OFF (`VITE_AI_PARSER_V2_ENABLED` không bật): bỏ qua hoàn
 *     toàn Hybrid Orchestrator — không chạy, không set hybridReview,
 *     review UI rơi về hành vi V1 cũ (các component bước 23–25 đã
 *     degrade về V1 khi hybridReview là null). Đây là công tắc rollback
 *     chính: set flag OFF → build/deploy lại là về V1.
 *  2. Flag ON nhưng orchestrator throw (lỗi bất ngờ ở tầng V2): bắt lỗi,
 *     giữ V1, hybridReview = null, telemetry ghi rolledBack=true với
 *     fallbackReason "orchestrator-error". Lỗi V2 không được làm mất
 *     kết quả V1 đã trích được.
 *
 * KHÔNG phải rollback (ghi rõ để khỏi nhầm):
 * - Quality Gate ra "failed" (vd PDF scan 0 câu) KHÔNG trigger rollback:
 *   gate failed là TÍN HIỆU (cần OCR / thiếu nội dung), hybridReview
 *   vẫn được giữ để publish guard (bước 25) chặn xuất bản đúng chỗ.
 *   Rollback chỉ khi V2 crash, không phải khi V2 báo xấu.
 * - Câu thiếu đáp án / thiếu phương án cũng không phải rollback — đó
 *   là việc của review UI + guard, V2 vẫn là nguồn metadata đúng.
 */

export type FallbackReason = "flag-off" | "orchestrator-error";

export interface HybridRunOutcome {
  /** Metadata V2 để lưu vào store; null = review dùng đường V1 cũ. */
  hybrid: HybridOrchestrationResult | null;
  rolledBack: boolean;
  fallbackReason: FallbackReason | null;
  /** Latency của riêng tầng orchestrator (ms); 0 khi flag OFF (không chạy). */
  orchestratorLatencyMs: number;
}

/**
 * Chạy Hybrid Orchestrator có rollback: flag OFF thì không chạy; chạy
 * mà throw thì giữ V1. `run` inject được để test (mặc định là
 * orchestrateExtraction thật). Không mutate input, không gọi AI.
 */
export function runHybridOrFallback(
  input: HybridInput,
  flagEnabled: boolean,
  run: (
    input: HybridInput
  ) => HybridOrchestrationResult = orchestrateExtraction
): HybridRunOutcome {
  if (!flagEnabled) {
    return {
      hybrid: null,
      rolledBack: true,
      fallbackReason: "flag-off",
      orchestratorLatencyMs: 0,
    };
  }
  const startedAt = Date.now();
  try {
    const hybrid = run(input);
    return {
      hybrid,
      rolledBack: false,
      fallbackReason: null,
      orchestratorLatencyMs: Date.now() - startedAt,
    };
  } catch {
    return {
      hybrid: null,
      rolledBack: true,
      fallbackReason: "orchestrator-error",
      orchestratorLatencyMs: Date.now() - startedAt,
    };
  }
}
