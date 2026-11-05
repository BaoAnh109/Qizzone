import { describe, expect, it, vi } from "vitest";
import { orchestrateExtraction } from "@/services/extraction/hybridOrchestrator";
import {
  buildExtractionTelemetryEvent,
  categorizeExtractionError,
  estimateCostUsd,
  logExtractionTelemetry,
} from "@/services/extraction/telemetry";
import {
  DEFAULT_QUOTA,
  QuotaExceededError,
} from "@/services/extraction/aiProvider";
import type {
  ExtractedQuestion,
  ExtractionResult,
} from "@/types/extractor";

/**
 * Bước 33: test telemetry. Toàn bộ test thuần (không gọi AI, không đọc
 * file, không chạm console thật — sink inject). Khóa quan trọng nhất:
 * event KHÔNG BAO GIỜ chứa nội dung đề (stem/option/đáp án/excerpt).
 */

const SECRET_STEM = "Nội dung bí mật ZEBRA-98765 không được lộ";
const SECRET_OPTION = "Phương án bí mật ORCA-13579";

function makeQuestion(
  overrides: Partial<ExtractedQuestion> & { order: number }
): ExtractedQuestion {
  const { order } = overrides;
  return {
    id: `q-${order}`,
    tempId: `t-${order}`,
    content: SECRET_STEM,
    options: [
      { id: "A", content: SECRET_OPTION, rawContent: `A. ${SECRET_OPTION}` },
      { id: "B", content: "Phương án B", rawContent: "B. Phương án B" },
      { id: "C", content: "Phương án C", rawContent: "C. Phương án C" },
      { id: "D", content: "Phương án D", rawContent: "D. Phương án D" },
    ],
    correctAnswers: ["A"],
    points: 1,
    confidenceScore: 0.99,
    detectionStrategy: "answer_table",
    rawTextSegment: SECRET_STEM,
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
    hasAnswerKeyTable: questions.some((q) => q.correctAnswers.length > 0),
    warningsCount: 0,
    extractedAt: new Date().toISOString(),
  };
}

describe("buildExtractionTelemetryEvent", () => {
  it("đếm đúng found/withAnswers/withoutAnswers/insufficientOptions + quality/evidence từ hybrid", () => {
    const v1 = makeResult([
      makeQuestion({ order: 1 }),
      makeQuestion({ order: 2, correctAnswers: [], detectionStrategy: "manual" }),
      makeQuestion({
        order: 3,
        options: [
          { id: "A", content: "Chỉ một phương án", rawContent: "A. Chỉ một" },
        ],
      }),
    ]);
    const hybrid = orchestrateExtraction({ result: v1 });
    const event = buildExtractionTelemetryEvent({
      sourceType: "docx",
      flagEnabled: true,
      v1,
      hybrid,
      latencyMs: 123,
      rolledBack: false,
      at: "2026-11-05T00:00:00.000Z",
    });

    expect(event.event).toBe("ai_parser_v2.extraction");
    expect(event.schemaVersion).toBe(1);
    expect(event.flagEnabled).toBe(true);
    expect(event.sourceType).toBe("docx");
    expect(event.engine).toBe("rule");
    expect(event.model).toBeNull();
    expect(event.questions.found).toBe(3);
    expect(event.questions.withAnswers).toBe(2);
    expect(event.questions.withoutAnswers).toBe(1);
    expect(event.questions.insufficientOptions).toBe(1);
    expect(event.qualityStatus).toBe(hybrid.quality.status);
    expect(event.evidence.valid).toBe(hybrid.evidence.summary.valid);
    expect(event.reconcile).toEqual({
      resolved: hybrid.reconcile.resolved,
      unresolved: hybrid.reconcile.unresolved,
      pruned: hybrid.reconcile.pruned,
    });
    expect(event.latencyMs).toBe(123);
    expect(event.errorCategory).toBe("none");
    expect(event.rolledBack).toBe(false);
    expect(event.costUsdEstimate).toBeNull();
  });

  it("KHÔNG chứa nội dung đề: stem/option/đáp án/excerpt không lọt vào JSON event", () => {
    const v1 = makeResult([makeQuestion({ order: 1 })]);
    const hybrid = orchestrateExtraction({ result: v1 });
    const event = buildExtractionTelemetryEvent({
      sourceType: "docx",
      flagEnabled: true,
      v1,
      hybrid,
      latencyMs: 5,
      rolledBack: false,
    });
    const json = JSON.stringify(event);
    expect(json).not.toContain("ZEBRA-98765");
    expect(json).not.toContain("ORCA-13579");
    expect(json).not.toContain("Nội dung bí mật");
    expect(json).not.toContain("Phương án bí mật");
    expect(json).not.toContain("de-thi.docx");
  });

  it("flag OFF (rollback): hybrid null → quality unknown, đếm vẫn từ V1, rolledBack true", () => {
    const v1 = makeResult([makeQuestion({ order: 1 })]);
    const event = buildExtractionTelemetryEvent({
      sourceType: "pdf",
      flagEnabled: false,
      v1,
      hybrid: null,
      totalPages: 2,
      latencyMs: 10,
      rolledBack: true,
      fallbackReason: "flag-off",
    });
    expect(event.flagEnabled).toBe(false);
    expect(event.engine).toBe("unknown");
    expect(event.qualityStatus).toBe("unknown");
    expect(event.totalPages).toBe(2);
    expect(event.questions.found).toBe(1);
    expect(event.chunks).toEqual({ total: 0, complete: 0, partial: 0, failed: 0 });
    expect(event.rolledBack).toBe(true);
    expect(event.fallbackReason).toBe("flag-off");
  });

  it("trích xuất thất bại (v1 null): found 0, không crash", () => {
    const event = buildExtractionTelemetryEvent({
      sourceType: "docx",
      flagEnabled: true,
      v1: null,
      hybrid: null,
      latencyMs: 3,
      errorCategory: "parse_error",
      rolledBack: false,
    });
    expect(event.questions.found).toBe(0);
    expect(event.questions.missing).toBeNull();
    expect(event.errorCategory).toBe("parse_error");
  });

  it("còn trang scan chưa OCR → errorCategory ocr_needed khi caller không truyền explicit", () => {
    const v1 = makeResult([makeQuestion({ order: 1 })]);
    const hybrid = orchestrateExtraction({
      result: v1,
      totalPages: 2,
      scanPages: [2],
    });
    const event = buildExtractionTelemetryEvent({
      sourceType: "pdf",
      flagEnabled: true,
      v1,
      hybrid,
      totalPages: 2,
      latencyMs: 7,
      rolledBack: false,
    });
    expect(event.errorCategory).toBe("ocr_needed");
    expect(event.chunks.failed).toBe(1);
  });

  it("errorCategory explicit của caller được giữ (không bị suy thành ocr_needed)", () => {
    const v1 = makeResult([makeQuestion({ order: 1 })]);
    const hybrid = orchestrateExtraction({
      result: v1,
      totalPages: 2,
      scanPages: [2],
    });
    const event = buildExtractionTelemetryEvent({
      sourceType: "pdf",
      flagEnabled: true,
      v1,
      hybrid,
      totalPages: 2,
      latencyMs: 7,
      errorCategory: "ai_error",
      rolledBack: false,
    });
    expect(event.errorCategory).toBe("ai_error");
  });

  it("missing đếm từ detectedHeaders khi có, null khi không đo được", () => {
    const v1 = makeResult([makeQuestion({ order: 1 })]);
    const hybrid = orchestrateExtraction({
      result: v1,
      documentQuality: {
        status: "partial",
        parsedQuestions: 1,
        detectedHeaders: 3,
        unparsedHeaders: 2,
        reasons: ["Thiếu 2 câu"],
      },
    });
    const event = buildExtractionTelemetryEvent({
      sourceType: "docx",
      flagEnabled: true,
      v1,
      hybrid,
      latencyMs: 1,
      rolledBack: false,
    });
    expect(event.questions.missing).toBe(2);
  });
});

describe("estimateCostUsd", () => {
  it("chưa cấu hình giá → null (không bịa giá)", () => {
    expect(estimateCostUsd(1_000_000, 500_000, DEFAULT_QUOTA)).toBeNull();
  });

  it("đã cấu hình giá → tính đúng theo token", () => {
    const quota = {
      ...DEFAULT_QUOTA,
      pricePerMillionInputUsd: 1,
      pricePerMillionOutputUsd: 2,
    };
    // (1_000_000 × 1 + 500_000 × 2) / 1_000_000 = 2.0
    expect(estimateCostUsd(1_000_000, 500_000, quota)).toBeCloseTo(2.0, 10);
  });

  it("chỉ có giá input → vẫn tính phần input", () => {
    const quota = {
      ...DEFAULT_QUOTA,
      pricePerMillionInputUsd: 0.5,
      pricePerMillionOutputUsd: 0,
    };
    expect(estimateCostUsd(2_000_000, 1_000_000, quota)).toBeCloseTo(1.0, 10);
  });
});

describe("categorizeExtractionError", () => {
  it("QuotaExceededError → quota_exceeded", () => {
    expect(
      categorizeExtractionError(new QuotaExceededError("requests", "1 > 0"))
    ).toBe("quota_exceeded");
  });

  it("lỗi thường → unknown (không đoán từ message)", () => {
    expect(categorizeExtractionError(new Error("boom"))).toBe("unknown");
    expect(categorizeExtractionError("chuỗi lỗi")).toBe("unknown");
    expect(categorizeExtractionError(null)).toBe("unknown");
  });
});

describe("logExtractionTelemetry (sink cục bộ, một dòng JSON)", () => {
  it("ghi đúng một dòng JSON có tiền tố, không chứa nội dung đề", () => {
    const v1 = makeResult([makeQuestion({ order: 1 })]);
    const hybrid = orchestrateExtraction({ result: v1 });
    const event = buildExtractionTelemetryEvent({
      sourceType: "docx",
      flagEnabled: true,
      v1,
      hybrid,
      latencyMs: 1,
      rolledBack: false,
    });
    const sink = vi.fn();
    logExtractionTelemetry(event, sink);
    expect(sink).toHaveBeenCalledTimes(1);
    const line = sink.mock.calls[0][0] as string;
    expect(line.startsWith("[ai-parser-v2] ")).toBe(true);
    const parsed = JSON.parse(line.replace("[ai-parser-v2] ", ""));
    expect(parsed.event).toBe("ai_parser_v2.extraction");
    expect(line).not.toContain("ZEBRA-98765");
    expect(line).not.toContain("ORCA-13579");
  });
});
