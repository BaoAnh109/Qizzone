/**
 * Test bước 07 (PLAN_MAIN): quality gate cho DOCX.
 * - assessDocxQuality là hàm thuần: complete / partial / failed dựa trên
 *   số header có nhãn quét độc lập so với số câu parse được, và câu thiếu
 *   phương án. Parser renumber order theo vị trí nên gate so sánh theo
 *   số đếm, không nêu tên số câu thiếu cụ thể.
 * - Thiếu đáp án KHÔNG làm partial (validator bước 04 đã chặn xuất bản);
 *   confidenceScore KHÔNG được dùng làm điều kiện chặn.
 * - Tích hợp qua parseDocxFile trên fixture thật bước 02 (f01/f06/f12/f13)
 *   và trên docx rỗng tự tạo (đường Mammoth → failed).
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import JSZip from "jszip";
import { parseDocxFile, assessDocxQuality } from "@/utils/parsers/docxParser";
import type {
  ExtractedQuestion,
  ExtractedOption,
  ExtractionResult,
} from "@/types/extractor";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(HERE, "../../../tests/fixtures/extraction");

function makeOption(id: string): ExtractedOption {
  return { id: id as ExtractedOption["id"], content: `Nội dung ${id}`, rawContent: id };
}

function makeQuestion(
  order: number,
  optionCount: number,
  correctAnswers: string[] = ["A"]
): ExtractedQuestion {
  const ids = ["A", "B", "C", "D"].slice(0, optionCount);
  return {
    id: `q${order}`,
    tempId: `q${order}`,
    order,
    content: `Câu hỏi ${order}`,
    options: ids.map((id) => makeOption(id)),
    correctAnswers: correctAnswers as ExtractedQuestion["correctAnswers"],
    points: 10,
    confidenceScore: 1,
    detectionStrategy: "answer_at_end",
    rawTextSegment: `Câu ${order}`,
  };
}

function makeResult(questions: ExtractedQuestion[]): ExtractionResult {
  return {
    fileName: "test.docx",
    fileType: "docx",
    fileSize: 0,
    title: "",
    subject: "Toán học",
    totalQuestionsDetected: questions.length,
    questions,
    hasAnswerKeyTable: false,
    warningsCount: 0,
    extractedAt: new Date().toISOString(),
  };
}

const TEXT_3_CAU = `Câu 1: Nội dung 1
A. a
B. b
C. c
D. d
Câu 2: Nội dung 2
A. a
B. b
C. c
D. d
Câu 3: Nội dung 3
A. a
B. b
C. c
D. d`;

describe("assessDocxQuality — logic gate thuần", () => {
  it("Đủ câu, đủ phương án → complete, không lý do", () => {
    const q = assessDocxQuality(
      makeResult([makeQuestion(1, 4), makeQuestion(2, 4), makeQuestion(3, 4)]),
      TEXT_3_CAU
    );
    expect(q.status).toBe("complete");
    expect(q.parsedQuestions).toBe(3);
    expect(q.detectedHeaders).toBe(3);
    expect(q.unparsedHeaders).toBe(0);
    expect(q.reasons).toEqual([]);
  });

  it("File nhiều câu nhưng chỉ parse được 1 câu → partial, thiếu theo số đếm (P0 bước 07)", () => {
    const q = assessDocxQuality(makeResult([makeQuestion(1, 4)]), TEXT_3_CAU);
    expect(q.status).toBe("partial");
    expect(q.unparsedHeaders).toBe(2);
    expect(q.reasons.join(" ")).toContain("3 header");
    expect(q.reasons.join(" ")).toContain("1 câu");
  });

  it("Thiếu câu giữa dải thứ tự → partial theo số đếm (parser renumber theo vị trí nên không nêu tên số câu thiếu)", () => {
    const q = assessDocxQuality(
      makeResult([makeQuestion(1, 4), makeQuestion(2, 4)]),
      TEXT_3_CAU
    );
    expect(q.status).toBe("partial");
    expect(q.unparsedHeaders).toBe(1);
  });

  it("Câu thiếu phương án (< 2 options) → partial, ghi đúng order", () => {
    const q = assessDocxQuality(
      makeResult([makeQuestion(1, 4), makeQuestion(2, 1)]),
      `Câu 1: Nội dung 1
Câu 2: Nội dung 2`
    );
    expect(q.status).toBe("partial");
    expect(q.invalidOptionOrders).toEqual([2]);
    expect(q.unparsedHeaders).toBe(0);
  });

  it("0 câu → failed", () => {
    const q = assessDocxQuality(makeResult([]), "");
    expect(q.status).toBe("failed");
    expect(q.parsedQuestions).toBe(0);
    expect(q.reasons.length).toBeGreaterThan(0);
  });

  it("Số câu không liên tục thật trong đề (2, 5, 9, 14) → complete: parser renumber theo vị trí nên đếm đủ 4 là đủ", () => {
    const text = [2, 5, 9, 14].map((n) => `Câu ${n}: Nội dung`).join("\n");
    const q = assessDocxQuality(
      makeResult([1, 2, 3, 4].map((n) => makeQuestion(n, 4))),
      text
    );
    expect(q.status).toBe("complete");
    expect(q.detectedHeaders).toBe(4);
    expect(q.unparsedHeaders).toBe(0);
  });

  it("Câu đủ phương án nhưng thiếu đáp án → vẫn complete (chặn xuất bản là việc của validator bước 04)", () => {
    const q = assessDocxQuality(
      makeResult([makeQuestion(1, 4, []), makeQuestion(2, 4, [])]),
      `Câu 1: Nội dung 1
Câu 2: Nội dung 2`
    );
    expect(q.status).toBe("complete");
  });
});

describe("parseDocxFile — quality kèm theo output thật", () => {
  async function parseFixture(name: string) {
    const buffer = fs.readFileSync(path.join(FIXTURE_DIR, name));
    const file = new File([buffer as unknown as BlobPart], name);
    return parseDocxFile(file);
  }

  it("f01 DOCX tô vàng: 4 câu đủ → complete, dữ liệu không mất", async () => {
    const out = await parseFixture("f01-docx-highlight.docx");
    expect(out.result.questions.length).toBe(4);
    expect(out.quality.status).toBe("complete");
    expect(out.quality.parsedQuestions).toBe(4);
  });

  it("f06 DOCX Đúng/Sai: IR bước 13 viết lại thành option A=Đúng, B=Sai → complete", async () => {
    const out = await parseFixture("f06-docx-true-false.docx");
    expect(out.result.questions.length).toBe(4);
    // Trước bước 13, f06 về 0 phương án nên gate partial với
    // invalidOptionOrders đủ 4; nay mệnh đề Đúng/Sai được viết lại thành
    // option thật (giữ HTML tô màu) nên đủ phương án → complete.
    expect(out.quality.status).toBe("complete");
    expect(out.quality.invalidOptionOrders.length).toBe(0);
    expect(
      out.result.questions.every(
        (q) =>
          q.options.length === 2 &&
          q.options[0].content === "Đúng" &&
          q.options[1].content === "Sai" &&
          q.questionType === "true_false"
      )
    ).toBe(true);
  });

  it("f12 DOCX số không liên tục: parser renumber 1–4, đủ 4 header → complete", async () => {
    const out = await parseFixture("f12-docx-noncontinuous.docx");
    expect(out.result.questions.map((q) => q.order)).toEqual([1, 2, 3, 4]);
    expect(out.quality.detectedHeaders).toBe(4);
    expect(out.quality.status).toBe("complete");
  });

  it("f13 DOCX không đáp án: đủ phương án → complete dù correctAnswers rỗng", async () => {
    const out = await parseFixture("f13-docx-no-answer.docx");
    expect(out.result.questions.length).toBe(3);
    expect(out.quality.status).toBe("complete");
  });

  it("Sau MVP: scanLabeledHeaders đếm được nhãn La Mã Câu I/II/III (h04) — đồng bộ với header regex của parser", () => {
    const rawText = `
Câu I. Thủ đô của Việt Nam là?
A. Hà Nội
B. Huế
C. Đà Nẵng
D. Hải Phòng

Câu II. Đâu là một ngôn ngữ lập trình?
A. HTML
B. CSS
C. TypeScript
D. JPEG

Câu III. 1 + 1 bằng mấy?
A. 1
B. 2
C. 3
D. 4
`;
    const quality = assessDocxQuality(
      makeResult([makeQuestion(1, 4), makeQuestion(2, 4), makeQuestion(3, 4)]),
      rawText
    );
    expect(quality.detectedHeaders).toBe(3);
    expect(quality.unparsedHeaders).toBe(0);
    expect(quality.status).toBe("complete");
  });

  it("Sau MVP: nhãn La Mã viết sai chuẩn (IIII) không được đếm vào detectedHeaders", () => {
    const rawText = `
Câu IIII. Hỏi gì?
A. 1
B. 2
C. 3
D. 4
`;
    const quality = assessDocxQuality(makeResult([makeQuestion(1, 4)]), rawText);
    expect(quality.detectedHeaders).toBe(0);
    // 1 câu parse được, 0 header đếm được → không có tín hiệu thiếu câu
    // ở tầng DOCX (tín hiệu 0-header là của Quality Gate bước 10).
    expect(quality.status).toBe("complete");
  });

  it("DOCX rỗng trong Node → throw ở đường Mammoth (giới hạn mammoth 1.12.2: openZip chỉ nhận path/buffer/file, không nhận arrayBuffer; đường này chưa từng được chạy trong test Node). FileDropzone đã catch và toast lỗi nên hành vi cũ 'từ chối rõ ràng' vẫn giữ; ở browser cùng input sẽ qua assessDocxQuality → failed (đã cover ở test thuần 0 câu).", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body></w:body></w:document>`
    );
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const file = new File([buffer], "empty.docx");
    await expect(parseDocxFile(file)).rejects.toThrow("Could not find file in options");
  });
});
