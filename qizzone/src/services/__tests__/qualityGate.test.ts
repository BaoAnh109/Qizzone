import { describe, it, expect } from "vitest";
import type {
  ExtractionV2Question,
  ExtractionV2Result,
} from "@/types/extractionV2";
import {
  assessExtractionQuality,
  type QualityGateIssueCode,
} from "@/services/extraction/qualityGate";

function makeQuestion(
  overrides: Partial<ExtractionV2Question> & { id: string; order: number }
): ExtractionV2Question {
  return {
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

function codes(result: ReturnType<typeof assessExtractionQuality>): QualityGateIssueCode[] {
  return result.issues.map((i) => i.code);
}

describe("Quality Gate tổng (bước 10)", () => {
  it("bộ sạch → complete, không issue", () => {
    const r = assessExtractionQuality(
      makeResult([
        makeQuestion({ id: "q1", order: 1 }),
        makeQuestion({ id: "q2", order: 2 }),
      ])
    );
    expect(r.status).toBe("complete");
    expect(r.issues).toEqual([]);
  });

  it("0 câu → failed + no_questions", () => {
    const r = assessExtractionQuality(makeResult([]));
    expect(r.status).toBe("failed");
    expect(codes(r)).toEqual(["no_questions"]);
  });

  it("documentQuality failed nhưng vẫn có câu → failed + document_failed", () => {
    const r = assessExtractionQuality(
      makeResult([makeQuestion({ id: "q1", order: 1 })], {
        documentQuality: {
          status: "failed",
          parsedQuestions: 1,
          reasons: ["File hỏng ở tầng parse"],
        },
      })
    );
    expect(r.status).toBe("failed");
    expect(codes(r)).toContain("document_failed");
  });

  it("thiếu câu theo số header độc lập (bước 07) → partial + missing_questions, chỉ báo theo số đếm", () => {
    const r = assessExtractionQuality(
      makeResult(
        [
          makeQuestion({ id: "q1", order: 1 }),
          makeQuestion({ id: "q2", order: 2 }),
          makeQuestion({ id: "q3", order: 3 }),
        ],
        {
          documentQuality: {
            status: "partial",
            parsedQuestions: 3,
            detectedHeaders: 5,
            unparsedHeaders: 2,
            reasons: ["Phát hiện 5 header nhưng chỉ bóc tách được 3 câu"],
          },
        }
      )
    );
    expect(r.status).toBe("partial");
    expect(codes(r)).toContain("missing_questions");
    const msg = r.issues.find((i) => i.code === "missing_questions")!.message;
    expect(msg).toContain("thiếu 2 câu");
    // Không nêu tên số câu thiếu cụ thể (parser đánh lại order nên không suy được số gốc).
    expect(msg).not.toMatch(/Câu \d+ thiếu/);
  });

  it("totalQuestionsDetected cao hơn số câu → partial + missing_questions", () => {
    const r = assessExtractionQuality(
      makeResult([makeQuestion({ id: "q1", order: 1 })], {
        totalQuestionsDetected: 4,
      })
    );
    expect(r.status).toBe("partial");
    expect(codes(r)).toContain("missing_questions");
  });

  it("câu thiếu phương án → partial + insufficient_options có vị trí", () => {
    const r = assessExtractionQuality(
      makeResult([
        makeQuestion({ id: "q1", order: 1 }),
        // Đáp án rỗng để chỉ còn đúng một tín hiệu (thiếu phương án):
        // nếu giữ đáp án "A" với 0 phương án thì answer_not_in_options
        // (needs_review) cũng đúng và sẽ xếp trên partial.
        makeQuestion({ id: "q2", order: 2, options: [], correctAnswers: [] }),
      ])
    );
    expect(r.status).toBe("partial");
    const iss = r.issues.find((i) => i.code === "insufficient_options")!;
    expect(iss.order).toBe(2);
    expect(iss.questionIndex).toBe(1);
  });

  it("câu trống nội dung → partial + empty_content", () => {
    const r = assessExtractionQuality(
      makeResult([makeQuestion({ id: "q1", order: 1, content: "   " })])
    );
    expect(r.status).toBe("partial");
    expect(codes(r)).toContain("empty_content");
  });

  it("thiếu ID và trùng ID → needs_review, có vị trí", () => {
    const r = assessExtractionQuality(
      makeResult([
        makeQuestion({ id: "", order: 1 }),
        makeQuestion({ id: "dup", order: 2 }),
        makeQuestion({ id: "dup", order: 3 }),
      ])
    );
    expect(r.status).toBe("needs_review");
    expect(codes(r)).toContain("missing_id");
    expect(codes(r)).toContain("duplicate_id");
    expect(r.issues.find((i) => i.code === "duplicate_id")!.order).toBe(3);
  });

  it("trùng phương án và đáp án ngoài phương án → needs_review", () => {
    const r = assessExtractionQuality(
      makeResult([
        makeQuestion({
          id: "q1",
          order: 1,
          options: [
            { id: "A", content: "X" },
            { id: "A", content: "Y" },
          ],
          correctAnswers: ["C"],
        }),
      ])
    );
    expect(r.status).toBe("needs_review");
    expect(codes(r)).toContain("duplicate_option");
    expect(codes(r)).toContain("answer_not_in_options");
  });

  it("mâu thuẫn bảng đáp án → needs_review; khớp bảng → complete; câu chưa có đáp án không tính là mâu thuẫn", () => {
    const conflict = assessExtractionQuality(
      makeResult([makeQuestion({ id: "q1", order: 1, correctAnswers: ["A"] })]),
      { answerKey: new Map([[1, ["B"]]]) }
    );
    expect(conflict.status).toBe("needs_review");
    expect(codes(conflict)).toContain("answer_key_conflict");

    const match = assessExtractionQuality(
      makeResult([makeQuestion({ id: "q1", order: 1, correctAnswers: ["A"] })]),
      { answerKey: { 1: ["A"] } }
    );
    expect(match.status).toBe("complete");

    const noAnswer = assessExtractionQuality(
      makeResult([
        makeQuestion({
          id: "q1",
          order: 1,
          correctAnswers: [],
          answerEvidence: null,
          status: "needs_review",
        }),
      ]),
      { answerKey: new Map([[1, ["B"]]]) }
    );
    expect(codes(noAnswer)).not.toContain("answer_key_conflict");
  });

  it("chunk hỏng/dở dang → partial; trùng chunk → needs_review", () => {
    const r = assessExtractionQuality(
      makeResult([makeQuestion({ id: "q1", order: 1 })], {
        chunks: [
          { chunkIndex: 0, status: "complete" },
          { chunkIndex: 1, status: "failed", reason: "OCR lỗi" },
          { chunkIndex: 2, status: "partial" },
          { chunkIndex: 2, status: "complete" },
        ],
      })
    );
    expect(codes(r)).toContain("chunk_failed");
    expect(codes(r)).toContain("chunk_partial");
    expect(codes(r)).toContain("duplicate_chunk");
    // Trùng chunk (needs_review) xếp trên chunk hỏng (partial).
    expect(r.status).toBe("needs_review");
  });

  it("trang chưa xử lý → partial, liệt kê đúng trang; đủ trang → complete", () => {
    const r = assessExtractionQuality(
      makeResult([
        makeQuestion({ id: "q1", order: 1, page: 1 }),
        makeQuestion({ id: "q2", order: 2, page: 2 }),
      ]),
      { totalPages: 3 }
    );
    expect(r.status).toBe("partial");
    const iss = r.issues.find((i) => i.code === "unprocessed_pages")!;
    expect(iss.message).toContain("trang 3");

    const full = assessExtractionQuality(
      makeResult([
        makeQuestion({ id: "q1", order: 1, page: 1 }),
        makeQuestion({ id: "q2", order: 2, page: 2 }),
        makeQuestion({ id: "q3", order: 3, page: 3 }),
      ]),
      { totalPages: 3 }
    );
    expect(full.status).toBe("complete");
  });

  it("biết tổng số trang nhưng không câu nào gắn trang → needs_review + page_coverage_unknown (không bịa là đủ)", () => {
    const r = assessExtractionQuality(
      makeResult([makeQuestion({ id: "q1", order: 1, page: null })]),
      { totalPages: 2 }
    );
    expect(r.status).toBe("needs_review");
    expect(codes(r)).toContain("page_coverage_unknown");
  });

  it("không truyền totalPages → bỏ qua kiểm tra trang, không bịa", () => {
    const r = assessExtractionQuality(
      makeResult([makeQuestion({ id: "q1", order: 1, page: null })])
    );
    expect(r.status).toBe("complete");
    expect(codes(r)).not.toContain("page_coverage_unknown");
    expect(codes(r)).not.toContain("unprocessed_pages");
  });

  it("confidence KHÔNG được dùng làm điều kiện: câu sạch dù confidence 0 vẫn complete; câu thiếu phương án dù confidence 1 vẫn partial", () => {
    const lowConf = assessExtractionQuality(
      makeResult([
        makeQuestion({
          id: "q1",
          order: 1,
          answerEvidence: { origin: "answer_table", confidence: 0 },
        }),
      ])
    );
    expect(lowConf.status).toBe("complete");

    const highConfBad = assessExtractionQuality(
      makeResult([
        makeQuestion({
          id: "q1",
          order: 1,
          options: [{ id: "A", content: "Chỉ 1 phương án" }],
          answerEvidence: { origin: "highlight", confidence: 1 },
        }),
      ])
    );
    expect(highConfBad.status).toBe("partial");
    expect(codes(highConfBad)).toContain("insufficient_options");
  });

  it("ranh giới với gate publish: câu thiếu đáp án (kiểu f13) không hạ cấp gate — việc chặn xuất bản thuộc bước 04/08", () => {
    const r = assessExtractionQuality(
      makeResult([
        makeQuestion({
          id: "q1",
          order: 1,
          correctAnswers: [],
          answerEvidence: null,
          status: "needs_review",
          quality: { status: "partial", reasons: ["Chưa có đáp án đúng"] },
        }),
      ])
    );
    expect(r.status).toBe("complete");
  });

  it("ưu tiên trạng thái: needs_review xếp trên partial; failed xếp trên tất cả", () => {
    const mixed = assessExtractionQuality(
      makeResult(
        [makeQuestion({ id: "q1", order: 1, correctAnswers: ["A"] })],
        { totalQuestionsDetected: 3 }
      ),
      { answerKey: new Map([[1, ["B"]]]) }
    );
    expect(codes(mixed)).toContain("missing_questions");
    expect(codes(mixed)).toContain("answer_key_conflict");
    expect(mixed.status).toBe("needs_review");

    const failed = assessExtractionQuality(makeResult([]), {
      answerKey: new Map([[1, ["B"]]]),
    });
    expect(failed.status).toBe("failed");
  });
});

describe("Quality Gate — tín hiệu 0 header (sau MVP, chống false-complete kiểu h04)", () => {
  it("tài liệu có câu nhưng quét header báo 0 → needs_review + no_headers_detected, không complete", () => {
    const r = assessExtractionQuality(
      makeResult([makeQuestion({ id: "q1", order: 1 })], {
        documentQuality: {
          status: "complete",
          parsedQuestions: 1,
          detectedHeaders: 0,
          reasons: [],
        },
      })
    );
    expect(codes(r)).toContain("no_headers_detected");
    expect(r.status).toBe("needs_review");
  });

  it("không quét header (detectedHeaders undefined, vd PDF/TXT) → không suy thành thiếu header", () => {
    const r = assessExtractionQuality(
      makeResult([makeQuestion({ id: "q1", order: 1 })])
    );
    expect(codes(r)).not.toContain("no_headers_detected");
    expect(r.status).toBe("complete");
  });

  it("0 câu thì failed + no_questions, không cộng thêm no_headers_detected", () => {
    const r = assessExtractionQuality(
      makeResult([], {
        documentQuality: {
          status: "failed",
          parsedQuestions: 0,
          detectedHeaders: 0,
          reasons: ["Không bóc tách được câu hỏi nào từ file"],
        },
      })
    );
    expect(r.status).toBe("failed");
    expect(codes(r)).toEqual(["no_questions"]);
  });
});
