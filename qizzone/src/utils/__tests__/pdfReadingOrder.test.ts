import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
// Tiền lệ của runner (bước 02): chỉ import legacy build trong cùng file
// test thì parsePdfFile (bản modern) mới chạy được trong vitest — bản
// modern đứng một mình lỗi "hashOriginal.toHex is not a function" ở Node.
// Import này không dùng trực tiếp, chỉ để môi trường test đủ điều kiện.
import "pdfjs-dist/legacy/build/pdf.mjs";
import {
  orderPageLines,
  findQuestionPage,
  assignQuestionPages,
  parsePdfFile,
  type PdfTextItem,
} from "@/utils/parsers/pdfParser";
import { cleanPdfPages } from "@/utils/parsers/pdfCleaner";
import { fromV1Question, toV1Question } from "@/services/extraction/v2Adapter";
import type { ExtractedQuestion } from "@/types/extractor";

/** Item text pdfjs giả lập: transform [fontSize, 0, 0, fontSize, x, y]. */
function item(str: string, x: number, y: number, width?: number): PdfTextItem {
  return { str, transform: [13, 0, 0, 13, x, y], width };
}

describe("PDF reading order 2 cột (bước 15)", () => {
  it("đọc hết cột trái rồi sang cột phải, không phụ thuộc thứ tự item đầu vào", () => {
    // Hình học f09: trái x=40 (tới ~300), phải x=320; item đưa vào xen kẽ theo Y.
    const items: PdfTextItem[] = [];
    const left = [
      ["Câu 1. Thủ đô của Úc là thành phố nào?", 782, 260],
      ["A. Sydney", 756, 65],
      ["B. Canberra", 730, 77],
      ["Đáp án: B", 652, 64],
      ["Câu 2. 12 x 6 bằng bao nhiêu?", 600, 199],
      ["A. 60", 574, 34],
      ["Đáp án: C", 470, 64],
    ] as const;
    const right = [
      ["Câu 3. Nguyên tố nào nhẹ nhất?", 782, 210],
      ["A. Heli", 756, 42],
      ["Đáp án: B", 652, 64],
      ["Câu 4. Một tá bằng bao nhiêu?", 600, 200],
      ["A. 10", 574, 34],
      ["Đáp án: B", 470, 64],
    ] as const;
    // Đưa vào xen kẽ: phải trước, trái sau, cùng Y — thứ tự stream không quyết định.
    const maxLen = Math.max(left.length, right.length);
    for (let i = 0; i < maxLen; i++) {
      if (right[i]) items.push(item(right[i][0], 320, right[i][1], right[i][2]));
      if (left[i]) items.push(item(left[i][0], 40, left[i][1], left[i][2]));
    }
    const lines = orderPageLines(items);
    expect(lines).toEqual([
      "Câu 1. Thủ đô của Úc là thành phố nào?",
      "A. Sydney",
      "B. Canberra",
      "Đáp án: B",
      "Câu 2. 12 x 6 bằng bao nhiêu?",
      "A. 60",
      "Đáp án: C",
      "Câu 3. Nguyên tố nào nhẹ nhất?",
      "A. Heli",
      "Đáp án: B",
      "Câu 4. Một tá bằng bao nhiêu?",
      "A. 10",
      "Đáp án: B",
    ]);
  });

  it("dòng toàn chiều rộng (tiêu đề) phát đúng vị trí Y, không bị ép vào cột", () => {
    const items = [
      item("ĐỀ THI HỌC KỲ I", 40, 810, 400),
      item("Câu 1. Hỏi gì?", 40, 782, 100),
      item("A. Một", 40, 756, 40),
      item("Câu 2. Hỏi khác?", 320, 782, 100),
      item("A. Hai", 320, 756, 40),
    ];
    expect(orderPageLines(items)).toEqual([
      "ĐỀ THI HỌC KỲ I",
      "Câu 1. Hỏi gì?",
      "A. Một",
      "Câu 2. Hỏi khác?",
      "A. Hai",
    ]);
  });

  it("cột không đều (cột phải ít dòng hơn) vẫn đọc theo cột", () => {
    const items = [
      item("Câu 1. Trái một?", 40, 782, 100),
      item("A. Một", 40, 756, 40),
      item("Câu 2. Trái hai?", 40, 730, 100),
      item("A. Hai", 40, 704, 40),
      item("Câu 3. Phải một?", 320, 782, 100),
      item("A. Ba", 320, 756, 40),
    ];
    expect(orderPageLines(items)).toEqual([
      "Câu 1. Trái một?",
      "A. Một",
      "Câu 2. Trái hai?",
      "A. Hai",
      "Câu 3. Phải một?",
      "A. Ba",
    ]);
  });

  it("1 cột giữ nguyên thứ tự Y (không đoán cột)", () => {
    const items = [
      item("Câu 1. Hỏi gì?", 40, 782, 300),
      item("A. Một", 40, 756, 50),
      item("B. Hai", 40, 730, 50),
      item("Câu 2. Hỏi khác?", 40, 704, 300),
    ];
    expect(orderPageLines(items)).toEqual([
      "Câu 1. Hỏi gì?",
      "A. Một",
      "B. Hai",
      "Câu 2. Hỏi khác?",
    ]);
  });

  it("thụt đầu dòng (phương án thụt 20pt) không tạo thành cột giả", () => {
    const items = [
      item("Câu 1. Hỏi gì?", 40, 782, 200),
      item("A. Một", 60, 756, 30),
      item("B. Hai", 60, 730, 30),
      item("Câu 2. Hỏi khác?", 40, 704, 200),
    ];
    expect(orderPageLines(items)).toEqual([
      "Câu 1. Hỏi gì?",
      "A. Một",
      "B. Hai",
      "Câu 2. Hỏi khác?",
    ]);
  });

  it("tiêu đề căn giữa + footer căn giữa không tạo thành cột giả", () => {
    const items = [
      item("ĐỀ THI", 250, 810, 100),
      item("Câu 1. Hỏi gì?", 40, 782, 300),
      item("A. Một", 40, 756, 50),
      item("Câu 2. Hỏi khác?", 40, 730, 300),
      item("Hết", 250, 100, 40),
    ];
    expect(orderPageLines(items)).toEqual([
      "ĐỀ THI",
      "Câu 1. Hỏi gì?",
      "A. Một",
      "Câu 2. Hỏi khác?",
      "Hết",
    ]);
  });

  it("gom dòng theo Y (ngưỡng < 4) và xếp item trong dòng theo X", () => {
    const items = [
      item("thế nào?", 145, 782, 60),
      item("Câu 1. Thủ đô", 40, 780, 100),
      item("Câu 2. Khác?", 40, 770, 100),
    ];
    // "Câu 1. Thủ đô" (y=780, kết thúc x=140) và "thế nào?" (y=782, x=145,
    // khe 5pt) cùng dòng (|Δy|=2 < 4, khe nhỏ) → nối thành một dòng.
    expect(orderPageLines(items)).toEqual(["Câu 1. Thủ đô thế nào?", "Câu 2. Khác?"]);
  });

  it("cùng Y nhưng khe X lớn thì tách thành hai dòng (hai cột)", () => {
    const items = [
      item("Trái", 40, 782, 100),
      item("Phải", 320, 782, 100),
      item("Trái hai", 40, 756, 100),
      item("Phải hai", 320, 756, 100),
    ];
    expect(orderPageLines(items)).toEqual(["Trái", "Trái hai", "Phải", "Phải hai"]);
  });
});

describe("Gắn số trang cho câu hỏi PDF (bước 15)", () => {
  const pages = [
    "Câu 1. Thủ đô của Úc là thành phố nào?\nA. Sydney\nB. Canberra\nĐáp án: B",
    "Câu 2. 12 x 6 bằng bao nhiêu?\nA. 60\nB. 66\nĐáp án: C",
  ];
  const q = (content: string, rawTextSegment = ""): Pick<ExtractedQuestion, "content" | "rawTextSegment"> => ({
    content,
    rawTextSegment,
  });

  it("stem ở trang 2 thì page = 2; stem ở trang 1 thì page = 1", () => {
    expect(findQuestionPage(q("12 x 6 bằng bao nhiêu?"), pages)).toBe(2);
    expect(findQuestionPage(q("Thủ đô của Úc là thành phố nào?"), pages)).toBe(1);
  });

  it("không khớp trang nào thì undefined, không đoán", () => {
    expect(findQuestionPage(q("Nội dung hoàn toàn không có trong tài liệu này"), pages)).toBeUndefined();
  });

  it("stem quá ngắn thì không khớp (tránh khớp nhầm), fallback sang đoạn gốc dài hơn", () => {
    expect(findQuestionPage(q("Hỏi?"), pages)).toBeUndefined();
    expect(
      findQuestionPage(q("Hỏi?", "Câu 2. 12 x 6 bằng bao nhiêu? A. 60 B. 66"), pages)
    ).toBe(2);
  });

  it("assignQuestionPages giữ nguyên câu không khớp được trang", () => {
    const base = {
      id: "q-ext-1",
      tempId: "ext-1",
      order: 1,
      content: "",
      options: [],
      correctAnswers: [],
      points: 1,
      confidenceScore: 0,
      detectionStrategy: "ai_inference",
      rawTextSegment: "",
    } as ExtractedQuestion;
    const out = assignQuestionPages(
      [
        { ...base, content: "12 x 6 bằng bao nhiêu?" },
        { ...base, order: 2, content: "Không có trong tài liệu này cả" },
      ],
      pages
    );
    expect(out[0].page).toBe(2);
    expect(out[1].page).toBeUndefined();
  });

  it("adapter V1↔V2 mang page đi và về (không còn null như trước bước 15)", () => {
    const v1 = {
      id: "q-ext-1",
      tempId: "ext-1",
      order: 1,
      content: "12 x 6 bằng bao nhiêu?",
      options: [],
      correctAnswers: ["C"],
      points: 1,
      confidenceScore: 0.99,
      detectionStrategy: "answer_at_end",
      rawTextSegment: "Câu 2. 12 x 6 bằng bao nhiêu?",
      page: 2,
    } as ExtractedQuestion;
    const v2 = fromV1Question(v1);
    expect(v2.page).toBe(2);
    expect(toV1Question(v2).page).toBe(2);
  });
});

describe("Header/footer lặp theo vị trí (bước 15, pdfCleaner)", () => {
  it("dòng đầu lặp trên 2 trang bị gỡ khỏi cả 2 trang", () => {
    const out = cleanPdfPages([
      "ĐỀ ÔN TẬP HỌC KỲ\nCâu 1. Hỏi gì?\nA. Một",
      "ĐỀ ÔN TẬP HỌC KỲ\nCâu 2. Hỏi khác?\nA. Hai",
    ]);
    expect(out[0]).not.toContain("ĐỀ ÔN TẬP");
    expect(out[1]).not.toContain("ĐỀ ÔN TẬP");
    expect(out[0]).toContain("Câu 1. Hỏi gì?");
    expect(out[1]).toContain("Câu 2. Hỏi khác?");
  });

  it("dòng cuối lặp trên 2 trang bị gỡ; dòng lặp ở giữa trang được giữ", () => {
    const out = cleanPdfPages([
      "Câu 1. Hỏi gì?\nĐáp án: B\nHết trang",
      "Câu 2. Hỏi khác?\nĐáp án: B\nHết trang",
    ]);
    expect(out[0]).not.toContain("Hết trang");
    expect(out[1]).not.toContain("Hết trang");
    // "Đáp án: B" lặp nhưng ở giữa trang → giữ nguyên (nội dung thật).
    expect(out[0]).toContain("Đáp án: B");
    expect(out[1]).toContain("Đáp án: B");
  });

  it("tài liệu 1 trang không bị gỡ dòng nào ngoài bộ lọc cũ", () => {
    const out = cleanPdfPages(["Câu 1. Hỏi gì?\nA. Một\nĐáp án: B"]);
    expect(out).toEqual(["Câu 1. Hỏi gì?\nA. Một\nĐáp án: B"]);
  });

  it("sau MVP: dòng nội dung lặp ở biên trang KHÔNG bị gỡ như footer (file ATTT)", () => {
    // Hồi quy: "Sai" đứng cuối trang ở nhiều trang từng bị gỡ mất, làm
    // câu Đúng/Sai mất vế Sai và không tổng hợp được option.
    const out = cleanPdfPages([
      "Câu 7. Mệnh đề một?\nĐúng\nSai",
      "Câu 45. Mệnh đề hai?\nĐúng\nSai",
    ]);
    expect(out[0]).toContain("Sai");
    expect(out[1]).toContain("Sai");
    expect(out[0]).toContain("Đúng");
    // Option thường cuối trang cũng là nội dung, không phải footer.
    const out2 = cleanPdfPages([
      "Câu 1. Hỏi gì?\na. Một\nb. Hai\nd. Toàn vẹn",
      "Câu 2. Hỏi khác?\na. Ba\nb. Bốn\nd. Toàn vẹn",
    ]);
    expect(out2[0]).toContain("d. Toàn vẹn");
    expect(out2[1]).toContain("d. Toàn vẹn");
  });
});

describe("parsePdfFile end-to-end trên fixture thật (bước 15)", () => {
  const FIXTURE_DIR = "tests/fixtures/extraction";

  it("f09 PDF 2 cột: 4 câu đúng thứ tự, page = 1 cho mọi câu", async () => {
    const buffer = fs.readFileSync(path.join(FIXTURE_DIR, "f09-pdf-two-column.pdf"));
    const file = new File([buffer as unknown as BlobPart], "f09-pdf-two-column.pdf", {
      type: "application/pdf",
    });
    const out = await parsePdfFile(file);
    expect(out.totalPages).toBe(1);
    expect(out.hasTextLayer).toBe(true);
    expect(out.result.questions.map((q) => q.order)).toEqual([1, 2, 3, 4]);
    expect(out.result.questions.map((q) => q.page)).toEqual([1, 1, 1, 1]);
    expect(out.result.questions[0].content).toContain("Thủ đô của Úc");
    expect(out.result.questions[2].content).toContain("nhẹ nhất");
  });

  it("f15 PDF 1 cột: 4 câu, page = 1 cho mọi câu", async () => {
    const buffer = fs.readFileSync(path.join(FIXTURE_DIR, "f15-pdf-text.pdf"));
    const file = new File([buffer as unknown as BlobPart], "f15-pdf-text.pdf", {
      type: "application/pdf",
    });
    const out = await parsePdfFile(file);
    expect(out.totalPages).toBe(1);
    expect(out.hasTextLayer).toBe(true);
    expect(out.result.questions.length).toBe(4);
    expect(out.result.questions.map((q) => q.page)).toEqual([1, 1, 1, 1]);
  });

  it("f10 PDF scan: không có text layer, 0 câu, không bịa text", async () => {
    const buffer = fs.readFileSync(path.join(FIXTURE_DIR, "f10-pdf-scan.pdf"));
    const file = new File([buffer as unknown as BlobPart], "f10-pdf-scan.pdf", {
      type: "application/pdf",
    });
    const out = await parsePdfFile(file);
    expect(out.hasTextLayer).toBe(false);
    expect(out.result.questions.length).toBe(0);
  });
});
