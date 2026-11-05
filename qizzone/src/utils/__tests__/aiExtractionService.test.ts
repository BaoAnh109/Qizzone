import { describe, it, expect } from "vitest";
import { AI_CONFIG } from "@/config/aiConfig";
import { extractQuizWithAI } from "@/services/aiExtractionService";

describe("AI Configuration & Extraction Service Unit Tests", () => {
  it("Cung cấp cấu hình mặc định cho mô hình mạnh nhất", () => {
    expect(AI_CONFIG.DEFAULT_MODEL).toBe("gemini-3.6-flash");
    expect(AI_CONFIG.MAX_RETRIES).toBe(3);
    expect(AI_CONFIG.TEMPERATURE).toBe(0.1);
    expect(AI_CONFIG.BATCH_SIZE).toBe(12);
    expect(AI_CONFIG.FALLBACK_MODELS.length).toBeGreaterThan(0);
  });

  it("Bóc tách văn bản qua AI Service chuyển đổi thành công ExtractionResult", async () => {
    const rawText = `
Câu 1: Cho hàm số $y = f(x)$. Đạo hàm của $x^2$ là:
A. $x$
<u>B. $2x$</u>
C. $3x$
D. $4x$
`;
    const result = await extractQuizWithAI({
      text: rawText,
    });

    expect(result).not.toBeNull();
    expect(result.questions.length).toBe(1);
    expect(result.questions[0].correctAnswers).toEqual(["B"]);
    expect(["underline", "visual_marker", "ai_inference"]).toContain(
      result.questions[0].detectionStrategy
    );
  });

  it("Hàm solveMissingAnswersWithAI xử lý danh sách câu hỏi chưa có đáp án an toàn", async () => {
    const { solveMissingAnswersWithAI } = await import("@/services/aiExtractionService");
    const sampleQuestions = [
      {
        id: "q-1",
        tempId: "t-1",
        order: 1,
        content: "Thủ đô của Pháp là gì?",
        options: [
          { id: "A" as const, content: "London", rawContent: "A. London" },
          { id: "B" as const, content: "Paris", rawContent: "B. Paris" },
          { id: "C" as const, content: "Berlin", rawContent: "C. Berlin" },
          { id: "D" as const, content: "Rome", rawContent: "D. Rome" },
        ],
        correctAnswers: [],
        points: 1,
        confidenceScore: 0,
        detectionStrategy: "ai_inference" as const,
        rawTextSegment: "...",
      },
    ];

    // Bước 17: solving là opt-in — test đường thật phải truyền optIn: true
    // (không có mạng nên các đợt fail, nhưng không crash và không đổi câu).
    const res = await solveMissingAnswersWithAI(sampleQuestions, undefined, { optIn: true });
    expect(res).toBeDefined();
    expect(res.updatedQuestions.length).toBe(1);
    expect(res.updatedQuestions[0].options.length).toBe(4);
  }, 20000);

  it("Xử lý chia đợt (batching) khi số lượng câu hỏi lớn và báo cáo tiến trình", async () => {
    const { solveMissingAnswersWithAI } = await import("@/services/aiExtractionService");
    const progressReports: string[] = [];
    const manyQuestions = Array.from({ length: 25 }, (_, i) => ({
      id: `q-${i + 1}`,
      tempId: `t-${i + 1}`,
      order: i + 1,
      content: `Câu hỏi số ${i + 1}?`,
      options: [
        { id: "A" as const, content: "Đáp án A", rawContent: "A. Đáp án A" },
        { id: "B" as const, content: "Đáp án B", rawContent: "B. Đáp án B" },
      ],
      correctAnswers: [],
      points: 0.4,
      confidenceScore: 0,
      detectionStrategy: "ai_inference" as const,
      rawTextSegment: "...",
    }));

    const res = await solveMissingAnswersWithAI(manyQuestions, (_cur, _tot, msg) => {
      if (msg) progressReports.push(msg);
    }, { optIn: true });

    expect(res).toBeDefined();
    expect(res.updatedQuestions.length).toBe(25);
    expect(progressReports.length).toBeGreaterThan(1);
    expect(progressReports[0]).toContain("25 câu");
  });
});

describe("Bước 17: tách extraction khỏi solving (không gọi Gemini thật)", () => {
  // id phải là OptionId đúng kiểu để tsc build không lỗi (vitest/esbuild
  // không bắt lỗi type — bài học từ bước 11).
  const baseOptions: Array<{ id: "A" | "B" | "C" | "D"; content: string }> = [
    { id: "A", content: "Đáp án A" },
    { id: "B", content: "Đáp án B" },
    { id: "C", content: "Đáp án C" },
    { id: "D", content: "Đáp án D" },
  ];

  it("normalizeAIAnswerEvidenceOrigin map đủ 7 origin bằng chứng gốc, lạ/null → null", async () => {
    const { normalizeAIAnswerEvidenceOrigin } = await import(
      "@/services/aiExtractionService"
    );
    expect(normalizeAIAnswerEvidenceOrigin("answer_table")).toBe("answer_table");
    expect(normalizeAIAnswerEvidenceOrigin("answer_line")).toBe("answer_at_end");
    expect(normalizeAIAnswerEvidenceOrigin("marker")).toBe("special_marker");
    expect(normalizeAIAnswerEvidenceOrigin("underline")).toBe("underline");
    expect(normalizeAIAnswerEvidenceOrigin("highlight")).toBe("highlight_color");
    expect(normalizeAIAnswerEvidenceOrigin("bold")).toBe("distinct_bold");
    expect(normalizeAIAnswerEvidenceOrigin("solution")).toBe("explanation_text");
    expect(normalizeAIAnswerEvidenceOrigin("none")).toBeNull();
    expect(normalizeAIAnswerEvidenceOrigin(null)).toBeNull();
    expect(normalizeAIAnswerEvidenceOrigin("ai_inference")).toBeNull();
    expect(normalizeAIAnswerEvidenceOrigin("guessed")).toBeNull();
  });

  it("extraction: đáp án kèm bằng chứng hợp lệ được giữ + strategy suy từ origin", async () => {
    const { parseAIResult } = await import("@/services/aiExtractionService");
    const result = parseAIResult(
      { title: "Đề", subject: "Toán", questions: [{
        order: 1, content: "2 + 2 = ?", type: "single_choice", options: baseOptions,
        correctAnswers: ["C"], confidenceScore: 0.95,
        answerEvidence: { origin: "highlight", excerpt: "C. 4" },
      }] },
      "De.docx", "docx", 100,
    );
    expect(result).not.toBeNull();
    expect(result!.questions[0].correctAnswers).toEqual(["C"]);
    expect(result!.questions[0].detectionStrategy).toBe("highlight_color");
    expect(result!.questions[0].confidenceScore).toBe(0.95);
  });

  it("extraction: đáp án không kèm bằng chứng bị lược về [] + cờ cảnh báo (không suy luận)", async () => {
    const { parseAIResult } = await import("@/services/aiExtractionService");
    const result = parseAIResult(
      { title: "Đề", subject: "Toán", questions: [{
        order: 1, content: "2 + 2 = ?", type: "single_choice", options: baseOptions,
        correctAnswers: ["C"], confidenceScore: 0.99,
        answerEvidence: null,
      }] },
      "De.docx", "docx", 100,
    );
    expect(result).not.toBeNull();
    expect(result!.questions[0].correctAnswers).toEqual([]);
    expect(result!.questions[0].detectionStrategy).toBe("ai_inference");
    expect(result!.questions[0].confidenceScore).toBe(0);
    expect(result!.questions[0].warningFlags).toContain(
      "Đáp án AI không kèm bằng chứng — cần giáo viên xác nhận",
    );
  });

  it("bước 18: origin lạ → toàn bộ output bị từ chối ở schema gate (không giữ câu với đáp án lược)", async () => {
    const { parseAIResult } = await import("@/services/aiExtractionService");
    const result = parseAIResult(
      { title: "Đề", subject: "Toán", questions: [{
        order: 1, content: "2 + 2 = ?", type: "single_choice", options: baseOptions,
        correctAnswers: ["B"], confidenceScore: 0.9,
        detectionStrategy: "answer_table",
        answerEvidence: { origin: "guessed", excerpt: "B. 4" },
      }] },
      "De.docx", "docx", 100,
    );
    // Hành vi cũ (bước 17) giữ câu với đáp án lược về []; bước 18 siết
    // schema: origin ngoài tập khai báo → output sai dạng → null để
    // caller đi nhánh fallback, không sửa lặng lẽ từng câu cho qua.
    expect(result).toBeNull();
  });

  it("extraction: detectionStrategy do AI tự gửi bị bỏ qua (origin hợp lệ)", async () => {
    const { parseAIResult } = await import("@/services/aiExtractionService");
    const result = parseAIResult(
      { title: "Đề", subject: "Toán", questions: [{
        order: 1, content: "2 + 2 = ?", type: "single_choice", options: baseOptions,
        correctAnswers: ["B"], confidenceScore: 0.9,
        detectionStrategy: "answer_table",
        answerEvidence: { origin: "marker", excerpt: "*B" },
      }] },
      "De.docx", "docx", 100,
    );
    expect(result!.questions[0].correctAnswers).toEqual(["B"]);
    // Strategy suy từ origin (marker → special_marker), KHÔNG tin
    // detectionStrategy "answer_table" do AI tự gửi.
    expect(result!.questions[0].detectionStrategy).toBe("special_marker");
  });

  it("extraction: không bao giờ trả ai_inference kèm đáp án (tách khỏi solving)", async () => {
    const { parseAIResult } = await import("@/services/aiExtractionService");
    const result = parseAIResult(
      { title: "Đề", subject: "Toán", questions: [
        { order: 1, content: "Câu 1?", options: baseOptions, correctAnswers: ["A"],
          answerEvidence: { origin: "answer_line", excerpt: "Đáp án: A" } },
        { order: 2, content: "Câu 2?", options: baseOptions, correctAnswers: [],
          answerEvidence: null },
      ] },
      "De.docx", "docx", 100,
    );
    for (const q of result!.questions) {
      if (q.detectionStrategy === "ai_inference") {
        expect(q.correctAnswers).toEqual([]);
      }
    }
  });

  it("extraction: confidence không hợp lệ/không có bằng chứng → 0 (bỏ default 0.9 cũ)", async () => {
    const { parseAIResult } = await import("@/services/aiExtractionService");
    const result = parseAIResult(
      { title: "Đề", subject: "Toán", questions: [{
        order: 1, content: "Câu 1?", options: baseOptions, correctAnswers: ["A"],
        confidenceScore: 1.5,
        answerEvidence: { origin: "marker", excerpt: "*A" },
      }] },
      "De.docx", "docx", 100,
    );
    expect(result!.questions[0].confidenceScore).toBe(0);
  });

  it("solving không opt-in: không gọi AI, không đổi câu nào, không báo tiến trình", async () => {
    const { solveMissingAnswersWithAI } = await import(
      "@/services/aiExtractionService"
    );
    const progress: string[] = [];
    const questions = [{
      id: "q-1", tempId: "t-1", order: 1, content: "Câu 1?",
      options: baseOptions.map((o) => ({ ...o, rawContent: `${o.id}. ${o.content}` })),
      correctAnswers: [] as never[], points: 1, confidenceScore: 0,
      detectionStrategy: "ai_inference" as const, rawTextSegment: "...",
    }];
    const res = await solveMissingAnswersWithAI(questions, (_c, _t, m) => {
      if (m) progress.push(m);
    });
    expect(res.solvedCount).toBe(0);
    expect(res.updatedQuestions).toEqual(questions);
    expect(progress).toEqual([]);
    expect(res.failureMessage).toMatch(/opt-in/);
  });

  it("applyAISolutions: không ghi đè câu đã có đáp án, câu chưa có đáp án gắn nhãn ai_inference + cờ", async () => {
    const { applyAISolutions } = await import("@/services/aiExtractionService");
    const answered = {
      id: "q-1", tempId: "t-1", order: 1, content: "Câu 1?",
      options: baseOptions.map((o) => ({ ...o, rawContent: `${o.id}. ${o.content}` })),
      correctAnswers: ["A"] as never[], points: 1, confidenceScore: 0.99,
      detectionStrategy: "answer_table" as const, rawTextSegment: "...",
    };
    const unanswered = {
      id: "q-2", tempId: "t-2", order: 2, content: "Câu 2?",
      options: baseOptions.map((o) => ({ ...o, rawContent: `${o.id}. ${o.content}` })),
      correctAnswers: [] as never[], points: 1, confidenceScore: 0,
      detectionStrategy: "ai_inference" as const, rawTextSegment: "...",
    };
    const solutions = new Map([
      ["q-1", { answer: "B" as const, explanation: "Ghi đè?" }],
      ["q-2", { answer: "C" as const, explanation: "AI giải." }],
    ]);
    const { updatedQuestions, solvedCount } = applyAISolutions([answered, unanswered], solutions);
    expect(solvedCount).toBe(1);
    expect(updatedQuestions[0].correctAnswers).toEqual(["A"]);
    expect(updatedQuestions[0].detectionStrategy).toBe("answer_table");
    expect(updatedQuestions[1].correctAnswers).toEqual(["C"]);
    expect(updatedQuestions[1].detectionStrategy).toBe("ai_inference");
    expect(updatedQuestions[1].warningFlags).toContain(
      "Đáp án do AI giải — cần giáo viên xác nhận",
    );
  });

  it("câu do AI giải qua adapter V2 thành ai_suggested + needs_review (không verified)", async () => {
    const { applyAISolutions } = await import("@/services/aiExtractionService");
    const { fromV1Question } = await import("@/services/extraction/v2Adapter");
    const unanswered = {
      id: "q-2", tempId: "t-2", order: 2, content: "Câu 2?",
      options: baseOptions.map((o) => ({ ...o, rawContent: `${o.id}. ${o.content}` })),
      correctAnswers: [] as never[], points: 1, confidenceScore: 0,
      detectionStrategy: "ai_inference" as const, rawTextSegment: "...",
    };
    const { updatedQuestions } = applyAISolutions(
      [unanswered],
      new Map([["q-2", { answer: "C" as const, explanation: "AI giải." }]]),
    );
    const v2 = fromV1Question(updatedQuestions[0]);
    expect(v2.answerEvidence?.origin).toBe("ai_suggested");
    expect(v2.status).toBe("needs_review");
  });
});

describe("Bước 12: normalizeAIQuestionType (passthrough type từ AI, không gọi Gemini)", () => {
  it("chấp nhận đúng 3 giá trị type hợp lệ", async () => {
    const { normalizeAIQuestionType } = await import(
      "@/services/aiExtractionService"
    );
    expect(normalizeAIQuestionType("single_choice")).toBe("single_choice");
    expect(normalizeAIQuestionType("multiple_choice")).toBe("multiple_choice");
    expect(normalizeAIQuestionType("true_false")).toBe("true_false");
  });

  it("type lạ / rỗng / không phải chuỗi → undefined để mapper suy luận rồi fallback", async () => {
    const { normalizeAIQuestionType } = await import(
      "@/services/aiExtractionService"
    );
    expect(normalizeAIQuestionType("unknown")).toBeUndefined();
    expect(normalizeAIQuestionType("essay")).toBeUndefined();
    expect(normalizeAIQuestionType("")).toBeUndefined();
    expect(normalizeAIQuestionType(null)).toBeUndefined();
    expect(normalizeAIQuestionType(undefined)).toBeUndefined();
    expect(normalizeAIQuestionType(42)).toBeUndefined();
  });
});
