import * as pdfjsLib from "pdfjs-dist";
import { parseRawExamText } from "./ruleExtractor";
import type { ExtractionResult } from "@/types/extractor";

// Configure PDF.js worker
if (typeof window !== "undefined") {
  // Use unpkg or local worker fallback
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

export interface ParsedPdfDocument {
  rawText: string;
  totalPages: number;
  pagesText: string[];
  result: ExtractionResult;
  pdfDoc?: pdfjsLib.PDFDocumentProxy;
}

/**
 * Trích xuất toàn bộ văn bản và các trang từ tệp PDF thật
 */
export async function parsePdfFile(file: File): Promise<ParsedPdfDocument> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  const totalPages = pdf.numPages;
  const pagesText: string[] = [];
  let fullText = "";

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    // Group items into lines based on vertical position
    let lastY: number | null = null;
    let pageLines: string[] = [];
    let currentLine = "";

    for (const item of textContent.items) {
      if ("str" in item) {
        const textItem = item as { str: string; transform: number[] };
        const currentY = textItem.transform[5];

        if (lastY === null || Math.abs(currentY - lastY) < 4) {
          currentLine += (currentLine.length > 0 && !currentLine.endsWith(" ") ? " " : "") + textItem.str;
        } else {
          if (currentLine.trim()) {
            pageLines.push(currentLine.trim());
          }
          currentLine = textItem.str;
        }
        lastY = currentY;
      }
    }

    if (currentLine.trim()) {
      pageLines.push(currentLine.trim());
    }

    const pageString = pageLines.join("\n");
    pagesText.push(pageString);
    fullText += `\n--- Trang ${pageNum} ---\n` + pageString + "\n";
  }

  // Chạy qua bộ phân tích đa chiến lược ruleExtractor
  const result = parseRawExamText(fullText, {
    fileName: file.name,
    fileType: "pdf",
  });

  return {
    rawText: fullText,
    totalPages,
    pagesText,
    result,
    pdfDoc: pdf,
  };
}

/**
 * Render một trang PDF cụ thể ra thẻ HTML Canvas
 */
export async function renderPdfPageToCanvas(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale = 1.5
): Promise<void> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  canvas.height = viewport.height;
  canvas.width = viewport.width;

  const canvasContext = canvas.getContext("2d");
  if (!canvasContext) return;

  const renderContext = {
    canvasContext,
    viewport,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (page.render(renderContext as any).promise);
}
