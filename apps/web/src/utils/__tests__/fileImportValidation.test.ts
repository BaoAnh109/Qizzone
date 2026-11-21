import { describe, expect, it } from "vitest";
import {
  MAX_AI_IMPORT_BYTES,
  MAX_DOCUMENT_IMPORT_BYTES,
  validateImportFile,
  validateImportFileSignature,
  validatePastedTextSize,
} from "@/utils/fileImportValidation";

function namedBlob(name: string, bytes: number[]): File {
  return Object.assign(new Blob([new Uint8Array(bytes)]), { name }) as File;
}

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

  it("checks file signatures so renamed or spoofed uploads are rejected", async () => {
    const pdf = namedBlob("exam.pdf", [0x25, 0x50, 0x44, 0x46, 0x2d]);
    const fakePdf = namedBlob("exam.pdf", [0x50, 0x4b, 0x03, 0x04]);
    const png = namedBlob("scan.png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const webp = namedBlob("scan.webp", [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(await validateImportFileSignature(pdf)).toBeNull();
    expect(await validateImportFileSignature(fakePdf)).toContain("PDF");
    expect(await validateImportFileSignature(png)).toBeNull();
    expect(await validateImportFileSignature(webp)).toBeNull();
  });

  it("limits pasted text by its UTF-8 byte size", () => {
    expect(validatePastedTextSize("Đề thi")).toBeNull();
    expect(validatePastedTextSize("a".repeat(MAX_AI_IMPORT_BYTES + 1))).toContain("5 MB");
  });
});
