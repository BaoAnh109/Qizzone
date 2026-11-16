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
  redText: boolean;
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

function isRedPdfColor(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const hex = value.toLowerCase().replace(/\s/g, "");
  const match = hex.match(/^#([\da-f]{6})$/);
  if (!match) return hex === "#f00";
  const red = parseInt(match[1].slice(0, 2), 16);
  const green = parseInt(match[1].slice(2, 4), 16);
  const blue = parseInt(match[1].slice(4, 6), 16);
  return red >= 150 && green <= 110 && blue <= 110 && red > green * 1.4 && red > blue * 1.4;
}

function normalizePdfText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, "");
}

function mapRedTextRunsToItems(textItems: string[], redRuns: string[]): Set<number> {
  const flatText = textItems.map(normalizePdfText).join("");
  const itemByCharacter: number[] = [];
  textItems.forEach((item, itemIndex) => {
    const length = normalizePdfText(item).length;
    for (let characterIndex = 0; characterIndex < length; characterIndex += 1) itemByCharacter.push(itemIndex);
  });

  const redItems = new Set<number>();
  let searchOffset = 0;
  for (const rawRun of redRuns) {
    const run = normalizePdfText(rawRun);
    if (run.length < 2) continue;
    const start = flatText.indexOf(run, searchOffset);
    if (start < 0) continue;
    for (let index = start; index < start + run.length; index += 1) {
      const itemIndex = itemByCharacter[index];
      if (itemIndex !== undefined) redItems.add(itemIndex);
    }
    searchOffset = start + run.length;
  }
  return redItems;
}

export interface PdfPagePaintMarks {
  vectorHighlights: number[][];
  redTextItems: Set<number>;
  visualRegions: Array<{ bbox: [number, number, number, number]; type: "image" | "shape" }>;
}

type PdfMatrix = [number, number, number, number, number, number];
type PdfBounds = [number, number, number, number];

function multiplyPdfMatrix(left: PdfMatrix, right: number[]): PdfMatrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function transformedBounds(points: Array<[number, number]>, matrix: PdfMatrix): PdfBounds | undefined {
  if (!points.length) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    const transformedX = matrix[0] * x + matrix[2] * y + matrix[4];
    const transformedY = matrix[1] * x + matrix[3] * y + matrix[5];
    minX = Math.min(minX, transformedX);
    minY = Math.min(minY, transformedY);
    maxX = Math.max(maxX, transformedX);
    maxY = Math.max(maxY, transformedY);
  }
  return [minX, minY, maxX, maxY];
}

function mergeVisualRegions(
  imageBounds: PdfBounds[],
  pathBounds: PdfBounds[],
  pageArea: number,
): PdfPagePaintMarks["visualRegions"] {
  const regions: PdfPagePaintMarks["visualRegions"] = [];
  for (const bbox of imageBounds) {
    const width = bbox[2] - bbox[0];
    const height = bbox[3] - bbox[1];
    if (width >= 24 && height >= 24) regions.push({ bbox, type: "image" });
  }

  const paths = pathBounds.slice(0, 5000).filter(bbox => {
    const width = bbox[2] - bbox[0];
    const height = bbox[3] - bbox[1];
    return width >= 2 && height >= 2 && width * height <= pageArea * 0.35;
  });
  const cellSize = 64;
  const cells = new Map<string, { bbox: PdfBounds; hasStructuralPath: boolean }>();
  for (const path of paths) {
    const cellX = Math.floor((path[0] + path[2]) / 2 / cellSize);
    const cellY = Math.floor((path[1] + path[3]) / 2 / cellSize);
    const key = cellX + ":" + cellY;
    const existing = cells.get(key);
    const hasStructuralPath = path[2] - path[0] > 18 || path[3] - path[1] > 18;
    cells.set(key, existing ? {
      bbox: [Math.min(path[0], existing.bbox[0]), Math.min(path[1], existing.bbox[1]), Math.max(path[2], existing.bbox[2]), Math.max(path[3], existing.bbox[3])],
      hasStructuralPath: existing.hasStructuralPath || hasStructuralPath,
    } : { bbox: path, hasStructuralPath });
  }
  const clusters = [...cells.values()].sort((first, second) => first.bbox[0] - second.bbox[0] || first.bbox[1] - second.bbox[1]);
  for (let index = 0; index < clusters.length; index += 1) {
    const current = clusters[index];
    let mergedAgain = true;
    while (mergedAgain) {
      mergedAgain = false;
      for (let otherIndex = index + 1; otherIndex < clusters.length;) {
        const other = clusters[otherIndex];
        const gapX = Math.max(0, other.bbox[0] - current.bbox[2], current.bbox[0] - other.bbox[2]);
        const gapY = Math.max(0, other.bbox[1] - current.bbox[3], current.bbox[1] - other.bbox[3]);
        if (gapX > 38 || gapY > 28) { otherIndex += 1; continue; }
        current.bbox = [Math.min(current.bbox[0], other.bbox[0]), Math.min(current.bbox[1], other.bbox[1]), Math.max(current.bbox[2], other.bbox[2]), Math.max(current.bbox[3], other.bbox[3])];
        current.hasStructuralPath ||= other.hasStructuralPath;
        clusters.splice(otherIndex, 1);
        mergedAgain = true;
      }
    }
  }
  for (const cluster of clusters) {
    const { bbox } = cluster;
    const width = bbox[2] - bbox[0];
    const height = bbox[3] - bbox[1];
    if (!cluster.hasStructuralPath || width < 34 || height < 26 || width * height < 1100 || width * height > pageArea * 0.45) continue;
    if (regions.some(region => intersects(region.bbox, bbox) && region.type === "image")) continue;
    regions.push({ bbox, type: "shape" });
  }
  return regions;
}

export async function getPdfPagePaintMarks(page: PdfJsTypes.PDFPageProxy, textItems: string[]): Promise<PdfPagePaintMarks> {
  const operators = (pdfjsLib as unknown as { OPS?: Record<string, number> }).OPS;
  if (!operators) return { vectorHighlights: [], redTextItems: new Set(), visualRegions: [] };
  const allowedPaintOps = new Set([operators.fill, operators.eoFill, operators.fillStroke, operators.eoFillStroke]);
  const operatorList = await page.getOperatorList();
  const vectorHighlights: number[][] = [];
  const imageBounds: PdfBounds[] = [];
  const pathBounds: PdfBounds[] = [];
  const redRuns: string[] = [];
  let isYellowFill = false;
  let fillColor: unknown;
  let redTextRun = "";
  let transform: PdfMatrix = [1, 0, 0, 1, 0, 0];
  const fillStateStack: Array<{ isYellowFill: boolean; fillColor: unknown; transform: PdfMatrix }> = [];
  const flushRedTextRun = () => {
    if (redTextRun.trim()) redRuns.push(redTextRun);
    redTextRun = "";
  };

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const operator = operatorList.fnArray[index];
    const args = operatorList.argsArray[index] as unknown[] | null;
    if (operator === operators.save) {
      fillStateStack.push({ isYellowFill, fillColor, transform: [...transform] as PdfMatrix });
      continue;
    }
    if (operator === operators.restore) {
      const previous = fillStateStack.pop();
      if (previous && previous.fillColor !== fillColor) flushRedTextRun();
      isYellowFill = previous?.isYellowFill || false;
      fillColor = previous?.fillColor;
      if (previous) transform = previous.transform;
      continue;
    }
    if (operator === operators.transform && args?.length === 6 && args.every(value => typeof value === "number")) {
      transform = multiplyPdfMatrix(transform, args as number[]);
      continue;
    }
    if (operator === operators.setTransform && args?.length === 6 && args.every(value => typeof value === "number")) {
      transform = args as PdfMatrix;
      continue;
    }
    if ([operators.paintImageXObject, operators.paintInlineImageXObject, operators.paintImageMaskXObject].includes(operator)) {
      const imageBoundsForOperator = transformedBounds([[0, 0], [1, 1]], transform);
      if (imageBoundsForOperator) imageBounds.push(imageBoundsForOperator);
      continue;
    }
    if (operator === operators.setFillRGBColor) {
      if (args?.[0] !== fillColor) flushRedTextRun();
      fillColor = args?.[0];
      isYellowFill = isYellowPdfColor(args?.[0]);
      continue;
    }
    if ([operators.setFillColor, operators.setFillColorN, operators.setFillGray, operators.setFillCMYKColor].includes(operator)) {
      flushRedTextRun();
      fillColor = undefined;
      isYellowFill = false;
      continue;
    }
    if (operator === operators.showText || operator === operators.showSpacedText) {
      const glyphs = args?.[0];
      const glyphText = Array.isArray(glyphs)
        ? glyphs.map(glyph => glyph && typeof glyph === "object" && "unicode" in glyph && typeof glyph.unicode === "string" ? glyph.unicode : "").join("")
        : "";
      if (isRedPdfColor(fillColor)) redTextRun += glyphText;
      else flushRedTextRun();
      continue;
    }
    if (operator !== operators.constructPath || !args) continue;

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
        const visualBounds = transformedBounds(coordinates, transform);
        if (visualBounds && args[0] !== undefined) pathBounds.push(visualBounds);
        if (!isYellowFill || !allowedPaintOps.has(args[0] as number)) continue;
        vectorHighlights.push([
          Math.min(...coordinates.map(([x]) => x)),
          Math.min(...coordinates.map(([, y]) => y)),
          Math.max(...coordinates.map(([x]) => x)),
          Math.max(...coordinates.map(([, y]) => y)),
        ]);
      }
    }
  }
  flushRedTextRun();
  const pageWidth = Math.abs(page.view[2] - page.view[0]);
  const pageHeight = Math.abs(page.view[3] - page.view[1]);
  return {
    vectorHighlights,
    redTextItems: mapRedTextRunsToItems(textItems, redRuns),
    visualRegions: mergeVisualRegions(imageBounds, pathBounds, pageWidth * pageHeight),
  };
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
    if (html && record.redText) value = "<span class=\"text-color-red\">" + value + "</span>";
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
    const pagePaintMarks = await getPdfPagePaintMarks(page, content.items.flatMap(item => "str" in item && item.str.trim() ? [item.str] : []));
    const vectorHighlights = pagePaintMarks.vectorHighlights;
    markAreas.push(...vectorHighlights
      .filter(bbox => Math.abs((bbox[2] - bbox[0]) * (bbox[3] - bbox[1])) > 0 &&
        Math.abs((bbox[2] - bbox[0]) * (bbox[3] - bbox[1])) < pageArea * 0.1)
      .map(bbox => ({ bbox, kind: "highlight" as const })));

    const records: PdfTextRecord[] = [];
    const blocks: DocumentIRBlock[] = [];
    let readingOrder = 0;
    let textRecordIndex = 0;
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
      records.push({
        text: textItem.str,
        x,
        y,
        width,
        height,
        bbox,
        fontName: textItem.fontName || "",
        highlighted,
        underlined,
        redText: pagePaintMarks.redTextItems.has(textRecordIndex),
      });
      textRecordIndex += 1;
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
    for (const [visualIndex, visual] of pagePaintMarks.visualRegions.entries()) {
      blocks.push({
        id: "p" + pageNum + "_visual_" + visualIndex,
        type: visual.type,
        bbox: visual.bbox,
        readingOrder: readingOrder++,
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

function unionBounds(blocks: DocumentIRBlock[]): PdfBounds | undefined {
  const bounds = blocks.flatMap(block => block.bbox ? [block.bbox as PdfBounds] : []);
  if (!bounds.length) return undefined;
  return [
    Math.min(...bounds.map(box => box[0])),
    Math.min(...bounds.map(box => box[1])),
    Math.max(...bounds.map(box => box[2])),
    Math.max(...bounds.map(box => box[3])),
  ];
}

function expandBounds(bounds: PdfBounds, padding: number): PdfBounds {
  return [bounds[0] - padding, bounds[1] - padding, bounds[2] + padding, bounds[3] + padding];
}

export function getScannedPdfPromptBounds(
  question: ExtractionResult["questions"][number],
  pageNumber: number,
  textBlocksById: Map<string, DocumentIRBlock>,
  allQuestions: ExtractionResult["questions"],
  pageWidth: number,
  pageHeight: number,
): PdfBounds | undefined {
  const promptBlocks = (question.promptSourceRefs || []).flatMap(id => {
    const block = textBlocksById.get(id);
    return block?.sourceRef.page === pageNumber && block.bbox ? [block] : [];
  });
  const promptBounds = unionBounds(promptBlocks);
  if (!promptBounds) return undefined;

  const optionBounds = question.options.flatMap(option => (option.sourceRefs || []).flatMap(id => {
    const block = textBlocksById.get(id);
    return block?.sourceRef.page === pageNumber && block.bbox ? [block.bbox as PdfBounds] : [];
  }));
  const xPadding = Math.max(16, pageWidth * 0.06);
  const yPadding = Math.min(100, Math.max(24, pageHeight * 0.08));
  let top = promptBounds[3] + yPadding;
  let bottom = promptBounds[1] - yPadding;

  // Include the figure between the question wording and its first option, while
  // keeping the option text outside the prompt image.
  const nearestOptionTop = Math.max(...optionBounds
    .filter(bounds => bounds[3] <= promptBounds[1] + 12)
    .map(bounds => bounds[3]), -Infinity);
  if (Number.isFinite(nearestOptionTop) && promptBounds[1] - nearestOptionTop <= 240) {
    bottom = Math.min(bottom, nearestOptionTop + 7);
  }

  // Scanned charts often precede “Theo biểu đồ...”. Extend the crop upward only
  // as far as the previous question on this page, so adjacent questions do not leak in.
  const currentCenterY = (promptBounds[1] + promptBounds[3]) / 2;
  const previousQuestionBottoms = allQuestions
    .filter(candidate => candidate.id !== question.id)
    .flatMap(candidate => [...new Set([...(candidate.promptSourceRefs || []), ...(candidate.sourceRefs || [])])]
      .flatMap(id => {
        const block = textBlocksById.get(id);
        if (block?.sourceRef.page !== pageNumber || !block.bbox) return [];
        const bounds = block.bbox as PdfBounds;
        const horizontalGap = Math.max(0, promptBounds[0] - bounds[2], bounds[0] - promptBounds[2]);
        const centerY = (bounds[1] + bounds[3]) / 2;
        return centerY > currentCenterY && horizontalGap < 48 ? [bounds[1]] : [];
      }));
  if (previousQuestionBottoms.length) {
    top = Math.min(top, Math.min(...previousQuestionBottoms) - 7);
  }

  return [
    Math.max(0, promptBounds[0] - xPadding),
    Math.max(0, bottom),
    Math.min(pageWidth, promptBounds[2] + xPadding),
    Math.min(pageHeight, top),
  ];
}

function boundsDistance(first: PdfBounds, second: PdfBounds): number {
  const gapX = Math.max(0, first[0] - second[2], second[0] - first[2]);
  const gapY = Math.max(0, first[1] - second[3], second[1] - first[3]);
  return Math.hypot(gapX, gapY);
}

function removeLiteralText(source: string, text: string): string {
  const value = text.trim();
  if (value.length < 3) return source;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.replace(new RegExp(escaped, "giu"), " ").replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
}

async function renderPdfRegion(
  pdf: PdfJsTypes.PDFDocumentProxy,
  pageNumber: number,
  bounds: PdfBounds,
  pageCanvases: Map<number, { canvas: HTMLCanvasElement; viewport: PdfJsTypes.PageViewport }>,
  padding = 8,
): Promise<string | undefined> {
  if (typeof document === "undefined") return undefined;
  let rendered = pageCanvases.get(pageNumber);
  if (!rendered) {
    const page = await pdf.getPage(pageNumber);
    const maxSide = Math.max(page.view[2] - page.view[0], page.view[3] - page.view[1]);
    const scale = Math.min(1.8, 1800 / maxSide);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    await page.render({ canvasContext: context, viewport } as unknown as Parameters<typeof page.render>[0]).promise;
    rendered = { canvas, viewport };
    pageCanvases.set(pageNumber, rendered);
  }

  const padded = expandBounds(bounds, padding);
  const corners = [
    rendered.viewport.convertToViewportPoint(padded[0], padded[1]),
    rendered.viewport.convertToViewportPoint(padded[0], padded[3]),
    rendered.viewport.convertToViewportPoint(padded[2], padded[1]),
    rendered.viewport.convertToViewportPoint(padded[2], padded[3]),
  ];
  const xs = corners.map(point => point[0]);
  const ys = corners.map(point => point[1]);
  const left = Math.max(0, Math.floor(Math.min(...xs)));
  const top = Math.max(0, Math.floor(Math.min(...ys)));
  const right = Math.min(rendered.canvas.width, Math.ceil(Math.max(...xs)));
  const bottom = Math.min(rendered.canvas.height, Math.ceil(Math.max(...ys)));
  const cropWidth = right - left;
  const cropHeight = bottom - top;
  if (cropWidth < 16 || cropHeight < 16) return undefined;

  const maxDimension = 1400;
  const scale = Math.min(1, maxDimension / Math.max(cropWidth, cropHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cropWidth * scale));
  canvas.height = Math.max(1, Math.round(cropHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(rendered.canvas, left, top, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
  const image = canvas.toDataURL("image/jpeg", 0.82);
  if (image.length <= 900_000) return image;
  const compressed = canvas.toDataURL("image/jpeg", 0.65);
  return compressed.length <= 900_000 ? compressed : undefined;
}

/** Crops PDF charts, diagrams, and maps and links each crop to its question or answer option. */
export async function attachPdfVisualMediaToQuestions(
  result: ExtractionResult,
  pdf: PdfJsTypes.PDFDocumentProxy | undefined,
  documentIR: DocumentIR,
): Promise<ExtractionResult> {
  if (!pdf || typeof document === "undefined") return result;
  const textBlocksById = new Map(documentIR.pages.flatMap(page => page.blocks)
    .filter(block => block.type === "text_span" || block.type === "paragraph")
    .map(block => [block.id, block]));
  const visualBlocks = documentIR.pages.flatMap(page => page.blocks
    .filter(block => (block.type === "image" || block.type === "shape") && block.bbox)
    .map(block => ({ pageNumber: page.pageNumber, block })));
  const pageCanvases = new Map<number, { canvas: HTMLCanvasElement; viewport: PdfJsTypes.PageViewport }>();
  const mediaByQuestion = new Map<string, { images: string[]; optionImages: Map<string, string[]> }>();
  const cleanedPromptByQuestion = new Map<string, string>();
  const cleanedOptionsByQuestion = new Map<string, Map<string, string>>();
  const maxAssets = 80;
  let assetCount = 0;
  let mediaBytes = 0;

  for (const { pageNumber, block: visualBlock } of visualBlocks) {
    const visualBounds = visualBlock.bbox as PdfBounds;
    const pageIR = documentIR.pages.find(page => page.pageNumber === pageNumber);
    const pageArea = (pageIR?.width || 0) * (pageIR?.height || 0);
    const isScannedPageImage = visualBlock.type === "image" && pageArea > 0
      && ((visualBounds[2] - visualBounds[0]) * (visualBounds[3] - visualBounds[1])) / pageArea > 0.72;
    if (isScannedPageImage) {
      for (const question of result.questions) {
        if (assetCount >= maxAssets || mediaBytes >= 15_000_000) break;
        const pageWidth = pageIR?.width || 0;
        const pageHeight = pageIR?.height || 0;
        const promptBounds = getScannedPdfPromptBounds(question, pageNumber, textBlocksById, result.questions, pageWidth, pageHeight);
        if (!promptBounds || boundsDistance(promptBounds, visualBounds) > 40) continue;
        const image = await renderPdfRegion(pdf, pageNumber, promptBounds, pageCanvases);
        if (!image) continue;
        assetCount += 1;
        mediaBytes += image.length;
        const existing = mediaByQuestion.get(question.id) || { images: [], optionImages: new Map<string, string[]>() };
        existing.images.push(image);
        mediaByQuestion.set(question.id, existing);
      }
      continue;
    }
    const questionTargets = result.questions.flatMap(question => {
      const questionBlockIds = new Set([...(question.promptSourceRefs || []), ...(question.sourceRefs || [])]);
      const sourceBlocks = [...questionBlockIds].flatMap(id => {
        const sourceBlock = textBlocksById.get(id);
        return sourceBlock?.sourceRef.page === pageNumber && sourceBlock.bbox ? [sourceBlock] : [];
      });
      const questionBounds = unionBounds(sourceBlocks);
      if (!questionBounds || boundsDistance(questionBounds, visualBounds) > 40) return [];
      return [{ question, questionBounds, sourceBlocks }];
    }).sort((first, second) => boundsDistance(first.questionBounds, visualBounds) - boundsDistance(second.questionBounds, visualBounds));
    const target = questionTargets[0];
    if (!target || assetCount >= maxAssets || mediaBytes >= 15_000_000) continue;

    const image = await renderPdfRegion(pdf, pageNumber, visualBounds, pageCanvases, visualBlock.type === "shape" ? 18 : 8);
    if (!image) continue;
    assetCount += 1;
    mediaBytes += image.length;
    const existing = mediaByQuestion.get(target.question.id) || { images: [], optionImages: new Map<string, string[]>() };
    const optionTargets = target.question.options.flatMap(option => {
      const optionBlocks = (option.sourceRefs || []).flatMap(id => {
        const sourceBlock = textBlocksById.get(id);
        return sourceBlock?.sourceRef.page === pageNumber && sourceBlock.bbox ? [sourceBlock] : [];
      });
      const optionBounds = unionBounds(optionBlocks);
      if (!optionBounds || boundsDistance(optionBounds, visualBounds) > 18) return [];
      return [{ option, distance: boundsDistance(optionBounds, visualBounds) }];
    }).sort((first, second) => first.distance - second.distance);
    const textVisualBounds = expandBounds(visualBounds, visualBlock.type === "shape" ? 18 : 8);

    if (optionTargets[0]) {
      const optionId = optionTargets[0].option.id;
      const current = existing.optionImages.get(optionId) || [];
      current.push(image);
      existing.optionImages.set(optionId, current);
    } else {
      existing.images.push(image);
      let cleanPrompt = cleanedPromptByQuestion.get(target.question.id) || target.question.content;
      for (const blockId of target.question.promptSourceRefs || []) {
        const sourceBlock = textBlocksById.get(blockId);
        if (!sourceBlock?.bbox || sourceBlock.sourceRef.page !== pageNumber || !intersects(sourceBlock.bbox, textVisualBounds)) continue;
        cleanPrompt = removeLiteralText(cleanPrompt, sourceBlock.text || sourceBlock.normalizedText || "");
      }
      cleanedPromptByQuestion.set(target.question.id, cleanPrompt);
      const optionCleanup = cleanedOptionsByQuestion.get(target.question.id) || new Map<string, string>();
      for (const option of target.question.options) {
        let cleanOption = optionCleanup.get(option.id) || option.content;
        for (const blockId of option.sourceRefs || []) {
          const sourceBlock = textBlocksById.get(blockId);
          if (!sourceBlock?.bbox || sourceBlock.sourceRef.page !== pageNumber || !intersects(sourceBlock.bbox, textVisualBounds)) continue;
          cleanOption = removeLiteralText(cleanOption, sourceBlock.text || sourceBlock.normalizedText || "");
        }
        if (cleanOption !== option.content) optionCleanup.set(option.id, cleanOption);
      }
      cleanedOptionsByQuestion.set(target.question.id, optionCleanup);
    }
    mediaByQuestion.set(target.question.id, existing);
  }

  return {
    ...result,
    questions: result.questions.map(question => {
      const media = mediaByQuestion.get(question.id);
      if (!media) return question;
      return {
        ...question,
        content: cleanedPromptByQuestion.get(question.id) || question.content,
        images: media.images.length ? [...(question.images || []), ...media.images] : question.images,
        options: question.options.map(option => {
          const images = media.optionImages.get(option.id);
          const cleanedOption = cleanedOptionsByQuestion.get(question.id)?.get(option.id);
          return {
            ...option,
            ...(cleanedOption ? { content: cleanedOption } : {}),
            ...(images?.length ? { images: [...(option.images || []), ...images] } : {}),
          };
        }),
      };
    }),
  };
}
