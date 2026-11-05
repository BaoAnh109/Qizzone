import { describe, it, expect } from "vitest";
import type {
  ExtractionV2Question,
  ExtractionV2Result,
} from "@/types/extractionV2";
import { parseExtractionV2Result } from "@/types/extractionV2";
import {
  attachChunksToV2,
  buildDocumentChunk,
  buildPageChunks,
  buildSegmentChunks,
} from "@/services/extraction/chunking";
import { assessExtractionQuality } from "@/services/extraction/qualityGate";

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
    fileName: "test.pdf",
    fileType: "pdf",
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

describe("Chunking theo trang (bước 19)", () => {
  it("3 trang: câu ở trang 1 và 3, trang 2 có text nhưng 0 câu → complete/partial/complete", () => {
    const out = buildPageChunks(
      [
        { page: 1, order: 1 },
        { page: 3, order: 2 },
      ],
      3
    );
    expect(out.chunks.map((c) => c.status)).toEqual([
      "complete",
      "partial",
      "complete",
    ]);
    expect(out.chunks[0].page).toBe(1);
    expect(out.chunks[1].reason).toContain("Trang 2");
    expect(out.chunks[2].questionOrders).toEqual([2]);
    expect(out.assignments).toEqual([
      { questionIndex: 0, chunkIndex: 0 },
      { questionIndex: 1, chunkIndex: 2 },
    ]);
    expect(out.unassignedQuestionIndexes).toEqual([]);
  });

  it("trang scan → failed và không nhận câu nào, kể cả câu khai page là trang scan", () => {
    const out = buildPageChunks(
      [
        { page: 1, order: 1 },
        { page: 2, order: 2 },
      ],
      2,
      [2]
    );
    expect(out.chunks[1].status).toBe("failed");
    expect(out.chunks[1].reason).toContain("scan");
    expect(out.chunks[1].questionOrders).toEqual([]);
    expect(out.assignments).toEqual([{ questionIndex: 0, chunkIndex: 0 }]);
    expect(out.unassignedQuestionIndexes).toEqual([1]);
  });

  it("câu ngắt qua trang chỉ thuộc chunk trang bắt đầu, không nhân đôi", () => {
    const out = buildPageChunks([{ page: 1, order: 1 }], 2);
    expect(out.assignments).toHaveLength(1);
    expect(out.chunks[0].questionOrders).toEqual([1]);
    expect(out.chunks[1].questionOrders).toEqual([]);
  });

  it("câu không page, page 0 hoặc page ngoài khoảng → unassigned, không đoán", () => {
    const out = buildPageChunks(
      [
        { page: null, order: 1 },
        { page: 0, order: 2 },
        { page: 5, order: 3 },
        { page: 2, order: 4 },
      ],
      3
    );
    expect(out.unassignedQuestionIndexes).toEqual([0, 1, 2]);
    expect(out.assignments).toEqual([{ questionIndex: 3, chunkIndex: 1 }]);
  });

  it("totalPages không hợp lệ → throw RangeError, không im lặng trả chunk rỗng", () => {
    expect(() => buildPageChunks([], 0)).toThrow(RangeError);
    expect(() => buildPageChunks([], 1.5)).toThrow(RangeError);
  });

  it("scanPages ngoài khoảng bị bỏ qua, không tạo chunk thừa", () => {
    const out = buildPageChunks([{ page: 1, order: 1 }], 1, [0, 2, 99]);
    expect(out.chunks).toHaveLength(1);
    expect(out.chunks[0].status).toBe("complete");
  });
});

describe("Chunking theo khối IR segment (bước 19)", () => {
  it("3 segment = 3 câu → 3 chunk complete, đúng block range, gán theo vị trí", () => {
    const out = buildSegmentChunks(
      [
        { blocks: [{ index: 0 }, { index: 1 }, { index: 2 }] },
        { blocks: [{ index: 3 }, { index: 4 }] },
        { blocks: [{ index: 5 }] },
      ],
      [{ order: 1 }, { order: 2 }, { order: 3 }]
    );
    expect(out.chunks.map((c) => c.status)).toEqual([
      "complete",
      "complete",
      "complete",
    ]);
    expect(out.chunks[0].blockStart).toBe(0);
    expect(out.chunks[0].blockEnd).toBe(2);
    expect(out.chunks[2].blockStart).toBe(5);
    expect(out.chunks[2].blockEnd).toBe(5);
    expect(out.assignments).toEqual([
      { questionIndex: 0, chunkIndex: 0 },
      { questionIndex: 1, chunkIndex: 1 },
      { questionIndex: 2, chunkIndex: 2 },
    ]);
    expect(out.unassignedQuestionIndexes).toEqual([]);
  });

  it("số segment khác số câu → mọi chunk partial, không gán câu nào", () => {
    const out = buildSegmentChunks(
      [{ blocks: [{ index: 0 }] }, { blocks: [{ index: 1 }] }],
      [{ order: 1 }, { order: 2 }, { order: 3 }]
    );
    expect(out.chunks.map((c) => c.status)).toEqual(["partial", "partial"]);
    expect(out.chunks[0].reason).toContain("khác số câu hỏi");
    expect(out.assignments).toEqual([]);
    expect(out.unassignedQuestionIndexes).toEqual([0, 1, 2]);
  });

  it("segment không có block → blockStart/blockEnd vắng mặt, không bịa 0", () => {
    const out = buildSegmentChunks([{ blocks: [] }], [{ order: 1 }]);
    expect(out.chunks[0].blockStart).toBeUndefined();
    expect(out.chunks[0].blockEnd).toBeUndefined();
    expect(out.chunks[0].status).toBe("complete");
  });

  it("segments rỗng → không chunk nào, mọi câu unassigned", () => {
    const out = buildSegmentChunks([], [{ order: 1 }]);
    expect(out.chunks).toEqual([]);
    expect(out.unassignedQuestionIndexes).toEqual([0]);
  });
});

describe("Chunk fallback toàn tài liệu (bước 19)", () => {
  it("0 câu → 1 chunk failed", () => {
    const out = buildDocumentChunk([]);
    expect(out.chunks).toHaveLength(1);
    expect(out.chunks[0].status).toBe("failed");
    expect(out.assignments).toEqual([]);
  });

  it("có câu → 1 chunk complete, mọi câu gán vào chunk 0", () => {
    const out = buildDocumentChunk([{ order: 1 }, { order: 2 }]);
    expect(out.chunks[0].status).toBe("complete");
    expect(out.chunks[0].questionOrders).toEqual([1, 2]);
    expect(out.assignments).toEqual([
      { questionIndex: 0, chunkIndex: 0 },
      { questionIndex: 1, chunkIndex: 0 },
    ]);
  });
});

describe("Gắn chunk vào kết quả V2 (bước 19)", () => {
  it("gán chunkIndex + sourceRef pdf:page N cho câu có page, không mutate input", () => {
    const q1 = makeQuestion({ id: "q1", order: 1, page: 2 });
    const result = makeResult([q1]);
    const out = buildPageChunks([{ page: 2, order: 1 }], 2);
    const attached = attachChunksToV2(result, out);
    expect(attached.chunks).toHaveLength(2);
    expect(attached.questions[0].chunkIndex).toBe(1);
    expect(attached.questions[0].sourceRef).toBe("pdf:page 2");
    // Input không bị mutate.
    expect("chunkIndex" in q1).toBe(false);
    expect(q1.sourceRef).toBeUndefined();
    expect(result.chunks).toEqual([]);
  });

  it("không ghi đè sourceRef đã có; chunk theo khối không bịa sourceRef", () => {
    const q1 = makeQuestion({
      id: "q1",
      order: 1,
      page: 1,
      sourceRef: "pdf:page 1 (đã có)",
    });
    const attached = attachChunksToV2(
      makeResult([q1]),
      buildPageChunks([{ page: 1, order: 1 }], 1)
    );
    expect(attached.questions[0].sourceRef).toBe("pdf:page 1 (đã có)");

    const q2 = makeQuestion({ id: "q2", order: 1 });
    const segAttached = attachChunksToV2(
      makeResult([q2]),
      buildSegmentChunks([{ blocks: [{ index: 0 }] }], [{ order: 1 }])
    );
    expect(segAttached.questions[0].chunkIndex).toBe(0);
    expect(segAttached.questions[0].sourceRef).toBeUndefined();
  });

  it("câu unassigned giữ nguyên, không có chunkIndex", () => {
    const q1 = makeQuestion({ id: "q1", order: 1, page: null });
    const attached = attachChunksToV2(
      makeResult([q1]),
      buildPageChunks([{ page: null, order: 1 }], 1)
    );
    expect(attached.questions[0].chunkIndex).toBeUndefined();
  });
});

describe("Chunking nối vào Quality Gate + Zod (bước 19)", () => {
  it("chunk failed → gate có issue chunk_failed; chunk trùng index → duplicate_chunk", () => {
    const withFailed = makeResult(
      [makeQuestion({ id: "q1", order: 1, page: 1 })],
      {
        chunks: [
          { chunkIndex: 0, status: "complete", page: 1, questionOrders: [1] },
          { chunkIndex: 1, status: "failed", reason: "Trang scan", page: 2, questionOrders: [] },
        ],
      }
    );
    const gate = assessExtractionQuality(withFailed, { totalPages: 2 });
    expect(gate.issues.map((i) => i.code)).toContain("chunk_failed");

    const dup = makeResult([makeQuestion({ id: "q1", order: 1 })], {
      chunks: [
        { chunkIndex: 0, status: "complete", questionOrders: [1] },
        { chunkIndex: 0, status: "complete", questionOrders: [1] },
      ],
    });
    const gateDup = assessExtractionQuality(dup);
    expect(gateDup.issues.map((i) => i.code)).toContain("duplicate_chunk");
  });

  it("V2 có chunks + chunkIndex qua được Zod round-trip, giữ nguyên dữ liệu", () => {
    const q1 = makeQuestion({ id: "q1", order: 1, page: 1 });
    const attached = attachChunksToV2(
      makeResult([q1]),
      buildPageChunks([{ page: 1, order: 1 }], 1)
    );
    const parsed = parseExtractionV2Result(JSON.parse(JSON.stringify(attached)));
    expect(parsed).not.toBeNull();
    expect(parsed!.chunks).toHaveLength(1);
    expect(parsed!.chunks[0].page).toBe(1);
    expect(parsed!.chunks[0].questionOrders).toEqual([1]);
    expect(parsed!.questions[0].chunkIndex).toBe(0);
    expect(parsed!.questions[0].sourceRef).toBe("pdf:page 1");
  });
});
