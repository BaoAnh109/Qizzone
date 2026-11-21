import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as pdfjs from "pdfjs-dist";
import { describe, expect, it, vi } from "vitest";
import { getPdfPagePaintMarks } from "@/utils/parsers/pdfParser";

vi.mock("pdfjs-dist", async () => import("pdfjs-dist/legacy/build/pdf.mjs"));

const sourcePath = process.env.QIZZONE_REAL_DOCS_DIR
  ? `${process.env.QIZZONE_REAL_DOCS_DIR}/CNXHKH 2024 HUIT.docx.pdf`
  : "";
const pdfRedTextDescribe = sourcePath && existsSync(sourcePath) ? describe : describe.skip;

pdfRedTextDescribe("PDF answer text color regression", () => {
  it("retains red-font choices from the actual socialist science PDF", async () => {
    const bytes = await readFile(sourcePath);
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const textItems = content.items.flatMap(item => "str" in item && item.str.trim() ? [item.str] : []);
    const marks = await getPdfPagePaintMarks(page, textItems);
    const markedText = textItems
      .filter((_text, index) => marks.redTextItems.has(index))
      .join("")
      .normalize("NFKC")
      .replace(/\s+/gu, "")
      .toLocaleLowerCase("vi");

    expect(markedText).toContain("c.tuyênngôncủađảngcộngsản");
    expect(markedText).toContain("a.lànhữngquyluậtvàtínhquyluậtchínhtrị");
    expect(marks.redTextItems.size).toBeGreaterThan(10);
  });
});
