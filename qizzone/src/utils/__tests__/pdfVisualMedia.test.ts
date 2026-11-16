import { describe, expect, it } from "vitest";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  getPdfPagePaintMarks,
  getScannedPdfPromptBounds,
  isPdfVisualPositionConsistentWithPromptCue,
  isPdfPromptVisualCueDistinctive,
  isPdfVisualSourcePageEligible,
  normalizePdfGlyphText,
  parsePdfFile,
} from "@/utils/parsers/pdfParser";
import { parseRawExamText } from "@/utils/parsers/ruleExtractor";
import type { DocumentIRBlock } from "@/types/documentIR";

function makePdf(content: string, resources = "<< >>", extraObjects: Array<{ value: string; binary?: Uint8Array }> = []): Uint8Array {
  const streamBytes = new TextEncoder().encode(content);
  const objects: Array<{ value: string; binary?: Uint8Array }> = [
    { value: "<< /Type /Catalog /Pages 2 0 R >>" },
    { value: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { value: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources ${resources} /Contents 4 0 R >>` },
    { value: `<< /Length ${streamBytes.length} >>\nstream\n${content}\nendstream` },
    ...extraObjects,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${object.value}\n`;
    if (object.binary) {
      const prefix = new TextEncoder().encode(pdf);
      const suffix = new TextEncoder().encode("\nendstream\nendobj\n");
      const next = new Uint8Array(prefix.length + object.binary.length + suffix.length);
      next.set(prefix);
      next.set(object.binary, prefix.length);
      next.set(suffix, prefix.length + object.binary.length);
      pdf = new TextDecoder("latin1").decode(next);
    } else {
      pdf += "endobj\n";
    }
  }
  const xrefOffset = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Uint8Array([...new TextEncoder().encode(pdf)]);
}

async function getVisualRegions(data: Uint8Array) {
  const loadingTask = pdfjsLib.getDocument({ data });
  const document = await loadingTask.promise;
  try {
    const page = await document.getPage(1);
    return (await getPdfPagePaintMarks(page, [])).visualRegions;
  } finally {
    await loadingTask.destroy();
  }
}

describe("PDF visual region detection", () => {
  it("detects a vector chart drawn from axes and bars", async () => {
    const pdf = makePdf("q 0 0 0 RG 2 w 100 400 m 100 550 l S 100 400 m 350 400 l S 120 400 30 70 re f 180 400 30 120 re f 240 400 30 95 re f Q");
    const regions = await getVisualRegions(pdf);
    expect(regions.some(region => region.type === "shape"
      && region.bbox[0] <= 120 && region.bbox[1] <= 400
      && region.bbox[2] >= 270 && region.bbox[3] >= 520)).toBe(true);
  });

  it("applies PDF transforms to yellow answer highlights before matching text", async () => {
    const pdf = makePdf("q 1 1 0 rg 1 0 0 1 0 500 cm 100 100 80 20 re f Q");
    const loadingTask = pdfjsLib.getDocument({ data: pdf });
    const document = await loadingTask.promise;
    try {
      const page = await document.getPage(1);
      const marks = await getPdfPagePaintMarks(page, []);
      expect(marks.vectorHighlights).toEqual([[100, 600, 180, 620]]);
    } finally {
      await loadingTask.destroy();
    }
  });

  it("detects the placement bounds of embedded PDF image objects", async () => {
    const imageBytes = new Uint8Array([1, 2, 3]);
    const content = "q 200 0 0 120 180 450 cm /Figure Do Q";
    const resources = "<< /XObject << /Figure 5 0 R >> >>";
    const image = {
      value: `<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${imageBytes.length} >>\nstream\n`,
      binary: imageBytes,
    };
    const regions = await getVisualRegions(makePdf(content, resources, [image]));
    expect(regions.some(region => region.type === "image"
      && region.bbox[0] <= 180 && region.bbox[1] <= 450
      && region.bbox[2] >= 380 && region.bbox[3] >= 570)).toBe(true);
  });

  it("crops a scanned chart with its prompt without including answer text", () => {
    const parsed = parseRawExamText("Câu 1: Dựa vào biểu đồ, chọn đáp án đúng.\nA. Phương án A\nB. Phương án B", {
      fileName: "scan.pdf",
      fileType: "pdf",
    }).questions[0];
    const question = {
      ...parsed,
      promptSourceRefs: ["prompt"],
      sourceRefs: ["prompt", "option-a", "option-b"],
      options: parsed.options.map((option, index) => ({ ...option, sourceRefs: [index === 0 ? "option-a" : "option-b"] })),
    };
    const blocks: DocumentIRBlock[] = [
      { id: "previous-question", type: "text_span", text: "Câu trước", bbox: [80, 700, 300, 730], readingOrder: 0, sourceRef: { page: 1 } },
      { id: "prompt", type: "text_span", text: question.content, bbox: [100, 600, 400, 630], readingOrder: 1, sourceRef: { page: 1 } },
      { id: "option-a", type: "text_span", text: "A. Phương án A", bbox: [100, 520, 300, 550], readingOrder: 2, sourceRef: { page: 1 } },
      { id: "option-b", type: "text_span", text: "B. Phương án B", bbox: [100, 470, 300, 500], readingOrder: 3, sourceRef: { page: 1 } },
    ];

    expect(getScannedPdfPromptBounds(question, 1, new Map(blocks.map(block => [block.id, block])), [question], 612, 792))
      .toEqual([63.28, 536.64, 436.72, 693.36]);
  });

  it("keeps superscript exponents in the extracted PDF text", async () => {
    const font = { value: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" };
    const pdfBytes = makePdf(
      "BT /F1 12 Tf 100 700 Td (x) Tj 7 4 Td /F1 8 Tf (3) Tj ET",
      "<< /Font << /F1 5 0 R >> >>",
      [font],
    );
    const parsed = await parsePdfFile(new File([pdfBytes.buffer as ArrayBuffer], "math-exponent.pdf"));
    expect(parsed.pagesText[0]).toContain("x³");
  });

  it("keeps graph axis labels in the figure crop instead of merging them into the prompt", async () => {
    const font = { value: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" };
    const content = [
      "q 0 0 0 RG 2 w 300 500 m 300 650 l S 300 500 m 500 500 l S 320 500 30 70 re f 380 500 30 110 re f Q",
      "BT /F1 12 Tf 70 650 Td (Graph of temperature changes in a city today.) Tj 210 -50 Td (t) Tj 20 0 Td (34) Tj ET",
    ].join(" ");
    const pdfBytes = makePdf(content, "<< /Font << /F1 5 0 R >> >>", [font]);
    const parsed = await parsePdfFile(new File([pdfBytes.buffer as ArrayBuffer], "graph-labels.pdf"));
    const visual = parsed.documentIR.pages[0].blocks.find(block => block.type === "shape");

    expect(visual?.bbox?.[0]).toBeLessThanOrEqual(280);
    expect(parsed.documentIR.pages[0].blocks.some(block => block.type === "text_span" && block.text === "34")).toBe(false);
    expect(parsed.documentIR.pages[0].blocks.find(block => block.type === "paragraph")?.text)
      .toContain("Graph of temperature changes in a city today.");
  });

  it("does not attach a figure above a prompt that explicitly refers to a figure below", () => {
    const prompt = [300, 520, 520, 545] as [number, number, number, number];
    const figureAbove = [320, 560, 500, 730] as [number, number, number, number];
    const figureBelow = [320, 300, 500, 500] as [number, number, number, number];

    expect(isPdfVisualPositionConsistentWithPromptCue(figureAbove, prompt, "như hình vẽ dưới đây")).toBe(false);
    expect(isPdfVisualPositionConsistentWithPromptCue(figureBelow, prompt, "như hình vẽ dưới đây")).toBe(true);
    expect(isPdfVisualPositionConsistentWithPromptCue(figureAbove, prompt, "Hình bên cho biết nhiệt độ")).toBe(true);
  });

  it("rejects catch-all questions with source matches across many pages", () => {
    expect(isPdfVisualSourcePageEligible(3, true, 1)).toBe(true);
    expect(isPdfVisualSourcePageEligible(3, false, 0)).toBe(false);
    expect(isPdfVisualSourcePageEligible(43, true, 5, true)).toBe(true);
    expect(isPdfVisualSourcePageEligible(43, true, 5, false)).toBe(false);
    expect(isPdfVisualSourcePageEligible(43, false, 0)).toBe(false);
    expect(isPdfPromptVisualCueDistinctive("và có bảng biến thiên như hình vẽ dưới")).toBe(true);
    expect(isPdfPromptVisualCueDistinctive("có đồ thị như hình vẽ bên. Hàm số")).toBe(false);
  });

  it("normalizes Greek letters from embedded PDF Symbol fonts", () => {
    expect(normalizePdfGlyphText("\uF06D = \uF072")).toBe("μ = ρ");
  });
});
