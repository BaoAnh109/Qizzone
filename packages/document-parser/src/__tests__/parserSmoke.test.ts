import { describe, expect, it } from "vitest";
import {
  MAX_EXTRACTED_QUESTIONS,
  MAX_OCR_PAGES_PER_IMPORT,
  MAX_R2_MATERIAL_BYTES,
  parseRawExamText,
  validateR2MaterialUpload,
} from "../index";

describe("@qizzone/document-parser smoke", () => {
  it("enforces extraction and OCR bounds and never guesses default answer A", () => {
    expect(MAX_EXTRACTED_QUESTIONS).toBe(1000);
    expect(MAX_OCR_PAGES_PER_IMPORT).toBe(10);
    expect(MAX_R2_MATERIAL_BYTES).toBe(50 * 1024 * 1024);

    const parsed = parseRawExamText(
      "Câu 1: Thủ đô Việt Nam là?\nA. Hà Nội\nB. TP.HCM\nC. Đà Nẵng\nD. Huế",
      { fileName: "sample.txt", fileType: "text" }
    );
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0].correctAnswers).toEqual([]);
    expect(parsed.questions[0].answerStatus).toBe("unknown");

    expect(
      validateR2MaterialUpload({ name: "large-exam.pdf", size: 48 * 1024 * 1024 })
    ).toBeNull();
    expect(
      validateR2MaterialUpload({ name: "huge-exam.pdf", size: 51 * 1024 * 1024 })
    ).not.toBeNull();
  });
});
