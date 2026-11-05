import { describe, it, expect } from "vitest";
import type { UploadedExamDocument } from "@/types/extractor";
import type { HybridOrchestrationResult } from "@/services/extraction/hybridOrchestrator";
import {
  buildAiExtractParams,
  buildAiFillInput,
  shouldShowAiFillButton,
} from "@/services/extraction/aiFill";

/**
 * Bước 24: test helper thuần của nút "AI lấp đáp án còn thiếu".
 * Điểm khóa: nút chỉ hiện khi aiNeeded; nguồn AI lấy từ tài liệu đã
 * tải (không gọi mù); input lấp dùng V1 hiện tại để không hoàn tác
 * sửa tay của giáo viên.
 */

function makeHybrid(needed: boolean) {
  return {
    aiNeeded: { needed, questions: [], ocrNeededPages: [] },
  } as unknown as HybridOrchestrationResult;
}

function makeDocument(
  overrides: Partial<UploadedExamDocument> = {}
): UploadedExamDocument {
  return {
    id: "doc-1",
    file: null,
    fileName: "de.pdf",
    fileType: "pdf",
    fileSize: 1000,
    uploadedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("aiFill — điều kiện hiện nút", () => {
  it("hiện nút khi aiNeeded.needed", () => {
    expect(shouldShowAiFillButton(makeHybrid(true))).toBe(true);
  });

  it("ẩn nút khi không cần AI, không có hybrid, hoặc hybrid null", () => {
    expect(shouldShowAiFillButton(makeHybrid(false))).toBe(false);
    expect(shouldShowAiFillButton(null)).toBe(false);
    expect(shouldShowAiFillButton(undefined)).toBe(false);
  });
});

describe("aiFill — nguồn AI từ tài liệu đã tải", () => {
  it("ảnh thì dùng imageBase64", () => {
    const params = buildAiExtractParams(
      makeDocument({ fileType: "image", imageBase64: "data:image/png;base64,xx" })
    );
    expect(params).toEqual({
      file: undefined,
      imageBase64: "data:image/png;base64,xx",
    });
  });

  it("DOCX/PDF/text thì dùng rawText", () => {
    const params = buildAiExtractParams(
      makeDocument({ fileType: "docx", rawText: "Câu 1: ..." })
    );
    expect(params).toEqual({ file: undefined, text: "Câu 1: ..." });
  });

  it("không có nguồn nào thì trả null (không gọi AI mù)", () => {
    expect(buildAiExtractParams(null)).toBeNull();
    expect(
      buildAiExtractParams(makeDocument({ fileType: "pdf", rawText: "   " }))
    ).toBeNull();
    expect(
      buildAiExtractParams(makeDocument({ fileType: "image" }))
    ).toBeNull();
  });
});

describe("aiFill — input lấp giữ V1 hiện tại", () => {
  it("dùng V1 hiện tại + metadata lần trích xuất gốc", () => {
    const current = { questions: [{ order: 1, correctAnswers: ["B"] }] };
    const stored = {
      result: { questions: [{ order: 1, correctAnswers: [] }] },
      documentQuality: { status: "complete" },
      totalPages: 3,
      scanPages: [2],
    };
    const input = buildAiFillInput(current as never, stored as never);
    // Đáp án sửa tay ("B") được giữ — không dùng V1 cũ trong stored.
    expect(input.result).toBe(current);
    expect(input.totalPages).toBe(3);
    expect(input.scanPages).toEqual([2]);
    expect(input.documentQuality).toEqual({ status: "complete" });
  });

  it("không có stored input thì chỉ còn V1 hiện tại", () => {
    const current = { questions: [] };
    const input = buildAiFillInput(current as never, null);
    expect(input.result).toBe(current);
    expect(input.totalPages).toBeUndefined();
    expect(input.scanPages).toBeUndefined();
  });
});
