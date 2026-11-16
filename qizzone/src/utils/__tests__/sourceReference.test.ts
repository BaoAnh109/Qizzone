import { describe, expect, it } from "vitest";
import type { DocumentIR } from "@/types/documentIR";
import { parseRawExamText } from "@/utils/parsers/ruleExtractor";
import { attachQuestionSourceReferences } from "@/utils/parsers/sourceReference";

describe("question source references", () => {
  it("chooses the repeated answer text nearest to its own prompt", () => {
    const parsed = parseRawExamText([
      "Câu 1: Trong tình huống này, vật chuyển động thẳng đều như thế nào?",
      "A. Đứng yên",
      "B. Chuyển động thẳng đều",
    ].join("\n"), { fileName: "repeated-options.pdf", fileType: "pdf" });
    const documentIR: DocumentIR = {
      schemaVersion: "2.0",
      sourceFormat: "pdf",
      parserVersion: "test",
      warnings: [],
      pages: [{
        pageNumber: 1,
        width: 600,
        height: 800,
        blocks: [
          { id: "prompt", type: "text_span", text: "Trong tình huống này, vật chuyển động thẳng đều như thế nào?", bbox: [80, 700, 420, 720], readingOrder: 0, sourceRef: { page: 1 } },
          { id: "local-answer", type: "text_span", text: "B. Chuyển động thẳng đều", bbox: [80, 650, 260, 670], readingOrder: 1, sourceRef: { page: 1 } },
          { id: "repeated-later", type: "text_span", text: "D. Thang máy chuyển động thẳng đều", bbox: [80, 300, 340, 320], readingOrder: 2, sourceRef: { page: 1 } },
        ],
      }],
    };

    const linked = attachQuestionSourceReferences(parsed, documentIR);
    expect(linked.questions[0].options.find(option => option.id === "B")?.sourceRefs).toEqual(["local-answer"]);
  });
});
