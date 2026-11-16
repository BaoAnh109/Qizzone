import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseRawExamText } from "@/utils/parsers/ruleExtractor";
import { shouldUseAIExtractionFallback } from "@/services/aiExtractionService";
import { parseDocxFile } from "@/utils/parsers/docxParser";
import { recognizeOcrPages } from "@/utils/parsers/ocrService";
import { parsePdfFile } from "@/utils/parsers/pdfParser";

// The standard build targets browsers. Vitest uses PDF.js's Node-compatible build.
vi.mock("pdfjs-dist", async () => import("pdfjs-dist/legacy/build/pdf.mjs"));

const benchmarkDirectory = process.env.QIZZONE_REAL_DOCS_DIR;
const benchmarkCases = [
  { fileName: "10_cau_trac_nghiem_triet_hoc_danh_dau_ngay_dap_an.docx", expectedQuestions: 10, expectedFullyOptioned: 6, expectedQuestionsWithOptions: 10, expectedEvidenceAnswers: 8 },
  { fileName: "10_cau_trac_nghiem_triet_hoc.docx", expectedQuestions: 10, expectedFullyOptioned: 10, expectedEvidenceAnswers: 10, expectedHasAnswerKey: true },
  { fileName: "60_cau_trac_nghiem_triet_hoc_4_kieu_danh_dau.docx", expectedQuestions: 60, expectedFullyOptioned: 60, expectedEvidenceAnswers: 59 },
  { fileName: "147_cau_ATTT_dap_an_to_vang.docx", expectedQuestions: 147, expectedFullyOptioned: 101, expectedQuestionsWithOptions: 101, expectedWithoutOptions: 46, expectedEvidenceAnswers: 101 },
  { fileName: "147_cau_ATTT_dap_an_to_vang.pdf", expectedQuestions: 147, expectedFullyOptioned: 101, expectedQuestionsWithOptions: 101, expectedWithoutOptions: 46, expectedEvidenceAnswers: 101 },
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
        durationMs: Math.round(performance.now() - startedAt),
      }));

      expect(questions.length, "question count").toBe(benchmarkCase.expectedQuestions);
      expect(fullyOptioned, "source questions with ordered A/B/C/D choices").toBe(benchmarkCase.expectedFullyOptioned);
      expect(questionsWithOptions, "source questions with parsed choices").toBe(benchmarkCase.expectedQuestionsWithOptions ?? benchmarkCase.expectedQuestions);
      expect(withoutOptions, "questions without options in the source").toBe(benchmarkCase.expectedWithoutOptions || 0);
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

  const markedDocxPath = join(benchmarkDirectory || ".", "147_cau_ATTT_dap_an_to_vang.docx");
  const markedPdfPath = join(benchmarkDirectory || ".", "147_cau_ATTT_dap_an_to_vang.pdf");
  const comparisonIt = benchmarkDirectory && existsSync(markedDocxPath) && existsSync(markedPdfPath) ? it : it.skip;
  comparisonIt("compares independently marked DOCX and PDF answers", async () => {
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
    expect(sharedAnswers.length).toBe(101);
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
