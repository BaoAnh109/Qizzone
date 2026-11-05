import { describe, it, expect } from "vitest";
import {
  validateQuestionsForSave,
  validateQuestionsForPublish,
  assertPublishable,
  formatSaveIssues,
} from "@/lib/validations/quizSave";

const validQuestion = (overrides: Record<string, unknown> = {}) => ({
  content: "2 + 2 = ?",
  type: "single_choice",
  options: [
    { id: "A", content: "3" },
    { id: "B", content: "4" },
    { id: "C", content: "5" },
    { id: "D", content: "6" },
  ],
  correctAnswers: ["B"],
  ...overrides,
});

describe("Bước 08: validation lưu đề theo trạng thái", () => {
  it("bộ câu hỏi sạch: publish 0 blocker, draft 0 warning", () => {
    const qs = [validQuestion(), validQuestion({ content: "3 + 3 = ?" })];
    expect(validateQuestionsForPublish(qs)).toEqual([]);
    const draft = validateQuestionsForSave(qs, "draft");
    expect(draft.blockers).toEqual([]);
    expect(draft.warnings).toEqual([]);
  });

  it("thiếu đáp án: publish chặn missing_answer, draft chỉ warning không blocker", () => {
    const qs = [validQuestion({ correctAnswers: [] })];
    const pub = validateQuestionsForPublish(qs);
    expect(pub).toHaveLength(1);
    expect(pub[0].code).toBe("missing_answer");
    expect(pub[0].order).toBe(1);
    const draft = validateQuestionsForSave(qs, "draft");
    expect(draft.blockers).toEqual([]);
    expect(draft.warnings).toHaveLength(1);
    expect(draft.warnings[0].code).toBe("missing_answer");
  });

  it("dưới 2 phương án: publish chặn insufficient_options, draft chỉ warning", () => {
    const qs = [
      validQuestion({
        options: [{ id: "A", content: "Chỉ một phương án" }],
        correctAnswers: ["A"],
      }),
    ];
    expect(validateQuestionsForPublish(qs)[0].code).toBe("insufficient_options");
    const draft = validateQuestionsForSave(qs, "draft");
    expect(draft.blockers).toEqual([]);
    expect(draft.warnings[0].code).toBe("insufficient_options");
  });

  it("đáp án không nằm trong phương án: publish chặn answer_not_in_options", () => {
    const qs = [validQuestion({ correctAnswers: ["D", "Z"] })];
    // single_choice + 2 đáp án cũng vi phạm, nhưng phải có answer_not_in_options
    const codes = validateQuestionsForPublish(qs).map((i) => i.code);
    expect(codes).toContain("answer_not_in_options");
  });

  it("single_choice có 2 đáp án: publish chặn too_many_answers (mirror luật DB)", () => {
    const qs = [validQuestion({ correctAnswers: ["A", "B"] })];
    const codes = validateQuestionsForPublish(qs).map((i) => i.code);
    expect(codes).toContain("too_many_answers");
  });

  it("multiple_choice có 2 đáp án hợp lệ: publish qua", () => {
    const qs = [
      validQuestion({ type: "multiple_choice", correctAnswers: ["A", "B"] }),
    ];
    expect(validateQuestionsForPublish(qs)).toEqual([]);
  });

  it("nội dung trống: publish chặn empty_content, draft chỉ warning", () => {
    const qs = [validQuestion({ content: "   " })];
    expect(validateQuestionsForPublish(qs)[0].code).toBe("empty_content");
    const draft = validateQuestionsForSave(qs, "draft");
    expect(draft.blockers).toEqual([]);
    expect(draft.warnings[0].code).toBe("empty_content");
  });

  it("quá 4 phương án: publish chặn too_many_options", () => {
    const qs = [
      validQuestion({
        options: [
          { id: "A", content: "1" },
          { id: "B", content: "2" },
          { id: "C", content: "3" },
          { id: "D", content: "4" },
          { id: "A", content: "trùng id" },
        ],
      }),
    ];
    const codes = validateQuestionsForPublish(qs).map((i) => i.code);
    expect(codes).toContain("too_many_options");
  });

  it("phương án trùng id / trống nội dung: publish chặn invalid_option", () => {
    const dup = validQuestion({
      options: [
        { id: "A", content: "x" },
        { id: "A", content: "y" },
      ],
      correctAnswers: ["A"],
    });
    expect(validateQuestionsForPublish([dup])[0].code).toBe("invalid_option");
    const empty = validQuestion({
      options: [
        { id: "A", content: "" },
        { id: "B", content: "y" },
      ],
      correctAnswers: ["B"],
    });
    expect(validateQuestionsForPublish([empty])[0].code).toBe("invalid_option");
  });

  it("không có câu hỏi nào: publish chặn no_questions", () => {
    const pub = validateQuestionsForPublish([]);
    expect(pub).toHaveLength(1);
    expect(pub[0].code).toBe("no_questions");
  });

  it("assertPublishable throw thông điệp liệt kê câu lỗi, bộ sạch không throw", () => {
    expect(() => assertPublishable([validQuestion()])).not.toThrow();
    expect(() => assertPublishable([validQuestion({ correctAnswers: [] })])).toThrow(
      /Không thể xuất bản/
    );
  });

  it("formatSaveIssues liệt kê tối đa 5 vấn đề + số vấn đề còn lại", () => {
    const qs = Array.from({ length: 7 }, (_, i) =>
      validQuestion({ content: `Câu ${i + 1}`, correctAnswers: [] })
    );
    const msg = formatSaveIssues(validateQuestionsForPublish(qs));
    expect(msg).toContain("2 vấn đề khác");
  });

  it("câu nháp tạo tay đã sửa xong (đủ đáp án/phương án): publish qua — cờ manual không tự chặn", () => {
    // Tiêu chí hoàn thiện nháp ở bước 08 là theo tính hợp lệ của câu,
    // không theo cờ isManualDraft (cờ không có UI nào gỡ).
    const qs = [validQuestion()];
    expect(validateQuestionsForPublish(qs)).toEqual([]);
  });

  it("Bước 12: true_false (cặp Đúng/Sai, 1 đáp án) publish qua — không bị chặn hay tính điểm sai", () => {
    // Tầng dưới đã tương thích sẵn: quizSave chỉ bắt "không phải
    // multiple thì đúng 1 đáp án" nên true_false 1 đáp án qua được;
    // gradingEngine chấm theo exact set match, không phụ thuộc type.
    const qs = [
      validQuestion({
        type: "true_false",
        options: [
          { id: "A", content: "Đúng" },
          { id: "B", content: "Sai" },
        ],
        correctAnswers: ["A"],
      }),
    ];
    expect(validateQuestionsForPublish(qs)).toEqual([]);
  });

  it("Bước 12: true_false có 2 đáp án vẫn bị chặn như single_choice (mirror luật DB)", () => {
    const qs = [
      validQuestion({
        type: "true_false",
        options: [
          { id: "A", content: "Đúng" },
          { id: "B", content: "Sai" },
        ],
        correctAnswers: ["A", "B"],
      }),
    ];
    expect(validateQuestionsForPublish(qs).map((i) => i.code)).toContain(
      "too_many_answers"
    );
  });
});
