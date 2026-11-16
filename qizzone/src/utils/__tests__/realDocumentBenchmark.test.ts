import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as pdfjs from "pdfjs-dist";
import { parseRawExamText } from "@/utils/parsers/ruleExtractor";
import { cleanPdfExtractedText } from "@/utils/parsers/pdfCleaner";
import { shouldUseAIExtractionFallback } from "@/services/aiExtractionService";
import { parseDocxFile } from "@/utils/parsers/docxParser";
import { recognizeOcrPages } from "@/utils/parsers/ocrService";
import { getPdfPagePaintMarks, parsePdfFile } from "@/utils/parsers/pdfParser";

// The standard build targets browsers. Vitest uses PDF.js's Node-compatible build.
vi.mock("pdfjs-dist", async () => import("pdfjs-dist/legacy/build/pdf.mjs"));

const benchmarkDirectory = process.env.QIZZONE_REAL_DOCS_DIR;
interface RealDocumentBenchmarkCase {
  fileName: string;
  expectedQuestions: number;
  expectedFullyOptioned: number;
  expectedQuestionsWithOptions?: number;
  expectedWithoutOptions?: number;
  expectedEvidenceAnswers?: number;
  expectedHasAnswerKey?: boolean;
  expectedTwoOptionQuestions?: number;
}

const benchmarkCases: RealDocumentBenchmarkCase[] = [
  { fileName: "10_cau_trac_nghiem_triet_hoc_danh_dau_ngay_dap_an.docx", expectedQuestions: 10, expectedFullyOptioned: 6, expectedQuestionsWithOptions: 10, expectedEvidenceAnswers: 8 },
  { fileName: "10_cau_trac_nghiem_triet_hoc.docx", expectedQuestions: 10, expectedFullyOptioned: 10, expectedEvidenceAnswers: 10, expectedHasAnswerKey: true },
  { fileName: "60_cau_trac_nghiem_triet_hoc_4_kieu_danh_dau.docx", expectedQuestions: 60, expectedFullyOptioned: 60, expectedEvidenceAnswers: 59 },
  { fileName: "147_cau_ATTT_dap_an_to_vang.docx", expectedQuestions: 147, expectedFullyOptioned: 101, expectedTwoOptionQuestions: 46, expectedQuestionsWithOptions: 147, expectedEvidenceAnswers: 147 },
  { fileName: "147_cau_ATTT_dap_an_to_vang.pdf", expectedQuestions: 147, expectedFullyOptioned: 101, expectedTwoOptionQuestions: 46, expectedQuestionsWithOptions: 147, expectedEvidenceAnswers: 147 },
  { fileName: "TNChuong3.pdf", expectedQuestions: 55, expectedFullyOptioned: 55 },
];

const benchmarkDescribe = benchmarkDirectory ? describe : describe.skip;

benchmarkDescribe("Opt-in real document extraction benchmark", () => {
  for (const benchmarkCase of benchmarkCases) {
    const filePath = join(benchmarkDirectory || ".", benchmarkCase.fileName);
    const benchmarkIt = benchmarkDirectory && existsSync(filePath) ? it : it.skip;
    benchmarkIt(`extracts structure from ${benchmarkCase.fileName}`, async () => {
      const bytes = await readFile(filePath);
      const file = new File([bytes], benchmarkCase.fileName);
      const startedAt = performance.now();
      const parsed = benchmarkCase.fileName.toLowerCase().endsWith(".pdf")
        ? await parsePdfFile(file)
        : await parseDocxFile(file);
      const questions = parsed.result.questions;
      const questionsWithOptions = questions.filter(question => question.options.length >= 2).length;
      const twoOptionQuestions = questions.filter(question => question.options.length === 2).length;
      const fullyOptioned = questions.filter(question =>
        question.options.length === 4 && question.options.every((option, index) => option.id === ["A", "B", "C", "D"][index]),
      ).length;
      const withoutOptions = questions.filter(question => question.options.length === 0).length;
      const evidenceSupportedAnswers = questions.filter(question => question.answerStatus === "evidence_supported").length;
      const ambiguousAnswers = questions.filter(question => question.answerStatus === "ambiguous").length;
      const geminiFallbackNeeded = shouldUseAIExtractionFallback(parsed.result);
      const optionCountHistogram = questions.reduce<Record<number, number>>((counts, question) => {
        counts[question.options.length] = (counts[question.options.length] || 0) + 1;
        return counts;
      }, {});
      console.info("[real-document-benchmark]", JSON.stringify({
        file: benchmarkCase.fileName,
        expectedQuestions: benchmarkCase.expectedQuestions,
        extractedQuestions: questions.length,
        expectedFourOptionQuestions: benchmarkCase.expectedFullyOptioned,
        fourOptionQuestions: fullyOptioned,
        questionsWithOptions,
        optionCountHistogram,
        questionsWithoutSourceOptions: withoutOptions,
        hasAnswerKeyTable: parsed.result.hasAnswerKeyTable,
        sourceQuestionNumberSample: parsed.result.coverage?.sourceQuestionNumbers.slice(0, 25),
        evidenceSupportedAnswers,
        ambiguousAnswers,
        geminiFallbackNeeded,
        extractionMethod: parsed.result.extractionMethod,
        qualityFlags: parsed.result.qualityFlags || [],
        twoOptionQuestions,
        durationMs: Math.round(performance.now() - startedAt),
      }));

      expect(questions.length, "question count").toBe(benchmarkCase.expectedQuestions);
      expect(fullyOptioned, "source questions with ordered A/B/C/D choices").toBe(benchmarkCase.expectedFullyOptioned);
      expect(questionsWithOptions, "source questions with parsed choices").toBe(benchmarkCase.expectedQuestionsWithOptions ?? benchmarkCase.expectedQuestions);
      expect(withoutOptions, "questions without options in the source").toBe(benchmarkCase.expectedWithoutOptions || 0);
      if ("expectedTwoOptionQuestions" in benchmarkCase) {
        expect(twoOptionQuestions, "two-choice true/false questions").toBe(benchmarkCase.expectedTwoOptionQuestions);
        expect(questions.filter(question => question.options.length === 2).every(question =>
          question.options.map(option => option.content).join("/") === "Đúng/Sai",
        )).toBe(true);
      }
      expect(evidenceSupportedAnswers, "answer evidence cannot refer to questions without parsed choices").toBeLessThanOrEqual(questionsWithOptions);
      expect(geminiFallbackNeeded, "complete source structures do not need paid fallback").toBe(false);
      if ("expectedEvidenceAnswers" in benchmarkCase) {
        expect(evidenceSupportedAnswers, "evidence-supported answer count").toBe(benchmarkCase.expectedEvidenceAnswers);
      }
      if ("expectedHasAnswerKey" in benchmarkCase) {
        expect(parsed.result.hasAnswerKeyTable, "standalone answer-key section").toBe(benchmarkCase.expectedHasAnswerKey);
      }
    }, 120_000);
  }

  const longPdfPath = join(benchmarkDirectory || ".", "CNXHKH 2024 HUIT.docx.pdf");
  const longPdfIt = benchmarkDirectory && existsSync(longPdfPath) ? it : it.skip;
  longPdfIt("keeps all 353 questions separate after question 300 in the actual PDF", async () => {
    const bytes = await readFile(longPdfPath);
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
    const pagesText: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const records = content.items.flatMap(item => {
        if (!("str" in item) || !item.str.trim()) return [];
        return [{
          text: item.str,
          x: item.transform[4] || 0,
          y: item.transform[5] || 0,
          width: Math.max(0, item.width || 0),
          height: Math.max(1, item.height || Math.abs(item.transform[3]) || 1),
        }];
      });
      const rows: Array<typeof records> = [];
      for (const record of [...records].sort((a, b) => b.y - a.y || a.x - b.x)) {
        const current = rows[rows.length - 1];
        if (current && Math.abs(current[0].y - record.y) <= Math.max(3, record.height * 0.35)) current.push(record);
        else rows.push([record]);
      }
      pagesText.push(rows.map(row => {
        row.sort((a, b) => a.x - b.x);
        let line = "";
        let previous: typeof row[number] | undefined;
        for (const record of row) {
          const gap = previous ? record.x - (previous.x + previous.width) : 0;
          if (previous && gap > Math.max(1.5, previous.height * 0.12) && !line.endsWith(" ") && !record.text.startsWith(" ")) line += " ";
          line += record.text;
          previous = record;
        }
        return line.trim();
      }).filter(Boolean).join("\n"));
    }

    const rawText = cleanPdfExtractedText(pagesText);
    const result = parseRawExamText(rawText, { fileName: "CNXHKH 2024 HUIT.docx.pdf", fileType: "pdf" });

    expect(result.questions).toHaveLength(353);
    expect(result.coverage?.sourceQuestionNumbers.slice(-4)).toEqual([350, 351, 352, 353]);
    expect(result.questions[299].content).not.toContain("Tăng cường mối quan hệ");
    expect(result.questions[300].content).toContain("Tăng cường mối quan hệ");
    expect(result.questions[300].options).toHaveLength(4);
    expect(result.questions[300].options[3].content).not.toContain("Khái niệm dân tộc hiện nay");
    expect(result.questions[301].content).toContain("Khái niệm dân tộc hiện nay");
  }, 120_000);

  const q10AnswerMarkIt = benchmarkDirectory && existsSync(longPdfPath) ? it : it.skip;
  q10AnswerMarkIt("detects the highlighted D answer for question 10 in the actual PDF", async () => {
    const bytes = await readFile(longPdfPath);
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes) });
    const pdf = await loadingTask.promise;
    try {
      const page = await pdf.getPage(2);
      const content = await page.getTextContent();
      const items = content.items.flatMap(item => {
        if (!("str" in item) || !item.str.trim()) return [];
        return [{
          text: item.str,
          x: item.transform[4] || 0,
          y: item.transform[5] || 0,
          width: item.width || 0,
          height: Math.max(1, item.height || Math.abs(item.transform[3]) || 1),
        }];
      });
      const marks = await getPdfPagePaintMarks(page, items.map(item => item.text));
      const rows: Array<typeof items> = [];
      for (const item of [...items].sort((first, second) => second.y - first.y || first.x - second.x)) {
        const row = rows.find(candidate => Math.abs(candidate[0].y - item.y) <= Math.max(3, item.height * 0.35));
        if (row) row.push(item);
        else rows.push([item]);
      }
      const found = rows.flatMap(row => {
        if (row[0].y < 200 || row[0].y > 270) return [];
        const text = [...row].sort((first, second) => first.x - second.x).map(item => item.text).join("");
        const optionId = text.match(/^\s*([A-D])\./i)?.[1]?.toUpperCase();
        if (!optionId) return [];
        const bounds = [
          Math.min(...row.map(item => item.x)),
          Math.min(...row.map(item => item.y - item.height * 0.2)),
          Math.max(...row.map(item => item.x + item.width)),
          Math.max(...row.map(item => item.y + item.height * 0.9)),
        ];
        const highlighted = marks.vectorHighlights.some(mark =>
          mark[0] < bounds[2] && mark[2] > bounds[0] && mark[1] < bounds[3] && mark[3] > bounds[1]);
        return [{ optionId, text, highlighted }];
      });

      expect(found.map(option => option.optionId).sort()).toEqual(["A", "B", "C", "D"]);
      expect(found.find(option => option.optionId === "D")?.text).toContain("Rôbớt Ôoen");
      expect(found.filter(option => option.highlighted).map(option => option.optionId)).toEqual(["D"]);
    } finally {
      await loadingTask.destroy();
    }
  }, 30_000);

  const q10FullExtractionIt = benchmarkDirectory && existsSync(longPdfPath) ? it : it.skip;
  q10FullExtractionIt("extracts the highlighted D answer for question 10 end to end", async () => {
    const bytes = await readFile(longPdfPath);
    const parsed = await parsePdfFile(new File([bytes], "CNXHKH 2024 HUIT.docx.pdf"));
    const question = parsed.result.questions.find(item => item.order === 10);
    expect(question?.content).toContain("Nhà tư tưởng xã hội chủ nghĩa nào");
    expect(question?.options.map(option => option.id)).toEqual(["A", "B", "C", "D"]);
    expect(question?.correctAnswers).toEqual(["D"]);
    expect(question?.detectionStrategy).toBe("highlight_color");
  }, 150_000);

  const markedDocxPath = join(benchmarkDirectory || ".", "147_cau_ATTT_dap_an_to_vang.docx");
  const markedPdfPath = join(benchmarkDirectory || ".", "147_cau_ATTT_dap_an_to_vang.pdf");
  const comparisonIt = benchmarkDirectory && existsSync(markedDocxPath) && existsSync(markedPdfPath) ? it : it.skip;
  comparisonIt("compares DOCX and PDF answer evidence", async () => {
    const [docxBytes, pdfBytes] = await Promise.all([readFile(markedDocxPath), readFile(markedPdfPath)]);
    const [docx, pdf] = await Promise.all([
      parseDocxFile(new File([docxBytes], "147_cau_ATTT_dap_an_to_vang.docx")),
      parsePdfFile(new File([pdfBytes], "147_cau_ATTT_dap_an_to_vang.pdf")),
    ]);
    const pdfQuestions = new Map(pdf.result.questions.map(question => [question.order, question]));
    const docxByOrder = new Map(docx.result.questions.map(question => [question.order, question]));
    const sharedAnswers = docx.result.questions.flatMap(question => {
      const pdfQuestion = pdfQuestions.get(question.order);
      return question.answerStatus === "evidence_supported" && pdfQuestion?.answerStatus === "evidence_supported"
        ? [{ docx: [...question.correctAnswers].sort().join(","), pdf: [...pdfQuestion.correctAnswers].sort().join(",") }]
        : [];
    });
    const exactAnswerAgreement = sharedAnswers.filter(answer => answer.docx === answer.pdf).length;
    const exactQuestionTextMatches = pdf.result.questions.filter(question =>
      question.content.normalize("NFKC").replace(/\s+/g, " ").trim() ===
      docxByOrder.get(question.order)?.content.normalize("NFKC").replace(/\s+/g, " ").trim(),
    ).length;
    const exactFullQuestionMatches = pdf.result.questions.filter(question => {
      const docxQuestion = docxByOrder.get(question.order);
      return question.content.normalize("NFKC").replace(/\s+/g, " ").trim() ===
        docxQuestion?.content.normalize("NFKC").replace(/\s+/g, " ").trim() &&
        question.options.length === docxQuestion.options.length &&
        question.options.every((option, index) => option.id === docxQuestion.options[index]?.id &&
          option.content.normalize("NFKC").replace(/\s+/g, " ").trim() ===
          docxQuestion.options[index]?.content.normalize("NFKC").replace(/\s+/g, " ").trim());
    }).length;

    console.info("[real-document-answer-agreement]", JSON.stringify({
      docxEvidenceAnswers: docx.result.questions.filter(question => question.answerStatus === "evidence_supported").length,
      pdfEvidenceAnswers: pdf.result.questions.filter(question => question.answerStatus === "evidence_supported").length,
      sharedEvidenceAnswers: sharedAnswers.length,
      exactAnswerAgreement,
      exactQuestionTextMatches,
      exactFullQuestionMatches,
    }));
    expect(sharedAnswers.length).toBe(147);
    expect(exactAnswerAgreement).toBe(sharedAnswers.length);
    expect(exactQuestionTextMatches).toBe(147);
    expect(exactFullQuestionMatches).toBe(147);
  }, 120_000);

  const ocrImagePath = process.env.QIZZONE_REAL_OCR_IMAGE_PATH;
  const ocrBenchmarkIt = benchmarkDirectory && ocrImagePath && existsSync(ocrImagePath) ? it : it.skip;
  ocrBenchmarkIt("recognizes questions from a rendered page of the real PDF", async () => {
    const pdfPath = join(benchmarkDirectory || ".", "TNChuong3.pdf");
    if (!benchmarkDirectory || !existsSync(pdfPath)) return;
    const pdfBytes = await readFile(pdfPath);
    const reference = await parsePdfFile(new File([pdfBytes], "TNChuong3.pdf"));
    const expectedQuestionCount = parseRawExamText(reference.pagesText[1] || "", { fileType: "pdf" }).questions.length;
    const [page] = await recognizeOcrPages([{ pageNumber: 2, image: ocrImagePath! }]);
    const ocrQuestionCount = parseRawExamText(page.text, { fileType: "pdf" }).questions.length;
    console.info("[real-document-ocr-benchmark]", JSON.stringify({
      page: page.pageNumber,
      characters: page.text.length,
      confidencePercent: Math.round(page.confidence * 100),
      expectedQuestionCount,
      ocrQuestionCount,
    }));
    expect(page.confidence).toBeGreaterThan(0.65);
    expect(ocrQuestionCount).toBe(expectedQuestionCount);
  }, 120_000);
});
