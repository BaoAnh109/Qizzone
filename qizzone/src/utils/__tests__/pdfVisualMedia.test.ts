import { describe, expect, it } from "vitest";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { getPdfPagePaintMarks, getScannedPdfPromptBounds } from "@/utils/parsers/pdfParser";
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
});
