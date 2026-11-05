import type { ExtractionResult } from "@/types/extractor";
import type { HybridOrchestrationResult } from "@/services/extraction/hybridOrchestrator";
import type { QualityGateStatus } from "@/services/extraction/qualityGate";
import {
  defaultQuotaConfig,
  QuotaExceededError,
  type QuotaConfig,
} from "@/services/extraction/aiProvider";

/**
 * Bước 33 (PLAN_MAIN, giai đoạn I): observability cho AI Parser V2.
 *
 * NGUYÊN TẮC BẢO MẬT (khóa ở bước này, test khóa theo):
 * - Event telemetry CHỈ chứa số đếm và trạng thái (engine, số trang,
 *   số câu found/missing, quality status, latency, ước tính chi phí,
 *   error category). KHÔNG BAO GIỜ chứa nội dung đề: không stem, không
 *   option, không đáp án, không excerpt bằng chứng, không tên file,
 *   không raw text. Ai thêm trường mới chứa nội dung đề vào event này
 *   là vi phạm — test `extractionTelemetry.test.ts` khóa bằng câu có
 *   nội dung đặc trưng và assert JSON event không chứa nó.
 * - Sink MẶC ĐỊNH là log cục bộ có cấu trúc (console.info, một dòng
 *   JSON). KHÔNG gửi telemetry lên server, KHÔNG có dashboard thật,
 *   KHÔNG beacon/network call nào trong module này. Muốn gửi lên
 *   server/dashboard thì là việc riêng sau này, cần quyết + phê duyệt.
 * - Chi phí chỉ là ƯỚC TÍNH từ token ước tính (bước 20) và giá đã cấu
 *   hình; khi chưa cấu hình giá thì costUsdEstimate = null (không bịa
 *   giá thị trường). Usage thật (token đếm) chỉ có khi caller cấp —
 *   hiện extractQuizWithAI không trả token về nên live path để null,
 *   ghi rõ ở doc bước 33 thay vì bịa số.
 */

export type ExtractionSourceType = "docx" | "pdf" | "image" | "text" | "paste";

export type ExtractionErrorCategory =
  | "none"
  | "parse_error"
  | "ai_error"
  | "quota_exceeded"
  | "ocr_needed"
  | "validation_failed"
  | "unknown";

export type TelemetryEngine =
  | "rule"
  | "gemini"
  | "manual"
  | "ocr"
  | "mixed"
  | "unknown";

/** Một event telemetry cho một lần trích xuất (một lần upload/dán text). */
export interface ExtractionTelemetryEvent {
  event: "ai_parser_v2.extraction";
  /** Version schema của event — tăng khi thêm/đổi field. */
  schemaVersion: 1;
  at: string;
  /** Flag V2 lúc chạy (false = đường V1 cũ, rollback). */
  flagEnabled: boolean;
  sourceType: ExtractionSourceType;
  /** Engine chiếm đa số trong câu V2; "mixed" khi nhiều engine; "unknown" khi không có V2. */
  engine: TelemetryEngine;
  /** Model AI khi đi đường AI (vd "gemini-3.6-flash"); null khi đi đường luật. */
  model: string | null;
  /** Tổng số trang (PDF); null khi không biết (DOCX/text). */
  totalPages: number | null;
  chunks: { total: number; complete: number; partial: number; failed: number };
  questions: {
    /** Số câu trích được (V1). */
    found: number;
    /** Số câu thiếu theo đếm độc lập (detectedHeaders − found); null khi không đo được. */
    missing: number | null;
    withAnswers: number;
    withoutAnswers: number;
    insufficientOptions: number;
  };
  qualityStatus: QualityGateStatus | "unknown";
  evidence: {
    valid: number;
    downgraded: number;
    conflict: number;
    invalid: number;
    unchecked: number;
  };
  reconcile: { resolved: number; unresolved: number; pruned: number };
  aiCalled: boolean;
  aiFilledCount: number;
  aiSkippedReason: string | null;
  /** Tổng latency lần trích xuất (ms, đo ở caller). */
  latencyMs: number;
  /** Ước tính chi phí USD; null khi chưa cấu hình giá hoặc không có usage. */
  costUsdEstimate: number | null;
  errorCategory: ExtractionErrorCategory;
  /** true khi kết quả cuối dùng đường V1 vì flag OFF hoặc orchestrator lỗi. */
  rolledBack: boolean;
  /** "flag-off" | "orchestrator-error" | null. */
  fallbackReason: string | null;
}

export interface BuildTelemetryInput {
  sourceType: ExtractionSourceType;
  flagEnabled: boolean;
  /** V1 đã trích được; null khi trích xuất thất bại trước khi có V1. */
  v1: ExtractionResult | null;
  /** Metadata V2; null khi flag OFF hoặc orchestrator lỗi (rollback). */
  hybrid: HybridOrchestrationResult | null;
  model?: string | null;
  totalPages?: number | null;
  latencyMs: number;
  aiCalled?: boolean;
  aiFilledCount?: number;
  aiSkippedReason?: string | null;
  /** Usage AI của lần này (nếu caller có); vắng mặt → cost null. */
  usage?: { inputTokens: number; outputTokens: number };
  /** Giá để ước tính chi phí; mặc định lấy từ defaultQuotaConfig() khi không truyền. */
  quota?: QuotaConfig;
  errorCategory?: ExtractionErrorCategory;
  rolledBack: boolean;
  fallbackReason?: string | null;
  /** Cho test inject thời gian cố định; mặc định thời điểm hiện tại. */
  at?: string;
}

/**
 * Ước tính chi phí USD từ token và giá đã cấu hình. Trả null khi chưa
 * cấu hình giá (cả hai giá đều 0 — mặc định của bước 20) để không bịa
 * giá thị trường; null ≠ 0 USD.
 */
export function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  quota: QuotaConfig
): number | null {
  if (
    quota.pricePerMillionInputUsd <= 0 &&
    quota.pricePerMillionOutputUsd <= 0
  ) {
    return null;
  }
  return (
    (inputTokens * quota.pricePerMillionInputUsd +
      outputTokens * quota.pricePerMillionOutputUsd) /
    1_000_000
  );
}

/**
 * Phân loại lỗi thành error category. Chỉ QuotaExceededError được map
 * chắc chắn từ kiểu lỗi; còn lại caller truyền explicit (parse_error
 * cho parser luật, ai_error cho đường AI) — không đoán từ message text
 * vì message có thể chứa nội dung đề.
 */
export function categorizeExtractionError(error: unknown): ExtractionErrorCategory {
  if (error instanceof QuotaExceededError) return "quota_exceeded";
  return "unknown";
}

/** Hàm thuần: dựng event telemetry từ số đếm — không đọc nội dung câu. */
export function buildExtractionTelemetryEvent(
  input: BuildTelemetryInput
): ExtractionTelemetryEvent {
  const { v1, hybrid } = input;
  const questions = v1?.questions ?? [];

  // Engine: engine chiếm đa số trong câu V2; nhiều engine → "mixed".
  let engine: TelemetryEngine = "unknown";
  if (hybrid) {
    const engines = new Set(hybrid.v2.questions.map((q) => q.engine));
    if (engines.size === 1) {
      engine = [...engines][0];
    } else if (engines.size > 1) {
      engine = "mixed";
    }
  }

  const chunks = { total: 0, complete: 0, partial: 0, failed: 0 };
  if (hybrid) {
    for (const chunk of hybrid.v2.chunks) {
      chunks.total++;
      chunks[chunk.status]++;
    }
  }

  // Số câu thiếu chỉ đo được khi có đếm header độc lập (DOCX bước 07);
  // không có đếm độc lập thì null — không suy từ totalQuestionsDetected
  // vì con số đó do chính parser đếm (tự đếm mình thì không phát hiện thiếu).
  const detectedHeaders = hybrid?.v2.documentQuality.detectedHeaders;
  const missing =
    detectedHeaders !== undefined && detectedHeaders > questions.length
      ? detectedHeaders - questions.length
      : null;

  // Error category: caller truyền explicit thì giữ; không truyền mà còn
  // trang scan chưa OCR thì là "ocr_needed" (chưa phải lỗi — là tín hiệu
  // cần OCR, bước 16); còn lại là "none".
  let errorCategory: ExtractionErrorCategory =
    input.errorCategory ?? "none";
  if (
    errorCategory === "none" &&
    hybrid &&
    hybrid.aiNeeded.ocrNeededPages.length > 0
  ) {
    errorCategory = "ocr_needed";
  }

  return {
    event: "ai_parser_v2.extraction",
    schemaVersion: 1,
    at: input.at ?? new Date().toISOString(),
    flagEnabled: input.flagEnabled,
    sourceType: input.sourceType,
    engine,
    model: input.model ?? null,
    totalPages: input.totalPages ?? null,
    chunks,
    questions: {
      found: questions.length,
      missing,
      withAnswers: questions.filter(
        (q) => q.correctAnswers && q.correctAnswers.length > 0
      ).length,
      withoutAnswers: questions.filter(
        (q) => !q.correctAnswers || q.correctAnswers.length === 0
      ).length,
      insufficientOptions: questions.filter(
        (q) => !q.options || q.options.length < 2
      ).length,
    },
    qualityStatus: hybrid ? hybrid.quality.status : "unknown",
    evidence: hybrid
      ? {
          valid: hybrid.evidence.summary.valid,
          downgraded: hybrid.evidence.summary.downgraded,
          conflict: hybrid.evidence.summary.conflict,
          invalid: hybrid.evidence.summary.invalid,
          unchecked: hybrid.evidence.summary.unchecked,
        }
      : { valid: 0, downgraded: 0, conflict: 0, invalid: 0, unchecked: 0 },
    reconcile: hybrid
      ? {
          resolved: hybrid.reconcile.resolved,
          unresolved: hybrid.reconcile.unresolved,
          pruned: hybrid.reconcile.pruned,
        }
      : { resolved: 0, unresolved: 0, pruned: 0 },
    aiCalled: input.aiCalled ?? false,
    aiFilledCount: input.aiFilledCount ?? 0,
    aiSkippedReason: input.aiSkippedReason ?? null,
    latencyMs: input.latencyMs,
    costUsdEstimate: input.usage
      ? estimateCostUsd(
          input.usage.inputTokens,
          input.usage.outputTokens,
          input.quota ?? defaultQuotaConfig()
        )
      : null,
    errorCategory,
    rolledBack: input.rolledBack,
    fallbackReason: input.fallbackReason ?? null,
  };
}

export type TelemetrySink = (message: string) => void;

/**
 * Ghi event ra log cục bộ có cấu trúc (một dòng JSON, tiền tố
 * `[ai-parser-v2]` để lọc). Sink mặc định là console.info — CHỈ log
 * cục bộ, KHÔNG gửi đi đâu (không fetch/beacon, không dashboard).
 * Sink inject được để test assert nội dung mà không chạm console thật.
 */
export function logExtractionTelemetry(
  event: ExtractionTelemetryEvent,
  sink: TelemetrySink = console.info
): void {
  sink(`[ai-parser-v2] ${JSON.stringify(event)}`);
}
