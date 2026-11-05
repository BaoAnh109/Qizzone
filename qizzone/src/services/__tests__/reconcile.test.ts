import { describe, expect, it } from "vitest";
import type {
  AnswerOrigin,
  ExtractionV2Question,
} from "@/types/extractionV2";
import type { QuestionEvidenceContext } from "@/services/extraction/evidenceValidator";
import {
  buildCandidatesFromContext,
  buildFormatContexts,
  reconcileQuestion,
  reconcileResult,
  type AnswerCandidate,
} from "@/services/extraction/reconcile";
import type { ExtractedQuestion } from "@/types/extractor";

/**
 * Bước 22: test Reconcile bằng bằng chứng. Toàn bộ dữ liệu tự dựng, không
 * gọi AI, không đọc file. Waterfall khóa ở bước 11:
 * teacher_confirmed > answer_table 99 = answer_line 99 > marker 98 >
 * underline 95 = highlight 95 > bold 90 > solution 88; ai_suggested/none
 * không bao giờ là ứng viên.
 */

function makeV2Question(
  overrides: Partial<ExtractionV2Question> & { order: number }
): ExtractionV2Question {
  // Tách order ra khỏi overrides trước khi spread (tsc bắt key trùng —
  // đúng bài học bước 11/21: vitest dùng esbuild không kiểm tra kiểu).
  const { order, ...rest } = overrides;
  return {
    id: `q-${order}`,
    order,
    sourceNumber: order,
    content: `Câu hỏi ${order} nội dung gì đó?`,
    type: "single_choice",
    options: [
      { id: "A", content: "Phương án A" },
      { id: "B", content: "Phương án B" },
      { id: "C", content: "Phương án C" },
      { id: "D", content: "Phương án D" },
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
    ...rest,
  };
}

function cand(
  origin: AnswerOrigin,
  answers: AnswerCandidate["answers"]
): AnswerCandidate {
  return { origin, answers };
}

describe("reconcileQuestion — chọn nguồn thắng theo waterfall", () => {
  it("bảng đáp án (99%) thắng tô vàng (95%)", () => {
    const q = makeV2Question({ order: 1 });
    const { question, result } = reconcileQuestion(q, 0, [
      cand("highlight", ["B"]),
      cand("answer_table", ["A"]),
    ]);
    // Đáp án hiện tại đã là A (trùng nguồn thắng) → không đổi, nhưng vẫn
    // ghi nhận nguồn thắng là bảng để UI đối chiếu.
    expect(result.outcome).toBe("unchanged");
    expect(result.winningOrigin).toBe("answer_table");
    expect(result.losingOrigins).toEqual(["highlight"]);
    expect(question.correctAnswers).toEqual(["A"]);
  });

  it("bảng đáp án thắng và thay đáp án hiện tại từ nguồn thấp hơn", () => {
    const q = makeV2Question({
      order: 1,
      correctAnswers: ["B"],
      answerEvidence: { origin: "highlight", confidence: 0.95 },
    });
    const { question, result } = reconcileQuestion(q, 0, [
      cand("highlight", ["B"]),
      cand("answer_table", ["A"]),
    ]);
    expect(result.outcome).toBe("resolved");
    expect(result.winningOrigin).toBe("answer_table");
    expect(question.correctAnswers).toEqual(["A"]);
    expect(question.answerEvidence?.origin).toBe("answer_table");
    expect(question.answerEvidence?.confidence).toBe(0.99);
    expect(question.status).toBe("verified");
    expect(question.warnings.length).toBe(1);
  });

  it("gạch chân (95%) thắng in đậm (90%)", () => {
    const q = makeV2Question({
      order: 1,
      correctAnswers: ["A"],
      answerEvidence: { origin: "bold", confidence: 0.9 },
    });
    const { question, result } = reconcileQuestion(q, 0, [
      cand("bold", ["A"]),
      cand("underline", ["C"]),
    ]);
    expect(result.outcome).toBe("resolved");
    expect(result.winningOrigin).toBe("underline");
    expect(question.correctAnswers).toEqual(["C"]);
    expect(question.answerEvidence?.confidence).toBe(0.95);
  });

  it("đồng hạng bảng vs dòng cuối câu mà khác đáp án → không có nguồn thắng, giữ nguyên + cờ", () => {
    const q = makeV2Question({ order: 1 });
    const { question, result } = reconcileQuestion(q, 0, [
      cand("answer_table", ["A"]),
      cand("answer_line", ["B"]),
    ]);
    expect(result.outcome).toBe("unresolved-conflict");
    expect(result.winningOrigin).toBeNull();
    expect(question.correctAnswers).toEqual(["A"]);
    expect(question.status).toBe("needs_review");
    expect(question.quality.status).toBe("partial");
    expect(question.warnings.length).toBe(1);
  });

  it("đồng hạng tô vàng vs gạch chân mà khác đáp án → không có nguồn thắng", () => {
    const q = makeV2Question({ order: 1 });
    const { question, result } = reconcileQuestion(q, 0, [
      cand("highlight", ["A"]),
      cand("underline", ["B"]),
    ]);
    expect(result.outcome).toBe("unresolved-conflict");
    expect(question.correctAnswers).toEqual(["A"]);
    expect(question.status).toBe("needs_review");
  });

  it("đồng hạng mà cùng tập đáp án thì không phải mâu thuẫn", () => {
    const q = makeV2Question({ order: 1 });
    const { result } = reconcileQuestion(q, 0, [
      cand("answer_table", ["A"]),
      cand("answer_line", ["A"]),
    ]);
    expect(result.outcome).toBe("unchanged");
    expect(result.winningOrigin).toBe("answer_table");
  });

  it("giáo viên đã xác nhận thì nguồn máy không được thay thế", () => {
    const q = makeV2Question({
      order: 1,
      correctAnswers: ["B"],
      answerEvidence: { origin: "teacher_confirmed", confidence: 1 },
    });
    const { question, result } = reconcileQuestion(q, 0, [
      cand("answer_table", ["A"]),
    ]);
    expect(result.outcome).toBe("unchanged");
    expect(question.correctAnswers).toEqual(["B"]);
    expect(question.answerEvidence?.origin).toBe("teacher_confirmed");
  });

  it("ứng viên teacher_confirmed (caller cấp) thắng bảng đáp án", () => {
    const q = makeV2Question({ order: 1 });
    const { question, result } = reconcileQuestion(q, 0, [
      cand("answer_table", ["A"]),
      cand("teacher_confirmed", ["C"]),
    ]);
    expect(result.outcome).toBe("resolved");
    expect(result.winningOrigin).toBe("teacher_confirmed");
    expect(question.correctAnswers).toEqual(["C"]);
    expect(question.answerEvidence?.confidence).toBe(1);
  });

  it("không có ứng viên → giữ nguyên, không thêm cờ", () => {
    const q = makeV2Question({ order: 1 });
    const { question, result } = reconcileQuestion(q, 0, []);
    expect(result.outcome).toBe("unchanged");
    expect(result.noCandidate).toBe(true);
    expect(question).toBe(q);
    expect(question.warnings).toEqual([]);
  });

  it("ứng viên ai_suggested bị bỏ qua hoàn toàn", () => {
    const q = makeV2Question({ order: 1 });
    const { question, result } = reconcileQuestion(q, 0, [
      cand("ai_suggested", ["C"]),
    ]);
    expect(result.outcome).toBe("unchanged");
    expect(result.noCandidate).toBe(true);
    expect(question.correctAnswers).toEqual(["A"]);
  });

  it("lược đáp án ngoài phương án, kèm cờ, không thay bằng đáp án khác", () => {
    const q = makeV2Question({
      order: 1,
      correctAnswers: ["A", "E" as never],
    });
    const { question, result } = reconcileQuestion(q, 0, [
      cand("answer_table", ["B"]),
    ]);
    expect(result.outcome).toBe("pruned-invalid");
    expect(question.correctAnswers).toEqual(["A"]);
    expect(question.status).toBe("needs_review");
    expect(question.warnings.length).toBe(1);
  });

  it("lược hết đáp án sai → đáp án rỗng + evidence null", () => {
    const q = makeV2Question({
      order: 1,
      correctAnswers: ["E" as never],
    });
    const { question, result } = reconcileQuestion(q, 0, []);
    expect(result.outcome).toBe("pruned-invalid");
    expect(question.correctAnswers).toEqual([]);
    expect(question.answerEvidence).toBeNull();
  });

  it("f07: tập tô vàng đầy đủ [A, C] thay đáp án parser chỉ lấy [A]", () => {
    const q = makeV2Question({
      order: 1,
      type: "multiple_choice",
      correctAnswers: ["A"],
      answerEvidence: { origin: "highlight", confidence: 0.95 },
    });
    const { question, result } = reconcileQuestion(q, 0, [
      cand("highlight", ["A", "C"]),
    ]);
    expect(result.outcome).toBe("resolved");
    expect(question.correctAnswers).toEqual(["A", "C"]);
    expect(question.answerEvidence?.origin).toBe("highlight");
  });

  it("nguồn cao hơn thay cả tập đáp án, type câu giữ nguyên", () => {
    // Bảng (99%) cao hơn tô vàng (95%) nên tập của bảng thắng và thay
    // toàn bộ tập hiện tại — đây là chọn nguồn theo waterfall, không
    // phải cắt tùy tiện: type multiple_choice giữ nguyên, không bị ép
    // về single_choice chỉ vì tập thắng chỉ còn 1 đáp án.
    const q = makeV2Question({
      order: 1,
      type: "multiple_choice",
      correctAnswers: ["A", "C"],
      answerEvidence: { origin: "highlight", confidence: 0.95 },
    });
    const { question, result } = reconcileQuestion(q, 0, [
      cand("answer_table", ["A"]),
    ]);
    expect(result.outcome).toBe("resolved");
    expect(question.correctAnswers).toEqual(["A"]);
    expect(question.type).toBe("multiple_choice");
  });

  it("câu < 2 phương án dù nguồn thắng vẫn needs_review", () => {
    const q = makeV2Question({
      order: 1,
      options: [{ id: "A", content: "Chỉ một phương án" }],
      correctAnswers: [],
      answerEvidence: null,
      status: "needs_review",
      quality: { status: "partial", reasons: ["Thiếu phương án"] },
    });
    const { question, result } = reconcileQuestion(q, 0, [
      cand("answer_table", ["A"]),
    ]);
    expect(result.outcome).toBe("resolved");
    expect(question.correctAnswers).toEqual(["A"]);
    expect(question.status).toBe("needs_review");
  });

  it("không mutate input", () => {
    const q = makeV2Question({ order: 1 });
    const { question } = reconcileQuestion(q, 0, [cand("answer_table", ["B"])]);
    expect(q.correctAnswers).toEqual(["A"]);
    expect(question).not.toBe(q);
  });
});

describe("buildCandidatesFromContext", () => {
  it("bảng + dòng + lời giải + flag định dạng thành đúng ứng viên", () => {
    const ctx: QuestionEvidenceContext = {
      answerKeyEntry: ["A"],
      trailingAnswer: "B",
      solutionAnswer: "C",
      optionFormats: {
        A: { highlight: true },
        B: { underline: true },
        C: { marker: true },
        D: {},
      },
    };
    const got = buildCandidatesFromContext(ctx);
    expect(got).toEqual([
      { origin: "answer_table", answers: ["A"] },
      { origin: "answer_line", answers: ["B"] },
      { origin: "solution", answers: ["C"] },
      { origin: "marker", answers: ["C"] },
      { origin: "underline", answers: ["B"] },
      { origin: "highlight", answers: ["A"] },
    ]);
  });

  it("in đậm 2+ phương án thì không có ứng viên bold", () => {
    const ctx: QuestionEvidenceContext = {
      optionFormats: { A: { bold: true }, B: { bold: true } },
    };
    expect(buildCandidatesFromContext(ctx)).toEqual([]);
  });

  it("in đậm đúng 1 phương án thì có ứng viên bold", () => {
    const ctx: QuestionEvidenceContext = {
      optionFormats: { A: { bold: true }, B: {} },
    };
    expect(buildCandidatesFromContext(ctx)).toEqual([
      { origin: "bold", answers: ["A"] },
    ]);
  });

  it("context rỗng → không có ứng viên", () => {
    expect(buildCandidatesFromContext(undefined)).toEqual([]);
    expect(buildCandidatesFromContext({})).toEqual([]);
  });
});

describe("buildFormatContexts (từ V1, cùng logic runner bước 11)", () => {
  it("chỉ cấp map cho câu có ít nhất một flag", () => {
    const v1q = (order: number, flags: Record<string, boolean>): ExtractedQuestion => ({
      id: `q-${order}`,
      tempId: `t-${order}`,
      order,
      content: `Câu ${order}`,
      options: (["A", "B", "C", "D"] as const).map((id) => ({
        id,
        content: `PA ${id}`,
        rawContent: `${id}. PA ${id}`,
        isHighlighted: id === "A" && flags.highlight === true,
        isBold: id === "B" && flags.bold === true,
      })),
      correctAnswers: ["A"],
      points: 1,
      confidenceScore: 0.95,
      detectionStrategy: "highlight_color",
      rawTextSegment: `Câu ${order}`,
    });
    const contexts = buildFormatContexts([
      v1q(1, { highlight: true }),
      v1q(2, {}),
    ]);
    expect(contexts.has(1)).toBe(true);
    expect(contexts.get(1)?.optionFormats?.A?.highlight).toBe(true);
    expect(contexts.has(2)).toBe(false);
  });
});

describe("reconcileResult — toàn tài liệu", () => {
  it("tổng hợp đúng số resolved/unresolved/pruned/unchanged", () => {
    const result = {
      fileName: "de.docx",
      fileType: "docx" as const,
      fileSize: 100,
      title: "",
      subject: "",
      totalQuestionsDetected: 4,
      questions: [
        makeV2Question({ order: 1 }),
        makeV2Question({
          order: 2,
          correctAnswers: ["B"],
          answerEvidence: { origin: "highlight", confidence: 0.95 },
        }),
        makeV2Question({ order: 3 }),
        makeV2Question({
          order: 4,
          correctAnswers: ["E" as never],
        }),
      ],
      hasAnswerKeyTable: false,
      documentQuality: { status: "complete" as const, parsedQuestions: 4, reasons: [] },
      warnings: [],
      chunks: [],
      extractedAt: new Date().toISOString(),
    };
    const contexts = new Map<number, QuestionEvidenceContext>([
      [1, { answerKeyEntry: ["A"] }],
      [2, { answerKeyEntry: ["A"] }],
      [3, { answerKeyEntry: ["A"], trailingAnswer: "B" }],
    ]);
    const out = reconcileResult(result, contexts);
    // Câu 4 không có context nhưng bị lược TRƯỚC khi xét ứng viên nên
    // không đếm noCandidate — noCandidate chỉ đếm câu đi tới bước xét
    // ứng viên mà không có ứng viên nào (ở đây không có câu nào như vậy
    // vì câu 1/2/3 đều có context, câu 4 dừng ở bước lược).
    expect(out.summary).toEqual({
      total: 4,
      resolved: 1,
      unresolved: 1,
      pruned: 1,
      unchanged: 1,
      noCandidate: 0,
    });
    expect(out.result.questions[1].correctAnswers).toEqual(["A"]);
    expect(out.result.questions[3].correctAnswers).toEqual([]);
  });
});
