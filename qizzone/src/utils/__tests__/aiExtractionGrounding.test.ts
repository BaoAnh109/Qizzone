import { describe, expect, it } from "vitest";
import { parseGroundedAIResult, shouldUseAIExtractionFallback, mergeExtractionResults } from "@/services/aiExtractionService";
import { parseRawExamText } from "@/utils/parsers/ruleExtractor";

describe("Grounded AI extraction fallback", () => {
  const source = "Question 1: What is HTTP?\nA. Protocol\nB. Browser";

  it("keeps source-grounded questions and always discards AI-suggested answer keys", () => {
    const result = parseGroundedAIResult({
      questions: [{
        order: 1,
        content: "What is HTTP?",
        options: [{ id: "A", content: "Protocol" }, { id: "B", content: "Browser" }],
        correctAnswers: ["B"],
        explanation: "The browser is correct.",
        confidenceScore: 1,
      }],
    }, "sample.txt", "text", source.length, source);

    expect(result?.questions).toHaveLength(1);
    expect(result?.questions[0].options.map(option => option.content)).toEqual(["Protocol", "Browser"]);
    expect(result?.questions[0].correctAnswers).toEqual([]);
    expect(result?.questions[0].answerStatus).toBe("unknown");
    expect(result?.questions[0].explanation).toBeUndefined();
    expect(result?.qualityFlags).toContain("ai_fallback_requires_human_review");
  });

  it("rejects invented question text and options with incorrect source labels", () => {
    const inventedStem = parseGroundedAIResult({
      questions: [{
        order: 1,
        content: "Which browser is best?",
        options: [{ id: "A", content: "Protocol" }, { id: "B", content: "Browser" }],
      }],
    }, "sample.txt", "text", source.length, source);
    expect(inventedStem).toBeNull();

    const swappedOptionLabel = parseGroundedAIResult({
      questions: [{
        order: 1,
        content: "What is HTTP?",
        options: [{ id: "A", content: "Browser" }, { id: "B", content: "Protocol" }],
      }],
    }, "sample.txt", "text", source.length, source);
    expect(swappedOptionLabel).toBeNull();
  });

  it("keeps a grounded fifth option in the AI fallback", () => {
    const fiveOptionSource = "Câu 4: Chọn phương án đúng?\nA. Một\nB. Hai\nC. Ba\nD. Bốn\nE. Năm";
    const result = parseGroundedAIResult({
      questions: [{
        order: 4,
        content: "Chọn phương án đúng?",
        options: [
          { id: "A", content: "Một" },
          { id: "B", content: "Hai" },
          { id: "C", content: "Ba" },
          { id: "D", content: "Bốn" },
          { id: "E", content: "Năm" },
        ],
      }],
    }, "sample.txt", "text", fiveOptionSource.length, fiveOptionSource);

    expect(result?.questions[0].options.map(option => option.id)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("runs fallback only when a structural gap has enough source options to recover", () => {
    const complete = parseRawExamText("Câu 1: Chọn giao thức.\nA. HTTP\nB. HTML");
    const sourceOnlyHasOneOption = parseRawExamText("Câu 1: Chọn giao thức.\nA. HTTP");
    const parserMissedOptions = parseRawExamText("Câu 1: Chọn giao thức.\nA. HTTP\nB. HTML");
    parserMissedOptions.questions[0].options = [];
    parserMissedOptions.qualityFlags = ["invalid_option_structure"];
    expect(shouldUseAIExtractionFallback(complete)).toBe(false);
    expect(shouldUseAIExtractionFallback(sourceOnlyHasOneOption)).toBe(false);
    expect(shouldUseAIExtractionFallback(parserMissedOptions)).toBe(true);
  });

  it("retains native answer evidence when merging an AI structure fallback", () => {
    const native = parseRawExamText("Câu 1: Chọn đáp án đúng?\n*A. Có\nB. Không");
    const fallback = parseGroundedAIResult({
      questions: [{
        order: 1,
        content: "Chọn đáp án đúng?",
        options: [{ id: "A", content: "Có" }, { id: "B", content: "Không" }],
      }],
    }, "sample.txt", "text", 1, "Câu 1: Chọn đáp án đúng?\n*A. Có\nB. Không")!;
    const merged = mergeExtractionResults(native, fallback);
    expect(merged.questions[0].correctAnswers).toEqual(["A"]);
    expect(merged.questions[0].answerStatus).toBe("evidence_supported");
    expect(merged.questions[0].answerEvidence?.[0].ruleId).toBe("option_marker_v1");
  });
});
