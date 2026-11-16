import * as pdfjsLib from "pdfjs-dist";
import type * as PdfJsTypes from "pdfjs-dist";
import { parseRawExamText } from "./ruleExtractor";
import { cleanPdfExtractedText } from "./pdfCleaner";
import { MAX_OCR_PAGES_PER_IMPORT, recognizeOcrPages, type OcrPageResult } from "./ocrService";
import type { ExtractionResult } from "@/types/extractor";
import type { DocumentIR, DocumentIRBlock, DocumentIRPage, DocumentIRStyle } from "@/types/documentIR";
import { attachQuestionSourceReferences } from "./sourceReference";

if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" + pdfjsLib.version + "/pdf.worker.min.mjs";
}

export interface ParsedPdfDocument {
  rawText: string;
  totalPages: number;
  pagesText: string[];
  result: ExtractionResult;
  pdfDoc?: PdfJsTypes.PDFDocumentProxy;
  documentIR: DocumentIR;
  ocrPageCount: number;
  qualityFlags: string[];
}

interface PdfTextRecord {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  bbox: [number, number, number, number];
  fontName: string;
  highlighted: boolean;
  underlined: boolean;
}

interface PdfAnnotationLike {
  annotationType?: number;
  rect?: number[];
  quadPoints?: number[];
  contents?: string;
  id?: string;
}

interface PdfMarkArea {
  bbox: number[];
  kind: "highlight" | "underline";
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function intersects(a: number[], b: number[]): boolean {
  return a.length >= 4 && b.length >= 4 && a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

function annotationBounds(annotation: PdfAnnotationLike): number[] | undefined {
  if (annotation.quadPoints && annotation.quadPoints.length >= 8) {
    const xs = annotation.quadPoints.filter((_value, index) => index % 2 === 0);
    const ys = annotation.quadPoints.filter((_value, index) => index % 2 === 1);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  return annotation.rect && annotation.rect.length >= 4 ? annotation.rect : undefined;
}

function isHighlightAnnotation(annotation: PdfAnnotationLike): boolean {
  const annotationTypes = (pdfjsLib as unknown as { AnnotationType?: { HIGHLIGHT?: number } }).AnnotationType;
  return annotation.annotationType === (annotationTypes?.HIGHLIGHT ?? 9);
}

function isUnderlineAnnotation(annotation: PdfAnnotationLike): boolean {
  const annotationTypes = (pdfjsLib as unknown as { AnnotationType?: { UNDERLINE?: number } }).AnnotationType;
  return annotation.annotationType === (annotationTypes?.UNDERLINE ?? 10);
}

function isYellowPdfColor(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.toLowerCase().replace(/\s/g, "");
  return normalized === "#ffff00" || normalized === "#ff0" || normalized === "rgb(255,255,0)";
}

async function getYellowVectorHighlightBounds(page: PdfJsTypes.PDFPageProxy): Promise<number[][]> {
  const operators = (pdfjsLib as unknown as { OPS?: Record<string, number> }).OPS;
  if (!operators) return [];
  const allowedPaintOps = new Set([operators.fill, operators.eoFill, operators.fillStroke, operators.eoFillStroke]);
  const operatorList = await page.getOperatorList();
  const bounds: number[][] = [];
  let isYellowFill = false;
  const fillStateStack: boolean[] = [];

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const operator = operatorList.fnArray[index];
    const args = operatorList.argsArray[index] as unknown[] | null;
    if (operator === operators.save) {
      fillStateStack.push(isYellowFill);
      continue;
    }
    if (operator === operators.restore) {
      isYellowFill = fillStateStack.pop() || false;
      continue;
    }
    if (operator === operators.setFillRGBColor) {
      isYellowFill = isYellowPdfColor(args?.[0]);
      continue;
    }
    if ([operators.setFillColor, operators.setFillColorN, operators.setFillGray, operators.setFillCMYKColor].includes(operator)) {
      isYellowFill = false;
      continue;
    }
    if (operator !== operators.constructPath || !isYellowFill || !args || !allowedPaintOps.has(args[0] as number)) continue;

    const pathSegments = args[1];
    if (!Array.isArray(pathSegments)) continue;
    for (const rawSegment of pathSegments) {
      if (!ArrayBuffer.isView(rawSegment) && !Array.isArray(rawSegment)) continue;
      const segment = Array.from(rawSegment as ArrayLike<number>);
      const coordinates: Array<[number, number]> = [];
      for (let cursor = 0; cursor < segment.length;) {
        const pathOperation = segment[cursor++];
        if (pathOperation === 0 || pathOperation === 1) { // moveTo / lineTo
          if (cursor + 1 >= segment.length) break;
          coordinates.push([segment[cursor], segment[cursor + 1]]);
          cursor += 2;
        } else if (pathOperation === 2) { // curveTo: two control points and endpoint
          if (cursor + 5 >= segment.length) break;
          coordinates.push([segment[cursor], segment[cursor + 1]], [segment[cursor + 2], segment[cursor + 3]], [segment[cursor + 4], segment[cursor + 5]]);
          cursor += 6;
        } else if (pathOperation === 3) { // quadraticCurveTo: control point and endpoint
          if (cursor + 3 >= segment.length) break;
          coordinates.push([segment[cursor], segment[cursor + 1]], [segment[cursor + 2], segment[cursor + 3]]);
          cursor += 4;
        }
      }
      if (coordinates.length >= 2) {
        bounds.push([
          Math.min(...coordinates.map(([x]) => x)),
          Math.min(...coordinates.map(([, y]) => y)),
          Math.max(...coordinates.map(([x]) => x)),
          Math.max(...coordinates.map(([, y]) => y)),
        ]);
      }
    }
  }
  return bounds;
}

function lineGroups(records: PdfTextRecord[], pageWidth: number): PdfTextRecord[][] {
  const ordered = [...records].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PdfTextRecord[][] = [];
  for (const record of ordered) {
    const current = rows[rows.length - 1];
    if (current && Math.abs(current[0].y - record.y) <= Math.max(3, record.height * 0.35)) current.push(record);
    else rows.push([record]);
  }
  for (const row of rows) row.sort((a, b) => a.x - b.x);

  const xPositions = records.map(record => record.x).sort((a, b) => a - b);
  let splitAt: number | undefined;
  let largestGap = pageWidth * 0.16;
  for (let index = 1; index < xPositions.length; index += 1) {
    const gap = xPositions[index] - xPositions[index - 1];
    if (gap > largestGap && xPositions[index - 1] < pageWidth * 0.44 && xPositions[index] > pageWidth * 0.56) {
      largestGap = gap;
      splitAt = (xPositions[index - 1] + xPositions[index]) / 2;
    }
  }
  if (splitAt === undefined) return rows;

  const left = records.filter(record => record.x < splitAt);
  const right = records.filter(record => record.x >= splitAt);
  if (left.length < 5 || right.length < 5) return rows;
  const makeColumnRows = (column: PdfTextRecord[]) => {
    const groups: PdfTextRecord[][] = [];
    for (const record of [...column].sort((a, b) => b.y - a.y || a.x - b.x)) {
      const current = groups[groups.length - 1];
      if (current && Math.abs(current[0].y - record.y) <= Math.max(3, record.height * 0.35)) current.push(record);
      else groups.push([record]);
    }
    groups.forEach(group => group.sort((a, b) => a.x - b.x));
    return groups;
  };
  return [...makeColumnRows(left), ...makeColumnRows(right)];
}

function joinRecords(records: PdfTextRecord[], html: boolean): string {
  let result = "";
  let previous: PdfTextRecord | undefined;
  for (const record of records) {
    const gap = previous ? record.x - (previous.x + previous.width) : 0;
    const separator = previous && gap > Math.max(1.5, previous.height * 0.12) &&
      !result.endsWith(" ") && !record.text.startsWith(" ") ? " " : "";
    let value = html ? escapeHtml(record.text) : record.text;
    if (html && record.highlighted) value = "<mark class=\"is-highlighted\">" + value + "</mark>";
    else if (html && record.underlined) value = "<u>" + value + "</u>";
    else if (html && /bold|demi|semibold/i.test(record.fontName)) value = "<strong class=\"is-bold\">" + value + "</strong>";
    result += separator + value;
    previous = record;
  }
  return result.trim();
}

function plainTextPageRecords(records: PdfTextRecord[], pageWidth: number): {
  plain: string;
  styled: string;
  lines: Array<{ text: string; bbox: [number, number, number, number]; bold: boolean; highlighted: boolean; underlined: boolean }>;
} {
  const rows = lineGroups(records, pageWidth);
  return {
    plain: rows.map(row => joinRecords(row, false)).filter(Boolean).join("\n"),
    styled: rows.map(row => joinRecords(row, true)).filter(Boolean).join("\n"),
    lines: rows.map(row => ({
      text: joinRecords(row, false),
      bbox: [Math.min(...row.map(record => record.bbox[0])), Math.min(...row.map(record => record.bbox[1])), Math.max(...row.map(record => record.bbox[2])), Math.max(...row.map(record => record.bbox[3]))] as [number, number, number, number],
      bold: row.some(record => /bold|demi|semibold/i.test(record.fontName)),
      highlighted: row.some(record => record.highlighted),
      underlined: row.some(record => record.underlined),
    })).filter(line => line.text.trim()),
  };
}

function isLikelyScan(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 40) return true;
  const nullCharacter = String.fromCharCode(0);
  const suspicious = [...trimmed].filter(character => character === "\uFFFD" || character === nullCharacter).length;
  return suspicious / trimmed.length > 0.04;
}

async function sha256(data: ArrayBuffer): Promise<string | undefined> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return undefined;
  }
}

export async function parsePdfFile(
  file: File,
  onProgress?: (percent: number, message: string) => void,
): Promise<ParsedPdfDocument> {
  const arrayBuffer = await file.arrayBuffer();
  if (!new Uint8Array(arrayBuffer).subarray(0, 5).every((byte, index) => byte === [37, 80, 68, 70, 45][index])) {
    throw new Error("Tệp không có chữ ký PDF hợp lệ.");
  }
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, useSystemFonts: true });
  const pdf = await loadingTask.promise;
  if (pdf.numPages > 100) {
    await loadingTask.destroy();
    throw new Error("PDF vượt quá giới hạn 100 trang.");
  }

  const pagesText: string[] = [];
  const styledPages: string[] = [];
  const irPages: DocumentIRPage[] = [];
  const scanPageNumbers: number[] = [];
  const qualityFlags: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const pageWidth = page.view[2] - page.view[0];
    const pageHeight = page.view[3] - page.view[1];
    const content = await page.getTextContent();
    const annotations = await page.getAnnotations({ intent: "display" }) as PdfAnnotationLike[];
    const markAreas: PdfMarkArea[] = annotations.flatMap(annotation => {
      const bbox = annotationBounds(annotation);
      if (!bbox || (!isHighlightAnnotation(annotation) && !isUnderlineAnnotation(annotation))) return [];
      return [{ kind: isHighlightAnnotation(annotation) ? "highlight" as const : "underline" as const, bbox }];
    });
    const pageArea = Math.abs(pageWidth * pageHeight);
    const vectorHighlights = await getYellowVectorHighlightBounds(page);
    markAreas.push(...vectorHighlights
      .filter(bbox => Math.abs((bbox[2] - bbox[0]) * (bbox[3] - bbox[1])) > 0 &&
        Math.abs((bbox[2] - bbox[0]) * (bbox[3] - bbox[1])) < pageArea * 0.1)
      .map(bbox => ({ bbox, kind: "highlight" as const })));

    const records: PdfTextRecord[] = [];
    const blocks: DocumentIRBlock[] = [];
    let readingOrder = 0;
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const textItem = item as { str: string; transform: number[]; width: number; height: number; fontName: string };
      const x = textItem.transform[4] || 0;
      const y = textItem.transform[5] || 0;
      const width = Math.max(0, textItem.width || 0);
      const height = Math.max(1, textItem.height || Math.abs(textItem.transform[3]) || 1);
      // PDF text matrices use the text baseline as origin and glyphs rise above
      // it; extending the box below the baseline shifts highlight matching to
      // the adjacent option line in many PDFs.
      const bbox: [number, number, number, number] = [x, y - height * 0.2, x + width, y + height * 0.9];
      const matchedAreas = markAreas.filter(record => intersects(bbox, record.bbox));
      const highlighted = matchedAreas.some(record => record.kind === "highlight");
      const underlined = matchedAreas.some(record => record.kind === "underline");
      records.push({ text: textItem.str, x, y, width, height, bbox, fontName: textItem.fontName || "", highlighted, underlined });
      const style: DocumentIRStyle = {};
      if (/bold|demi|semibold/i.test(textItem.fontName || "")) style.bold = true;
      if (highlighted) style.highlight = "pdf_annotation";
      if (underlined) style.underline = true;
      blocks.push({
        id: "p" + pageNum + "_b" + readingOrder,
        type: "text_span",
        text: textItem.str,
        normalizedText: textItem.str.normalize("NFKC"),
        bbox,
        readingOrder,
        style,
        sourceRef: { page: pageNum, run: readingOrder },
      });
      readingOrder += 1;
    }
    for (const record of markAreas) {
      blocks.push({
        id: "p" + pageNum + "_annotation_" + blocks.length,
        type: "annotation",
        bbox: record.bbox as [number, number, number, number],
        readingOrder: readingOrder++,
        style: record.kind === "highlight" ? { highlight: "pdf_annotation" } : { underline: true },
        sourceRef: { page: pageNum },
      });
    }

    const pageData = plainTextPageRecords(records, pageWidth);
    blocks.push(...pageData.lines.map((line, index) => ({
      id: "p" + pageNum + "_line" + index,
      type: "paragraph" as const,
      text: line.text,
      normalizedText: line.text.normalize("NFKC"),
      bbox: line.bbox,
      readingOrder: readingOrder + index,
      style: {
        bold: line.bold || undefined,
        highlight: line.highlighted ? "pdf_annotation" : undefined,
        underline: line.underlined || undefined,
      },
      sourceRef: { page: pageNum },
    })));
    pagesText.push(pageData.plain);
    styledPages.push(pageData.styled);
    if (isLikelyScan(pageData.plain)) scanPageNumbers.push(pageNum);
    irPages.push({ pageNumber: pageNum, width: pageWidth, height: pageHeight, blocks });
    onProgress?.(Math.round((pageNum / pdf.numPages) * 35), "Đang đọc lớp văn bản và bố cục PDF...");
  }

  const ocrPages: OcrPageResult[] = [];
  if (scanPageNumbers.length) {
    const selectedPages = scanPageNumbers.slice(0, MAX_OCR_PAGES_PER_IMPORT);
    if (scanPageNumbers.length > MAX_OCR_PAGES_PER_IMPORT) qualityFlags.push("ocr_page_limit_exceeded");
    if (typeof document === "undefined") {
      qualityFlags.push("ocr_requires_browser_runtime");
    } else {
      const inputs = [];
      const renderSizes = new Map<number, { width: number; height: number }>();
      for (const pageNumber of selectedPages) {
        const page = await pdf.getPage(pageNumber);
        const viewportScale = Math.min(2, 2200 / Math.max(page.view[2] - page.view[0], page.view[3] - page.view[1]));
        const canvas = document.createElement("canvas");
        await renderPdfPageToCanvas(pdf, pageNumber, canvas, Math.max(1.25, viewportScale));
        inputs.push({ pageNumber, image: canvas });
        renderSizes.set(pageNumber, { width: canvas.width, height: canvas.height });
      }
      try {
        ocrPages.push(...await recognizeOcrPages(inputs, (percent, message) => onProgress?.(35 + Math.round(percent * 0.55), message)));
        for (const ocrPage of ocrPages) {
          const pageIndex = ocrPage.pageNumber - 1;
          pagesText[pageIndex] = ocrPage.text;
          styledPages[pageIndex] = ocrPage.text;
          if (ocrPage.confidence < 0.72) qualityFlags.push("ocr_low_confidence_page_" + ocrPage.pageNumber);
          const pageIR = irPages[pageIndex];
          const page = await pdf.getPage(ocrPage.pageNumber);
          const renderSize = renderSizes.get(ocrPage.pageNumber);
          const width = page.view[2] - page.view[0];
          const height = page.view[3] - page.view[1];
          const renderWidth = renderSize?.width || width;
          const renderHeight = renderSize?.height || height;
          pageIR.blocks.push(...ocrPage.regions.map((region, index) => ({
            id: "p" + ocrPage.pageNumber + "_ocr_" + index,
            type: "text_span" as const,
            text: region.text,
            normalizedText: region.text.normalize("NFKC"),
            bbox: [
              page.view[0] + (region.bbox[0] / renderWidth) * width,
              page.view[3] - (region.bbox[3] / renderHeight) * height,
              page.view[0] + (region.bbox[2] / renderWidth) * width,
              page.view[3] - (region.bbox[1] / renderHeight) * height,
            ] as [number, number, number, number],
            readingOrder: pageIR.blocks.length + index,
            sourceRef: { page: ocrPage.pageNumber },
          })));
        }
      } catch {
        qualityFlags.push("ocr_failed");
      }
    }
  }
  if (scanPageNumbers.length > ocrPages.length) qualityFlags.push("scan_pages_unprocessed");

  const cleanedText = cleanPdfExtractedText(pagesText);
  const cleanedStyledText = cleanPdfExtractedText(styledPages);
  const sourceHash = await sha256(arrayBuffer);
  let result = parseRawExamText(cleanedStyledText, {
    fileName: file.name,
    fileType: "pdf",
  });
  result = attachQuestionSourceReferences(result, {
    schemaVersion: "2.0",
    sourceFormat: "pdf",
    sourceHash,
    parserVersion: "qizzone-pdf-v2",
    pages: irPages,
    warnings: qualityFlags,
  });
  result.fileSize = file.size;
  result.extractionMethod = ocrPages.length ? "ocr" : "native_parser";
  result.sourceHash = sourceHash;
  result.qualityFlags = [...new Set([...(result.qualityFlags || []), ...qualityFlags])];
  result.warningsCount += qualityFlags.length;
  onProgress?.(100, "Đã đọc xong tài liệu PDF.");

  return {
    rawText: cleanedText,
    totalPages: pdf.numPages,
    pagesText,
    result,
    pdfDoc: pdf,
    documentIR: {
      schemaVersion: "2.0",
      sourceFormat: "pdf",
      sourceHash,
      parserVersion: "qizzone-pdf-v2",
      pages: irPages,
      warnings: qualityFlags,
    },
    ocrPageCount: ocrPages.length,
    qualityFlags,
  };
}

export async function renderPdfPageToCanvas(
  pdf: PdfJsTypes.PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale = 1.5,
): Promise<void> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  canvas.height = viewport.height;
  canvas.width = viewport.width;
  const canvasContext = canvas.getContext("2d");
  if (!canvasContext) return;
  await page.render({ canvasContext, viewport } as unknown as Parameters<typeof page.render>[0]).promise;
}
