import { describe, it, expect } from "vitest";
import type { ExtractedQuestion } from "@/types/extractor";
import type { ExtractionV2Question } from "@/types/extractionV2";
import { parseExtractionV2Result } from "@/types/extractionV2";
import {
  fromV1Question,
  fromV1Result,
  fromDocxParseOutput,
  toV1Question,
  toV1Result,
  v2ToQuizQuestions,
  validateV2QuestionTypes,
} from "@/services/extraction/v2Adapter";
import type { DocxParseOutput } from "@/utils/parsers/docxParser";

function makeV1(
  overrides: Partial<ExtractedQuestion> & { id: string; order: number }
): ExtractedQuestion {
  return {
    tempId: `tmp-${overrides.id}`,
    content: "Nội dung câu hỏi",
    options: [
      { id: "A", content: "Đáp án A", rawContent: "A. Đáp án A" },
      { id: "B", content: "Đáp án B", rawContent: "B. Đáp án B" },
      { id: "C", content: "Đáp án C", rawContent: "C. Đáp án C" },
      { id: "D", content: "Đáp án D", rawContent: "D. Đáp án D" },
    ],
    correctAnswers: ["A"],
    explanation: "",
    points: 1,
    confidenceScore: 0.99,
    detectionStrategy: "answer_table",
    rawTextSegment: "Câu 1. Nội dung câu hỏi",
    ...overrides,
  };
}

function makeV2(
  overrides: Partial<ExtractionV2Question> & { id: string; order: number }
): ExtractionV2Question {
  return {
    sourceNumber: null,
    content: "Nội dung câu hỏi",
    type: "single_choice",
    options: [
      { id: "A", content: "Đáp án A" },
      { id: "B", content: "Đáp án B" },
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

describe("fromV1Question", () => {
  it("câu có đáp án bảng + đủ phương án → verified, origin answer_table", () => {
    const v2 = fromV1Question(makeV1({ id: "q1", order: 1 }));
    expect(v2.status).toBe("verified");
    expect(v2.answerEvidence).toEqual({ origin: "answer_table", confidence: 0.99 });
    expect(v2.quality.status).toBe("complete");
    expect(v2.engine).toBe("rule");
  });

  it("câu thiếu đáp án → evidence null, needs_review, đáp án giữ []", () => {
    const v2 = fromV1Question(
      makeV1({
        id: "q2",
        order: 2,
        correctAnswers: [],
        confidenceScore: 0,
        detectionStrategy: "ai_inference",
        warningFlags: ["Chưa có đáp án (Cần chọn đáp án hoặc dùng AI giải)"],
      })
    );
    expect(v2.correctAnswers).toEqual([]);
    expect(v2.answerEvidence).toBeNull();
    expect(v2.status).toBe("needs_review");
    expect(v2.quality.status).toBe("partial");
  });

  it("đáp án ai_inference → ai_suggested, engine gemini, needs_review (không verified)", () => {
    const v2 = fromV1Question(
      makeV1({
        id: "q3",
        order: 3,
        correctAnswers: ["B"],
        confidenceScore: 0.96,
        detectionStrategy: "ai_inference",
      })
    );
    expect(v2.answerEvidence?.origin).toBe("ai_suggested");
    expect(v2.engine).toBe("gemini");
    expect(v2.status).toBe("needs_review");
  });

  it("nháp tạo tay có đáp án vẫn needs_review (cờ không tự xóa)", () => {
    const v2 = fromV1Question(
      makeV1({
        id: "q4",
        order: 4,
        isManualDraft: true,
        detectionStrategy: "manual",
        confidenceScore: 1,
      })
    );
    expect(v2.engine).toBe("manual");
    expect(v2.answerEvidence?.origin).toBe("teacher_confirmed");
    expect(v2.status).toBe("needs_review");
  });

  it("câu có đáp án nhưng < 2 phương án → needs_review, không bịa option", () => {
    const v2 = fromV1Question(
      makeV1({
        id: "q5",
        order: 5,
        options: [{ id: "A", content: "Chỉ 1 phương án", rawContent: "A." }],
        correctAnswers: ["A"],
        detectionStrategy: "answer_at_end",
        confidenceScore: 0.99,
      })
    );
    expect(v2.options).toHaveLength(1);
    expect(v2.status).toBe("needs_review");
  });

  it("V1 không giữ số gốc: sourceNumber luôn null, không suy từ order", () => {
    // Đề đánh số không liên tục (f12: header 2/5/9/14) nhưng V1 order là 1–4;
    // adapter không được suy sourceNumber = order.
    const v2 = fromV1Question(makeV1({ id: "q6", order: 3 }));
    expect(v2.sourceNumber).toBeNull();
  });

  it("map đủ các strategy sang origin (đáp án cuối câu, marker, gạch chân, tô màu, in đậm, lời giải)", () => {
    const cases = [
      ["answer_at_end", "answer_line"],
      ["special_marker", "marker"],
      ["underline", "underline"],
      ["highlight_color", "highlight"],
      ["distinct_bold", "bold"],
      ["explanation_text", "solution"],
    ] as const;
    for (const [strategy, origin] of cases) {
      const v2 = fromV1Question(
        makeV1({
          id: `q-${strategy}`,
          order: 1,
          detectionStrategy: strategy,
          confidenceScore: 0.9,
        })
      );
      expect(v2.answerEvidence?.origin).toBe(origin);
      expect(v2.status).toBe("verified");
    }
  });
});

describe("toV1Question / toV1Result (V1 UI đọc được V2)", () => {
  it("round-trip V1 → V2 → V1 giữ nguyên nội dung, options, đáp án", () => {
    const v1 = makeV1({ id: "q1", order: 1, detectionStrategy: "answer_at_end" });
    const back = toV1Question(fromV1Question(v1));
    expect(back.content).toBe(v1.content);
    expect(back.options.map((o) => [o.id, o.content])).toEqual(
      v1.options.map((o) => [o.id, o.content])
    );
    expect(back.correctAnswers).toEqual(v1.correctAnswers);
    expect(back.detectionStrategy).toBe("answer_at_end");
    expect(back.confidenceScore).toBe(0.99);
  });

  it("câu needs_review qua V1 vẫn mang cờ review, không mất dữ liệu", () => {
    const v2 = makeV2({ id: "q9", order: 1, status: "needs_review", correctAnswers: [] });
    const back = toV1Question(v2);
    expect(back.correctAnswers).toEqual([]);
    expect(back.warningFlags).toContain("Cần xem lại (Extraction V2)");
  });

  it("toV1Result: warningsCount = tổng warningFlags (đúng công thức V1)", () => {
    const v2 = fromV1Result({
      fileName: "de.docx",
      fileType: "docx",
      fileSize: 100,
      title: "de",
      subject: "Toán học",
      totalQuestionsDetected: 2,
      questions: [
        makeV1({ id: "q1", order: 1, warningFlags: ["Cờ 1", "Cờ 2"] }),
        makeV1({ id: "q2", order: 2, correctAnswers: [] }),
      ],
      hasAnswerKeyTable: true,
      warningsCount: 2,
      extractedAt: new Date().toISOString(),
    });
    const back = toV1Result(v2);
    expect(back.questions).toHaveLength(2);
    // q1 giữ 2 cờ gốc; q2 (needs_review, thiếu đáp án) cộng thêm 1 cờ review khi về V1.
    expect(back.warningsCount).toBe(3);
  });
});

describe("v2ToQuizQuestions (flow main)", () => {
  it("giữ type thật multiple_choice / true_false, không ép single_choice", () => {
    const qs = v2ToQuizQuestions([
      makeV2({ id: "m1", order: 1, type: "multiple_choice", correctAnswers: ["A", "B"] }),
      makeV2({ id: "t1", order: 2, type: "true_false", correctAnswers: ["A"] }),
    ]);
    expect(qs[0].type).toBe("multiple_choice");
    expect(qs[0].correctAnswers).toEqual(["A", "B"]);
    expect(qs[1].type).toBe("true_false");
  });

  it("type unknown → single_choice theo hành vi cũ, đáp án [] giữ nguyên", () => {
    const qs = v2ToQuizQuestions([
      makeV2({ id: "u1", order: 1, type: "unknown", correctAnswers: [] }),
    ]);
    expect(qs[0].type).toBe("single_choice");
    expect(qs[0].correctAnswers).toEqual([]);
  });
});

describe("fromDocxParseOutput (nối quality bước 07 vào V2)", () => {
  it("partial do thiếu câu → documentQuality partial + warnings cấp tài liệu, không đổ lỗi cho câu cụ thể", () => {
    const output = {
      rawHtml: "",
      rawText: "Câu 1. ... Câu 2. ... Câu 3. ...",
      result: {
        fileName: "de.docx",
        fileType: "docx",
        fileSize: 100,
        title: "de",
        subject: "Toán học",
        totalQuestionsDetected: 2,
        questions: [
          makeV1({ id: "q1", order: 1 }),
          makeV1({ id: "q2", order: 2 }),
        ],
        hasAnswerKeyTable: false,
        warningsCount: 0,
        extractedAt: new Date().toISOString(),
      },
      quality: {
        status: "partial",
        parsedQuestions: 2,
        detectedHeaders: 3,
        unparsedHeaders: 1,
        invalidOptionOrders: [],
        reasons: ["Phát hiện 3 header câu hỏi trong file nhưng chỉ bóc tách được 2 câu (thiếu 1 câu)"],
      },
    } as unknown as DocxParseOutput;
    const v2 = fromDocxParseOutput(output);
    expect(v2.documentQuality.status).toBe("partial");
    expect(v2.documentQuality.unparsedHeaders).toBe(1);
    expect(v2.warnings).toHaveLength(1);
    // Câu đã trích vẫn verified — câu thiếu không tồn tại để gắn lỗi.
    expect(v2.questions.every((q) => q.status === "verified")).toBe(true);
  });

  it("complete → không có warnings cấp tài liệu", () => {
    const output = {
      rawHtml: "",
      rawText: "Câu 1. ...",
      result: {
        fileName: "de.docx",
        fileType: "docx",
        fileSize: 100,
        title: "de",
        subject: "Toán học",
        totalQuestionsDetected: 1,
        questions: [makeV1({ id: "q1", order: 1 })],
        hasAnswerKeyTable: false,
        warningsCount: 0,
        extractedAt: new Date().toISOString(),
      },
      quality: {
        status: "complete",
        parsedQuestions: 1,
        detectedHeaders: 1,
        unparsedHeaders: 0,
        invalidOptionOrders: [],
        reasons: [],
      },
    } as unknown as DocxParseOutput;
    const v2 = fromDocxParseOutput(output);
    expect(v2.documentQuality.status).toBe("complete");
    expect(v2.warnings).toEqual([]);
  });
});

describe("parseExtractionV2Result (Zod cho dữ liệu AI)", () => {
  it("chấp nhận V2 hợp lệ kể cả câu thiếu đáp án (không bắt bịa đáp án)", () => {
    const v2 = fromV1Result({
      fileName: "de.docx",
      fileType: "docx",
      fileSize: 100,
      title: "de",
      subject: "Toán học",
      totalQuestionsDetected: 1,
      questions: [makeV1({ id: "q1", order: 1, correctAnswers: [] })],
      hasAnswerKeyTable: false,
      warningsCount: 0,
      extractedAt: new Date().toISOString(),
    });
    expect(parseExtractionV2Result(v2)).not.toBeNull();
  });

  it("từ chối dữ liệu AI không hợp lệ: đáp án ngoài A–D, confidence > 1", () => {
    const base = fromV1Result({
      fileName: "de.docx",
      fileType: "docx",
      fileSize: 100,
      title: "de",
      subject: "Toán học",
      totalQuestionsDetected: 1,
      questions: [makeV1({ id: "q1", order: 1 })],
      hasAnswerKeyTable: false,
      warningsCount: 0,
      extractedAt: new Date().toISOString(),
    });
    const badAnswer = structuredClone(base);
    (badAnswer.questions[0].correctAnswers as string[]).push("E");
    expect(parseExtractionV2Result(badAnswer)).toBeNull();
    const badConfidence = structuredClone(base);
    if (badConfidence.questions[0].answerEvidence) {
      badConfidence.questions[0].answerEvidence.confidence = 1.5;
    }
    expect(parseExtractionV2Result(badConfidence)).toBeNull();
  });
});

describe("Bước 12: validateV2QuestionTypes (unknown cần review, mismatch chặn)", () => {
  it("type unknown → diagnostic unknown_type, KHÔNG chặn xuất bản (giữ flow main)", () => {
    const diagnostics = validateV2QuestionTypes([
      makeV2({ id: "u1", order: 1, type: "unknown", correctAnswers: [] }),
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("unknown_type");
    expect(diagnostics[0].blocksPublish).toBe(false);
    // Map vẫn về single_choice theo hành vi cũ, nhưng đã có diagnostic
    // đánh dấu cần review thay vì im lặng như trước bước 12.
    expect(v2ToQuizQuestions([
      makeV2({ id: "u1", order: 1, type: "unknown", correctAnswers: [] }),
    ])[0].type).toBe("single_choice");
  });

  it("type thật hợp lệ + đáp án hợp lệ → không diagnostic", () => {
    expect(validateV2QuestionTypes([
      makeV2({ id: "m1", order: 1, type: "multiple_choice", correctAnswers: ["A", "B"] }),
      makeV2({ id: "t1", order: 2, type: "true_false", correctAnswers: ["A"] }),
      makeV2({ id: "s1", order: 3, type: "single_choice", correctAnswers: ["B"] }),
    ])).toEqual([]);
  });

  it("single/true_false có nhiều đáp án → type_answer_mismatch, chặn xuất bản", () => {
    const diagnostics = validateV2QuestionTypes([
      makeV2({ id: "s1", order: 1, type: "single_choice", correctAnswers: ["A", "B"] }),
      makeV2({ id: "t1", order: 2, type: "true_false", correctAnswers: ["A", "B"] }),
    ]);
    expect(diagnostics.map((d) => d.code)).toEqual([
      "type_answer_mismatch",
      "type_answer_mismatch",
    ]);
    expect(diagnostics.every((d) => d.blocksPublish)).toBe(true);
    expect(diagnostics.map((d) => d.order)).toEqual([1, 2]);
  });
});
