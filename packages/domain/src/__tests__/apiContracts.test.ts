import { describe, expect, it } from "vitest";
import {
  confirmUploadRequestSchema,
  createUploadUrlRequestSchema,
  extractQuizRequestSchema,
  finalizeExamRequestSchema,
  MAX_DIRECT_UPLOAD_BYTES,
  OPTION_IDS,
  questionSchema,
  computeNotificationRetryDelaySeconds,
  formatVietnamDateTime,
} from "../index";

describe("@qizzone/domain contracts and schemas", () => {
  it("supports 2 to 5 options (A-E) in questionSchema and rejects invalid answer letters", () => {
    expect(OPTION_IDS).toEqual(["A", "B", "C", "D", "E"]);
    const fiveOptionValid = questionSchema.safeParse({
      content: "Câu hỏi 5 lựa chọn",
      type: "single_choice",
      options: [
        { id: "A", content: "1" },
        { id: "B", content: "2" },
        { id: "C", content: "3" },
        { id: "D", content: "4" },
        { id: "E", content: "5" },
      ],
      correctAnswers: ["E"],
      points: 1,
    });
    expect(fiveOptionValid.success).toBe(true);

    const mismatchedAnswer = questionSchema.safeParse({
      content: "Câu hỏi sai đáp án",
      type: "single_choice",
      options: [
        { id: "A", content: "1" },
        { id: "B", content: "2" },
      ],
      correctAnswers: ["C"],
      points: 1,
    });
    expect(mismatchedAnswer.success).toBe(false);
  });

  it("validates R2 presigned upload contracts up to 50 MiB and rejects oversized or invalid MIME", () => {
    expect(
      createUploadUrlRequestSchema.safeParse({
        fileName: "de-thi-toan.pdf",
        mimeType: "application/pdf",
        sizeBytes: MAX_DIRECT_UPLOAD_BYTES,
      }).success
    ).toBe(true);

    expect(
      createUploadUrlRequestSchema.safeParse({
        fileName: "too-big.pdf",
        mimeType: "application/pdf",
        sizeBytes: MAX_DIRECT_UPLOAD_BYTES + 1,
      }).success
    ).toBe(false);

    expect(
      createUploadUrlRequestSchema.safeParse({
        fileName: "evil.exe",
        mimeType: "application/x-msdownload",
        sizeBytes: 1024,
      }).success
    ).toBe(false);

    expect(
      confirmUploadRequestSchema.safeParse({
        materialId: "550e8400-e29b-41d4-a716-446655440000",
      }).success
    ).toBe(true);
  });

  it("validates extract-quiz and finalize-exam contracts", () => {
    expect(extractQuizRequestSchema.safeParse({}).success).toBe(false);
    expect(
      extractQuizRequestSchema.safeParse({
        materialId: "550e8400-e29b-41d4-a716-446655440000",
        extractionMode: "scan_ocr_vlm",
        selectedPages: [1, 2, 3],
      }).success
    ).toBe(true);

    expect(
      finalizeExamRequestSchema.safeParse({
        attemptId: "550e8400-e29b-41d4-a716-446655440000",
        idempotencyKey: "submit-attempt-123456",
      }).success
    ).toBe(true);
  });

  it("computes bounded exponential retry delays and Vietnam timezone formatting", () => {
    expect(computeNotificationRetryDelaySeconds(1)).toBe(30);
    expect(computeNotificationRetryDelaySeconds(2)).toBe(60);
    expect(computeNotificationRetryDelaySeconds(10)).toBe(3600);
    const formatted = formatVietnamDateTime("2026-11-21T03:30:00.000Z");
    expect(formatted).toContain("10:30");
    expect(formatted).toContain("21/11/2026");
  });
});
