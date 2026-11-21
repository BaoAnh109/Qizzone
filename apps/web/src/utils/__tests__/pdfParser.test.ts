import { describe, it, expect } from "vitest";
import fs from "fs";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { cleanPdfExtractedText } from "@/utils/parsers/pdfCleaner";
import { parseRawExamText } from "@/utils/parsers/ruleExtractor";

describe("PDF Parser & Cleaner Tests", () => {
  it("Làm sạch thành công watermark Studocu, header, footer và số trang", () => {
    const rawPages = [
      "messages.pdf_cover_qr_code_label\nTrang bìa môn học\nTrường Đại học Công nghệ\nmessages.downloaded_by\nlOMoARcPSD|64861506",
      "Chương 3\n1. Câu hỏi số một?\nA. Đáp án A\nB. Đáp án B\nC. Đáp án C\nD. Đáp án D\nmessages.downloaded_by\nlOMoARcPSD|64861506",
    ];

    const cleaned = cleanPdfExtractedText(rawPages);
    expect(cleaned).not.toContain("lOMoARcPSD");
    expect(cleaned).not.toContain("messages.downloaded_by");
    expect(cleaned).toContain("1. Câu hỏi số một?");
    expect(cleaned).toContain("A. Đáp án A");
  });

  it("Bóc tách chính xác 100% toàn bộ 55 câu hỏi từ file thực tế documents/doc_test/TNChuong3.pdf", async () => {
    const filePath = "d:/Qizzone/documents/doc_test/TNChuong3.pdf";
    if (fs.existsSync(filePath)) {
      const buffer = fs.readFileSync(filePath);
      const uint8Array = new Uint8Array(buffer);

      const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
      const pdf = await loadingTask.promise;

      expect(pdf.numPages).toBe(17);

      const rawPages: string[] = [];
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        let lastY: number | null = null;
        const pageLines: string[] = [];
        let currentLine = "";

        for (const item of textContent.items) {
          if ("str" in item) {
            const textItem = item as { str: string; transform: number[] };
            const currentY = textItem.transform[5];
            if (lastY === null || Math.abs(currentY - lastY) < 4) {
              currentLine += (currentLine.length > 0 && !currentLine.endsWith(" ") ? " " : "") + textItem.str;
            } else {
              if (currentLine.trim()) pageLines.push(currentLine.trim());
              currentLine = textItem.str;
            }
            lastY = currentY;
          }
        }
        if (currentLine.trim()) pageLines.push(currentLine.trim());
        rawPages.push(pageLines.join("\n"));
      }

      const cleanedText = cleanPdfExtractedText(rawPages);
      const result = parseRawExamText(cleanedText, {
        fileName: "TNChuong3.pdf",
        fileType: "pdf",
      });

      expect(result.questions.length).toBe(55);

      // Kiểm tra tất cả 55 câu hỏi đều có đủ 4 lựa chọn A, B, C, D
      for (let i = 0; i < 55; i++) {
        const q = result.questions[i];
        expect(q.order).toBe(i + 1);
        expect(q.options.length).toBe(4);
        expect(q.options.map(o => o.id)).toEqual(["A", "B", "C", "D"]);
        expect(q.content.trim().length).toBeGreaterThan(0);
        q.options.forEach(opt => {
          expect(opt.content.trim().length).toBeGreaterThan(0);
        });
      }
    }
  });
});
