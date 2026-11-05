import { describe, expect, it, vi } from "vitest";
import type {
  ExtractedQuestion,
  ExtractionResult,
} from "@/types/extractor";
import {
  orchestrateExtraction,
  orchestrateWithAI,
} from "@/services/extraction/hybridOrchestrator";
import { QuotaExceededError } from "@/services/extraction/aiProvider";

/**
 * Bước 21: test Hybrid Orchestrator. Toàn bộ AI đi qua mock dep (không
 * gọi Gemini thật, không tốn quota); parser luật không nằm trong test
 * này — orchestrator nhận V1 đã parse sẵn.
 */

function makeQuestion(
  overrides: Partial<ExtractedQuestion> & { order: number }
): ExtractedQuestion {
  const { order } = overrides;
  return {
    id: `q-${order}`,
    tempId: `t-${order}`,
    content: `Câu hỏi ${order} nội dung gì đó?`,
    options: [
      { id: "A", content: "Phương án A", rawContent: "A. Phương án A" },
      { id: "B", content: "Phương án B", rawContent: "B. Phương án B" },
      { id: "C", content: "Phương án C", rawContent: "C. Phương án C" },
      { id: "D", content: "Phương án D", rawContent: "D. Phương án D" },
    ],
    correctAnswers: ["A"],
    points: 1,
    confidenceScore: 0.99,
    detectionStrategy: "answer_table",
    rawTextSegment: `Câu hỏi ${overrides.order}`,
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

describe("orchestrateExtraction (tầng đồng bộ, không gọi AI)", () => {
  it("bộ luật đủ → quality complete, không cần AI, chunk toàn tài liệu complete", () => {
    const out = orchestrateExtraction({
      result: makeResult([makeQuestion({ order: 1 }), makeQuestion({ order: 2 })]),
    });
    expect(out.v1.questions).toHaveLength(2);
    expect(out.quality.status).toBe("complete");
    expect(out.aiNeeded.needed).toBe(false);
    expect(out.aiNeeded.questions).toEqual([]);
    expect(out.v2.chunks).toHaveLength(1);
    expect(out.v2.chunks[0].status).toBe("complete");
    expect(out.v2.questions[0].chunkIndex).toBe(0);
  });

  it("câu thiếu đáp án → aiNeeded missing_answer, V1 gốc giữ nguyên", () => {
    const q = makeQuestion({
      order: 1,
      correctAnswers: [],
      detectionStrategy: "ai_inference",
      confidenceScore: 0,
    });
    const result = makeResult([q]);
    const out = orchestrateExtraction({ result });
    expect(out.aiNeeded.needed).toBe(true);
    expect(out.aiNeeded.questions).toEqual([
      { questionIndex: 0, order: 1, reasons: ["missing_answer"] },
    ]);
    expect(out.v1).toBe(result);
    expect(out.v1.questions[0].correctAnswers).toEqual([]);
  });

  it("câu thiếu phương án → aiNeeded insufficient_options", () => {
    const q = makeQuestion({
      order: 1,
      options: [{ id: "A", content: "Chỉ một phương án", rawContent: "A. Chỉ một" }],
    });
    const out = orchestrateExtraction({ result: makeResult([q]) });
    expect(out.aiNeeded.questions[0].reasons).toContain("insufficient_options");
  });

  it("PDF theo trang: trang không câu → chunk partial, câu mang chunkIndex + sourceRef trang", () => {
    const q = makeQuestion({ order: 1, page: 1 });
    const out = orchestrateExtraction({
      result: makeResult([q]),
      totalPages: 2,
    });
    expect(out.v2.chunks).toHaveLength(2);
    expect(out.v2.chunks[0].status).toBe("complete");
    expect(out.v2.chunks[1].status).toBe("partial");
    expect(out.v2.questions[0].chunkIndex).toBe(0);
    expect(out.v2.questions[0].sourceRef).toBe("pdf:page 1");
  });

  it("trang scan → chunk failed + ocrNeededPages, không tính là cần AI extraction", () => {
    const q = makeQuestion({ order: 1, page: 1 });
    const out = orchestrateExtraction({
      result: makeResult([q]),
      totalPages: 2,
      scanPages: [2],
    });
    expect(out.v2.chunks[1].status).toBe("failed");
    expect(out.aiNeeded.ocrNeededPages).toEqual([2]);
    expect(out.aiNeeded.needed).toBe(false);
  });

  it("chất lượng DOCX bước 07 được giữ trong V2 (partial do thiếu câu)", () => {
    const out = orchestrateExtraction({
      result: makeResult([makeQuestion({ order: 1 })]),
      documentQuality: {
        status: "partial",
        parsedQuestions: 1,
        detectedHeaders: 3,
        unparsedHeaders: 2,
        reasons: ["Thiếu 2 câu"],
      },
    });
    expect(out.v2.documentQuality.status).toBe("partial");
    expect(out.v2.documentQuality.detectedHeaders).toBe(3);
    expect(out.quality.status).not.toBe("complete");
  });

  it("đáp án ngoài phương án → bước 22 lược về [] + cờ, không còn đếm invalid ở evidence cuối", () => {
    // Thay đổi kỳ vọng có chủ đích của bước 22 (tiền lệ bước 04/13):
    // trước bước 22, evidence cuối đếm invalid = 1 vì validator chỉ hạ
    // cấp mà không sửa; nay reconcile lược đáp án sai ngay trong V2 nên
    // evidence cuối (validate lại trên V2 đã lược) không còn invalid,
    // thay vào đó reconcile báo pruned = 1 và câu mang cờ + needs_review.
    const q = makeQuestion({
      order: 1,
      // "E" không nằm trong options A–D: lỗi cấu trúc, validator bắt được không cần context.
      correctAnswers: ["E" as never],
    });
    const out = orchestrateExtraction({ result: makeResult([q]) });
    expect(out.reconcile.pruned).toBe(1);
    expect(out.v2.questions[0].correctAnswers).toEqual([]);
    expect(out.v2.questions[0].answerEvidence).toBeNull();
    expect(out.v2.questions[0].status).toBe("needs_review");
    // 2 cờ đều đúng audit: cờ validator gốc (đáp án E ngoài phương án)
    // + cờ lược của reconcile — không gộp để khỏi mất dấu vết.
    expect(out.v2.questions[0].warnings.length).toBe(2);
    expect(
      out.v2.questions[0].warnings.some((w) => w.includes("lược đáp án ngoài phương án"))
    ).toBe(true);
    expect(out.evidence.summary.invalid).toBe(0);
  });

  it("bước 22: f07 — tập tô vàng đầy đủ [A, C] thay đáp án parser chỉ lấy [A]", () => {
    const q = makeQuestion({
      order: 1,
      correctAnswers: ["A"],
      detectionStrategy: "highlight_color",
      options: [
        { id: "A", content: "Phương án A", rawContent: "A. Phương án A", isHighlighted: true },
        { id: "B", content: "Phương án B", rawContent: "B. Phương án B" },
        { id: "C", content: "Phương án C", rawContent: "C. Phương án C", isHighlighted: true },
        { id: "D", content: "Phương án D", rawContent: "D. Phương án D" },
      ],
    });
    const out = orchestrateExtraction({ result: makeResult([q]) });
    expect(out.reconcile.resolved).toBe(1);
    expect(out.v2.questions[0].correctAnswers).toEqual(["A", "C"]);
    expect(out.v2.questions[0].answerEvidence?.origin).toBe("highlight");
    // V1 giữ nguyên (quyết định bước 21): review UI cũ vẫn thấy [A].
    expect(out.v1.questions[0].correctAnswers).toEqual(["A"]);
  });

  it("bước 22: mâu thuẫn đồng hạng trong V2 không tự chọn — V1 giữ nguyên, V2 mang cờ", () => {
    // Đồng hạng chỉ xảy ra khi context có 2 nguồn cùng mức; context của
    // orchestrator chỉ có flag định dạng nên case này dựng ở tầng
    // reconcile thuần (xem reconcile.test.ts). Ở đây khóa phần còn lại:
    // câu có flag nhưng nguồn thắng trùng đáp án thì không đổi gì.
    const q = makeQuestion({
      order: 1,
      correctAnswers: ["A"],
      detectionStrategy: "highlight_color",
      options: [
        { id: "A", content: "Phương án A", rawContent: "A. Phương án A", isHighlighted: true },
        { id: "B", content: "Phương án B", rawContent: "B. Phương án B" },
        { id: "C", content: "Phương án C", rawContent: "C. Phương án C" },
        { id: "D", content: "Phương án D", rawContent: "D. Phương án D" },
      ],
    });
    const out = orchestrateExtraction({ result: makeResult([q]) });
    expect(out.reconcile.resolved).toBe(0);
    expect(out.reconcile.unresolved).toBe(0);
    expect(out.v2.questions[0].correctAnswers).toEqual(["A"]);
  });
});

describe("orchestrateWithAI (on-demand, mock provider)", () => {
  it("không cần AI → không gọi aiExtract", async () => {
    const aiExtract = vi.fn();
    const out = await orchestrateWithAI(
      { result: makeResult([makeQuestion({ order: 1 })]) },
      { aiExtract }
    );
    expect(aiExtract).not.toHaveBeenCalled();
    expect(out.aiCalled).toBe(false);
    expect(out.aiSkippedReason).toBe("not-needed");
  });

  it("lấp đáp án thiếu bằng đáp án AI có bằng chứng, không ghi đè đáp án luật đã có", async () => {
    const ruleQ1 = makeQuestion({
      order: 1,
      correctAnswers: [],
      detectionStrategy: "ai_inference",
      confidenceScore: 0,
    });
    const ruleQ2 = makeQuestion({ order: 2 }); // đã có đáp án A
    const aiQ1 = makeQuestion({
      order: 1,
      correctAnswers: ["B"],
      detectionStrategy: "highlight_color",
      confidenceScore: 0.95,
    });
    const aiQ2 = makeQuestion({
      order: 2,
      correctAnswers: ["C"],
      detectionStrategy: "highlight_color",
    });
    const aiExtract = vi.fn().mockResolvedValue(makeResult([aiQ1, aiQ2]));
    const out = await orchestrateWithAI(
      { result: makeResult([ruleQ1, ruleQ2]) },
      { aiExtract }
    );
    expect(aiExtract).toHaveBeenCalledTimes(1);
    expect(out.aiCalled).toBe(true);
    expect(out.aiFilledCount).toBe(1);
    expect(out.v1.questions[0].correctAnswers).toEqual(["B"]);
    expect(out.v1.questions[0].detectionStrategy).toBe("highlight_color");
    // Câu 2 đã có đáp án luật A → không bị AI ghi đè thành C.
    expect(out.v1.questions[1].correctAnswers).toEqual(["A"]);
  });

  it("đáp án AI nhãn ai_inference (solving) bị từ chối hợp nhất", async () => {
    const ruleQ = makeQuestion({
      order: 1,
      correctAnswers: [],
      detectionStrategy: "ai_inference",
      confidenceScore: 0,
    });
    const aiQ = makeQuestion({
      order: 1,
      correctAnswers: ["B"],
      detectionStrategy: "ai_inference",
      confidenceScore: 0.96,
    });
    const out = await orchestrateWithAI(
      { result: makeResult([ruleQ]) },
      { aiExtract: vi.fn().mockResolvedValue(makeResult([aiQ])) }
    );
    expect(out.aiCalled).toBe(true);
    expect(out.aiFilledCount).toBe(0);
    expect(out.v1.questions[0].correctAnswers).toEqual([]);
  });

  it("không có provider → giữ kết quả luật kèm lý do", async () => {
    const ruleQ = makeQuestion({
      order: 1,
      correctAnswers: [],
      detectionStrategy: "ai_inference",
      confidenceScore: 0,
    });
    const out = await orchestrateWithAI({ result: makeResult([ruleQ]) }, null);
    expect(out.aiCalled).toBe(false);
    expect(out.aiSkippedReason).toBe("no-provider");
    expect(out.v1.questions[0].correctAnswers).toEqual([]);
  });

  it("vượt quota → không throw, giữ kết quả luật kèm cảnh báo quota", async () => {
    const ruleQ = makeQuestion({
      order: 1,
      correctAnswers: [],
      detectionStrategy: "ai_inference",
      confidenceScore: 0,
    });
    const aiExtract = vi
      .fn()
      .mockRejectedValue(new QuotaExceededError("requests", "51 > 50 request"));
    const out = await orchestrateWithAI(
      { result: makeResult([ruleQ]) },
      { aiExtract }
    );
    expect(out.aiCalled).toBe(false);
    expect(out.aiSkippedReason).toBe("quota");
    expect(out.v1.questions[0].correctAnswers).toEqual([]);
    expect(out.warnings.some((w) => w.includes("giới hạn gọi AI"))).toBe(true);
  });

  it("AI lỗi thường → giữ kết quả luật kèm lý do error", async () => {
    const ruleQ = makeQuestion({
      order: 1,
      correctAnswers: [],
      detectionStrategy: "ai_inference",
      confidenceScore: 0,
    });
    const aiExtract = vi.fn().mockRejectedValue(new Error("network down"));
    const out = await orchestrateWithAI(
      { result: makeResult([ruleQ]) },
      { aiExtract }
    );
    expect(out.aiCalled).toBe(false);
    expect(out.aiSkippedReason).toBe("error");
    expect(out.v1.questions[0].correctAnswers).toEqual([]);
  });
});
