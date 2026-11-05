import { describe, it, expect } from "vitest";
import type { ExtractedQuestion } from "@/types/extractor";
import type {
  ExtractionV2Question,
  V2ChunkStatus,
} from "@/types/extractionV2";
import type { ReconcileQuestionResult } from "@/services/extraction/reconcile";
import {
  buildQuestionSourceTrace,
  buildSourceTraces,
} from "@/services/extraction/sourceTrace";
import type { HybridOrchestrationResult } from "@/services/extraction/hybridOrchestrator";

/**
 * Bước 24: test đối chiếu nguồn. Điểm khóa: không bịa vị trí — chunk
 * toàn tài liệu không phải vị trí, câu tạo tay không có nguồn, mâu thuẫn
 * chưa giải quyết thì không có nguồn thắng.
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
    ],
    correctAnswers: ["A"],
    answerEvidence: {
      origin: "highlight",
      confidence: 0.95,
      sourceExcerpt: "Đáp án: A",
    },
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

function makeV1(overrides: Partial<ExtractedQuestion> = {}): ExtractedQuestion {
  return {
    id: "q1",
    tempId: "t1",
    order: 1,
    content: "Thủ đô của Việt Nam là gì?",
    options: [
      { id: "A", content: "Hà Nội", rawContent: "A. Hà Nội" },
      { id: "B", content: "TP.HCM", rawContent: "B. TP.HCM" },
    ],
    correctAnswers: ["A"],
    points: 1,
    confidenceScore: 0.95,
    detectionStrategy: "highlight_color",
    rawTextSegment: "Câu 1: Thủ đô của Việt Nam là gì? A. Hà Nội B. TP.HCM",
    ...overrides,
  } as ExtractedQuestion;
}

function makeChunk(
  overrides: Partial<V2ChunkStatus> = {}
): V2ChunkStatus {
  return {
    chunkIndex: 0,
    status: "complete",
    questionOrders: [1],
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

describe("sourceTrace — vị trí nguồn", () => {
  it("câu PDF có page thì vị trí là Trang N", () => {
    const t = buildQuestionSourceTrace({
      question: makeQuestion({ page: 2, chunkIndex: 1 }),
      questionIndex: 0,
      chunk: makeChunk({ chunkIndex: 1, page: 2 }),
    });
    expect(t.positionLabel).toBe("Trang 2");
    expect(t.chunkLabel).toBe("Chunk 1 — đã xử lý");
    expect(t.hasSource).toBe(true);
    expect(t.noSourceReason).toBeNull();
  });

  it("chunk khối IR thì vị trí là khoảng khối", () => {
    const t = buildQuestionSourceTrace({
      question: makeQuestion({ chunkIndex: 0 }),
      questionIndex: 0,
      chunk: makeChunk({ blockStart: 3, blockEnd: 5 }),
    });
    expect(t.positionLabel).toBe("Khối 3–5");
    expect(t.hasSource).toBe(true);
  });

  it("chunk toàn tài liệu không được tính là vị trí", () => {
    const t = buildQuestionSourceTrace({
      question: makeQuestion({
        chunkIndex: 0,
        answerEvidence: null,
        correctAnswers: [],
      }),
      questionIndex: 0,
      v1question: makeV1({ rawTextSegment: "" }),
      chunk: makeChunk(),
    });
    expect(t.positionLabel).toBeNull();
    expect(t.chunkLabel).toBe("Chunk 0 — đã xử lý");
    expect(t.hasSource).toBe(false);
    expect(t.noSourceReason).toBe(
      "Parser không giữ được vị trí hay bằng chứng của câu này"
    );
  });

  it("câu tạo tay không có nguồn dù rawTextSegment là placeholder", () => {
    const t = buildQuestionSourceTrace({
      question: makeQuestion({
        engine: "manual",
        answerEvidence: null,
        correctAnswers: [],
      }),
      questionIndex: 0,
      v1question: makeV1({ rawTextSegment: "Câu hỏi thêm mới thủ công" }),
      chunk: makeChunk(),
    });
    expect(t.hasSource).toBe(false);
    expect(t.rawSegment).toBeNull();
    expect(t.noSourceReason).toBe(
      "Câu tạo tay — không có nguồn trong tài liệu gốc"
    );
  });
});

describe("sourceTrace — trích đoạn và nguồn thắng", () => {
  it("ưu tiên đoạn trích bằng chứng hơn đoạn gốc", () => {
    const t = buildQuestionSourceTrace({
      question: makeQuestion(),
      questionIndex: 0,
      v1question: makeV1(),
    });
    expect(t.evidenceExcerpt).toBe("Đáp án: A");
    expect(t.rawSegment).toBe(
      "Câu 1: Thủ đô của Việt Nam là gì? A. Hà Nội B. TP.HCM"
    );
  });

  it("đoạn gốc trùng excerpt thì không hiển thị trùng", () => {
    const t = buildQuestionSourceTrace({
      question: makeQuestion(),
      questionIndex: 0,
      v1question: makeV1({ rawTextSegment: "Đáp án: A" }),
    });
    expect(t.evidenceExcerpt).toBe("Đáp án: A");
    expect(t.rawSegment).toBeNull();
  });

  it("nguồn thắng từ reconcile kèm % waterfall", () => {
    const t = buildQuestionSourceTrace({
      question: makeQuestion(),
      questionIndex: 0,
      reconcile: makeReconcile({
        outcome: "resolved",
        winningOrigin: "answer_table",
        losingOrigins: ["highlight"],
      }),
    });
    expect(t.winningOrigin).toBe("answer_table");
    expect(t.winningLabel).toBe("Bảng đáp án");
    expect(t.winningPercent).toBe(99);
    expect(t.losingLabels).toEqual(["Tô vàng"]);
  });

  it("giáo viên xác nhận thắng thì có nhãn nhưng không có số", () => {
    const t = buildQuestionSourceTrace({
      question: makeQuestion(),
      questionIndex: 0,
      reconcile: makeReconcile({
        outcome: "resolved",
        winningOrigin: "teacher_confirmed",
      }),
    });
    expect(t.winningLabel).toBe("Giáo viên xác nhận");
    expect(t.winningPercent).toBeNull();
  });

  it("mâu thuẫn chưa giải quyết thì không có nguồn thắng", () => {
    const t = buildQuestionSourceTrace({
      question: makeQuestion(),
      questionIndex: 0,
      reconcile: makeReconcile({
        outcome: "unresolved-conflict",
        winningOrigin: null,
        losingOrigins: ["answer_table", "highlight"],
        message: "Mâu thuẫn cùng mức ưu tiên",
      }),
    });
    expect(t.winningOrigin).toBeNull();
    expect(t.winningLabel).toBeNull();
    expect(t.losingLabels).toEqual(["Bảng đáp án", "Tô vàng"]);
  });

  it("không có báo cáo reconcile thì suy nguồn thắng từ evidence", () => {
    const t = buildQuestionSourceTrace({
      question: makeQuestion(),
      questionIndex: 0,
    });
    expect(t.winningOrigin).toBe("highlight");
    expect(t.winningLabel).toBe("Tô vàng");
    expect(t.winningPercent).toBe(95);
  });
});

describe("sourceTrace — buildSourceTraces khớp theo order", () => {
  it("khớp câu V1, chunk và reconcile theo order", () => {
    const hybrid = {
      v2: {
        questions: [
          makeQuestion({ page: 1, chunkIndex: 0 }),
          makeQuestion({ id: "q2", order: 2, page: 2, chunkIndex: 1 }),
        ],
        chunks: [
          makeChunk({ chunkIndex: 0, page: 1 }),
          makeChunk({ chunkIndex: 1, page: 2, status: "failed" }),
        ],
      },
      reconcileQuestions: [makeReconcile()],
    } as unknown as HybridOrchestrationResult;
    const traces = buildSourceTraces(hybrid, [
      makeV1(),
      makeV1({ id: "q2", order: 2 }),
    ]);
    expect(traces.get(1)?.positionLabel).toBe("Trang 1");
    expect(traces.get(2)?.positionLabel).toBe("Trang 2");
    expect(traces.get(2)?.chunkStatus).toBe("failed");
    expect(traces.get(1)?.winningOrigin).toBe("highlight");
  });
});
