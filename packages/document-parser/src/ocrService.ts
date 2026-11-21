import { createWorker } from "tesseract.js";

export const MAX_OCR_PAGES_PER_IMPORT = 10;

export interface OcrInputPage {
  pageNumber: number;
  image: string | Blob | HTMLCanvasElement;
}

export interface OcrRegion {
  text: string;
  confidence: number;
  bbox: [number, number, number, number];
}

export interface OcrPageResult {
  pageNumber: number;
  text: string;
  confidence: number;
  regions: OcrRegion[];
}

/**
 * Runs OCR on the device. The source document stays in the browser; only the
 * Tesseract WASM core and Vietnamese/English language data are fetched lazily.
 */
export async function recognizeOcrPages(
  pages: OcrInputPage[],
  onProgress?: (percent: number, message: string) => void,
): Promise<OcrPageResult[]> {
  if (!pages.length) return [];
  if (pages.length > MAX_OCR_PAGES_PER_IMPORT) {
    throw new Error(`OCR giới hạn ${MAX_OCR_PAGES_PER_IMPORT} trang mỗi lần nhập.`);
  }

  const worker = await createWorker("vie+eng", 1, {
    logger: message => {
      if (message.status === "recognizing text") {
        const progress = Math.round((message.progress || 0) * 100);
        onProgress?.(progress, "Đang nhận diện chữ trên trang...");
      } else if (message.status === "loading language traineddata") {
        onProgress?.(0, "Đang tải dữ liệu OCR tiếng Việt...");
      }
    },
  });

  try {
    const results: OcrPageResult[] = [];
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      const { data } = await worker.recognize(page.image, { rotateAuto: true });
      const regions = (data.blocks || []).flatMap(block => {
        const text = block.text.trim();
        if (!text) return [];
        return [{
          text,
          confidence: Math.max(0, Math.min(1, block.confidence / 100)),
          bbox: [block.bbox.x0, block.bbox.y0, block.bbox.x1, block.bbox.y1] as [number, number, number, number],
        }];
      });
      results.push({
        pageNumber: page.pageNumber,
        text: data.text.trim(),
        confidence: Math.max(0, Math.min(1, data.confidence / 100)),
        regions,
      });
      onProgress?.(Math.round(((index + 1) / pages.length) * 100), `Đã OCR ${index + 1}/${pages.length} trang`);
    }
    return results;
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}
