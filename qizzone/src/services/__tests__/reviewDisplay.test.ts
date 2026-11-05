import { describe, it, expect } from "vitest";
import type { ExtractionV2Question } from "@/types/extractionV2";
import type { ReconcileQuestionResult } from "@/services/extraction/reconcile";
import {
  buildQuestionReviewDisplay,
  buildReviewDisplay,
} from "@/services/extraction/reviewDisplay";
import type { HybridOrchestrationResult } from "@/services/extraction/hybridOrchestrator";

/**
 * Bước 23: test display model. Điểm khóa: display KHÔNG BAO GIỜ đọc
 * evidence.confidence hay V1 confidenceScore — % hiển thị chỉ từ
 * waterfall của origin, và nguồn không có % thì không hiển thị số.
 */

function makeQuestion(
  overrides: Partial<ExtractionV2Question> = {}
): ExtractionV2Question {
  return {
    id: "q1",
    order: 1,
    sourceNumber: null,
    content: "Thủ đô của Việt Nam là gì?",
    type: "single_choice",
    options: [
      { id: "A", content: "Hà Nội" },
      { id: "B", content: "TP.HCM" },
      { id: "C", content: "Đà Nẵng" },
      { id: "D", content: "Huế" },
    ],
    correctAnswers: ["A"],
    answerEvidence: { origin: "highlight", confidence: 0.95 },
    status: "verified",
    quality: { status: "complete", reasons: [] },
    points: 1,
    warnings: [],
    assetRefs: [],
    engine: "rule",
    page: null,
    ...overrides,
  };
}

function makeReconcile(
  overrides: Partial<ReconcileQuestionResult> = {}
): ReconcileQuestionResult {
  return {
    order: 1,
    questionIndex: 0,
    outcome: "unchanged",
    winningOrigin: null,
    losingOrigins: [],
    noCandidate: false,
    message: null,
    ...overrides,
  };
}

describe("reviewDisplay — trạng thái + nguồn + % waterfall", () => {
  it("câu verified có nguồn thắng thì hiển thị đúng nguồn + % waterfall", () => {
    const d = buildQuestionReviewDisplay({
      question: makeQuestion(),
      questionIndex: 0,
      evidenceVerdict: "valid",
    });
    expect(d.status).toBe("verified");
    expect(d.statusLabel).toBe("Đã xác minh");
    expect(d.answerSourceLabel).toBe("Tô vàng");
    expect(d.answerConfidencePercent).toBe(95);
    expect(d.suggestedAction).toBeNull();
    expect(d.questionDetection.complete).toBe(true);
    expect(d.questionDetection.label).toBe("Nhận diện đầy đủ");
  });

  it("bảng đáp án thắng thì hiển thị 99%", () => {
    const d = buildQuestionReviewDisplay({
      question: makeQuestion({
        answerEvidence: { origin: "answer_table", confidence: 0.99 },
      }),
      questionIndex: 0,
      evidenceVerdict: "valid",
    });
    expect(d.answerSourceLabel).toBe("Bảng đáp án");
    expect(d.answerConfidencePercent).toBe(99);
  });

  it("% hiển thị suy từ origin, KHÔNG từ evidence.confidence tự khai", () => {
    // Evidence mang confidence 0.42 tự khai nhưng origin là tô vàng:
    // display vẫn ra 95 (waterfall), không ra 42.
    const d = buildQuestionReviewDisplay({
      question: makeQuestion({
        answerEvidence: { origin: "highlight", confidence: 0.42 },
      }),
      questionIndex: 0,
      evidenceVerdict: "valid",
    });
    expect(d.answerConfidencePercent).toBe(95);
  });

  it("câu mâu thuẫn đồng hạng thì needs_review kèm cờ + hành động", () => {
    const d = buildQuestionReviewDisplay({
      question: makeQuestion({
        status: "needs_review",
        quality: { status: "partial", reasons: [] },
      }),
      questionIndex: 0,
      evidenceVerdict: "conflict",
      reconcile: makeReconcile({
        outcome: "unresolved-conflict",
        message:
          "Câu 1 có bằng chứng mâu thuẫn cùng mức ưu tiên — giữ nguyên đáp án hiện tại, cần giáo viên xác nhận",
      }),
    });
    expect(d.status).toBe("needs_review");
    expect(d.flagKeys).toContain("conflict");
    expect(d.reasons.join(" ")).toContain("mâu thuẫn");
    expect(d.suggestedAction).toBe(
      "Chọn đáp án đúng trong các nguồn mâu thuẫn"
    );
  });

  it("câu thiếu đáp án thì needs_review kèm lý do + hành động chọn đáp án", () => {
    const d = buildQuestionReviewDisplay({
      question: makeQuestion({
        correctAnswers: [],
        answerEvidence: null,
        status: "needs_review",
        quality: { status: "partial", reasons: [] },
      }),
      questionIndex: 0,
    });
    expect(d.status).toBe("needs_review");
    expect(d.answerSourceLabel).toBeNull();
    expect(d.answerConfidencePercent).toBeNull();
    expect(d.reasons).toContain("Chưa có đáp án");
    expect(d.flagKeys).toContain("missing_answer");
    expect(d.suggestedAction).toBe("Chọn đáp án đúng");
  });

  it("câu đã lược thì needs_review kèm cờ pruned + hành động chọn lại", () => {
    const d = buildQuestionReviewDisplay({
      question: makeQuestion({
        correctAnswers: [],
        answerEvidence: null,
        status: "needs_review",
        quality: { status: "partial", reasons: [] },
      }),
      questionIndex: 0,
      reconcile: makeReconcile({
        outcome: "pruned-invalid",
        message:
          "Câu 1 đã lược đáp án ngoài phương án [E] — cần giáo viên xác nhận, không tự thay bằng đáp án khác",
      }),
    });
    expect(d.status).toBe("needs_review");
    expect(d.flagKeys).toContain("pruned");
    expect(d.reasons.join(" ")).toContain("lược");
    expect(d.suggestedAction).toBe("Chọn lại đáp án");
  });

  it("câu không bằng chứng thì không hiển thị confidence > 0", () => {
    const d = buildQuestionReviewDisplay({
      question: makeQuestion({
        correctAnswers: [],
        answerEvidence: null,
        status: "needs_review",
        quality: { status: "partial", reasons: [] },
      }),
      questionIndex: 0,
    });
    expect(d.answerConfidencePercent).toBeNull();
    expect(d.answerSourceLabel).toBeNull();
    expect(d.flagKeys).toContain("no_evidence");
  });

  it("câu tạo tay thì gắn nhãn tạo tay", () => {
    const d = buildQuestionReviewDisplay({
      question: makeQuestion({
        engine: "manual",
        status: "needs_review",
        quality: { status: "partial", reasons: [] },
      }),
      questionIndex: 0,
    });
    expect(d.status).toBe("needs_review");
    expect(d.flagKeys).toContain("manual");
    expect(d.reasons).toContain("Câu tạo tay");
  });

  it("đáp án AI gợi ý thì likely và KHÔNG hiển thị 96% solving", () => {
    const d = buildQuestionReviewDisplay({
      question: makeQuestion({
        answerEvidence: { origin: "ai_suggested", confidence: 0.96 },
        status: "needs_review",
        quality: { status: "partial", reasons: [] },
      }),
      questionIndex: 0,
    });
    expect(d.status).toBe("likely");
    expect(d.statusLabel).toBe("Có thể đúng");
    expect(d.answerSourceLabel).toBe("AI gợi ý");
    expect(d.answerConfidencePercent).toBeNull();
    expect(d.flagKeys).toContain("ai_suggested");
    expect(d.suggestedAction).toBe("Xác nhận đáp án gợi ý");
  });

  it("giáo viên xác nhận thì verified nhưng KHÔNG hiển thị %", () => {
    const d = buildQuestionReviewDisplay({
      question: makeQuestion({
        answerEvidence: { origin: "teacher_confirmed", confidence: 1 },
      }),
      questionIndex: 0,
      evidenceVerdict: "valid",
    });
    expect(d.status).toBe("verified");
    expect(d.answerSourceLabel).toBe("Giáo viên xác nhận");
    expect(d.answerConfidencePercent).toBeNull();
  });

  it("đáp án ngoài phương án thì invalid", () => {
    const d = buildQuestionReviewDisplay({
      question: makeQuestion({
        // V2 option chỉ A–D nên đáp án E là ngoài phương án (dùng ép kiểu
        // để mô phỏng dữ liệu hỏng từ tầng trên).
        correctAnswers: ["E" as never],
        answerEvidence: { origin: "highlight", confidence: 0.95 },
        status: "needs_review",
        quality: { status: "partial", reasons: [] },
      }),
      questionIndex: 0,
      evidenceVerdict: "invalid",
    });
    expect(d.status).toBe("invalid");
    expect(d.flagKeys).toContain("invalid_answer");
    expect(d.suggestedAction).toBe("Sửa đáp án ngoài phương án");
  });

  it("câu thiếu phương án thì nhận diện chưa đầy đủ + needs_review", () => {
    const d = buildQuestionReviewDisplay({
      question: makeQuestion({
        options: [{ id: "A", content: "Hà Nội" }],
        correctAnswers: [],
        answerEvidence: null,
        status: "needs_review",
        quality: { status: "partial", reasons: [] },
      }),
      questionIndex: 0,
    });
    expect(d.status).toBe("needs_review");
    expect(d.questionDetection.complete).toBe(false);
    expect(d.flagKeys).toContain("insufficient_options");
    expect(d.flagKeys).toContain("incomplete_detection");
  });

  it("câu rỗng nội dung không bao giờ verified", () => {
    const d = buildQuestionReviewDisplay({
      question: makeQuestion({ content: "   " }),
      questionIndex: 0,
      evidenceVerdict: "valid",
    });
    expect(d.status).toBe("needs_review");
    expect(d.reasons).toContain("Thiếu nội dung câu hỏi");
  });

  it("câu OCR và trang scan mang cờ riêng", () => {
    const ocr = buildQuestionReviewDisplay({
      question: makeQuestion({
        engine: "ocr",
        status: "needs_review",
        quality: { status: "partial", reasons: [] },
      }),
      questionIndex: 0,
    });
    expect(ocr.flagKeys).toContain("ocr");

    const scan = buildQuestionReviewDisplay({
      question: makeQuestion({
        status: "needs_review",
        quality: { status: "partial", reasons: [] },
        page: 2,
      }),
      questionIndex: 0,
      scanPage: true,
    });
    expect(scan.flagKeys).toContain("scan");
    expect(scan.reasons).toContain("Trang scan — cần OCR");
  });

  it("type unknown mang cờ riêng", () => {
    const d = buildQuestionReviewDisplay({
      question: makeQuestion({
        type: "unknown",
        status: "needs_review",
        quality: { status: "partial", reasons: [] },
      }),
      questionIndex: 0,
    });
    expect(d.flagKeys).toContain("unknown_type");
  });
});

describe("buildReviewDisplay — tổng hợp toàn tài liệu", () => {
  function makeHybrid(): HybridOrchestrationResult {
    const q1 = makeQuestion();
    const q2 = makeQuestion({
      id: "q2",
      order: 2,
      correctAnswers: [],
      answerEvidence: null,
      status: "needs_review",
      quality: { status: "partial", reasons: [] },
    });
    const q3 = makeQuestion({
      id: "q3",
      order: 3,
      answerEvidence: { origin: "ai_suggested", confidence: 0.96 },
      status: "needs_review",
      quality: { status: "partial", reasons: [] },
    });
    return {
      v1: {} as never,
      v2: {
        questions: [q1, q2, q3],
        chunks: [],
      } as never,
      quality: {} as never,
      evidence: {
        questions: [
          { order: 1, questionIndex: 0, verdict: "valid" },
          { order: 2, questionIndex: 1, verdict: "valid" },
          { order: 3, questionIndex: 2, verdict: "valid" },
        ],
      } as never,
      reconcile: {
        total: 3,
        resolved: 0,
        unresolved: 0,
        pruned: 0,
        unchanged: 3,
        noCandidate: 0,
      },
      reconcileQuestions: [
        makeReconcile(),
        makeReconcile({ order: 2, questionIndex: 1 }),
        makeReconcile({ order: 3, questionIndex: 2 }),
      ],
      aiNeeded: { needed: true, questions: [], ocrNeededPages: [] },
      warnings: [],
    };
  }

  it("đếm đúng từng trạng thái và byFlag để UI lọc", () => {
    const display = buildReviewDisplay(makeHybrid());
    expect(display.summary.total).toBe(3);
    expect(display.summary.verified).toBe(1);
    expect(display.summary.needs_review).toBe(1);
    expect(display.summary.likely).toBe(1);
    expect(display.summary.invalid).toBe(0);
    expect(display.summary.byFlag["missing_answer"]).toBe(1);
    expect(display.summary.byFlag["ai_suggested"]).toBe(1);
    expect(display.questions.map((d) => d.order)).toEqual([1, 2, 3]);
  });
});
