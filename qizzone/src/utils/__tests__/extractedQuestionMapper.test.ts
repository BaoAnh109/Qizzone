import { describe, it, expect } from "vitest";
import {
  mapExtractedQuestionsToQuizQuestions,
  validateExtractedQuestions,
  getPublishBlockers,
  resolveQuestionType,
} from "../extractedQuestionMapper";
import type { ExtractedQuestion } from "@/types/extractor";

function makeQuestion(
  overrides: Partial<ExtractedQuestion> & { id: string; order: number }
): ExtractedQuestion {
  return {
    tempId: `tmp-${overrides.id}`,
    content: "Nội dung câu hỏi",
    options: [
      { id: "A", content: "Đáp án A", rawContent: "A. Đáp án A" },
      { id: "B", content: "Đáp án B", rawContent: "B. Đáp án B" },
    ],
    correctAnswers: ["A"],
    explanation: "",
    points: 1,
    confidenceScore: 0.9,
    detectionStrategy: "answer_table",
    rawTextSegment: "Câu hỏi ...",
    ...overrides,
  };
}

describe("extractedQuestionMapper", () => {
  it("converts ExtractedQuestion array to Quiz Question array correctly", () => {
    const mockExtracted: ExtractedQuestion[] = [
      {
        id: "q-1",
        tempId: "tmp-1",
        order: 1,
        content: "Nội dung câu 1",
        options: [
          { id: "A", content: "Đáp án A", rawContent: "A. Đáp án A" },
          { id: "B", content: "Đáp án B", rawContent: "B. Đáp án B" },
        ],
        correctAnswers: ["B"],
        explanation: "Lời giải chi tiết câu 1",
        points: 2,
        confidenceScore: 0.95,
        detectionStrategy: "underline",
        rawTextSegment: "Câu 1: ...",
      },
      {
        id: "q-2",
        tempId: "tmp-2",
        order: 2,
        content: "Nội dung câu 2",
        options: [
          { id: "A", content: "Lựa chọn 1", rawContent: "A. 1" },
          { id: "B", content: "Lựa chọn 2", rawContent: "B. 2" },
        ],
        correctAnswers: [],
        explanation: "",
        points: 1,
        confidenceScore: 0.8,
        detectionStrategy: "distinct_bold",
        rawTextSegment: "Câu 2: ...",
      },
    ];

    const result = mapExtractedQuestionsToQuizQuestions(mockExtracted);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("q-1");
    expect(result[0].order).toBe(1);
    expect(result[0].content).toBe("Nội dung câu 1");
    expect(result[0].options).toEqual([
      { id: "A", content: "Đáp án A" },
      { id: "B", content: "Đáp án B" },
    ]);
    expect(result[0].correctAnswers).toEqual(["B"]);
    expect(result[0].points).toBe(2);
    expect(result[0].explanation).toBe("Lời giải chi tiết câu 1");

    // Bước 04: KHÔNG còn fallback đáp án A. Câu chưa có đáp án giữ
    // nguyên [] — đáp án giả ["A"] bị cấm (Extraction ≠ Solving).
    expect(result[1].correctAnswers).toEqual([]);
    expect(result[1].order).toBe(2);
  });

  it("never fabricates an answer: missing answer stays [] after mapping", () => {
    const result = mapExtractedQuestionsToQuizQuestions([
      makeQuestion({ id: "q-no-ans", order: 1, correctAnswers: [] }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].correctAnswers).toEqual([]);
    expect(result[0].options).toHaveLength(2);
  });

  it("validateExtractedQuestions flags missing answer, insufficient options, dangling answer", () => {
    const diagnostics = validateExtractedQuestions([
      makeQuestion({ id: "q-missing", order: 1, correctAnswers: [] }),
      makeQuestion({
        id: "q-few-opts",
        order: 2,
        options: [{ id: "A", content: "Chỉ 1 lựa chọn", rawContent: "A. Chỉ 1" }],
        correctAnswers: ["A"],
      }),
      makeQuestion({ id: "q-dangling", order: 3, correctAnswers: ["C"] }),
    ]);
    expect(diagnostics.map((d) => d.code).sort()).toEqual([
      "answer_not_in_options",
      "insufficient_options",
      "missing_answer",
    ]);
    expect(diagnostics.every((d) => d.blocksPublish)).toBe(true);
    expect(diagnostics.map((d) => d.order).sort()).toEqual([1, 2, 3]);
  });

  it("publish guard: a question missing an answer is never publishable with a fake answer", () => {
    // BatchActionBar chặn xuất bản bằng getPublishBlockers() trên
    // diagnostics này (không gọi createQuiz); test ở mức pure function
    // vì BatchActionBar là component cần router/store để render.
    const questions = [
      makeQuestion({ id: "q-no-ans", order: 1, correctAnswers: [] }),
    ];
    const mapped = mapExtractedQuestionsToQuizQuestions(questions);
    expect(mapped[0].correctAnswers).toEqual([]);
    expect(mapped[0].correctAnswers).not.toContain("A");
    const blockers = getPublishBlockers(validateExtractedQuestions(questions));
    expect(blockers).toHaveLength(1);
    expect(blockers[0].code).toBe("missing_answer");
  });

  it("publish guard allows a clean set: valid questions keep prior behavior", () => {
    const questions = [
      makeQuestion({ id: "q-ok", order: 1, correctAnswers: ["B"] }),
    ];
    const mapped = mapExtractedQuestionsToQuizQuestions(questions);
    expect(mapped[0].correctAnswers).toEqual(["B"]);
    expect(getPublishBlockers(validateExtractedQuestions(questions))).toEqual([]);
  });
});

describe("Bước 12: giữ type câu hỏi khi map sang Quiz (không ép single_choice)", () => {
  const trueFalseOptions = [
    { id: "A" as const, content: "Đúng", rawContent: "A. Đúng" },
    { id: "B" as const, content: "Sai", rawContent: "B. Sai" },
  ];

  it("explicit questionType multiple_choice được giữ, đủ đáp án không bị cắt", () => {
    const q = makeQuestion({
      id: "q-multi",
      order: 1,
      questionType: "multiple_choice",
      correctAnswers: ["A", "C"],
      options: [
        { id: "A", content: "Đáp án A", rawContent: "A. Đáp án A" },
        { id: "B", content: "Đáp án B", rawContent: "B. Đáp án B" },
        { id: "C", content: "Đáp án C", rawContent: "C. Đáp án C" },
      ],
    });
    const mapped = mapExtractedQuestionsToQuizQuestions([q]);
    expect(mapped[0].type).toBe("multiple_choice");
    expect(mapped[0].correctAnswers).toEqual(["A", "C"]);
    expect(getPublishBlockers(validateExtractedQuestions([q]))).toEqual([]);
  });

  it("explicit questionType true_false được giữ với options Đúng/Sai, không nhét A–D giả", () => {
    const q = makeQuestion({
      id: "q-tf",
      order: 1,
      questionType: "true_false",
      options: trueFalseOptions,
      correctAnswers: ["A"],
    });
    const mapped = mapExtractedQuestionsToQuizQuestions([q]);
    expect(mapped[0].type).toBe("true_false");
    expect(mapped[0].options).toEqual([
      { id: "A", content: "Đúng" },
      { id: "B", content: "Sai" },
    ]);
    expect(mapped[0].correctAnswers).toEqual(["A"]);
  });

  it("suy luận true_false từ cặp phương án Đúng/Sai khi không có questionType", () => {
    const q = makeQuestion({
      id: "q-tf-infer",
      order: 1,
      options: trueFalseOptions,
      correctAnswers: ["B"],
    });
    expect(resolveQuestionType(q)).toEqual({
      type: "true_false",
      source: "inferred_true_false",
    });
    expect(mapExtractedQuestionsToQuizQuestions([q])[0].type).toBe("true_false");
  });

  it("suy luận multiple_choice từ nhiều đáp án khi không có questionType", () => {
    const q = makeQuestion({
      id: "q-multi-infer",
      order: 1,
      correctAnswers: ["A", "B"],
    });
    expect(resolveQuestionType(q)).toEqual({
      type: "multiple_choice",
      source: "inferred_multiple",
    });
    expect(mapExtractedQuestionsToQuizQuestions([q])[0].type).toBe("multiple_choice");
  });

  it("không có type và không suy ra được gì thì fallback single_choice theo hành vi cũ", () => {
    const q = makeQuestion({ id: "q-fallback", order: 1, correctAnswers: ["B"] });
    expect(resolveQuestionType(q)).toEqual({
      type: "single_choice",
      source: "fallback_single",
    });
    expect(mapExtractedQuestionsToQuizQuestions([q])[0].type).toBe("single_choice");
  });

  it("questionType lạ bị bỏ qua, rơi về suy luận/fallback chứ không lọt type lạ", () => {
    const q = makeQuestion({ id: "q-bad-type", order: 1, correctAnswers: ["B"] }) as ExtractedQuestion;
    (q as unknown as Record<string, unknown>).questionType = "essay";
    expect(resolveQuestionType(q).type).toBe("single_choice");
    expect(mapExtractedQuestionsToQuizQuestions([q])[0].type).toBe("single_choice");
  });

  it("type một đáp án nhưng có nhiều đáp án thì chặn xuất bản (type_answer_mismatch)", () => {
    const diagnostics = validateExtractedQuestions([
      makeQuestion({
        id: "q-mismatch",
        order: 1,
        questionType: "single_choice",
        correctAnswers: ["A", "B"],
      }),
      makeQuestion({
        id: "q-tf-mismatch",
        order: 2,
        options: trueFalseOptions,
        correctAnswers: ["A", "B"],
      }),
    ]);
    const mismatches = diagnostics.filter((d) => d.code === "type_answer_mismatch");
    expect(mismatches.map((d) => d.order).sort()).toEqual([1, 2]);
    expect(mismatches.every((d) => d.blocksPublish)).toBe(true);
    expect(getPublishBlockers(diagnostics)).toHaveLength(2);
  });
});
