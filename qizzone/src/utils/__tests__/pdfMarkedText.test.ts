import { describe, expect, it } from "vitest";
import { parseRawExamText } from "@/utils/parsers/ruleExtractor";

describe("PDF text with yellow highlights", () => {
  it("extracts lowercase options, preserving marked answer", () => {
    const pdfText = `Câu 1. Loại virus biến đổi mã?
a. Stealth
<mark>b. Metamorphic</mark>
c. Polymorphic
d. Encrypted`;
    const result = parseRawExamText(pdfText, { fileType: "pdf" });
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].options.map(o => o.id)).toEqual(["A", "B", "C", "D"]);
    expect(result.questions[0].correctAnswers).toEqual(["B"]);
  });

  it("extracts true/false marked lines as native true_false", () => {
    const pdfText = `Câu 1. Rootkit có thể che giấu tiến trình.
<mark>Đúng</mark>
Sai`;
    const result = parseRawExamText(pdfText, { fileType: "pdf" });
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].type).toBe("true_false");
    expect(result.questions[0].options.map(o => o.content)).toEqual(["Đúng", "Sai"]);
    expect(result.questions[0].correctAnswers).toEqual(["A"]);
  });
});
