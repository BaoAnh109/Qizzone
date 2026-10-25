import { describe, expect, it } from "vitest";
import {
  MAX_AI_IMPORT_BYTES,
  MAX_DOCUMENT_IMPORT_BYTES,
  validateImportFile,
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
