import { describe, expect, it } from "vitest";
import { getExtractedQuestionIssues } from "@/utils/extractedQuestionValidation";
import type { ExtractedQuestion } from "@/types/extractor";

const validQuestion: ExtractedQuestion = {
  id: "q1", tempId: "t1", order: 1, content: "Câu hỏi hợp lệ?",
  options: [
    { id: "A", content: "Một", rawContent: "A. Một" },
    { id: "B", content: "Hai", rawContent: "B. Hai" },
  ],
  correctAnswers: ["B"], points: 1, confidenceScore: 0.95,
  detectionStrategy: "highlight_color", rawTextSegment: "Câu hỏi hợp lệ?",
};

describe("extracted question validation", () => {
  it("accepts a complete single-choice extraction", () => {
    expect(getExtractedQuestionIssues([validQuestion])).toEqual([]);
  });

  it("rejects unanswered questions instead of inventing A", () => {
    const issues = getExtractedQuestionIssues([{ ...validQuestion, correctAnswers: [] }]);
    expect(issues.some(issue => issue.includes("chưa có đáp án"))).toBe(true);
  });

  it("rejects fabricated or missing options", () => {
    const issues = getExtractedQuestionIssues([{
      ...validQuestion, options: [{ id: "A", content: "Lựa chọn A", rawContent: "A. Lựa chọn A" }],
    }]);
    expect(issues.some(issue => issue.includes("từ 2 đến 4"))).toBe(true);
    expect(issues.some(issue => issue.includes("nội dung mẫu"))).toBe(true);
  });

  it("rejects multiple answers until mapping supports multiple_choice", () => {
    const issues = getExtractedQuestionIssues([{
      ...validQuestion, correctAnswers: ["A", "B"],
    }]);
    expect(issues.some(issue => issue.includes("nhiều đáp án"))).toBe(true);
  });
}
