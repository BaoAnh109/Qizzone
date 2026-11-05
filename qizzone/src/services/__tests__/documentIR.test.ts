/**
 * Test bước 13 (PLAN_MAIN): Canonical Document IR.
 * - Tách đoạn, phân loại block, phát hiện header lặp ở biên khối.
 * - Gom block thành câu hỏi, giữ số câu gốc, nhận diện Đúng/Sai.
 * - Live path (ruleExtractor): số gốc, header lặp f11, Đúng/Sai f06,
 *   nối bảng đáp án theo số gốc ở Quality Gate.
 * Không sửa test cũ; test mới chỉ đo hành vi bước 13.
 */
import { describe, it, expect } from "vitest";
import { parseRawExamText } from "@/utils/parsers/ruleExtractor";
import {
  buildDocumentIR,
  collectRepeatedHeaderLines,
  groupIRQuestions,
  splitParagraphUnits,
  stripRepeatedParagraphs,
  synthesizeTrueFalseBlock,
} from "@/services/extraction/documentIR";
import {
  fromV1Question,
  toV1Question,
} from "@/services/extraction/v2Adapter";
import { assessExtractionQuality } from "@/services/extraction/qualityGate";
import type { ExtractionV2Result } from "@/types/extractionV2";

describe("splitParagraphUnits", () => {
  it("tách <p> và dòng thường, bỏ đoạn rỗng", () => {
    const units = splitParagraphUnits(
      "<p>Câu 1. Hỏi gì?</p>\n<p>A. Một</p>\n\nDòng thường"
    );
    expect(units.map((u) => u.text)).toEqual([
      "Câu 1. Hỏi gì?",
      "A. Một",
      "Dòng thường",
    ]);
    expect(units[0].raw).toBe("<p>Câu 1. Hỏi gì?</p>");
  });
});

describe("buildDocumentIR", () => {
  it("phân loại header/option/statement và giữ số câu gốc", () => {
    const ir = buildDocumentIR(
      "ĐỀ KIỂM TRA\nCâu 2. Hỏi 2?\nA. Một\nB. Hai\nCâu 5. Đúng hay sai?\nĐúng\nSai\n",
      { fileName: "test.txt", fileType: "text" },
      { 2: "B", 5: "A" }
    );
    expect(ir.detectedHeaders).toEqual([2, 5]);
    expect(ir.blocks.find((b) => b.text === "Câu 2. Hỏi 2?")?.kind).toBe(
      "question_header"
    );
    expect(ir.blocks.find((b) => b.text === "Câu 2. Hỏi 2?")?.sourceNumber).toBe(2);
    expect(ir.blocks.find((b) => b.text === "A. Một")?.kind).toBe("option");
    expect(ir.blocks.find((b) => b.text === "Đúng")?.kind).toBe("statement");
    expect(ir.answerKey).toEqual([
      { sourceNumber: 2, answers: ["B"] },
      { sourceNumber: 5, answers: ["A"] },
    ]);
  });

  it("phát hiện dòng header lặp ở biên khối, không chạm dòng giữa khối", () => {
    const ir = buildDocumentIR(
      "ĐỀ ÔN TẬP\nCâu 1. Hỏi 1?\nA. Một\nB. Hai\nĐỀ ÔN TẬP\nCâu 2. Hỏi 2?\nA. Ba\nB. Bốn\nĐỀ ÔN TẬP\n",
      { fileName: "test.txt", fileType: "text" }
    );
    expect(ir.repeatedLines).toEqual(["ĐỀ ÔN TẬP"]);
    expect(
      ir.blocks.filter((b) => b.kind === "repeated_header").length
    ).toBe(3);
  });

  it("không coi Đúng/Sai hay dòng đáp án lặp là header lặp", () => {
    const ir = buildDocumentIR(
      "Câu 1. Mệnh đề 1.\nĐúng\nSai\nCâu 2. Mệnh đề 2.\nĐúng\nSai\n",
      { fileName: "test.txt", fileType: "text" }
    );
    expect(ir.repeatedLines).toEqual([]);
  });
});

describe("groupIRQuestions", () => {
  it("gom đúng câu, bỏ header lặp, phần mở đầu không thành câu giả", () => {
    const ir = buildDocumentIR(
      "ĐỀ ÔN TẬP\nCâu 1. Hỏi 1?\nA. Một\nB. Hai\nĐỀ ÔN TẬP\nCâu 2. Hỏi 2?\nA. Ba\nB. Bốn\n",
      { fileName: "test.txt", fileType: "text" }
    );
    const segments = groupIRQuestions(ir);
    expect(segments.map((s) => s.sourceNumber)).toEqual([1, 2]);
    expect(segments[0].bodyText).not.toContain("ĐỀ ÔN TẬP");
    expect(segments[1].bodyText).not.toContain("ĐỀ ÔN TẬP");
  });

  it("nhận diện câu Đúng/Sai và tài liệu không header thành một segment", () => {
    const ir = buildDocumentIR("Mệnh đề gì đó.\nĐúng\nSai\n", {
      fileName: "test.txt",
      fileType: "text",
    });
    const segments = groupIRQuestions(ir);
    expect(segments).toHaveLength(1);
    expect(segments[0].sourceNumber).toBeNull();
    expect(segments[0].isTrueFalse).toBe(true);
  });
});

describe("stripRepeatedParagraphs + collectRepeatedHeaderLines", () => {
  it("bỏ dòng lặp, giữ nguyên các dòng còn lại", () => {
    const groups = [
      splitParagraphUnits("ĐỀ ÔN TẬP"),
      splitParagraphUnits("Hỏi 1?\nA. Một\nĐỀ ÔN TẬP"),
      splitParagraphUnits("Hỏi 2?\nA. Ba\nĐỀ ÔN TẬP"),
    ];
    const repeated = collectRepeatedHeaderLines(groups);
    expect(repeated.has("ĐỀ ÔN TẬP")).toBe(true);
    const cleaned = stripRepeatedParagraphs(
      "<p>Hỏi 1?</p>\n<p>ĐỀ ÔN TẬP</p>\n<p>A. Một</p>",
      repeated
    );
    expect(cleaned).not.toContain("ĐỀ ÔN TẬP");
    expect(cleaned).toContain("A. Một");
  });

  it("tiền đề chung lặp ở ĐẦU thân nhiều câu KHÔNG bị coi là header lặp (f16, bước 26)", () => {
    const premise =
      "Một hình chữ nhật có chiều dài 12 cm và chiều rộng 8 cm.";
    const groups = [
      splitParagraphUnits("ĐỀ ÔN TẬP"),
      splitParagraphUnits(
        `${premise}\nChu vi là bao nhiêu?\nA. 20 cm\nB. 40 cm`
      ),
      splitParagraphUnits(
        `${premise}\nDiện tích là bao nhiêu?\nA. 96 cm vuông\nB. 20 cm vuông`
      ),
    ];
    const repeated = collectRepeatedHeaderLines(groups);
    expect(repeated.has(premise)).toBe(false);
  });

  it("option thường ở CUỐI nhiều khối KHÔNG bị coi là header lặp (sau MVP, file ATTT)", () => {
    // Hồi quy: "d. Toàn vẹn" lặp ở cuối Q13 và Q94 từng bị bump rồi
    // strip mất option D của cả hai câu (OPTION_RE chỉ nhận [A-D] hoa).
    const groups = [
      splitParagraphUnits("ĐỀ ÔN TẬP"),
      splitParagraphUnits("Hỏi 1?\na. Sẵn sàng\nb. Bí mật\nc. Xác thực\nd. Toàn vẹn"),
      splitParagraphUnits("Hỏi 2?\na. Chống chối bỏ\nb. Sẵn sàng\nc. Bí mật\nd. Toàn vẹn"),
      // Nhóm 3 giữ lại true-positive: header lặp thật vẫn bị phát hiện.
      splitParagraphUnits("Hỏi 3?\nA. Một\nB. Hai\nĐỀ ÔN TẬP"),
    ];
    const repeated = collectRepeatedHeaderLines(groups);
    expect(repeated.has("d. Toàn vẹn")).toBe(false);
    expect(repeated.has("ĐỀ ÔN TẬP")).toBe(true);
  });

  it("parseRawExamText giữ đủ 4 option khi option D lặp ở nhiều câu (sau MVP, file ATTT)", () => {
    const raw = [
      "Câu 1. Thuộc tính nào bị vi phạm?",
      "a. Sẵn sàng",
      "b. Bí mật",
      "c. Xác thực",
      "d. Toàn vẹn",
      "",
      "Câu 2. Tấn công chặn bắt vi phạm thuộc tính nào?",
      "a. Chống chối bỏ",
      "b. Sẵn sàng",
      "c. Bí mật",
      "d. Toàn vẹn",
    ].join("\n");
    const res = parseRawExamText(raw);
    expect(res.questions.length).toBe(2);
    for (const q of res.questions) {
      expect(q.options.map((o) => o.id)).toEqual(["A", "B", "C", "D"]);
      expect(q.options[3].content).toBe("Toàn vẹn");
    }
  });
});

describe("synthesizeTrueFalseBlock", () => {
  it("viết lại Đúng/Sai thành A/B, giữ nguyên HTML tô màu", () => {
    const { text, synthesized } = synthesizeTrueFalseBlock(
      "<p>Mệnh đề.</p>\n<p><mark>Đúng</mark></p>\n<p>Sai</p>"
    );
    expect(synthesized).toBe(true);
    expect(text).toContain("<p>A. <mark>Đúng</mark></p>");
    expect(text).toContain("<p>B. Sai</p>");
  });

  it("không viết lại khi đã có option A-D hoặc thiếu một vế", () => {
    expect(
      synthesizeTrueFalseBlock("Hỏi?\nA. Một\nB. Hai\nĐúng").synthesized
    ).toBe(false);
    expect(synthesizeTrueFalseBlock("Hỏi?\nĐúng").synthesized).toBe(false);
  });
});

describe("parseRawExamText với IR (live path)", () => {
  it("giữ số câu gốc 2/5/9/14, order vẫn 1–4", () => {
    const raw = [
      "Câu 2. Hỏi 2?",
      "A. Một",
      "B. Hai",
      "Câu 5. Hỏi 5?",
      "A. Ba",
      "B. Bốn",
      "Câu 9. Hỏi 9?",
      "A. Năm",
      "B. Sáu",
      "Câu 14. Hỏi 14?",
      "A. Bảy",
      "B. Tám",
    ].join("\n");
    const result = parseRawExamText(raw, { fileName: "t.txt", fileType: "text" });
    expect(result.questions.map((q) => q.order)).toEqual([1, 2, 3, 4]);
    expect(result.questions.map((q) => q.sourceNumber)).toEqual([2, 5, 9, 14]);
  });

  it("dòng header lặp không còn trộn vào option D (f11)", () => {
    const raw = [
      "ĐỀ ÔN TẬP — MÔN KHOA HỌC TỰ NHIÊN",
      "Câu 1. Lực nào giữ các hành tinh?",
      "A. Lực ma sát",
      "B. Lực hấp dẫn",
      "C. Lực đẩy",
      "D. Lực kéo",
      "ĐỀ ÔN TẬP — MÔN KHOA HỌC TỰ NHIÊN",
      "Câu 2. Đơn vị đo cường độ dòng điện?",
      "A. Vôn",
      "B. Oát",
      "C. Ampe",
      "D. Ôm",
    ].join("\n");
    const result = parseRawExamText(raw, { fileName: "t.txt", fileType: "text" });
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].options[3].content).toBe("Lực kéo");
    expect(result.questions[0].content).not.toContain("ĐỀ ÔN TẬP");
  });

  it("tiền đề chung lặp ở đầu thân câu được GIỮ trong stem (f16, bước 26)", () => {
    const raw = [
      "Câu 1.",
      "Một hình chữ nhật có chiều dài 12 cm và chiều rộng 8 cm.",
      "Chu vi của hình chữ nhật là bao nhiêu?",
      "A. 20 cm",
      "B. 40 cm",
      "Câu 2.",
      "Một hình chữ nhật có chiều dài 12 cm và chiều rộng 8 cm.",
      "Diện tích của hình chữ nhật là bao nhiêu?",
      "A. 96 cm vuông",
      "B. 20 cm vuông",
    ].join("\n");
    const result = parseRawExamText(raw, { fileName: "t.txt", fileType: "text" });
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].content).toContain(
      "Một hình chữ nhật có chiều dài 12 cm và chiều rộng 8 cm."
    );
    expect(result.questions[1].content).toContain(
      "Một hình chữ nhật có chiều dài 12 cm và chiều rộng 8 cm."
    );
  });

  it("khối Đúng/Sai thành option A/B với type true_false (f06, text thuần)", () => {
    const raw = [
      "Câu 1. Trái Đất quay quanh Mặt Trời.",
      "Đúng",
      "Sai",
      "Câu 2. Nước sôi ở 90 độ C.",
      "Đúng",
      "Sai",
    ].join("\n");
    const result = parseRawExamText(raw, { fileName: "t.txt", fileType: "text" });
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].options.map((o) => o.content)).toEqual([
      "Đúng",
      "Sai",
    ]);
    expect(result.questions[0].questionType).toBe("true_false");
    expect(result.questions[0].content).toBe("Trái Đất quay quanh Mặt Trời.");
  });

  it("Đúng/Sai có tô màu HTML thì waterfall bắt được đáp án (f06, DOCX)", () => {
    const raw = [
      "<p>Câu 1. Trái Đất quay quanh Mặt Trời.</p>",
      "<p><mark>Đúng</mark></p>",
      "<p>Sai</p>",
    ].join("\n");
    const result = parseRawExamText(raw, { fileName: "t.docx", fileType: "docx" });
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].options.map((o) => o.content)).toEqual([
      "Đúng",
      "Sai",
    ]);
    expect(result.questions[0].correctAnswers).toEqual(["A"]);
    expect(result.questions[0].detectionStrategy).toBe("highlight_color");
  });

  it("bảng đáp án nối theo số gốc, không theo order (đề 2/5)", () => {
    const raw = [
      "Câu 2. Hỏi 2?",
      "A. Một",
      "B. Hai",
      "Câu 5. Hỏi 5?",
      "A. Ba",
      "B. Bốn",
      "BẢNG ĐÁP ÁN",
      "2: A",
      "5: B",
    ].join("\n");
    const result = parseRawExamText(raw, { fileName: "t.txt", fileType: "text" });
    expect(result.questions.map((q) => q.sourceNumber)).toEqual([2, 5]);
    expect(result.questions[0].correctAnswers).toEqual(["A"]);
    expect(result.questions[1].correctAnswers).toEqual(["B"]);
  });
});

describe("adapter V1↔V2 giữ số gốc và type (bước 13)", () => {
  it("fromV1Question mang sourceNumber và questionType thật", () => {
    const v2 = fromV1Question({
      id: "q-ext-1",
      tempId: "ext-1",
      order: 1,
      sourceNumber: 5,
      questionType: "true_false",
      content: "Mệnh đề.",
      options: [
        { id: "A", content: "Đúng", rawContent: "Đúng" },
        { id: "B", content: "Sai", rawContent: "Sai" },
      ],
      correctAnswers: ["A"],
      points: 1,
      confidenceScore: 0.95,
      detectionStrategy: "highlight_color",
      rawTextSegment: "",
    });
    expect(v2.sourceNumber).toBe(5);
    expect(v2.type).toBe("true_false");
    const back = toV1Question(v2);
    expect(back.sourceNumber).toBe(5);
    expect(back.questionType).toBe("true_false");
  });
});

describe("Quality Gate nối bảng đáp án theo số gốc (bước 13)", () => {
  const base: ExtractionV2Result = {
    fileName: "t",
    fileType: "text",
    fileSize: 0,
    title: "",
    subject: "",
    totalQuestionsDetected: 2,
    questions: [],
    hasAnswerKeyTable: true,
    documentQuality: { status: "complete", parsedQuestions: 2, reasons: [] },
    warnings: [],
    chunks: [],
    extractedAt: new Date().toISOString(),
  };
  const mkQ = (order: number, sourceNumber: number | null, answers: string[]) => ({
    id: `q-${order}`,
    order,
    sourceNumber,
    content: "Hỏi?",
    type: "single_choice" as const,
    options: [
      { id: "A" as const, content: "Một" },
      { id: "B" as const, content: "Hai" },
    ],
    correctAnswers: answers as ("A" | "B")[],
    answerEvidence: null,
    status: "needs_review" as const,
    quality: { status: "complete" as const, reasons: [] },
    points: 1,
    warnings: [],
    assetRefs: [],
    engine: "rule" as const,
    page: null,
  });

  it("bảng keyed-by-sourceNumber khớp thì không conflict", () => {
    const v2: ExtractionV2Result = {
      ...base,
      questions: [mkQ(1, 2, ["A"]), mkQ(2, 5, ["B"])],
    };
    const gate = assessExtractionQuality(v2, {
      answerKey: { 2: ["A"], 5: ["B"] },
    });
    expect(
      gate.issues.filter((i) => i.code === "answer_key_conflict")
    ).toHaveLength(0);
  });

  it("bảng keyed-by-sourceNumber lệch thì conflict đúng câu gốc", () => {
    const v2: ExtractionV2Result = {
      ...base,
      questions: [mkQ(1, 2, ["A"]), mkQ(2, 5, ["B"])],
    };
    const gate = assessExtractionQuality(v2, {
      answerKey: { 2: ["B"], 5: ["B"] },
    });
    const conflicts = gate.issues.filter(
      (i) => i.code === "answer_key_conflict"
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].order).toBe(1);
  });

  it("câu không có số gốc vẫn nối được bằng order (tương thích cũ)", () => {
    const v2: ExtractionV2Result = {
      ...base,
      questions: [mkQ(1, null, ["A"])],
    };
    const gate = assessExtractionQuality(v2, { answerKey: { 1: ["B"] } });
    expect(
      gate.issues.filter((i) => i.code === "answer_key_conflict")
    ).toHaveLength(1);
  });
});
