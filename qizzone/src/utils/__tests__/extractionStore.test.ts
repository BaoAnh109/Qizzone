import { describe, it, expect, beforeEach } from "vitest";
import { useExtractionStore } from "@/store/extractionStore";
import type { ExtractionResult } from "@/types/extractor";

const mockExtraction: ExtractionResult = {
  fileName: "test_quiz.docx",
  fileType: "docx",
  fileSize: 1000,
  title: "Đề thi thử Store",
  subject: "Toán học",
  totalQuestionsDetected: 4,
  hasAnswerKeyTable: false,
  warningsCount: 0,
  extractedAt: "2026-08-30T00:00:00Z",
  questions: [
    {
      id: "q1",
      tempId: "t1",
      order: 1,
      content: "Câu 1: $1 + 1 = ?$",
      options: [
        { id: "A", content: "2", rawContent: "A. 2" },
        { id: "B", content: "3", rawContent: "B. 3" },
      ],
      correctAnswers: ["A"],
      points: 2.5,
      confidenceScore: 0.9,
      detectionStrategy: "underline",
      rawTextSegment: "Câu 1...",
    },
    {
      id: "q2",
      tempId: "t2",
      order: 2,
      content: "Câu 2: $2 \\times 2 = ?$",
      options: [
        { id: "A", content: "4", rawContent: "A. 4" },
        { id: "B", content: "5", rawContent: "B. 5" },
      ],
      correctAnswers: ["A"],
      points: 2.5,
      confidenceScore: 0.9,
      detectionStrategy: "underline",
      rawTextSegment: "Câu 2...",
    },
    {
      id: "q3",
      tempId: "t3",
      order: 3,
      content: "Câu 3: $3 + 3 = ?$",
      options: [
        { id: "A", content: "6", rawContent: "A. 6" },
        { id: "B", content: "7", rawContent: "B. 7" },
      ],
      correctAnswers: ["A"],
      points: 2.5,
      confidenceScore: 0.9,
      detectionStrategy: "underline",
      rawTextSegment: "Câu 3...",
    },
    {
      id: "q4",
      tempId: "t4",
      order: 4,
      content: "Câu 4: $4 \\times 2 = ?$",
      options: [
        { id: "A", content: "8", rawContent: "A. 8" },
        { id: "B", content: "9", rawContent: "B. 9" },
      ],
      correctAnswers: ["A"],
      points: 2.5,
      confidenceScore: 0.9,
      detectionStrategy: "underline",
      rawTextSegment: "Câu 4...",
    },
  ],
};

describe("extractionStore Unit Tests", () => {
  beforeEach(() => {
    useExtractionStore.getState().clearAll();
    useExtractionStore.getState().setExtractionResult(mockExtraction);
  });

  it("thay đổi đáp án đúng 1-click cập nhật chính xác chiến lược manual", () => {
    useExtractionStore.getState().setCorrectAnswer("q1", "B");
    const updatedQ1 = useExtractionStore
      .getState()
      .extractionResult?.questions.find((q) => q.id === "q1");

    expect(updatedQ1?.correctAnswers).toEqual(["B"]);
    expect(updatedQ1?.detectionStrategy).toBe("manual");
    expect(updatedQ1?.confidenceScore).toBe(1.0);
  });

  it("chia đều 10 điểm tự động tính chuẩn barem điểm mỗi câu", () => {
    useExtractionStore.getState().autoBalancePoints(10);
    const questions =
      useExtractionStore.getState().extractionResult?.questions || [];

    expect(questions.length).toBe(4);
    questions.forEach((q) => {
      expect(q.points).toBe(2.5);
    });
  });

  it("áp dụng chuỗi bảng đáp án hàng loạt cập nhật đồng loạt các câu hỏi", () => {
    const { updatedCount } = useExtractionStore
      .getState()
      .applyBatchAnswerKey("1B 2B 3B 4B");

    expect(updatedCount).toBe(4);
    const questions =
      useExtractionStore.getState().extractionResult?.questions || [];

    questions.forEach((q) => {
      expect(q.correctAnswers).toEqual(["B"]);
      expect(q.detectionStrategy).toBe("answer_table");
      expect(q.confidenceScore).toBe(0.99);
    });
  });

  it("xóa câu hỏi và tự động đánh lại số thứ tự (order) liên tục", () => {
    useExtractionStore.getState().deleteQuestion("q2");
    const questions =
      useExtractionStore.getState().extractionResult?.questions || [];

    expect(questions.length).toBe(3);
    expect(questions[0].order).toBe(1);
    expect(questions[1].order).toBe(2);
    expect(questions[2].order).toBe(3);
  });

  it("thêm câu hỏi mới thủ công thành công", () => {
    useExtractionStore.getState().addEmptyQuestion();
    const questions =
      useExtractionStore.getState().extractionResult?.questions || [];

    expect(questions.length).toBe(5);
    expect(questions[4].order).toBe(5);
    expect(questions[4].detectionStrategy).toBe("manual");
  });
});
