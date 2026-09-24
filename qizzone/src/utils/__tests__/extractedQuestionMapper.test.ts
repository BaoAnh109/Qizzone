import { describe, it, expect } from "vitest";
import { mapExtractedQuestionsToQuizQuestions } from "../extractedQuestionMapper";
import type { ExtractedQuestion } from "@/types/extractor";

describe("extractedQuestionMapper", () => {
  it("converts ExtractedQuestion array to Quiz Question array correctly", () => {
    const mockExtracted: ExtractedQuestion[] = [
      {
        id: "q-1",
        tempId: "tmp-1",
        order: 1,
        content: "Nội dung câu 1",
        options: [
          { id: "A", content: "Đáp án A", rawContent: "A. Đáp án A" },
          { id: "B", content: "Đáp án B", rawContent: "B. Đáp án B" },
        ],
        correctAnswers: ["B"],
        explanation: "Lời giải chi tiết câu 1",
        points: 2,
        confidenceScore: 0.95,
        detectionStrategy: "underline",
        rawTextSegment: "Câu 1: ...",
      },
      {
        id: "q-2",
        tempId: "tmp-2",
        order: 2,
        content: "Nội dung câu 2",
        options: [
          { id: "A", content: "Lựa chọn 1", rawContent: "A. 1" },
          { id: "B", content: "Lựa chọn 2", rawContent: "B. 2" },
        ],
        correctAnswers: [],
        explanation: "",
        points: 1,
        confidenceScore: 0.8,
        detectionStrategy: "distinct_bold",
        rawTextSegment: "Câu 2: ...",
      },
    ];

    const result = mapExtractedQuestionsToQuizQuestions(mockExtracted);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("q-1");
    expect(result[0].order).toBe(1);
    expect(result[0].content).toBe("Nội dung câu 1");
    expect(result[0].options).toEqual([
      { id: "A", content: "Đáp án A" },
      { id: "B", content: "Đáp án B" },
    ]);
    expect(result[0].correctAnswers).toEqual(["B"]);
    expect(result[0].points).toBe(2);
    expect(result[0].explanation).toBe("Lời giải chi tiết câu 1");

    // Fallback default answer if empty
    expect(result[1].correctAnswers).toEqual(["A"]);
    expect(result[1].order).toBe(2);
  });
});
