import { edge } from "@/lib/cloud";
import { AI_CONFIG } from "@/config/aiConfig";

/**
 * Bước 20 (PLAN_MAIN, giai đoạn E): provider abstraction + quota/cost cap
 * cho đường AI extraction.
 *
 * Ranh giới (giữ nguyên các bước trước):
 * - Provider CHỈ gọi model và trả output THÔ — không validate schema
 *   (bước 18), không tách extract/solve (bước 17), không quyết định
 *   fallback (caller giữ). Vì vậy thêm provider mới (local/mock/…)
 *   không cần sửa caller: chỉ cần implement AIProvider rồi đưa vào
 *   AIProviderRunner.
 * - Quota được chặn TRƯỚC mỗi lần gọi dựa trên ước tính (không phải số
 *   đo thật của nhà cung cấp): ước tính token = ký tự / 4 cho text,
 *   cộng 1024 token ước tính cho mỗi ảnh (base64 không quy đổi trực
 *   tiếp ra token). Số thực tế có thể lệch nhẹ nên lần gọi cuối có thể
 *   vượt cap một chút — đó là hành vi đã biết, không phải lỗi.
 * - Cost chỉ có ý nghĩa khi cấu hình giá: mặc định giá = 0 nên cap chi
 *   phí TẮT (maxCostUsd: null) cho tới khi app cấu hình giá thật của
 *   provider đang dùng. Không bịa giá thị trường trong code.
 * - Usage log (mọi lần gọi thành công) để bước 33 observability dùng
 *   sau; lần gọi lỗi không ghi usage (chưa tiêu tốn kết quả).
 */

export interface AIExtractInput {
  prompt: string;
  imageBase64?: string;
}

/** Provider AI extraction — trả output thô, caller tự validate (bước 18). */
export interface AIProvider {
  readonly name: string;
  readonly model: string;
  extract(input: AIExtractInput): Promise<unknown>;
}

/** Provider mặc định: Gemini qua Edge Function hiện có của main. */
export class GeminiEdgeProvider implements AIProvider {
  readonly name = "gemini-edge";
  readonly model = AI_CONFIG.DEFAULT_MODEL;

  private readonly timeoutMs: number;

  constructor(timeoutMs = 90_000) {
    this.timeoutMs = timeoutMs;
  }

  async extract(input: AIExtractInput): Promise<unknown> {
    // Giữ nguyên hành vi main: edge() forward body nguyên văn sang Edge
    // Function, nơi thử lần lượt các model fallback server-side.
    const response = await edge<{ result: unknown }>(
      "extract-quiz-with-gemini",
      { prompt: input.prompt, imageBase64: input.imageBase64 },
      this.timeoutMs
    );
    return response.result;
  }
}

export interface QuotaConfig {
  /** 0 = tắt hẳn đường AI (không gọi provider lần nào). */
  maxRequests: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  /** null = không cap chi phí (chỉ cap khi đã cấu hình giá). */
  maxCostUsd: number | null;
  pricePerMillionInputUsd: number;
  pricePerMillionOutputUsd: number;
}

export const DEFAULT_QUOTA: QuotaConfig = {
  maxRequests: 50,
  maxInputTokens: 500_000,
  maxOutputTokens: 200_000,
  maxCostUsd: null,
  pricePerMillionInputUsd: 0,
  pricePerMillionOutputUsd: 0,
};

function envValue(key: string): string | undefined {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return env?.[key];
  } catch {
    return undefined;
  }
}

function envInt(key: string, fallback: number): number {
  const raw = envValue(key);
  if (raw === undefined) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function envFloat(key: string, fallback: number): number {
  const raw = envValue(key);
  if (raw === undefined) return fallback;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Quota mặc định: đọc từ env Vite (VITE_AI_MAX_REQUESTS,
 * VITE_AI_MAX_INPUT_TOKENS, VITE_AI_MAX_OUTPUT_TOKENS,
 * VITE_AI_MAX_COST_USD, VITE_AI_PRICE_PER_MILLION_INPUT_USD,
 * VITE_AI_PRICE_PER_MILLION_OUTPUT_USD) khi có, ngược lại dùng
 * DEFAULT_QUOTA. Env không hợp lệ → fallback mặc định, không throw.
 */
export function defaultQuotaConfig(): QuotaConfig {
  const maxCostRaw = envValue("VITE_AI_MAX_COST_USD");
  const maxCost = maxCostRaw === undefined ? null : envFloat("VITE_AI_MAX_COST_USD", NaN);
  return {
    maxRequests: envInt("VITE_AI_MAX_REQUESTS", DEFAULT_QUOTA.maxRequests),
    maxInputTokens: envInt("VITE_AI_MAX_INPUT_TOKENS", DEFAULT_QUOTA.maxInputTokens),
    maxOutputTokens: envInt("VITE_AI_MAX_OUTPUT_TOKENS", DEFAULT_QUOTA.maxOutputTokens),
    maxCostUsd: maxCost !== null && Number.isFinite(maxCost) ? maxCost : null,
    pricePerMillionInputUsd: envFloat(
      "VITE_AI_PRICE_PER_MILLION_INPUT_USD",
      DEFAULT_QUOTA.pricePerMillionInputUsd
    ),
    pricePerMillionOutputUsd: envFloat(
      "VITE_AI_PRICE_PER_MILLION_OUTPUT_USD",
      DEFAULT_QUOTA.pricePerMillionOutputUsd
    ),
  };
}

export type QuotaExceededReason =
  | "disabled"
  | "requests"
  | "inputTokens"
  | "outputTokens"
  | "cost";

/** Lỗi cap — KHÔNG phải lỗi transient, caller không được retry (bước 18). */
export class QuotaExceededError extends Error {
  readonly reason: QuotaExceededReason;

  constructor(reason: QuotaExceededReason, detail: string) {
    super(`Đã vượt giới hạn gọi AI (${reason}): ${detail}`);
    this.name = "QuotaExceededError";
    this.reason = reason;
  }
}

export interface UsageRecord {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  at: string;
}

/** Ước tính token từ text: ký tự / 4, làm tròn lên. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Runner: bọc một provider với quota + usage log. Hàm thuần về mặt
 * quyết định cap (chỉ gọi provider khi pre-check qua), không tự retry
 * (retry thuộc requestAI, bước 18) và không tự fallback (thuộc caller).
 */
export class AIProviderRunner {
  private usageLog: UsageRecord[] = [];

  readonly provider: AIProvider;
  readonly quota: QuotaConfig;

  constructor(provider: AIProvider, quota: QuotaConfig = defaultQuotaConfig()) {
    this.provider = provider;
    this.quota = quota;
  }

  get usage(): UsageRecord[] {
    return [...this.usageLog];
  }

  get totalRequests(): number {
    return this.usageLog.length;
  }

  get totalInputTokens(): number {
    return this.usageLog.reduce((sum, record) => sum + record.inputTokens, 0);
  }

  get totalOutputTokens(): number {
    return this.usageLog.reduce((sum, record) => sum + record.outputTokens, 0);
  }

  get totalCostUsd(): number {
    return this.usageLog.reduce((sum, record) => sum + record.costUsd, 0);
  }

  resetUsage(): void {
    this.usageLog = [];
  }

  private checkCap(inputTokens: number): void {
    const q = this.quota;
    if (q.maxRequests === 0) {
      throw new QuotaExceededError("disabled", "đường AI đã tắt (maxRequests = 0)");
    }
    if (this.totalRequests + 1 > q.maxRequests) {
      throw new QuotaExceededError(
        "requests",
        `${this.totalRequests + 1} > ${q.maxRequests} request`
      );
    }
    if (this.totalInputTokens + inputTokens > q.maxInputTokens) {
      throw new QuotaExceededError(
        "inputTokens",
        `${this.totalInputTokens + inputTokens} > ${q.maxInputTokens} token (ước tính)`
      );
    }
    // Output của lần gọi sắp tới chưa biết trước: cap output chặn lần
    // gọi TIẾP THEO khi tổng đã dùng chạm ngưỡng, không chặn oan lần
    // gọi còn room bằng ước tính bịa.
    if (this.totalOutputTokens >= q.maxOutputTokens) {
      throw new QuotaExceededError(
        "outputTokens",
        `${this.totalOutputTokens} >= ${q.maxOutputTokens} token (ước tính)`
      );
    }
    if (q.maxCostUsd !== null) {
      const spentCost = this.totalCostUsd;
      const nextInputCost = (inputTokens * q.pricePerMillionInputUsd) / 1_000_000;
      if (spentCost + nextInputCost > q.maxCostUsd) {
        throw new QuotaExceededError(
          "cost",
          `~$${(spentCost + nextInputCost).toFixed(4)} > $${q.maxCostUsd} (ước tính, chưa tính output)`
        );
      }
    }
  }

  async extract(input: AIExtractInput): Promise<unknown> {
    const inputTokens =
      estimateTokens(input.prompt) + (input.imageBase64 ? 1024 : 0);
    this.checkCap(inputTokens);
    const result = await this.provider.extract(input);
    const outputTokens = estimateTokens(
      typeof result === "string" ? result : JSON.stringify(result ?? "")
    );
    const costUsd =
      (inputTokens * this.quota.pricePerMillionInputUsd +
        outputTokens * this.quota.pricePerMillionOutputUsd) /
      1_000_000;
    this.usageLog.push({
      provider: this.provider.name,
      model: this.provider.model,
      inputTokens,
      outputTokens,
      costUsd,
      at: new Date().toISOString(),
    });
    return result;
  }
}

/** Runner mặc định của app: Gemini qua Edge Function + quota mặc định. */
export let defaultAIRunner: AIProviderRunner = new AIProviderRunner(
  new GeminiEdgeProvider()
);

/** Cho phép app bootstrap / test thay runner mặc định mà không sửa caller. */
export function setDefaultAIRunner(runner: AIProviderRunner): void {
  defaultAIRunner = runner;
}
