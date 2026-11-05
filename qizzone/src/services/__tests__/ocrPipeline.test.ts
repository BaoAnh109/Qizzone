import { describe, it, expect, beforeEach } from "vitest";
import {
  decidePdfOcrRoute,
  getOcrEngine,
  registerOcrEngine,
  runOcrPages,
  ocrPagesToV2Result,
  OCR_WARNING,
  OcrUnavailableError,
  type OcrEngine,
  type OcrPageInput,
} from "@/services/extraction/ocr";
import { parseExtractionV2Result } from "@/types/extractionV2";
import { renderPdfPageToImageBlob } from "@/utils/parsers/pdfParser";

const OCR_TEXT_PAGE_1 = `Câu 1: Tính giá trị của biểu thức 1 + 1 bằng mấy?
A. 1
B. 2
C. 3
D. 4
Đáp án: B`;

const OCR_TEXT_PAGE_2 = `Câu 2: Tính giá trị của biểu thức 2 + 2 bằng mấy?
A. 3
B. 4
C. 5
D. 6
Đáp án: B`;

describe("Bước 16 — routing PDF sang OCR", () => {
  it("PDF toàn text → đường text, không đoán trang scan", () => {
    expect(
      decidePdfOcrRoute({ hasTextLayer: true, totalPages: 3 })
    ).toEqual({ route: "text" });
    expect(
      decidePdfOcrRoute({
        hasTextLayer: true,
        totalPages: 3,
        scanPages: [],
      })
    ).toEqual({ route: "text" });
  });

  it("PDF toàn scan (không text layer) → ocr-needed đủ các trang", () => {
    expect(
      decidePdfOcrRoute({ hasTextLayer: false, totalPages: 4 })
    ).toEqual({ route: "ocr-needed", ocrPages: [1, 2, 3, 4] });
  });

  it("Tài liệu xen text/scan → mixed, chỉ liệt kê trang scan", () => {
    expect(
      decidePdfOcrRoute({
        hasTextLayer: true,
        totalPages: 5,
        scanPages: [2, 4],
      })
    ).toEqual({ route: "mixed", ocrPages: [2, 4] });
  });

  it("scanPages có → ưu tiên scanPages hơn hasTextLayer", () => {
    // hasTextLayer=true nhưng scanPages liệt kê toàn bộ trang (trường hợp
    // parse ghi nhận text rỗng ở mọi trang) thì vẫn là ocr-needed.
    expect(
      decidePdfOcrRoute({
        hasTextLayer: true,
        totalPages: 2,
        scanPages: [1, 2],
      })
    ).toEqual({ route: "ocr-needed", ocrPages: [1, 2] });
  });
});

describe("Bước 16 — engine registry và chạy OCR theo trang", () => {
  beforeEach(() => {
    registerOcrEngine(null);
  });

  it("chưa đăng ký engine → getOcrEngine null, runOcrPages throw rõ ràng", async () => {
    expect(getOcrEngine()).toBeNull();
    await expect(
      runOcrPages(null, [{ pageNumber: 1, image: "data:image/png;base64,xxx" }])
    ).rejects.toBeInstanceOf(OcrUnavailableError);
  });

  it("stub engine: trang lỗi được ghi, không chặn trang khác, giữ thứ tự", async () => {
    const stub: OcrEngine = {
      name: "stub-test-engine",
      isAvailable: async () => true,
      recognizePage: async (input: OcrPageInput) => {
        if (input.pageNumber === 2) throw new Error("OCR lỗi giả lập");
        return {
          pageNumber: input.pageNumber,
          text: `trang ${input.pageNumber}`,
          meanConfidence: 0.9,
        };
      },
    };
    registerOcrEngine(stub);
    expect(getOcrEngine()?.name).toBe("stub-test-engine");
    const { pages, failedPages } = await runOcrPages(stub, [
      { pageNumber: 3, image: "x" },
      { pageNumber: 1, image: "x" },
      { pageNumber: 2, image: "x" },
    ]);
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 3]);
    expect(failedPages).toEqual([2]);
  });

  it("engine báo unavailable → throw OcrUnavailableError, không bịa text", async () => {
    const dead: OcrEngine = {
      name: "dead-engine",
      isAvailable: async () => false,
      recognizePage: async () => {
        throw new Error("không bao giờ được gọi");
      },
    };
    await expect(
      runOcrPages(dead, [{ pageNumber: 1, image: "x" }])
    ).rejects.toBeInstanceOf(OcrUnavailableError);
  });
});

describe("Bước 16 — text OCR → V2 qua cùng pipeline tách câu", () => {
  it("câu OCR luôn engine ocr + needs_review + quality partial, kể cả câu có đáp án", () => {
    const result = ocrPagesToV2Result(
      [
        { pageNumber: 1, text: OCR_TEXT_PAGE_1, meanConfidence: 0.92 },
        { pageNumber: 2, text: OCR_TEXT_PAGE_2, meanConfidence: 0.88 },
      ],
      [],
      {
        fileName: "scan.pdf",
        fileSize: 1234,
        fileType: "pdf",
        engineName: "stub-test-engine",
      }
    );
    expect(result.questions.length).toBe(2);
    expect(result.totalQuestionsDetected).toBe(2);
    for (const q of result.questions) {
      expect(q.engine).toBe("ocr");
      // Đáp án OCR chưa xác minh thì KHÔNG BAO GIỜ verified.
      expect(q.status).toBe("needs_review");
      expect(q.quality.status).toBe("partial");
      expect(q.warnings).toContain(OCR_WARNING);
    }
    // Đáp án từ text OCR vẫn bắt được qua waterfall (không mất dữ liệu),
    // chỉ là chưa xác minh.
    expect(result.questions[0].correctAnswers).toEqual(["B"]);
    expect(result.questions[1].correctAnswers).toEqual(["B"]);
    // Gắn trang thật theo text OCR từng trang.
    expect(result.questions[0].page).toBe(1);
    expect(result.questions[1].page).toBe(2);
    // Chất lượng tài liệu: có câu → partial, không phải complete.
    expect(result.documentQuality.status).toBe("partial");
    expect(result.ocr).toEqual({
      engineName: "stub-test-engine",
      failedPages: [],
      meanConfidence: 0.9,
    });
    // Kết quả OCR qua được schema V2 (engine ocr + meta ocr hợp lệ).
    expect(parseExtractionV2Result(result)).not.toBeNull();
  });

  it("trang OCR lỗi được ghi vào ocr.failedPages và lý do documentQuality", () => {
    const result = ocrPagesToV2Result(
      [{ pageNumber: 1, text: OCR_TEXT_PAGE_1 }],
      [2],
      {
        fileName: "scan-mixed.pdf",
        fileSize: 100,
        fileType: "pdf",
        engineName: "stub-test-engine",
      }
    );
    expect(result.questions.length).toBe(1);
    expect(result.ocr?.failedPages).toEqual([2]);
    expect(result.documentQuality.reasons.join(" ")).toContain("2");
    expect(result.documentQuality.status).toBe("partial");
  });

  it("OCR trả text rỗng → failed, 0 câu, không bịa câu", () => {
    const result = ocrPagesToV2Result(
      [{ pageNumber: 1, text: "" }],
      [2],
      {
        fileName: "scan-empty.pdf",
        fileSize: 100,
        fileType: "pdf",
        engineName: "stub-test-engine",
      }
    );
    expect(result.questions.length).toBe(0);
    expect(result.documentQuality.status).toBe("failed");
    expect(result.ocr?.failedPages).toEqual([2]);
    expect(parseExtractionV2Result(result)).not.toBeNull();
  });

  it("ảnh đơn (không phải PDF) cũng qua được pipeline với fileType image", () => {
    const result = ocrPagesToV2Result(
      [{ pageNumber: 1, text: OCR_TEXT_PAGE_1 }],
      [],
      {
        fileName: "anh-de.png",
        fileSize: 50,
        fileType: "image",
        engineName: "stub-test-engine",
      }
    );
    expect(result.fileType).toBe("image");
    expect(result.questions.length).toBe(1);
    expect(result.questions[0].engine).toBe("ocr");
  });
});

describe("Bước 16 — render trang PDF ra ảnh", () => {
  it("ở Node (không có DOM) throw lỗi rõ ràng thay vì trả Blob giả", async () => {
    await expect(
      renderPdfPageToImageBlob(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        1
      )
    ).rejects.toThrow("chỉ chạy ở browser");
  });
});
