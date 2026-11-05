import { describe, it, expect } from "vitest";
import type {
  ExtractedQuestion,
  ExtractionResult,
} from "@/types/extractor";
import type { OptionId } from "@/types/quiz";
import { orchestrateExtraction } from "@/services/extraction/hybridOrchestrator";
import {
  assessPublishGuard,
  toPublishGuardSummary,
} from "@/services/extraction/publishGuard";

function opt(id: OptionId, extra: Partial<ExtractedQuestion["options"][number]> = {}) {
  return { id, content: `Phương án ${id}`, rawContent: `Phương án ${id}`, ...extra };
}

function q(
  order: number,
  overrides: Partial<ExtractedQuestion> = {}
): ExtractedQuestion {
  return {
    id: `q-${order}`,
    tempId: `tmp-${order}`,
    order,
    content: `Câu hỏi ${order}`,
    options: [opt("A"), opt("B"), opt("C"), opt("D")],
    correctAnswers: ["A"],
    points: 1,
    confidenceScore: 0,
    detectionStrategy: "answer_table",
    rawTextSegment: `Câu ${order} ... Đáp án: A`,
    ...overrides,
  };
}

function result(questions: ExtractedQuestion[]): ExtractionResult {
  return {
    fileName: "test.docx",
    fileType: "docx",
    fileSize: 100,
    title: "Đề test",
    subject: "Toán học 12",
    totalQuestionsDetected: questions.length,
    questions,
    hasAnswerKeyTable: false,
    warningsCount: 0,
    extractedAt: "2026-11-05",
  };
}

describe("Bước 25: publishGuard — không hybrid thì đi đường cũ (V1)", () => {
  it("câu đủ đáp án thì publish không bị chặn", () => {
    const guard = assessPublishGuard(result([q(1), q(2)]), null);
    expect(guard.publishBlocked).toBe(false);
    expect(guard.blockers).toEqual([]);
  });

  it("câu thiếu đáp án thì publish bị chặn, draft chỉ cảnh báo", () => {
    const guard = assessPublishGuard(
      result([q(1), q(2, { correctAnswers: [] })]),
      null
    );
    expect(guard.publishBlocked).toBe(true);
    expect(guard.blockers.some((b) => b.code === "missing_answer" && b.order === 2)).toBe(true);
    expect(guard.draftWarnings.length).toBe(guard.blockers.length + guard.warnings.length);
    // Draft không chặn: draftWarnings chỉ là danh sách cảnh báo, không có cờ chặn riêng.
    expect(guard.blockers.length).toBeGreaterThan(0);
  });

  it("đáp án ngoài phương án và thiếu phương án đều chặn publish", () => {
    const guard = assessPublishGuard(
      result([
        q(1, { correctAnswers: ["Z" as OptionId] }),
        q(2, { options: [opt("A")] }),
      ]),
      null
    );
    expect(guard.publishBlocked).toBe(true);
    expect(guard.blockers.some((b) => b.code === "answer_not_in_options")).toBe(true);
    expect(guard.blockers.some((b) => b.code === "insufficient_options")).toBe(true);
  });

  it("type unknown chỉ cảnh báo, không chặn; type mismatch chặn", () => {
    const unknown = assessPublishGuard(
      result([q(1, { questionType: "single_choice" }), q(2, { questionType: undefined })]),
      null
    );
    // Câu 2 không có questionType → V2 type "unknown" → chỉ cảnh báo.
    expect(unknown.warnings.some((w) => w.code === "unknown_type" && w.order === 2)).toBe(true);
    expect(unknown.publishBlocked).toBe(false);

    const mismatch = assessPublishGuard(
      result([q(1, { questionType: "single_choice", correctAnswers: ["A", "B"] })]),
      null
    );
    expect(mismatch.publishBlocked).toBe(true);
    expect(mismatch.blockers.some((b) => b.code === "type_answer_mismatch")).toBe(true);
    // Không nhân đôi: V1 và V2 cùng bắt mismatch thì chỉ 1 blocker cho câu đó.
    expect(mismatch.blockers.filter((b) => b.code === "type_answer_mismatch")).toHaveLength(1);
  });
});

describe("Bước 25: publishGuard — gate và chunk", () => {
  it("gate failed (0 câu) chặn publish ở cấp tài liệu", () => {
    const empty = result([]);
    const hybrid = orchestrateExtraction({ result: empty });
    expect(hybrid.quality.status).toBe("failed");
    const guard = assessPublishGuard(empty, hybrid);
    expect(guard.publishBlocked).toBe(true);
    expect(guard.docBlockers.some((b) => b.code === "gate_failed")).toBe(true);
    expect(guard.docBlockers.every((b) => b.questionIndex === -1)).toBe(true);
  });

  it("chunk failed có trang (trang scan) chặn publish, liệt kê trang", () => {
    const r = result([q(1)]);
    const hybrid = orchestrateExtraction({ result: r, totalPages: 2, scanPages: [2] });
    const guard = assessPublishGuard(r, hybrid);
    expect(guard.publishBlocked).toBe(true);
    const chunk = guard.docBlockers.find((b) => b.code === "chunk_failed");
    expect(chunk).toBeDefined();
    expect(chunk!.message).toContain("2");
  });

  it("gate partial/needs_review chỉ cảnh báo, không chặn publish", () => {
    // Tài liệu 1 câu đủ nhưng chunk partial (trang có text mà 0 câu).
    // Gate ra needs_review (không phải partial) vì câu DOCX không có page
    // nên dính page_coverage_unknown — cả hai mức đều chỉ cảnh báo.
    const r = result([q(1)]);
    const hybrid = orchestrateExtraction({ result: r, totalPages: 2 });
    expect(["partial", "needs_review"]).toContain(hybrid.quality.status);
    const guard = assessPublishGuard(r, hybrid);
    expect(guard.publishBlocked).toBe(false);
    expect(guard.warnings.some((w) => w.code === "chunk_partial")).toBe(true);
  });
});

describe("Bước 25: publishGuard — evidence và reconcile stale", () => {
  function hybridWithEvidenceOverride(
    base: ExtractionResult,
    mutate: (h: ReturnType<typeof orchestrateExtraction>) => void
  ) {
    const hybrid = orchestrateExtraction({ result: base });
    mutate(hybrid);
    return hybrid;
  }

  it("evidence conflict chặn publish; câu đã xóa thì bỏ qua; câu sửa tay thì miễn", () => {
    const base = result([q(1), q(2)]);
    const conflict = {
      order: 2,
      questionIndex: 1,
      verdict: "conflict" as const,
      effectiveStatus: "needs_review" as const,
      crossChecked: true,
      issues: [
        {
          code: "evidence_conflict" as const,
          order: 2,
          questionIndex: 1,
          message: "Câu 2 mâu thuẫn bảng vs tô vàng",
        },
      ],
    };
    const hybrid = hybridWithEvidenceOverride(base, (h) => {
      h.evidence.questions = [conflict];
    });

    // Chặn khi câu còn nguyên.
    const blocked = assessPublishGuard(base, hybrid);
    expect(blocked.publishBlocked).toBe(true);
    expect(blocked.blockers.some((b) => b.code === "evidence_conflict" && b.order === 2)).toBe(true);

    // Câu đã xóa khỏi review thì blocker stale bị bỏ qua.
    const deleted = assessPublishGuard(result([q(1)]), hybrid);
    expect(deleted.blockers.some((b) => b.code === "evidence_conflict")).toBe(false);
    expect(deleted.publishBlocked).toBe(false);

    // Giáo viên sửa tay (manual) thì miễn blocker stale, V1 live vẫn quyết.
    const edited = result([
      q(1),
      q(2, { detectionStrategy: "manual", correctAnswers: ["B"] }),
    ]);
    const exempt = assessPublishGuard(edited, hybrid);
    expect(exempt.blockers.some((b) => b.code === "evidence_conflict")).toBe(false);
    expect(exempt.publishBlocked).toBe(false);
  });

  it("evidence invalid trùng V1 answer_not_in_options thì giữ V1, không nhân đôi", () => {
    const base = result([q(1, { correctAnswers: ["Z" as OptionId] })]);
    const hybrid = hybridWithEvidenceOverride(base, (h) => {
      h.evidence.questions = [
        {
          order: 1,
          questionIndex: 0,
          verdict: "invalid" as const,
          effectiveStatus: "needs_review" as const,
          crossChecked: true,
          issues: [
            {
              code: "answer_not_in_options" as const,
              order: 1,
              questionIndex: 0,
              message: "Câu 1 có đáp án ngoài phương án",
            },
          ],
        },
      ];
    });
    const guard = assessPublishGuard(base, hybrid);
    expect(guard.blockers.filter((b) => b.order === 1)).toHaveLength(1);
    expect(guard.blockers[0].code).toBe("answer_not_in_options");
  });

  it("reconcile unresolved chặn publish; trùng evidence cùng câu thì giữ evidence", () => {
    const base = result([q(1), q(2)]);
    const hybrid = hybridWithEvidenceOverride(base, (h) => {
      h.reconcileQuestions = [
        {
          order: 2,
          questionIndex: 1,
          outcome: "unresolved-conflict",
          winningOrigin: null,
          losingOrigins: ["answer_table", "highlight"],
          noCandidate: false,
          message: "Bảng và tô vàng khác nhau",
        },
      ];
      h.evidence.questions = [
        {
          order: 2,
          questionIndex: 1,
          verdict: "conflict" as const,
          effectiveStatus: "needs_review" as const,
          crossChecked: true,
          issues: [
            {
              code: "evidence_conflict" as const,
              order: 2,
              questionIndex: 1,
              message: "Câu 2 mâu thuẫn",
            },
          ],
        },
      ];
    });
    const guard = assessPublishGuard(base, hybrid);
    const order2 = guard.blockers.filter((b) => b.order === 2);
    expect(order2).toHaveLength(1);
    expect(order2[0].code).toBe("evidence_conflict");
  });

  it("reconcile unresolved một mình (không có evidence) vẫn chặn publish", () => {
    const base = result([q(1)]);
    const hybrid = hybridWithEvidenceOverride(base, (h) => {
      h.reconcileQuestions = [
        {
          order: 1,
          questionIndex: 0,
          outcome: "unresolved-conflict",
          winningOrigin: null,
          losingOrigins: ["answer_table", "highlight"],
          noCandidate: false,
          message: "Đồng hạng khác tập đáp án",
        },
      ];
      h.evidence.questions = [];
    });
    const guard = assessPublishGuard(base, hybrid);
    expect(guard.publishBlocked).toBe(true);
    expect(guard.blockers.some((b) => b.code === "reconcile_unresolved")).toBe(true);
  });

  it("câu sửa tay nhưng vẫn thiếu đáp án thì V1 live vẫn chặn", () => {
    const base = result([q(1, { detectionStrategy: "manual", correctAnswers: [] })]);
    const hybrid = orchestrateExtraction({ result: base });
    const guard = assessPublishGuard(base, hybrid);
    expect(guard.publishBlocked).toBe(true);
    expect(guard.blockers.some((b) => b.code === "missing_answer")).toBe(true);
  });
});

describe("Bước 25: publishGuard — summary cho CreateQuiz", () => {
  it("summary chỉ mang docBlockers (cấp tài liệu) và warnings", () => {
    const r = result([q(1)]);
    const hybrid = orchestrateExtraction({ result: r, totalPages: 2, scanPages: [2] });
    const summary = toPublishGuardSummary(assessPublishGuard(r, hybrid));
    expect(summary.publishBlocked).toBe(true);
    expect(summary.docBlockerMessages.length).toBeGreaterThan(0);
    expect(summary.docBlockerMessages.every((m) => m.includes("Tài liệu"))).toBe(true);
  });
});
