import * as pdfjsLib from "pdfjs-dist";
import { parseRawExamText } from "./ruleExtractor";
import { cleanPdfExtractedText } from "./pdfCleaner";
import { hasYellowBackground } from "./pdfHighlightDetector";
import type { ExtractionResult } from "@/types/extractor";

// Configure PDF.js worker
if (typeof window !== "undefined") {
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
 * Tự động làm sạch watermark Studocu, header lặp lại, và nối liền các câu hỏi bị ngắt qua trang.
 */
export async function parsePdfFile(file: File): Promise<ParsedPdfDocument> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  const totalPages = pdf.numPages;
  const pagesText: string[] = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    // Preserve the original reading order but retain bounding boxes so that
    // visible yellow backgrounds can be matched to the source option.
    type TextLine = { text: string; x: number; y: number; width: number; height: number };
    const lines: TextLine[] = [];
    let current: TextLine | null = null;

    for (const item of textContent.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const x = item.transform[4];
      const y = item.transform[5];
      const height = Math.max(item.height || 0, Math.abs(item.transform[3]), 10);
      const width = Math.max(item.width || 0, 1);
      if (current && Math.abs(y - current.y) < 4) {
        current.text += (current.text.endsWith(" ") ? "" : " ") + item.str;
        current.width = Math.max(current.width, x + width - current.x);
        current.height = Math.max(current.height, height);
      } else {
        if (current?.text.trim()) lines.push(current);
        current = { text: item.str, x, y, width, height };
      }
    }
    if (current?.text.trim()) lines.push(current);

    // Rasterize ONLY pages with recognizable option labels. A PDF's yellow
    // highlights are often drawn rectangles, not text styles or annotations.
    const candidates = lines.filter(line =>
      /^\s*(?:(?:[a-d]\s*[.):\-])|(?:Đúng|Sai)\s*$)/iu.test(line.text)
    );
    const markedLines = new Set<TextLine>();
    if (candidates.length > 0 && typeof document !== "undefined") {
      const scale = 1.5;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context) {
        // PDF.js v6 requires the canvas as well as its rendering context.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await page.render({ canvas, canvasContext: context, viewport } as any).promise;
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        for (const line of candidates) {
          const rect = {
            x: line.x * scale,
            y: viewport.height - (line.y + line.height * 0.9) * scale,
            width: Math.min(Math.max(line.width, 38), 200) * scale,
            height: Math.max(line.height, 11) * scale,
          };
          if (hasYellowBackground(pixels, rect)) markedLines.add(line);
        }
      }
      canvas.width = 0;
      canvas.height = 0;
    }

    // Mark the precise text line; the existing ruleExtractor understands <mark>
    // for A-D and True/False options, and retains all non-highlighted text.
    pagesText.push(lines.map(line => {
      const text = line.text.trim();
      return markedLines.has(line) ? `<mark>${text}</mark>` : text;
    }).join("\n"));
  }

  // Làm sạch watermark, tiêu đề trang rác và ghép liền văn bản giữa các trang
  const cleanedText = cleanPdfExtractedText(pagesText);

  // Chạy qua bộ phân tích đa chiến lược ruleExtractor
  const result = parseRawExamText(cleanedText, {
    fileName: file.name,
    fileType: "pdf",
  });

  return {
    rawText: cleanedText,
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
