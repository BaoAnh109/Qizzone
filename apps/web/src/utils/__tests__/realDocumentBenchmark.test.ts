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
const publicBenchmarkDirectory = process.env.QIZZONE_PUBLIC_DOCS_DIR;
interface RealDocumentBenchmarkCase {
  fileName: string;
  expectedQuestions: number;
  directory?: "public";
  expectedMinimumVisualBlocks?: number;
  expectedFullyOptioned?: number;
  expectedQuestionsWithOptions?: number;
  expectedWithoutOptions?: number;
  expectedEvidenceAnswers?: number;
  expectedHasAnswerKey?: boolean;
  expectedTwoOptionQuestions?: number;
  expectedDuplicateSourceNumbers?: number;
  expectTrueFalseOptions?: boolean;
  expectOcrUnavailable?: boolean;
  expectOcrLimitExceeded?: boolean;
  expectAIFallback?: boolean;
  requireNoAIFallback?: boolean;
}

const benchmarkCases: RealDocumentBenchmarkCase[] = [
  { fileName: "10_cau_trac_nghiem_triet_hoc_danh_dau_ngay_dap_an.docx", expectedQuestions: 10, expectedFullyOptioned: 6, expectedQuestionsWithOptions: 10, expectedEvidenceAnswers: 8, requireNoAIFallback: true },
  { fileName: "10_cau_trac_nghiem_triet_hoc.docx", expectedQuestions: 10, expectedFullyOptioned: 10, expectedQuestionsWithOptions: 10, expectedEvidenceAnswers: 10, expectedHasAnswerKey: true, requireNoAIFallback: true },
  { fileName: "60_cau_trac_nghiem_triet_hoc_4_kieu_danh_dau.docx", expectedQuestions: 60, expectedFullyOptioned: 60, expectedQuestionsWithOptions: 60, expectedEvidenceAnswers: 59, requireNoAIFallback: true },
  { fileName: "147_cau_ATTT_dap_an_to_vang.docx", expectedQuestions: 147, expectedFullyOptioned: 101, expectedTwoOptionQuestions: 46, expectTrueFalseOptions: true, expectedQuestionsWithOptions: 147, expectedEvidenceAnswers: 147, requireNoAIFallback: true },
  { fileName: "147_cau_ATTT_dap_an_to_vang.pdf", expectedQuestions: 147, expectedFullyOptioned: 101, expectedTwoOptionQuestions: 46, expectTrueFalseOptions: true, expectedQuestionsWithOptions: 147, expectedEvidenceAnswers: 147, requireNoAIFallback: true },
  { fileName: "TNChuong3.pdf", expectedQuestions: 55, expectedFullyOptioned: 55, expectedQuestionsWithOptions: 55, requireNoAIFallback: true },
  { fileName: "MongoDB_30_cau_Anh_Viet_ABCD_Chu_Hoa.docx", expectedQuestions: 60, expectedDuplicateSourceNumbers: 30 },
  { fileName: "MongoDB_30_English_Cau_Answer_Key.docx", expectedQuestions: 30 },
  { fileName: "Ngan_hang_150_cau_Tu_tuong_Ho_Chi_Minh AI soạn dùng để test khi đọc xong giáo trình.docx", expectedQuestions: 250 },
  { fileName: "Ngan_hang_250_cau_Tu_tuong_Ho_Chi_Minh_trac_nghiem_kem_bang_dap_an.docx", expectedQuestions: 250 },
  { fileName: "50 đầu.pdf", expectedQuestions: 0, expectOcrUnavailable: true, expectOcrLimitExceeded: true, expectAIFallback: true },
  { fileName: "51-100.pdf", expectedQuestions: 0, expectOcrUnavailable: true, expectOcrLimitExceeded: true, expectAIFallback: true },
  { fileName: "101-157.pdf", expectedQuestions: 0, expectOcrUnavailable: true, expectOcrLimitExceeded: true, expectAIFallback: true },
  { fileName: "2023-physics.pdf", expectedQuestions: 34, directory: "public", expectAIFallback: true },
  { fileName: "2024-geography.pdf", expectedQuestions: 156, directory: "public", expectedMinimumVisualBlocks: 1, expectAIFallback: true },
  { fileName: "2025-math-first-100.pdf", expectedQuestions: 242, directory: "public", expectedMinimumVisualBlocks: 1, expectAIFallback: true },
  { fileName: "2023-physics-page-1-scan.pdf", expectedQuestions: 0, directory: "public", expectOcrUnavailable: true },
];

const benchmarkDescribe = benchmarkDirectory || publicBenchmarkDirectory ? describe : describe.skip;

benchmarkDescribe("Opt-in real document extraction benchmark", () => {
  for (const benchmarkCase of benchmarkCases) {
    const caseDirectory = benchmarkCase.directory === "public" ? publicBenchmarkDirectory : benchmarkDirectory;
    const filePath = join(caseDirectory || ".", benchmarkCase.fileName);
    const benchmarkIt = caseDirectory && existsSync(filePath) ? it : it.skip;
    benchmarkIt(`extracts structure from ${benchmarkCase.fileName}`, async () => {
      const bytes = await readFile(filePath);
      const file = new File([bytes], benchmarkCase.fileName);
      const startedAt = performance.now();
      const parsed = benchmarkCase.fileName.toLowerCase().endsWith(".pdf")
        ? await parsePdfFile(file)
        : await parseDocxFile(file);
      const questions = parsed.result.questions;
      const qualityFlags = "qualityFlags" in parsed ? parsed.qualityFlags : parsed.result.qualityFlags || [];
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
      const sourceQuestionNumbers = parsed.result.coverage?.sourceQuestionNumbers || [];
      const duplicateSourceQuestionNumbers = sourceQuestionNumbers.length - new Set(sourceQuestionNumbers).size;
      const visualBlockCount = parsed.documentIR.pages.flatMap(page => page.blocks)
        .filter(block => block.type === "image" || block.type === "shape").length;
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
        qualityFlags,
        twoOptionQuestions,
        duplicateSourceQuestionNumbers,
        visualBlockCount,
        durationMs: Math.round(performance.now() - startedAt),
      }));

      expect(questions.length, "question count").toBe(benchmarkCase.expectedQuestions);
      if (benchmarkCase.expectedFullyOptioned !== undefined) {
        expect(fullyOptioned, "source questions with ordered A/B/C/D choices").toBe(benchmarkCase.expectedFullyOptioned);
      }
      if (benchmarkCase.expectedQuestionsWithOptions !== undefined) {
        expect(questionsWithOptions, "source questions with parsed choices").toBe(benchmarkCase.expectedQuestionsWithOptions);
      }
      if (benchmarkCase.expectedDuplicateSourceNumbers !== undefined) {
        expect(duplicateSourceQuestionNumbers, "intentional repeated numbering in bilingual variants").toBe(benchmarkCase.expectedDuplicateSourceNumbers);
      }
      if (benchmarkCase.expectedWithoutOptions !== undefined) {
        expect(withoutOptions, "questions without options in the source").toBe(benchmarkCase.expectedWithoutOptions);
      }
      if (benchmarkCase.expectOcrUnavailable) {
        expect(qualityFlags).toContain("ocr_requires_browser_runtime");
        expect(qualityFlags).toContain("scan_pages_unprocessed");
      }
      if (benchmarkCase.expectOcrLimitExceeded) {
        expect(qualityFlags).toContain("ocr_page_limit_exceeded");
      }
      if (benchmarkCase.expectAIFallback !== undefined) {
        expect(geminiFallbackNeeded, "fallback status matches the incomplete or ambiguous source").toBe(benchmarkCase.expectAIFallback);
      }
      if (benchmarkCase.expectedMinimumVisualBlocks !== undefined) {
        expect(visualBlockCount, "detected diagram, chart, map, or embedded image regions").toBeGreaterThanOrEqual(benchmarkCase.expectedMinimumVisualBlocks);
      }
      if ("expectedTwoOptionQuestions" in benchmarkCase) {
        expect(twoOptionQuestions, "two-choice true/false questions").toBe(benchmarkCase.expectedTwoOptionQuestions);
        if (benchmarkCase.expectTrueFalseOptions) {
          expect(questions.filter(question => question.options.length === 2).every(question =>
            question.options.map(option => option.content).join("/") === "Đúng/Sai",
          )).toBe(true);
        }
      }
      expect(evidenceSupportedAnswers, "answer evidence cannot refer to questions without parsed choices").toBeLessThanOrEqual(questionsWithOptions);
      if (benchmarkCase.requireNoAIFallback) {
        expect(geminiFallbackNeeded, "complete source structures do not need paid fallback").toBe(false);
      }
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
  q10FullExtractionIt("extracts question 10 and its highlighted D answer end to end", async () => {
    const bytes = await readFile(longPdfPath);
    const startedAt = performance.now();
    const parsed = await parsePdfFile(new File([bytes], "CNXHKH 2024 HUIT.docx.pdf"));
    const invalidQuestionCount = parsed.result.questions.filter(question =>
      question.options.length < 2 || question.options.length > 4 || question.options.some(option => !option.content.trim()),
    ).length;
    const unsupportedAnswerCount = parsed.result.questions.filter(question => question.answerStatus === "unknown").length;
    console.info("[real-document-long-pdf]", JSON.stringify({
      totalPages: parsed.totalPages,
      questionCount: parsed.result.questions.length,
      invalidQuestionCount,
      unsupportedAnswerCount,
      aiFallbackNeeded: shouldUseAIExtractionFallback(parsed.result),
      durationMs: Math.round(performance.now() - startedAt),
      qualityFlags: parsed.result.qualityFlags,
    }));
    expect(parsed.result.questions).toHaveLength(353);
    expect(parsed.result.qualityFlags).not.toContain("question_count_mismatch");
    expect(parsed.result.qualityFlags).not.toContain("question_number_gap_or_duplicate");
    const question = parsed.result.questions.find(item => item.order === 10);
    expect(question?.content).toContain("Nhà tư tưởng xã hội chủ nghĩa nào");
    expect(question?.options.map(option => option.id)).toEqual(["A", "B", "C", "D"]);
    expect(question?.correctAnswers).toEqual(["D"]);
    expect(question?.detectionStrategy).toBe("highlight_color");
  }, 150_000);

  const oversizedMathPath = join(publicBenchmarkDirectory || ".", "2025-math.pdf");
  const oversizedMathIt = publicBenchmarkDirectory && existsSync(oversizedMathPath) ? it : it.skip;
  oversizedMathIt("rejects the 188-page math PDF before page-level extraction", async () => {
    const bytes = await readFile(oversizedMathPath);
    await expect(parsePdfFile(new File([bytes], "2025-math.pdf"))).rejects.toThrow("PDF vượt quá giới hạn 100 trang.");
  }, 30_000);

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

    const contentMismatchOrders = pdf.result.questions.flatMap(question => {
      const docxQuestion = docxByOrder.get(question.order);
      const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim();
      const sameContent = docxQuestion && normalize(question.content) === normalize(docxQuestion.content);
      const sameOptions = docxQuestion && question.options.length === docxQuestion.options.length &&
        question.options.every((option, index) => option.id === docxQuestion.options[index]?.id &&
          normalize(option.content) === normalize(docxQuestion.options[index]?.content));
      if (sameContent && sameOptions) return [];
      return [{
        order: question.order,
        pdf: question.options.map(option => `${option.id}. ${option.content}`),
        docx: docxQuestion?.options.map(option => `${option.id}. ${option.content}`),
      }];
    });
    console.info("[real-document-answer-agreement]", JSON.stringify({
      docxEvidenceAnswers: docx.result.questions.filter(question => question.answerStatus === "evidence_supported").length,
      pdfEvidenceAnswers: pdf.result.questions.filter(question => question.answerStatus === "evidence_supported").length,
      sharedEvidenceAnswers: sharedAnswers.length,
      exactAnswerAgreement,
      exactQuestionTextMatches,
      exactFullQuestionMatches,
      contentMismatchOrders,
    }));
    expect(sharedAnswers.length).toBe(147);
    expect(exactAnswerAgreement).toBe(sharedAnswers.length);
    expect(exactQuestionTextMatches).toBe(147);
    expect(exactFullQuestionMatches).toBe(147);
  }, 120_000);

  const ocrImagePaths = [
    process.env.QIZZONE_REAL_OCR_IMAGE_PATH,
    process.env.QIZZONE_REAL_OCR_IMAGE_PATH_ROTATED,
  ].filter((path): path is string => Boolean(path));
  const syntheticOcrImagePath = process.env.QIZZONE_SYNTHETIC_OCR_IMAGE_PATH;
  const ocrReferencePdfPath = process.env.QIZZONE_OCR_REFERENCE_PDF_PATH;
  const ocrPageNumber = Number(process.env.QIZZONE_OCR_PAGE_NUMBER || "2");
  const ocrBenchmarkIt = ocrImagePaths.length === 2 && syntheticOcrImagePath && ocrReferencePdfPath &&
    [...ocrImagePaths, syntheticOcrImagePath, ocrReferencePdfPath].every(existsSync) ? it : it.skip;
  ocrBenchmarkIt("recognizes original, rotated, and synthetic Vietnamese exam images", async () => {
    const pdfBytes = await readFile(ocrReferencePdfPath!);
    const reference = await parsePdfFile(new File([pdfBytes], "OCR-reference.pdf"));
    const expectedQuestionCount = parseRawExamText(reference.pagesText[ocrPageNumber - 1] || "", { fileType: "pdf" }).questions.length;
    const startedAt = performance.now();
    const pages = await recognizeOcrPages([
      ...ocrImagePaths.map(image => ({ pageNumber: ocrPageNumber, image })),
      { pageNumber: 1, image: syntheticOcrImagePath! },
    ]);
    const measurements = pages.slice(0, ocrImagePaths.length).map((page, index) => ({
      image: ocrImagePaths[index],
      characters: page.text.length,
      confidencePercent: Math.round(page.confidence * 100),
      expectedQuestionCount,
      ocrQuestionCount: parseRawExamText(page.text, { fileType: "pdf" }).questions.length,
    }));
    const syntheticResult = parseRawExamText(pages[2].text, { fileType: "image" });
    const syntheticQuestion = syntheticResult.questions[0];
    console.info("[real-document-ocr-benchmark]", JSON.stringify({
      measurements,
      synthetic: {
        confidencePercent: Math.round(pages[2].confidence * 100),
        text: pages[2].text,
        questionCount: syntheticResult.questions.length,
        optionIds: syntheticQuestion?.options.map(option => option.id),
        prompt: syntheticQuestion?.content,
      },
      durationMs: Math.round(performance.now() - startedAt),
    }));
    expect(pages.every(page => page.confidence > 0.65)).toBe(true);
    expect(measurements.every(measurement => Math.abs(measurement.ocrQuestionCount - expectedQuestionCount) <= 2)).toBe(true);
    expect(syntheticResult.questions).toHaveLength(1);
    expect(syntheticQuestion?.options.map(option => option.id)).toEqual(["A", "B", "C", "D"]);
    expect(syntheticQuestion?.content.toLocaleLowerCase()).toContain("đạo hàm");
  }, 120_000);
});
