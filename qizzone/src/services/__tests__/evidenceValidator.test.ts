import { describe, it, expect } from "vitest";
import type {
  ExtractionV2Question,
  ExtractionV2Result,
} from "@/types/extractionV2";
import {
  validateQuestionEvidence,
  validateEvidence,
  applyEvidenceValidation,
  type QuestionEvidenceContext,
} from "@/services/extraction/evidenceValidator";

function makeQuestion(
  overrides: Partial<ExtractionV2Question> = {}
): ExtractionV2Question {
  return {
    id: "q-test",
    order: 1,
    sourceNumber: null,
    content: "Nội dung câu hỏi",
    type: "single_choice",
    options: [
      { id: "A", content: "Đáp án A" },
      { id: "B", content: "Đáp án B" },
      { id: "C", content: "Đáp án C" },
      { id: "D", content: "Đáp án D" },
    ],
    correctAnswers: ["A"],
    answerEvidence: { origin: "answer_table", confidence: 0.99 },
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

function makeResult(
  questions: ExtractionV2Question[],
  overrides: Partial<ExtractionV2Result> = {}
): ExtractionV2Result {
  return {
    fileName: "test.docx",
    fileType: "docx",
    fileSize: 1000,
    title: "",
    subject: "",
    totalQuestionsDetected: questions.length,
    questions,
    hasAnswerKeyTable: false,
    documentQuality: {
      status: "complete",
      parsedQuestions: questions.length,
      reasons: [],
    },
    warnings: [],
    chunks: [],
    extractedAt: "2026-11-05T00:00:00.000Z",
    ...overrides,
  };
}

const flagged = (
  optionId: "A" | "B" | "C" | "D",
  flag: "underline" | "highlight" | "bold" | "marker"
): QuestionEvidenceContext => ({
  optionFormats: { [optionId]: { [flag]: true } } as QuestionEvidenceContext["optionFormats"],
});

describe("Evidence Validator (bước 11)", () => {
  it("đáp án từ bảng đáp án khớp bảng → valid, giữ verified, đã đối chiếu", () => {
    const q = makeQuestion({});
    const r = validateQuestionEvidence(q, 0, { answerKeyEntry: ["A"] });
    expect(r.verdict).toBe("valid");
    expect(r.effectiveStatus).toBe("verified");
    expect(r.crossChecked).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it("đáp án highlight khớp flag phương án → valid", () => {
    const q = makeQuestion({
      answerEvidence: { origin: "highlight", confidence: 0.95 },
    });
    const r = validateQuestionEvidence(q, 0, flagged("A", "highlight"));
    expect(r.verdict).toBe("valid");
    expect(r.effectiveStatus).toBe("verified");
  });

  it("đáp án marker khớp flag → valid", () => {
    const q = makeQuestion({
      answerEvidence: { origin: "marker", confidence: 0.98 },
    });
    const r = validateQuestionEvidence(q, 0, flagged("A", "marker"));
    expect(r.verdict).toBe("valid");
  });

  it("không có đáp án, evidence null, needs_review → valid (đúng nhãn không-đáp-án)", () => {
    const q = makeQuestion({
      correctAnswers: [],
      answerEvidence: null,
      status: "needs_review",
      quality: { status: "partial", reasons: ["Chưa có đáp án"] },
    });
    const r = validateQuestionEvidence(q, 0);
    expect(r.verdict).toBe("valid");
    expect(r.effectiveStatus).toBe("needs_review");
    expect(r.crossChecked).toBe(true);
  });

  it("ai_suggested + needs_review → valid (đúng nhãn, không tự thành verified)", () => {
    const q = makeQuestion({
      answerEvidence: { origin: "ai_suggested", confidence: 0.96 },
      status: "needs_review",
      engine: "gemini",
    });
    const r = validateQuestionEvidence(q, 0);
    expect(r.verdict).toBe("valid");
    expect(r.effectiveStatus).toBe("needs_review");
  });

  it("teacher_confirmed + đủ phương án → valid, giữ verified (con người là bằng chứng)", () => {
    const q = makeQuestion({
      answerEvidence: { origin: "teacher_confirmed", confidence: 1 },
    });
    const r = validateQuestionEvidence(q, 0);
    expect(r.verdict).toBe("valid");
    expect(r.effectiveStatus).toBe("verified");
    expect(r.crossChecked).toBe(true);
  });

  it("có đáp án nhưng evidence null → missing_evidence, hạ cấp", () => {
    const q = makeQuestion({ answerEvidence: null });
    const r = validateQuestionEvidence(q, 0);
    expect(r.verdict).toBe("downgraded");
    expect(r.issues.map((i) => i.code)).toContain("missing_evidence");
    expect(r.effectiveStatus).toBe("needs_review");
  });

  it("có đáp án nhưng evidence khai none → missing_evidence, hạ cấp", () => {
    const q = makeQuestion({
      answerEvidence: { origin: "none", confidence: 0 },
    });
    const r = validateQuestionEvidence(q, 0);
    expect(r.verdict).toBe("downgraded");
    expect(r.issues.map((i) => i.code)).toContain("missing_evidence");
  });

  it("không đáp án nhưng evidence khai nguồn → evidence_without_answer, hạ cấp", () => {
    const q = makeQuestion({
      correctAnswers: [],
      answerEvidence: { origin: "highlight", confidence: 0.95 },
      status: "needs_review",
    });
    const r = validateQuestionEvidence(q, 0);
    expect(r.verdict).toBe("downgraded");
    expect(r.issues.map((i) => i.code)).toContain("evidence_without_answer");
  });

  it("ai_suggested nhưng status verified → status_mismatch, hạ cấp (không bao giờ verified)", () => {
    const q = makeQuestion({
      answerEvidence: { origin: "ai_suggested", confidence: 0.96 },
      status: "verified",
      engine: "gemini",
    });
    const r = validateQuestionEvidence(q, 0);
    expect(r.verdict).toBe("downgraded");
    expect(r.issues.map((i) => i.code)).toContain("status_mismatch");
    expect(r.effectiveStatus).toBe("needs_review");
  });

  it("verified nhưng chỉ 1 phương án → status_mismatch, hạ cấp", () => {
    const q = makeQuestion({
      options: [{ id: "A", content: "Đáp án A" }],
    });
    const r = validateQuestionEvidence(q, 0, { answerKeyEntry: ["A"] });
    expect(r.verdict).toBe("downgraded");
    expect(r.issues.map((i) => i.code)).toContain("status_mismatch");
  });

  it("khai highlight nhưng phương án không có flag → evidence_mismatch, hạ cấp", () => {
    const q = makeQuestion({
      answerEvidence: { origin: "highlight", confidence: 0.95 },
    });
    const r = validateQuestionEvidence(q, 0, flagged("B", "highlight"));
    expect(r.verdict).toBe("downgraded");
    expect(r.issues.map((i) => i.code)).toContain("evidence_mismatch");
    expect(r.effectiveStatus).toBe("needs_review");
  });

  it("khai bold nhưng có 2 phương án in đậm → evidence_mismatch (mất tính duy nhất)", () => {
    const q = makeQuestion({
      answerEvidence: { origin: "bold", confidence: 0.9 },
    });
    const r = validateQuestionEvidence(q, 0, {
      optionFormats: { A: { bold: true }, B: { bold: true } },
    });
    expect(r.verdict).toBe("downgraded");
    expect(r.issues.map((i) => i.code)).toContain("evidence_mismatch");
  });

  it("khai highlight nhưng không có context → valid về cấu trúc nhưng unchecked (không suy thành sai)", () => {
    const q = makeQuestion({
      answerEvidence: { origin: "highlight", confidence: 0.95 },
    });
    const r = validateQuestionEvidence(q, 0);
    expect(r.verdict).toBe("valid");
    expect(r.crossChecked).toBe(false);
    expect(r.effectiveStatus).toBe("verified");
  });

  it("đáp án từ bảng nhưng bảng ghi khác → answer_key_conflict, verdict conflict", () => {
    const q = makeQuestion({});
    const r = validateQuestionEvidence(q, 0, { answerKeyEntry: ["B"] });
    expect(r.verdict).toBe("conflict");
    expect(r.issues.map((i) => i.code)).toContain("answer_key_conflict");
    expect(r.effectiveStatus).toBe("needs_review");
  });

  it("đáp án từ dòng cuối câu nhưng dòng đó ghi khác → answer_line_conflict", () => {
    const q = makeQuestion({
      answerEvidence: { origin: "answer_line", confidence: 0.99 },
    });
    const r = validateQuestionEvidence(q, 0, { trailingAnswer: "C" });
    expect(r.verdict).toBe("conflict");
    expect(r.issues.map((i) => i.code)).toContain("answer_line_conflict");
  });

  it("đáp án từ lời giải nhưng lời giải nêu khác → solution_conflict", () => {
    const q = makeQuestion({
      answerEvidence: { origin: "solution", confidence: 0.88 },
    });
    const r = validateQuestionEvidence(q, 0, { solutionAnswer: "D" });
    expect(r.verdict).toBe("conflict");
    expect(r.issues.map((i) => i.code)).toContain("solution_conflict");
  });

  it("bảng nói A nhưng dòng cuối câu nói B (đáp án khai khớp bảng) → evidence_conflict", () => {
    const q = makeQuestion({});
    const r = validateQuestionEvidence(q, 0, {
      answerKeyEntry: ["A"],
      trailingAnswer: "B",
    });
    expect(r.verdict).toBe("conflict");
    expect(r.issues.map((i) => i.code)).toContain("evidence_conflict");
    expect(r.effectiveStatus).toBe("needs_review");
  });

  it("đáp án ngoài phương án → answer_not_in_options, verdict invalid", () => {
    const q = makeQuestion({
      options: [
        { id: "A", content: "Đáp án A" },
        { id: "B", content: "Đáp án B" },
      ],
      correctAnswers: ["C"],
    });
    const r = validateQuestionEvidence(q, 0, { answerKeyEntry: ["C"] });
    expect(r.verdict).toBe("invalid");
    expect(r.issues.map((i) => i.code)).toContain("answer_not_in_options");
    expect(r.effectiveStatus).toBe("needs_review");
  });

  it("cấm dùng confidence hai chiều: câu sạch dù confidence 0 vẫn valid; câu mismatch dù confidence 1 vẫn hạ cấp", () => {
    const clean = makeQuestion({
      id: "q-clean",
      order: 1,
      answerEvidence: { origin: "answer_table", confidence: 0 },
    });
    expect(
      validateQuestionEvidence(clean, 0, { answerKeyEntry: ["A"] }).verdict
    ).toBe("valid");
    const bad = makeQuestion({
      id: "q-bad",
      order: 2,
      answerEvidence: { origin: "highlight", confidence: 1 },
    });
    const r = validateQuestionEvidence(bad, 0, flagged("B", "highlight"));
    expect(r.verdict).toBe("downgraded");
  });

  it("validateEvidence toàn tài liệu: đếm đúng summary theo từng verdict", () => {
    const result = makeResult([
      makeQuestion({ id: "q1", order: 1 }),
      makeQuestion({
        id: "q2",
        order: 2,
        answerEvidence: { origin: "highlight", confidence: 0.95 },
      }),
      makeQuestion({
        id: "q3",
        order: 3,
        correctAnswers: [],
        answerEvidence: null,
        status: "needs_review",
      }),
    ]);
    const v = validateEvidence(result, {
      1: { answerKeyEntry: ["A"] },
      2: { optionFormats: { B: { highlight: true } } },
    });
    expect(v.summary.total).toBe(3);
    expect(v.summary.valid).toBe(2);
    expect(v.summary.downgraded).toBe(1);
    expect(v.summary.conflict).toBe(0);
    expect(v.summary.invalid).toBe(0);
    expect(v.summary.verified).toBe(1);
    expect(v.summary.needsReview).toBe(2);
  });

  it("applyEvidenceValidation: hạ status + thêm warnings, KHÔNG đổi đáp án/evidence, KHÔNG nâng cấp", () => {
    const result = makeResult([
      makeQuestion({ id: "q1", order: 1 }),
      makeQuestion({
        id: "q2",
        order: 2,
        answerEvidence: { origin: "highlight", confidence: 0.95 },
      }),
    ]);
    const validation = validateEvidence(result, {
      1: { answerKeyEntry: ["A"] },
      2: { optionFormats: { B: { highlight: true } } },
    });
    const applied = applyEvidenceValidation(result, validation);
    // Câu 1 giữ nguyên verified; câu 2 hạ cấp nhưng đáp án/evidence giữ nguyên.
    expect(applied.questions[0].status).toBe("verified");
    expect(applied.questions[1].status).toBe("needs_review");
    expect(applied.questions[1].quality.status).toBe("partial");
    expect(applied.questions[1].correctAnswers).toEqual(["A"]);
    expect(applied.questions[1].answerEvidence?.origin).toBe("highlight");
    expect(applied.questions[1].warnings.length).toBeGreaterThan(0);
    // Gốc không bị mutate.
    expect(result.questions[1].status).toBe("verified");
  });
});
