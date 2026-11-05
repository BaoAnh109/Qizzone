import * as pdfjsLib from "pdfjs-dist";
import { parseRawExamText } from "./ruleExtractor";
import { cleanPdfPages } from "./pdfCleaner";
import type { ExtractedQuestion, ExtractionResult } from "@/types/extractor";

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
  /**
   * Bước 15: false khi không trang nào có text layer (PDF scan/chỉ có
   * ảnh) — parser không bịa text, câu hỏi trả về rỗng và Quality Gate
   * báo failed/no_questions; OCR thật thuộc bước 16.
   */
  hasTextLayer: boolean;
  /**
   * Bước 16: số trang (1-based) không có text item nào — tức trang scan,
   * cần OCR. Rỗng = mọi trang đều có text layer. Dùng để routing OCR
   * (ocr.ts) và báo số trang lỗi/thiếu, kể cả tài liệu xen text/scan.
   */
  scanPages: number[];
}

/**
 * Bước 15 (PLAN_MAIN): thứ tự đọc text layer của một trang PDF.
 *
 * Vấn đề cũ: gom dòng chỉ theo tọa độ Y theo thứ tự item của pdfjs nên
 * PDF 2 cột bị đọc ngang hàng, trộn cột (chỉ đúng tình cờ khi content
 * stream đã xếp theo cột). Cách mới, hàm thuần, test được:
 *
 * 1. Gom item thành dòng theo Y (ngưỡng |Δy| < 4 như trước), trong dòng
 *    xếp theo X tăng dần. Tọa độ pdfjs: y là baseline, GIẢM dần từ trên
 *    xuống dưới trang nên thứ tự trên→dưới là y giảm dần.
 * 2. Phát hiện cột từ cụm điểm bắt đầu dòng (minX): các minX liên tiếp
 *    cách nhau > 30pt thì tách cụm (indent thường < 30pt, khe cột
 *    thường lớn hơn nhiều). Chỉ tin là đa cột khi MỌI cặp cụm kề nhau
 *    thỏa: mỗi cụm >= 2 dòng; khe (minX cụm sau − maxX lớn nhất của
 *    các dòng không vượt khe ở cụm trước) >= 10pt; khoảng Y của hai cụm
 *    chồng nhau >= 50% khoảng ngắn hơn (hai cột phải nằm cạnh nhau,
 *    không phải tiêu đề căn giữa + thân bài). Không thỏa → đọc 1 cột
 *    theo Y như cũ, không đoán cột.
 * 3. Dòng vượt khe (minX ở cụm trước nhưng maxX chạm tới minX cụm sau)
 *    là dòng toàn chiều rộng (tiêu đề, header): phát ra đúng vị trí Y
 *    của nó, xen giữa các khối cột, thay vì bị ép vào một cột.
 * 4. Cột không đều vẫn đúng: số dòng mỗi cụm không cần bằng nhau, chỉ
 *    cần mỗi cụm >= 2 dòng; cột chỉ có 1 dòng thì rơi về đọc 1 cột
 *    (an toàn hơn đoán sai).
 */
export interface PdfTextItem {
  str: string;
  transform: number[];
  width?: number;
}

interface PdfLine {
  text: string;
  minX: number;
  maxX: number;
  y: number;
}

function itemWidth(item: PdfTextItem): number {
  if (typeof item.width === "number" && isFinite(item.width)) return item.width;
  const fontSize = item.transform && isFinite(item.transform[0]) ? Math.abs(item.transform[0]) : 12;
  return item.str.length * fontSize * 0.5;
}

function groupItemsIntoLines(items: PdfTextItem[]): PdfLine[] {
  const usable = items.filter((it) => it && typeof it.str === "string" && it.str.trim() !== "" && it.transform);
  // Trên→dưới: y giảm dần; cùng Y thì X tăng dần.
  const sorted = [...usable].sort((a, b) => {
    const dy = b.transform[5] - a.transform[5];
    if (dy !== 0) return dy;
    return a.transform[4] - b.transform[4];
  });
  // Lượt 1: gom thành band theo Y (ngưỡng |Δy| < 4 như trước).
  const bands: { items: PdfTextItem[]; y: number }[] = [];
  for (const it of sorted) {
    const y = it.transform[5];
    const last = bands[bands.length - 1];
    if (last && Math.abs(y - last.y) < 4) last.items.push(it);
    else bands.push({ items: [it], y });
  }
  // Lượt 2: trong mỗi band, tách segment tại khe X lớn. Hai cột cùng Y
  // (vd f09: cột trái kết thúc x≈300, cột phải bắt đầu x=320) phải thành
  // hai dòng riêng — nếu không, cột phải sẽ bị nối đuôi cột trái. Ngưỡng
  // khe = max(15pt, 1.2 × cỡ chữ): khe giữa các từ trong dòng thường chỉ
  // vài pt, khe cột thì lớn hơn nhiều. Dòng bị tách oan (vd khoảng trống
  // lớn trong dòng) vẫn nằm kề nhau sau bước xếp cột nên ít hại.
  const lines: PdfLine[] = [];
  for (const band of bands) {
    const byX = [...band.items].sort((a, b) => a.transform[4] - b.transform[4]);
    const fontSizes = byX
      .map((it) => (isFinite(it.transform[0]) ? Math.abs(it.transform[0]) : 0))
      .filter((s) => s > 0)
      .sort((a, b) => a - b);
    const medianFont = fontSizes.length > 0 ? fontSizes[Math.floor(fontSizes.length / 2)] : 12;
    const gapThreshold = Math.max(15, 1.2 * medianFont);
    let current: PdfTextItem[] = [];
    const flushSegment = () => {
      if (current.length === 0) return;
      let text = "";
      for (const it of current) {
        text += (text.length > 0 && !text.endsWith(" ") ? " " : "") + it.str;
      }
      const minX = Math.min(...current.map((it) => it.transform[4]));
      const maxX = Math.max(...current.map((it) => it.transform[4] + itemWidth(it)));
      lines.push({ text: text.trim(), minX, maxX, y: band.y });
      current = [];
    };
    for (const it of byX) {
      if (current.length > 0) {
        const prevEnd = Math.max(...current.map((c) => c.transform[4] + itemWidth(c)));
        if (it.transform[4] - prevEnd > gapThreshold) flushSegment();
      }
      current.push(it);
    }
    flushSegment();
  }
  return lines.filter((l) => l.text !== "");
}

/** Sắp xếp các dòng của một trang thành thứ tự đọc (đã xử lý đa cột). */
export function orderPageLines(items: PdfTextItem[]): string[] {
  const lines = groupItemsIntoLines(items);
  if (lines.length === 0) return [];

  // Cụm điểm bắt đầu dòng: minX liên tiếp cách nhau > 30pt thì tách cụm.
  const starts = [...new Set(lines.map((l) => l.minX))].sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const s of starts) {
    const last = clusters[clusters.length - 1];
    if (last && s - last[last.length - 1] <= 30) last.push(s);
    else clusters.push([s]);
  }
  if (clusters.length < 2) return lines.map((l) => l.text);

  const clusterOf = (line: PdfLine): number => {
    for (let i = 0; i < clusters.length; i++) {
      if (clusters[i].includes(line.minX)) return i;
    }
    return 0;
  };
  const clusterMinStart = clusters.map((c) => c[0]);
  // Dòng toàn chiều rộng: chạm tới minX của cụm sau.
  const isFullWidth = (line: PdfLine): boolean => {
    const ci = clusterOf(line);
    return ci < clusters.length - 1 && line.maxX >= clusterMinStart[ci + 1];
  };

  // Kiểm chứng đa cột cho mọi cặp cụm kề nhau; một cặp không đạt thì
  // toàn trang đọc 1 cột (an toàn hơn đoán cột sai).
  for (let i = 0; i < clusters.length - 1; i++) {
    const leftLines = lines.filter((l) => clusterOf(l) === i);
    const rightLines = lines.filter((l) => clusterOf(l) === i + 1);
    if (leftLines.length < 2 || rightLines.length < 2) return lines.map((l) => l.text);
    const nonCrossing = leftLines.filter((l) => !isFullWidth(l));
    if (nonCrossing.length < 2) return lines.map((l) => l.text);
    const gutter = clusterMinStart[i + 1] - Math.max(...nonCrossing.map((l) => l.maxX));
    if (gutter < 10) return lines.map((l) => l.text);
    const leftSpan: [number, number] = [
      Math.min(...leftLines.map((l) => l.y)),
      Math.max(...leftLines.map((l) => l.y)),
    ];
    const rightSpan: [number, number] = [
      Math.min(...rightLines.map((l) => l.y)),
      Math.max(...rightLines.map((l) => l.y)),
    ];
    const overlap = Math.min(leftSpan[1], rightSpan[1]) - Math.max(leftSpan[0], rightSpan[0]);
    const shorter = Math.min(leftSpan[1] - leftSpan[0], rightSpan[1] - rightSpan[0]);
    if (shorter <= 0 || overlap < 0.5 * shorter) return lines.map((l) => l.text);
  }

  // Thứ tự đọc: duyệt theo Y giảm dần; gặp dòng toàn chiều rộng thì xả
  // khối cột đang gom (xếp theo cột rồi Y) rồi phát dòng đó ngay vị trí Y.
  const ordered: string[] = [];
  let block: PdfLine[] = [];
  const flushBlock = () => {
    block
      .sort((a, b) => {
        const dc = clusterOf(a) - clusterOf(b);
        if (dc !== 0) return dc;
        const dy = b.y - a.y;
        if (dy !== 0) return dy;
        return a.minX - b.minX;
      })
      .forEach((l) => ordered.push(l.text));
    block = [];
  };
  // lines đã ở thứ tự Y giảm dần (cùng Y thì X tăng dần nhờ group).
  for (const line of lines) {
    if (isFullWidth(line)) {
      flushBlock();
      ordered.push(line.text);
    } else {
      block.push(line);
    }
  }
  flushBlock();
  return ordered;
}

/** Chuẩn hóa để khớp stem với trang: NFC + thường + chỉ giữ chữ/số. */
function normText(s: string): string {
  return (s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Tìm trang (1-based) chứa câu hỏi: trang đầu tiên mà text đã làm sạch
 * chứa 40 ký tự chữ/số đầu của stem (fallback: đoạn text gốc của câu).
 * Không khớp → undefined (không đoán trang). Câu ngắt qua trang thì lấy
 * trang đầu tiên chứa stem — đúng trang bắt đầu của câu.
 */
export function findQuestionPage(
  question: Pick<ExtractedQuestion, "content" | "rawTextSegment">,
  cleanedPages: string[]
): number | undefined {
  const normPages = cleanedPages.map(normText);
  for (const candidate of [question.content, question.rawTextSegment]) {
    const needle = normText(candidate).slice(0, 40);
    if (needle.length < 10) continue;
    for (let i = 0; i < normPages.length; i++) {
      if (normPages[i].includes(needle)) return i + 1;
    }
  }
  return undefined;
}

/** Gắn `page` cho các câu hỏi PDF từ text từng trang đã làm sạch. */
export function assignQuestionPages(
  questions: ExtractedQuestion[],
  cleanedPages: string[]
): ExtractedQuestion[] {
  return questions.map((q) => {
    const page = findQuestionPage(q, cleanedPages);
    return page === undefined ? q : { ...q, page };
  });
}

/**
 * Trích xuất toàn bộ văn bản và các trang từ tệp PDF thật
 * Tự động làm sạch watermark Studocu, header lặp lại, và nối liền các câu hỏi bị ngắt qua trang.
 * Bước 15: thứ tự đọc 2 cột đúng (orderPageLines), mỗi câu hỏi mang số
 * trang thật (page), header/footer lặp theo vị trí được gỡ (cleanPdfPages).
 */
export async function parsePdfFile(file: File): Promise<ParsedPdfDocument> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  const totalPages = pdf.numPages;
  const pagesText: string[] = [];
  let hasTextLayer = false;
  const scanPages: number[] = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items = (textContent.items as PdfTextItem[]).filter(
      (item) => item && typeof (item as PdfTextItem).str === "string"
    );
    if (items.some((it) => it.str.trim() !== "")) hasTextLayer = true;
    else scanPages.push(pageNum);
    pagesText.push(orderPageLines(items).join("\n"));
  }

  // Làm sạch watermark, tiêu đề trang rác và ghép liền văn bản giữa các trang
  const cleanedPages = cleanPdfPages(pagesText);
  const cleanedText = cleanedPages.filter((p) => p.length > 0).join("\n\n");

  // Chạy qua bộ phân tích đa chiến lược ruleExtractor
  const parsed = parseRawExamText(cleanedText, {
    fileName: file.name,
    fileType: "pdf",
  });
  const result: ExtractionResult = {
    ...parsed,
    questions: assignQuestionPages(parsed.questions, cleanedPages),
  };

  return {
    rawText: cleanedText,
    totalPages,
    pagesText,
    result,
    pdfDoc: pdf,
    hasTextLayer,
    scanPages,
  };
}

/**
 * Bước 16: render một trang PDF ra Blob ảnh (PNG) để đưa vào engine OCR.
 * Chỉ chạy ở browser (cần DOM Canvas); ở Node throw lỗi rõ ràng thay vì
 * trả Blob giả. Scale mặc định 2.0 — OCR cần ảnh nét hơn preview 1.5.
 */
export async function renderPdfPageToImageBlob(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  scale = 2.0
): Promise<Blob> {
  if (typeof document === "undefined") {
    throw new Error(
      "renderPdfPageToImageBlob chỉ chạy ở browser (cần DOM Canvas)."
    );
  }
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.height = viewport.height;
  canvas.width = viewport.width;
  const canvasContext = canvas.getContext("2d");
  if (!canvasContext) {
    throw new Error("Không tạo được canvas context để render trang PDF.");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (page.render({ canvasContext, viewport } as any).promise);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png")
  );
  if (!blob) {
    throw new Error("Render trang PDF ra ảnh thất bại (toBlob trả null).");
  }
  return blob;
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
