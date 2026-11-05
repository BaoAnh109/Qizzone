import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Test bước 20 bằng mock provider — KHÔNG gọi Gemini thật, không cần
// API/quota. Runner mặc định được thay tạm trong file này rồi khôi
// phục sau mỗi test; vitest isolate module theo file nên không rò sang
// file test khác.
import {
  AIProviderRunner,
  DEFAULT_QUOTA,
  QuotaExceededError,
  defaultAIRunner,
  estimateTokens,
  setDefaultAIRunner,
  type AIProvider,
  type QuotaConfig,
} from "@/services/extraction/aiProvider";
import { extractQuizWithAI } from "@/services/aiExtractionService";

const originalRunner = defaultAIRunner;

class MockProvider implements AIProvider {
  readonly name = "mock-provider";
  readonly model = "mock-model";
  calls = 0;
  result: unknown = { ok: true };

  private readonly failWith?: Error;

  constructor(failWith?: Error, result?: unknown) {
    this.failWith = failWith;
    if (result !== undefined) this.result = result;
  }

  async extract(): Promise<unknown> {
    this.calls++;
    if (this.failWith) throw this.failWith;
    return this.result;
  }
}

function quota(overrides: Partial<QuotaConfig>): QuotaConfig {
  return { ...DEFAULT_QUOTA, ...overrides };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  setDefaultAIRunner(originalRunner);
});

describe("Bước 20: provider abstraction + usage log", () => {
  it("estimateTokens: 4000 ký tự → 1000 token", () => {
    expect(estimateTokens("x".repeat(4000))).toBe(1000);
    expect(estimateTokens("abc")).toBe(1);
  });

  it("lần gọi thành công ghi usage đúng provider/model/token", async () => {
    const provider = new MockProvider(undefined, { answer: 42 });
    const runner = new AIProviderRunner(provider, quota({}));
    const result = await runner.extract({ prompt: "x".repeat(400) });
    expect(result).toEqual({ answer: 42 });
    expect(runner.totalRequests).toBe(1);
    expect(runner.totalInputTokens).toBe(100);
    expect(runner.usage).toHaveLength(1);
    expect(runner.usage[0]?.provider).toBe("mock-provider");
    expect(runner.usage[0]?.model).toBe("mock-model");
    expect(runner.usage[0]?.outputTokens).toBeGreaterThan(0);
  });

  it("lần gọi lỗi không ghi usage", async () => {
    const provider = new MockProvider(new Error("boom"));
    const runner = new AIProviderRunner(provider, quota({}));
    await expect(runner.extract({ prompt: "hi" })).rejects.toThrow("boom");
    expect(runner.totalRequests).toBe(0);
    expect(runner.usage).toHaveLength(0);
  });

  it("resetUsage xóa log để đo phiên mới", async () => {
    const provider = new MockProvider();
    const runner = new AIProviderRunner(provider, quota({}));
    await runner.extract({ prompt: "hi" });
    expect(runner.totalRequests).toBe(1);
    runner.resetUsage();
    expect(runner.totalRequests).toBe(0);
    expect(runner.usage).toHaveLength(0);
  });
});

describe("Bước 20: quota/cost cap", () => {
  it("cap = 0 (disabled): không gọi provider lần nào", async () => {
    const provider = new MockProvider();
    const runner = new AIProviderRunner(provider, quota({ maxRequests: 0 }));
    await expect(runner.extract({ prompt: "hi" })).rejects.toBeInstanceOf(
      QuotaExceededError
    );
    await expect(runner.extract({ prompt: "hi" })).rejects.toMatchObject({
      reason: "disabled",
    });
    expect(provider.calls).toBe(0);
  });

  it("vượt maxRequests: lần thứ hai bị chặn, provider chỉ gọi 1 lần", async () => {
    const provider = new MockProvider();
    const runner = new AIProviderRunner(provider, quota({ maxRequests: 1 }));
    await runner.extract({ prompt: "hi" });
    await expect(runner.extract({ prompt: "hi" })).rejects.toMatchObject({
      reason: "requests",
    });
    expect(provider.calls).toBe(1);
  });

  it("vượt maxInputTokens: chặn TRƯỚC khi gọi, provider 0 lần", async () => {
    const provider = new MockProvider();
    const runner = new AIProviderRunner(provider, quota({ maxInputTokens: 999 }));
    // 4000 ký tự = 1000 token ước tính > 999.
    await expect(
      runner.extract({ prompt: "x".repeat(4000) })
    ).rejects.toMatchObject({ reason: "inputTokens" });
    expect(provider.calls).toBe(0);
  });

  it("vượt maxOutputTokens: lần gọi tiếp theo bị chặn khi tổng đã dùng chạm ngưỡng", async () => {
    const provider = new MockProvider(undefined, "y".repeat(4000));
    const runner = new AIProviderRunner(provider, quota({ maxOutputTokens: 1000 }));
    await runner.extract({ prompt: "hi" });
    // Output lần đầu = 1000 token → tổng đã dùng = ngưỡng → lần sau chặn.
    expect(runner.totalOutputTokens).toBe(1000);
    await expect(runner.extract({ prompt: "hi" })).rejects.toMatchObject({
      reason: "outputTokens",
    });
    expect(provider.calls).toBe(1);
  });

  it("vượt maxCostUsd (khi đã cấu hình giá): chặn trước khi gọi", async () => {
    const provider = new MockProvider();
    const runner = new AIProviderRunner(
      provider,
      quota({
        maxCostUsd: 0.001,
        pricePerMillionInputUsd: 10,
        pricePerMillionOutputUsd: 0,
      })
    );
    // 4000 ký tự = 1000 token input × $10/1M = $0.01 > $0.001.
    await expect(
      runner.extract({ prompt: "x".repeat(4000) })
    ).rejects.toMatchObject({ reason: "cost" });
    expect(provider.calls).toBe(0);
  });

  it("mặc định không cấu hình giá: cap chi phí tắt, chỉ cap request/token", async () => {
    expect(DEFAULT_QUOTA.maxCostUsd).toBeNull();
    expect(DEFAULT_QUOTA.pricePerMillionInputUsd).toBe(0);
    const provider = new MockProvider();
    const runner = new AIProviderRunner(provider, quota({}));
    await runner.extract({ prompt: "x".repeat(4000) });
    expect(provider.calls).toBe(1);
    expect(runner.totalCostUsd).toBe(0);
  });
});

describe("Bước 20: wiring vào extractQuizWithAI (không sửa caller khác)", () => {
  it("lỗi cap KHÔNG retry: provider chỉ gọi đúng 1 lần, text fallback parser luật", async () => {
    const provider = new MockProvider(
      new QuotaExceededError("requests", "2 > 1 request")
    );
    setDefaultAIRunner(new AIProviderRunner(provider, quota({})));
    const result = await extractQuizWithAI({
      text: "Câu 1: 2 + 2 = ?\nA. 3\nB. 4\nC. 5\nD. 6",
    });
    expect(provider.calls).toBe(1);
    expect(result.questions.length).toBeGreaterThanOrEqual(1);
  });

  it("cap = 0 + ảnh: throw rõ ràng lý do quota, provider 0 lần", async () => {
    const provider = new MockProvider();
    setDefaultAIRunner(
      new AIProviderRunner(provider, quota({ maxRequests: 0 }))
    );
    await expect(
      extractQuizWithAI({ imageBase64: "data:image/png;base64,xxxx" })
    ).rejects.toBeInstanceOf(QuotaExceededError);
    expect(provider.calls).toBe(0);
  });

  it("cap = 0 + text: fallback parser luật, provider 0 lần (AI tắt hẳn)", async () => {
    const provider = new MockProvider();
    setDefaultAIRunner(
      new AIProviderRunner(provider, quota({ maxRequests: 0 }))
    );
    const result = await extractQuizWithAI({
      text: "Câu 1: 2 + 2 = ?\nA. 3\nB. 4\nC. 5\nD. 6",
    });
    expect(provider.calls).toBe(0);
    expect(result.questions.length).toBeGreaterThanOrEqual(1);
  });
});
