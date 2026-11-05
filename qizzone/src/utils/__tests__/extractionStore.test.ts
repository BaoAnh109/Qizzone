import { describe, it, expect, beforeEach } from "vitest";
import { useExtractionStore } from "@/store/extractionStore";
import { validateExtractedQuestions } from "@/utils/extractedQuestionMapper";
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

  // Bước 05: toggleCorrectAnswer cho phép [] — không fallback ["A"].
  it("bỏ đáp án cuối thì câu về [] kèm trạng thái cần review, không rơi về A", () => {
    useExtractionStore.getState().toggleCorrectAnswer("q1", "A");
    const q1 = useExtractionStore
      .getState()
      .extractionResult?.questions.find((q) => q.id === "q1");

    expect(q1?.correctAnswers).toEqual([]);
    expect(q1?.detectionStrategy).toBe("manual");
    expect(q1?.confidenceScore).toBe(0);
    expect(q1?.warningFlags).toContain("Chưa có đáp án đúng");
  });

  it("bỏ 1 trong 2 đáp án thì đáp án còn lại được giữ nguyên", () => {
    const store = useExtractionStore.getState();
    store.toggleCorrectAnswer("q1", "B"); // ["A", "B"]
    useExtractionStore.getState().toggleCorrectAnswer("q1", "A"); // ["B"]
    const q1 = useExtractionStore
      .getState()
      .extractionResult?.questions.find((q) => q.id === "q1");

    expect(q1?.correctAnswers).toEqual(["B"]);
    expect(q1?.warningFlags).not.toContain("Chưa có đáp án đúng");
    expect(q1?.confidenceScore).toBe(1.0);
  });

  it("chọn lại đáp án sau khi rỗng thì gỡ cờ cần review", () => {
    const store = useExtractionStore.getState();
    store.toggleCorrectAnswer("q1", "A"); // []
    useExtractionStore.getState().toggleCorrectAnswer("q1", "B"); // ["B"]
    const q1 = useExtractionStore
      .getState()
      .extractionResult?.questions.find((q) => q.id === "q1");

    expect(q1?.correctAnswers).toEqual(["B"]);
    expect(q1?.warningFlags).not.toContain("Chưa có đáp án đúng");
    expect(q1?.confidenceScore).toBe(1.0);
  });

  it("setCorrectAnswer chủ động chọn thì gỡ cờ rỗng cũ", () => {
    const store = useExtractionStore.getState();
    store.toggleCorrectAnswer("q1", "A"); // [] + cờ
    useExtractionStore.getState().setCorrectAnswer("q1", "B");
    const q1 = useExtractionStore
      .getState()
      .extractionResult?.questions.find((q) => q.id === "q1");

    expect(q1?.correctAnswers).toEqual(["B"]);
    expect(q1?.warningFlags).not.toContain("Chưa có đáp án đúng");
  });

  it("câu thêm tay là manual_draft: không đáp án giả, không tự xuất bản được", () => {
    useExtractionStore.getState().addEmptyQuestion();
    const questions =
      useExtractionStore.getState().extractionResult?.questions || [];
    const draft = questions[4];

    expect(draft.isManualDraft).toBe(true);
    expect(draft.correctAnswers).toEqual([]);
    expect(draft.confidenceScore).toBe(0);
    expect(draft.warningFlags).toContain("Câu hỏi nháp tạo thủ công");
    expect(draft.warningFlags).toContain("Chưa có đáp án đúng");
    // Placeholder UI vẫn được sinh để giáo viên sửa, nhưng không
    // phải câu trích xuất hợp lệ: validator bước 04 chặn xuất bản.
    expect(draft.options.map((o) => o.id)).toEqual(["A", "B", "C", "D"]);
    const diagnostics = validateExtractedQuestions([draft]);
    expect(
      diagnostics.some(
        (d) => d.code === "missing_answer" && d.blocksPublish === true
      )
    ).toBe(true);
    expect(useExtractionStore.getState().selectedQuestionId).toBe(draft.id);
  });

  it("batch answer mapping có conflict: cùng câu ghi 2 đáp án thì lần sau thắng, ghi đè cả đáp án manual", () => {
    useExtractionStore.getState().setCorrectAnswer("q1", "B"); // manual
    const { updatedCount } = useExtractionStore
      .getState()
      .applyBatchAnswerKey("1A 1C 2B");
    const questions =
      useExtractionStore.getState().extractionResult?.questions || [];

    expect(updatedCount).toBe(2);
    expect(questions[0].correctAnswers).toEqual(["C"]);
    expect(questions[0].detectionStrategy).toBe("answer_table");
    expect(questions[0].confidenceScore).toBe(0.99);
    expect(questions[1].correctAnswers).toEqual(["B"]);
  });

  it("batch answer mapping bỏ qua mục không hợp lệ, không crash, không cập nhật câu nào", () => {
    const { updatedCount } = useExtractionStore
      .getState()
      .applyBatchAnswerKey("5Z 0A 9");
    const questions =
      useExtractionStore.getState().extractionResult?.questions || [];

    expect(updatedCount).toBe(0);
    questions.forEach((q) => {
      expect(q.correctAnswers).toEqual(["A"]);
    });
  });
});
