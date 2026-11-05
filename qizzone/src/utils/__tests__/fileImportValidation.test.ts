import { describe, expect, it } from "vitest";
import {
  MAX_AI_IMPORT_BYTES,
  MAX_DOCUMENT_IMPORT_BYTES,
  checkFileSignature,
  validateImportFile,
  validateImportFileSignature,
  validatePastedTextSize,
} from "@/utils/fileImportValidation";

describe("file import size and format validation", () => {
  it("accepts DOCX and PDF up to 25 MB, including uppercase extensions", () => {
    expect(
      validateImportFile({ name: "exam.DOCX", size: MAX_DOCUMENT_IMPORT_BYTES }),
    ).toBeNull();
    expect(
      validateImportFile({ name: "exam.PDF", size: MAX_DOCUMENT_IMPORT_BYTES }),
    ).toBeNull();
  });

  it("accepts image and text imports up to 5 MB", () => {
    for (const name of ["scan.webp", "scan.JPG", "questions.txt", "questions.MD"]) {
      expect(validateImportFile({ name, size: MAX_AI_IMPORT_BYTES })).toBeNull();
    }
  });

  it("rejects files above the matching limit before processing", () => {
    expect(
      validateImportFile({ name: "exam.docx", size: MAX_DOCUMENT_IMPORT_BYTES + 1 }),
    ).toContain("25 MB");
    expect(
      validateImportFile({ name: "scan.png", size: MAX_AI_IMPORT_BYTES + 1 }),
    ).toContain("5 MB");
  });

  it("rejects empty files and unsupported extensions", () => {
    expect(validateImportFile({ name: "exam.pdf", size: 0 })).toContain("trống");
    expect(validateImportFile({ name: "exam.doc", size: 100 })).toContain(".docx");
  });

  it("limits pasted text by its UTF-8 byte size", () => {
    expect(validatePastedTextSize("Đề thi")).toBeNull();
    expect(validatePastedTextSize("a".repeat(MAX_AI_IMPORT_BYTES + 1))).toContain("5 MB");
  });
});

describe("file import signature validation (bước 32)", () => {
  it("accepts matching magic bytes for docx, pdf and images", () => {
    expect(checkFileSignature("docx", new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
    expect(checkFileSignature("docx", new Uint8Array([0x50, 0x4b, 0x05, 0x06]))).toBeNull();
    expect(checkFileSignature("pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBeNull();
    expect(checkFileSignature("png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(checkFileSignature("jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
    expect(
      checkFileSignature(
        "webp",
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
      ),
    ).toBeNull();
  });

  it("rejects spoofed extensions instead of letting the parser handle them", () => {
    // HTML đội lốt .docx, text đội lốt .pdf, PNG đội lốt .jpg.
    expect(checkFileSignature("docx", new Uint8Array([0x3c, 0x68, 0x74, 0x6d]))).toContain(".docx");
    expect(checkFileSignature("pdf", new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toContain(".pdf");
    expect(checkFileSignature("jpg", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toContain("JPEG");
  });

  it("does not signature-check plain text formats", () => {
    expect(checkFileSignature("txt", new Uint8Array([0x00, 0x01, 0x02]))).toBeNull();
    expect(checkFileSignature("md", new Uint8Array([]))).toBeNull();
  });

  it("reads only the first bytes of the file for the async wrapper", async () => {
    const seen: number[] = [];
    const blob = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])]);
    const fakeFile = {
      name: "exam.pdf",
      slice: (start: number, end: number) => {
        seen.push(start, end);
        return blob.slice(start, end);
      },
    };
    await expect(validateImportFileSignature(fakeFile)).resolves.toBeNull();
    expect(seen).toEqual([0, 12]);
  });
});
