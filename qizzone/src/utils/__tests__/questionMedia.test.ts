import { describe, expect, it } from "vitest";
import { parseRawExamText } from "@/utils/parsers/ruleExtractor";
import { attachDocxImagesToQuestions, getOcrQuestionImageBounds } from "@/utils/parsers/questionMedia";
import type { DocumentIR } from "@/types/documentIR";

describe("document question media", () => {
  it("keeps DOCX diagrams in the prompt and images in their matching options", async () => {
    const source = [
      "Câu 1: Dựa vào hình sau, chọn nhận định đúng.",
      '<span data-image-id="chart-1">[Hình ảnh]</span>',
      'A. Phương án có hình <span data-image-id="option-a">[Hình ảnh]</span>',
      "B. Phương án không có hình",
    ].join("\n");
    const parsed = parseRawExamText(source, { fileName: "charts.docx", fileType: "docx" });
    const chart = "data:image/png;base64,Y2hhcnQ=";
    const optionImage = "data:image/png;base64,b3B0aW9u";

    const result = await attachDocxImagesToQuestions(parsed, {
      "chart-1": chart,
      "option-a": optionImage,
    });

    expect(result.questions[0].images).toEqual([chart]);
    expect(result.questions[0].options[0].images).toEqual([optionImage]);
    expect(result.questions[0].content).not.toContain("[Hình ảnh]");
    expect(result.questions[0].options[0].content).not.toContain("[Hình ảnh]");
  });

  it("includes the chart area but stops the scanned prompt crop before its answers", () => {
    const parsed = parseRawExamText("Câu 1: Dựa vào hình sau, chọn nhận định đúng.\nA. Đáp án một\nB. Đáp án hai", {
      fileName: "scan.jpg",
      fileType: "image",
    }).questions[0];
    const question = {
      ...parsed,
      promptSourceRefs: ["prompt"],
      options: parsed.options.map((option, index) => ({ ...option, sourceRefs: [index === 0 ? "option-a" : "option-b"] })),
    };
    const documentIR: DocumentIR = {
      schemaVersion: "2.0",
      sourceFormat: "image",
      parserVersion: "test",
      warnings: [],
      pages: [{
        pageNumber: 1,
        width: 600,
        height: 1000,
        blocks: [
          { id: "previous-question", type: "text_span", text: "Câu trước", bbox: [70, 30, 300, 50], readingOrder: 0, sourceRef: { page: 1 } },
          { id: "prompt", type: "text_span", text: question.content, bbox: [80, 100, 350, 130], readingOrder: 1, sourceRef: { page: 1 } },
          { id: "option-a", type: "text_span", text: "A. Đáp án một", bbox: [80, 240, 260, 270], readingOrder: 2, sourceRef: { page: 1 } },
          { id: "option-b", type: "text_span", text: "B. Đáp án hai", bbox: [80, 290, 260, 320], readingOrder: 3, sourceRef: { page: 1 } },
        ],
      }],
    };

    expect(getOcrQuestionImageBounds(question, documentIR, 600, 1000)).toEqual([44, 57, 386, 210]);
  });
});
