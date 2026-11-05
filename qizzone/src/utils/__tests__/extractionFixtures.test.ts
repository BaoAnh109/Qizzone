/**
 * Runner đo parser hiện tại trên fixtures có ground truth (bước 02, PLAN_MAIN).
 *
 * - Đọc mọi `*.expected.json` trong `qizzone/tests/fixtures/extraction/`,
 *   chạy parser luật hiện tại (parseDocxFile / parsePdfFile / parseRawExamText),
 *   KHÔNG gọi Gemini, KHÔNG OCR, KHÔNG tốn API.
 * - So sánh theo order xuất hiện: missing / extra / duplicate / stem mismatch /
 *   options mismatch / answer mismatch. Type, page, evidence, strategy, ảnh
 *   chỉ ghi nhận dạng info (parser hiện tại chưa có các trường này).
 * - Ghi `tests/fixtures/extraction/report.json` + in bảng tổng kết.
 * - Bước 10 (PLAN_MAIN) mở rộng runner theo hướng cộng thêm, KHÔNG sửa
 *   logic so sánh cũ: mỗi fixture kèm `gateStatus` + `gateIssueCodes` của
 *   Quality Gate tổng (chạy trên kết quả parser qua adapter V1 → V2; DOCX
 *   kèm quality bước 07, PDF kèm totalPages khi biết được). Gate chỉ đo,
 *   test vẫn không fail theo gateStatus.
 * - Bước 11 (PLAN_MAIN) cộng thêm tương tự: mỗi fixture kèm verdict của
 *   Evidence Validator (valid/downgraded/conflict/invalid + mã vấn đề).
 *   Context đối chiếu chỉ gồm flag định dạng từng phương án lấy từ parser
 *   V1 — và CHỈ cấp map khi parser thực sự ghi nhận flag: PDF text layer
 *   không có dữ liệu định dạng nên để unchecked, không suy thành mismatch.
 *   Bảng đáp án / dòng đáp án cuối câu / lời giải không cấp ở runner này
 *   (đó là dữ liệu nguồn mà parser đã tiêu thụ; đối chiếu bảng/dòng/lời
 *   giải được cover bằng test đơn vị của validator).
 * - Bước 13 (PLAN_MAIN) cộng thêm tương tự: mỗi câu kèm `gotSourceNumber`
 *   + `sourceNumberOk` (số câu gốc parser giữ được so với số trong label
 *   ground truth), totals kèm khối `sourceNumber` (match/total trên câu
 *   matched). Chỉ đo, không gate test, không đổi logic so sánh cũ.
 * - Bước 15 (PLAN_MAIN) cộng thêm tương tự: mỗi câu PDF kèm `gotPage` +
 *   `pageOk` (số trang parser gắn được so với `page` ground truth),
 *   totals kèm khối `page` (match/total trên câu matched của fixture PDF;
 *   DOCX/text không có phân trang chắc chắn nên không tính). Fallback
 *   legacy dùng chung helper mới (orderPageLines/cleanPdfPages/
 *   assignQuestionPages) để hai đường PDF cho cùng kết quả. Chỉ đo,
 *   không gate test, không đổi logic so sánh cũ.
 * - Bước 19 (PLAN_MAIN) cộng thêm tương tự: chạy chunking trên V2 rồi
 *   mới chạy gate + validator (PDF: một chunk/trang; DOCX/text: một
 *   chunk cho toàn tài liệu vì runner không có IR segment để chunk
 *   theo khối), totals kèm khối `chunks` (complete/partial/failed).
 *   Chỉ đo, không gate test, không đổi logic so sánh cũ.
 * - Bước 22 (PLAN_MAIN) cộng thêm tương tự: chạy Reconcile bằng bằng
 *   chứng trên V2 đã qua validator (context định dạng từ parser V1 như
 *   bước 11) rồi so đáp án V2 đã reconcile với ground truth — số này
 *   đo RIÊNG (reconciledAnswerMismatch / reconciledFullyOk), KHÔNG
 *   thay số V1 (answerMismatch / fullyOkQuestions) để vẫn so được với
 *   baseline đóng băng. Chỉ đo, không gate test.
 *   thêm latency từng fixture, content exact match (NFC + trim + gộp
 *   whitespace, vẫn giải HTML entity do parser xuất ra — chặt hơn
 *   normalized match nhưng không phạt artifact entity), CSV benchmark
 *   (`benchmark.csv`), và khối rates/cost ở totals. Không gọi Gemini
 *   (chưa có consent/quota) nên baseline Gemini ghi null, không bịa số.
 *
 * CỐ TÌNH KHÔNG fail test khi parser lệch ground truth: bước 02 là đo,
 * bước 03 mới đóng băng baseline. Test chỉ fail khi runner không chạy được
 * (không đọc được fixture, parser throw không bắt được, không ghi được report).
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseDocxFile } from "@/utils/parsers/docxParser";
import {
  parsePdfFile,
  orderPageLines,
  assignQuestionPages,
} from "@/utils/parsers/pdfParser";
import { parseRawExamText } from "@/utils/parsers/ruleExtractor";
import { cleanPdfPages } from "@/utils/parsers/pdfCleaner";
// pdfjs bản modern (mà parsePdfFile dùng) lỗi trong môi trường Node của
// vitest ("hashOriginal.toHex is not a function"); bản legacy thì chạy.
// Fallback này chỉ đo phần "text layer + rule parser" của PDF, và được
// ghi rõ cờ pdfFallback trong report — không giả vờ là parsePdfFile.
import * as pdfjsLegacy from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ExtractedQuestion, ExtractionResult } from "@/types/extractor";
import type { ExtractionV2Result } from "@/types/extractionV2";
import {
  fromDocxParseOutput,
  fromV1Result,
} from "@/services/extraction/v2Adapter";
import {
  assessExtractionQuality,
  type QualityGateStatus,
} from "@/services/extraction/qualityGate";
import {
  applyEvidenceValidation,
  validateEvidence,
  type OptionFormatFlags,
  type QuestionEvidenceContext,
} from "@/services/extraction/evidenceValidator";
import { reconcileResult } from "@/services/extraction/reconcile";
import {
  attachChunksToV2,
  buildDocumentChunk,
  buildPageChunks,
} from "@/services/extraction/chunking";
import type { OptionId } from "@/types/quiz";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(HERE, "../../../tests/fixtures/extraction");
const REPORT_PATH = path.join(FIXTURE_DIR, "report.json");

interface ExpectedOption {
  key: string;
  text: string;
}
interface ExpectedQuestion {
  order: number;
  label: string;
  type: string;
  stem: string;
  options: ExpectedOption[];
  correctAnswers: string[];
  answerOrigin: string;
  page: number;
  evidence: string;
  hasImage?: boolean;
}
interface ExpectedFixture {
  id: string;
  file: string;
  format: string;
  notes: string;
  questions: ExpectedQuestion[];
}

interface PerQuestionResult {
  order: number;
  label: string;
  status: "ok" | "missing" | "stem_mismatch" | "options_mismatch" | "answer_mismatch" | "multi_mismatch";
  gotStem: string;
  gotOptions: Record<string, string>;
  gotAnswers: string[];
  gotStrategy: string;
  gotImages: number;
  mismatches: string[];
  /** Bước 03: exact match (NFC + trim + gộp whitespace), chặt hơn norm(). */
  stemExact: boolean;
  optionsExact: boolean;
  /**
   * Bước 13 (cộng thêm, chỉ đo): số câu gốc parser giữ được so với số
   * trong label ground truth ("Câu 2" → 2). Câu missing không tính.
   */
  gotSourceNumber: number | null;
  sourceNumberOk: boolean;
  /**
   * Bước 15 (cộng thêm, chỉ đo): số trang parser gắn được so với `page`
   * ground truth. Chỉ tính trên fixture PDF + câu matched; DOCX/text
   * không có phân trang chắc chắn nên gotPage null và không tính.
   */
  gotPage: number | null;
  pageOk: boolean;
}

interface FixtureResult {
  id: string;
  file: string;
  format: string;
  expected: number;
  got: number;
  missing: number[];
  extra: number[];
  duplicates: string[];
  stemMismatch: number;
  optionsMismatch: number;
  answerMismatch: number;
  error: string | null;
  pdfFallback: boolean;
  perQuestion: PerQuestionResult[];
  /** Bước 03: ms đo quanh lần parse của fixture (không gồm đọc file). */
  latencyMs: number;
  stemExactMatch: number;
  optionsExactMatch: number;
  /**
   * Bước 10 (cộng thêm, chỉ đo — KHÔNG gate test): trạng thái Quality Gate
   * tổng khi chạy trên kết quả parser của fixture này (chuyển V1 → V2 qua
   * adapter; DOCX kèm quality bước 07, PDF kèm totalPages khi biết được).
   * Test vẫn không fail theo gateStatus — số này chỉ để đọc xu hướng.
   */
  gateStatus: QualityGateStatus;
  gateIssueCodes: string[];
  /**
   * Bước 11 (cộng thêm, chỉ đo — KHÔNG gate test): verdict của Evidence
   * Validator theo từng câu (valid/downgraded/conflict/invalid) + mã vấn
   * đề, đếm từ kết quả validator trên V2 của fixture này.
   */
  evidenceValid: number;
  evidenceDowngraded: number;
  evidenceConflict: number;
  evidenceInvalid: number;
  evidenceUnchecked: number;
  evidenceIssueCodes: string[];
  /**
   * Bước 13 (cộng thêm, chỉ đo): số câu matched giữ đúng sourceNumber
   * trên tổng số câu matched (câu missing không tính).
   */
  sourceNumberMatch: number;
  sourceNumberTotal: number;
  /**
   * Bước 15 (cộng thêm, chỉ đo): số câu matched của fixture PDF giữ đúng
   * `page` ground truth (câu missing không tính; fixture không phải PDF
   * thì cả hai đều 0).
   */
  pageMatch: number;
  pageTotal: number;
  /**
   * Bước 16 (cộng thêm, chỉ đo): fixture PDF có cần OCR không (toàn scan
   * hoặc xen text/scan) và danh sách trang scan (1-based). Fixture không
   * phải PDF thì ocrNeeded=false, ocrPages=[].
   */
  ocrNeeded: boolean;
  ocrPages: number[];
  /**
   * Bước 19 (cộng thêm, chỉ đo): số chunk theo trạng thái khi chạy
   * chunking trên V2 của fixture này (PDF: một chunk/trang; DOCX/text:
   * một chunk cho toàn tài liệu — runner không có IR segment để chunk
   * theo khối). Chỉ đo, không gate test, không đổi logic so sánh cũ.
   */
  chunkComplete: number;
  chunkPartial: number;
  chunkFailed: number;
  chunkTotal: number;
  /**
   * Bước 22 (cộng thêm, chỉ đo): đáp án sau Reconcile so với ground
   * truth trên câu matched (câu missing không tính, như answerMismatch)
   * và số câu matched khớp hoàn toàn sau reconcile (stem + options +
   * đáp án đã reconcile). Số V1 ở trên giữ nguyên.
   */
  reconciledAnswerMismatch: number;
  reconciledFullyOk: number;
  reconciledResolved: number;
  reconciledUnresolved: number;
  reconciledPruned: number;
}

async function parsePdfWithLegacyFallback(
  buffer: Buffer,
  fileName: string
): Promise<{
  questions: ExtractedQuestion[];
  fallback: boolean;
  totalPages: number;
  scanPages: number[];
}> {
  const data = new Uint8Array(buffer);
  const loadingTask = (
    pdfjsLegacy as unknown as {
      getDocument: (o: unknown) => { promise: Promise<unknown> };
    }
  ).getDocument({ data });
  const pdf = (await loadingTask.promise) as {
    numPages: number;
    getPage: (n: number) => Promise<{
      getTextContent: () => Promise<{
        items: Array<{ str?: string; transform?: number[] }>;
      }>;
    }>;
  };
  const pagesText: string[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items = (textContent.items as Array<{ str?: string; transform?: number[]; width?: number }>)
      .filter((it) => typeof it.str === "string" && it.transform)
      .map((it) => ({ str: it.str as string, transform: it.transform as number[], width: it.width }));
    // Bước 15: dùng chung helper mới với parsePdfFile (thứ tự đọc 2 cột +
    // gắn trang) để hai đường PDF không lệch nhau.
    pagesText.push(orderPageLines(items).join("\n"));
  }
  const cleanedPages = cleanPdfPages(pagesText);
  const cleaned = cleanedPages.filter((p) => p.length > 0).join("\n\n");
  const parsed = parseRawExamText(cleaned, {
    fileName,
    fileType: "pdf",
  });
  // Bước 16: trang nào không có dòng text nào sau khi sắp xếp thì là
  // trang scan (cùng định nghĩa với scanPages của parsePdfFile).
  const scanPages = pagesText
    .map((t, i) => (t.trim() === "" ? i + 1 : -1))
    .filter((n) => n > 0);
  return {
    questions: assignQuestionPages(parsed.questions, cleanedPages),
    fallback: true,
    totalPages: pdf.numPages,
    scanPages,
  };
}

/** Chuẩn hóa để so sánh: giải HTML entity (parser xuất &#039; cho dấu '),
 *  bỏ placeholder "[Hình ảnh]" (không phải nội dung stem), rồi NFC +
 *  thường + chỉ giữ chữ/số (bỏ khoảng trắng, dấu câu, ký tự LaTeX
 *  $ \ { } — để "\frac{1}{2}" khớp "frac12" ở mức ý). */
function norm(s: string | undefined | null): string {
  const decoded = (s ?? "")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\[hình ảnh\]/gi, "");
  return decoded
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Bước 03: exact match — NFC + trim + gộp whitespace, vẫn giải entity
 *  như norm() (parser xuất &#039; cho dấu '). Chặt hơn norm(): giữ nguyên
 *  hoa/thường, dấu câu, ký tự LaTeX. */
function exact(s: string | undefined | null): string {
  const decoded = (s ?? "")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\[hình ảnh\]/gi, "");
  return decoded.normalize("NFC").replace(/\s+/g, " ").trim();
}

function sameArray(a: string[], b: string[]): boolean {
  const sa = [...a].sort().join(",");
  const sb = [...b].sort().join(",");
  return sa === sb;
}

async function runFixture(fx: ExpectedFixture): Promise<FixtureResult> {
  const buffer = fs.readFileSync(path.join(FIXTURE_DIR, fx.file));
  let questions: ExtractedQuestion[] = [];
  let error: string | null = null;
  let pdfFallback = false;
  // Bước 16: tín hiệu OCR cho fixture PDF (cộng thêm, chỉ đo).
  let ocrNeeded = false;
  let ocrPages: number[] = [];
  // Bước 10: V2 để chạy Quality Gate tổng (cộng thêm, không đổi logic so sánh).
  let gateV2: ExtractionV2Result | null = null;
  let gateTotalPages: number | undefined;
  const startedAt = Date.now();
  try {
    if (fx.format === "docx") {
      const file = new File([buffer as unknown as BlobPart], fx.file);
      const out = await parseDocxFile(file);
      questions = out.result.questions;
      gateV2 = fromDocxParseOutput(out);
    } else if (fx.format === "pdf") {
      const file = new File([buffer as unknown as BlobPart], fx.file);
      try {
        const out = await parsePdfFile(file);
        questions = out.result.questions;
        gateV2 = fromV1Result(out.result);
        gateTotalPages = out.totalPages;
        ocrPages = out.scanPages;
        ocrNeeded = !out.hasTextLayer || out.scanPages.length > 0;
      } catch {
        const fb = await parsePdfWithLegacyFallback(buffer, fx.file);
        questions = fb.questions;
        pdfFallback = fb.fallback;
        gateTotalPages = fb.totalPages;
        ocrPages = fb.scanPages;
        ocrNeeded = fb.scanPages.length > 0;
        gateV2 = fromV1Result({
          fileName: fx.file,
          fileType: "pdf",
          fileSize: buffer.length,
          title: "",
          subject: "",
          totalQuestionsDetected: questions.length,
          questions,
          hasAnswerKeyTable: false,
          warningsCount: 0,
          extractedAt: new Date().toISOString(),
        } as ExtractionResult);
      }
    } else {
      const text = buffer.toString("utf-8");
      const res = parseRawExamText(text, {
        fileName: fx.file,
        fileType: "text",
      });
      questions = res.questions;
      gateV2 = fromV1Result(res);
    }
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  const latencyMs = Date.now() - startedAt;
  // V2 dùng chung cho gate bước 10 và validator bước 11; khi parse lỗi
  // thì dùng kết quả rỗng (gate → failed/no_questions, validator → 0 câu).
  const v2ForChecks: ExtractionV2Result = gateV2 ?? {
    fileName: fx.file,
    fileType: fx.format as ExtractionV2Result["fileType"],
    fileSize: buffer.length,
    title: "",
    subject: "",
    totalQuestionsDetected: 0,
    questions: [],
    hasAnswerKeyTable: false,
    documentQuality: { status: "failed", parsedQuestions: 0, reasons: [] },
    warnings: [],
    chunks: [],
    extractedAt: new Date().toISOString(),
  };
  // Bước 19 (cộng thêm, chỉ đo): chạy chunking trên V2 rồi mới chạy
  // gate + validator — gate đọc được trạng thái chunk thật (chunk_failed
  // / chunk_partial) thay vì mảng rỗng. PDF: một chunk/trang (dùng
  // totalPages + scanPages đã biết); DOCX/text: một chunk cho toàn tài
  // liệu (runner không có IR segment để chunk theo khối). Không đổi
  // logic so sánh câu ở dưới (so theo questions V1).
  const chunkOutput =
    fx.format === "pdf" && gateTotalPages !== undefined
      ? buildPageChunks(v2ForChecks.questions, gateTotalPages, ocrPages)
      : buildDocumentChunk(v2ForChecks.questions);
  const v2WithChunks = attachChunksToV2(v2ForChecks, chunkOutput);
  const chunkComplete = chunkOutput.chunks.filter(
    (c) => c.status === "complete"
  ).length;
  const chunkPartial = chunkOutput.chunks.filter(
    (c) => c.status === "partial"
  ).length;
  const chunkFailed = chunkOutput.chunks.filter(
    (c) => c.status === "failed"
  ).length;
  // Gate chạy cả khi parse lỗi (questions rỗng → failed/no_questions).
  const gate = assessExtractionQuality(
    v2WithChunks,
    gateTotalPages !== undefined ? { totalPages: gateTotalPages } : {}
  );

  // Bước 11: Evidence Validator (cộng thêm, chỉ đo — KHÔNG gate test).
  // Context chỉ gồm flag định dạng từ parser V1; chỉ cấp map cho câu nào
  // parser thực sự ghi nhận ít nhất một flag — câu không có dữ liệu định
  // dạng thì để unchecked, không suy thành mismatch.
  const evidenceContexts = new Map<number, QuestionEvidenceContext>();
  for (const q of questions) {
    const formats: Partial<Record<OptionId, OptionFormatFlags>> = {};
    let hasAnyFlag = false;
    for (const opt of q.options) {
      const flags: OptionFormatFlags = {};
      if (opt.isUnderline) {
        flags.underline = true;
        hasAnyFlag = true;
      }
      if (opt.isHighlighted) {
        flags.highlight = true;
        hasAnyFlag = true;
      }
      if (opt.isBold) {
        flags.bold = true;
        hasAnyFlag = true;
      }
      if (opt.hasSpecialMarker) {
        flags.marker = true;
        hasAnyFlag = true;
      }
      formats[opt.id] = flags;
    }
    if (hasAnyFlag) evidenceContexts.set(q.order, { optionFormats: formats });
  }
  const evidence = validateEvidence(v2WithChunks, evidenceContexts);

  // Bước 22: Reconcile bằng bằng chứng (cộng thêm, chỉ đo — KHÔNG đổi
  // logic so sánh V1 ở dưới; số V1 giữ nguyên để so với baseline đóng
  // băng, số sau reconcile đo riêng ở reconciledAnswerMismatch).
  const v2Validated = applyEvidenceValidation(v2WithChunks, evidence);
  const reconciled = reconcileResult(v2Validated, evidenceContexts);
  const reconciledByOrder = new Map(
    reconciled.result.questions.map((q) => [q.order, q])
  );

  const byOrder = new Map<number, ExtractedQuestion>();
  const seenStems = new Map<string, number>();
  const duplicates: string[] = [];
  for (const got of questions) {
    const n = norm(got.content);
    seenStems.set(n, (seenStems.get(n) ?? 0) + 1);
    if (!byOrder.has(got.order)) byOrder.set(got.order, got);
  }
  for (const [stem, count] of seenStems) {
    if (count > 1 && stem) duplicates.push(`${stem.slice(0, 40)} x${count}`);
  }

  const expectedOrders = new Set(fx.questions.map((q) => q.order));
  const extra = questions
    .map((q) => q.order)
    .filter((o) => !expectedOrders.has(o));

  const perQuestion: PerQuestionResult[] = [];
  let stemMismatch = 0;
  let optionsMismatch = 0;
  let answerMismatch = 0;
  let reconciledAnswerMismatch = 0;
  let reconciledFullyOk = 0;
  let stemExactMatch = 0;
  let optionsExactMatch = 0;
  let sourceNumberMatch = 0;
  let sourceNumberTotal = 0;
  let pageMatch = 0;
  let pageTotal = 0;
  const missing: number[] = [];

  for (const exp of fx.questions) {
    const got = byOrder.get(exp.order);
    if (!got) {
      missing.push(exp.order);
      perQuestion.push({
        order: exp.order,
        label: exp.label,
        status: "missing",
        gotStem: "",
        gotOptions: {},
        gotAnswers: [],
        gotStrategy: "",
        gotImages: 0,
        mismatches: ["missing"],
        stemExact: false,
        optionsExact: false,
        gotSourceNumber: null,
        sourceNumberOk: false,
        gotPage: null,
        pageOk: false,
      });
      continue;
    }
    const mismatches: string[] = [];
    const gotOptions: Record<string, string> = {};
    for (const o of got.options) gotOptions[o.id] = o.content;
    if (norm(got.content) !== norm(exp.stem)) {
      mismatches.push("stem");
      stemMismatch += 1;
    }
    const expOptions: Record<string, string> = {};
    for (const o of exp.options) expOptions[o.key] = o.text;
    const optKeys = new Set([...Object.keys(expOptions), ...Object.keys(gotOptions)]);
    let optOk = true;
    let optExact = true;
    for (const k of optKeys) {
      if (norm(expOptions[k]) !== norm(gotOptions[k])) optOk = false;
      if (exact(expOptions[k]) !== exact(gotOptions[k])) optExact = false;
    }
    if (!optOk) {
      mismatches.push("options");
      optionsMismatch += 1;
    }
    if (!sameArray(got.correctAnswers ?? [], exp.correctAnswers)) {
      mismatches.push("answers");
      answerMismatch += 1;
    }
    const stemExact = exact(got.content) === exact(exp.stem);
    if (stemExact) stemExactMatch += 1;
    if (optExact) optionsExactMatch += 1;
    // Bước 13: số câu gốc trong label ("Câu 2" → 2) so với sourceNumber
    // parser giữ được; chỉ tính trên câu matched, không tính câu missing.
    const labelNumber = parseInt(exp.label.replace(/\D/g, ""), 10);
    const gotSourceNumber = got.sourceNumber ?? null;
    const sourceNumberOk =
      !isNaN(labelNumber) && gotSourceNumber === labelNumber;
    sourceNumberTotal += 1;
    if (sourceNumberOk) sourceNumberMatch += 1;
    // Bước 15: so page chỉ trên fixture PDF + câu matched.
    const gotPage = got.page ?? null;
    const pageOk = fx.format === "pdf" && gotPage === exp.page;
    if (fx.format === "pdf") {
      pageTotal += 1;
      if (pageOk) pageMatch += 1;
    }
    // Bước 22: so đáp án V2 đã reconcile với ground truth (chỉ đo riêng;
    // câu missing không tính, như answerMismatch; stem/options vẫn lấy
    // từ V1 vì reconcile không đổi stem/options).
    const recQ = reconciledByOrder.get(exp.order);
    const recAnsOk = recQ
      ? sameArray(recQ.correctAnswers ?? [], exp.correctAnswers)
      : false;
    if (!recAnsOk) reconciledAnswerMismatch += 1;
    if (stemExact && optExact && recAnsOk) reconciledFullyOk += 1;
    perQuestion.push({
      order: exp.order,
      label: exp.label,
      status:
        mismatches.length === 0
          ? "ok"
          : mismatches.length > 1
            ? "multi_mismatch"
            : (`${mismatches[0]}_mismatch` as PerQuestionResult["status"]),
      gotStem: got.content,
      gotOptions,
      gotAnswers: got.correctAnswers ?? [],
      gotStrategy: got.detectionStrategy ?? "",
      gotImages: got.images?.length ?? 0,
      mismatches,
      stemExact,
      optionsExact: optExact,
      gotSourceNumber,
      sourceNumberOk,
      gotPage,
      pageOk,
    });
  }

  return {
    id: fx.id,
    file: fx.file,
    format: fx.format,
    expected: fx.questions.length,
    got: questions.length,
    missing,
    extra,
    duplicates,
    stemMismatch,
    optionsMismatch,
    answerMismatch,
    error,
    pdfFallback,
    perQuestion,
    latencyMs,
    stemExactMatch,
    optionsExactMatch,
    gateStatus: gate.status,
    gateIssueCodes: gate.issues.map((i) => i.code),
    evidenceValid: evidence.summary.valid,
    evidenceDowngraded: evidence.summary.downgraded,
    evidenceConflict: evidence.summary.conflict,
    evidenceInvalid: evidence.summary.invalid,
    evidenceUnchecked: evidence.summary.unchecked,
    evidenceIssueCodes: evidence.issues.map((i) => i.code),
    sourceNumberMatch,
    sourceNumberTotal,
    pageMatch,
    pageTotal,
    ocrNeeded,
    ocrPages,
    chunkComplete,
    chunkPartial,
    chunkFailed,
    chunkTotal: chunkOutput.chunks.length,
    reconciledAnswerMismatch,
    reconciledFullyOk,
    reconciledResolved: reconciled.summary.resolved,
    reconciledUnresolved: reconciled.summary.unresolved,
    reconciledPruned: reconciled.summary.pruned,
  };
}

function loadFixtures(): ExpectedFixture[] {
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".expected.json"))
    .sort()
    .map((f) =>
      JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), "utf-8")) as ExpectedFixture
    );
}

describe("Extraction fixtures (bước 02 — đo, không gate)", () => {
  const fixtures = loadFixtures();
  const results: FixtureResult[] = [];

  it("đọc được fixtures", () => {
    expect(fixtures.length).toBeGreaterThan(0);
    for (const fx of fixtures) {
      expect(fs.existsSync(path.join(FIXTURE_DIR, fx.file))).toBe(true);
    }
  });

  for (const fx of fixtures) {
    it(`chạy parser trên ${fx.id} (${fx.file})`, async () => {
      const r = await runFixture(fx);
      results.push(r);
      if (r.error) {
        console.log(`[${fx.id}] ERROR: ${r.error}`);
      } else {
        console.log(
          `[${fx.id}] expected=${r.expected} got=${r.got} ` +
            `missing=[${r.missing.join(",")}] extra=[${r.extra.join(",")}] ` +
            `stemX=${r.stemMismatch} optX=${r.optionsMismatch} ansX=${r.answerMismatch} ` +
            `dup=${r.duplicates.length} gate=${r.gateStatus}[${r.gateIssueCodes.join(",")}] ` +
            `ev=valid${r.evidenceValid}/down${r.evidenceDowngraded}/conf${r.evidenceConflict}/inv${r.evidenceInvalid}/unchecked${r.evidenceUnchecked}[${r.evidenceIssueCodes.join(",")}] ` +
            `srcNum=${r.sourceNumberMatch}/${r.sourceNumberTotal} ` +
            `page=${r.pageMatch}/${r.pageTotal} ` +
            `chunk=${r.chunkComplete}c/${r.chunkPartial}p/${r.chunkFailed}f ` +
            `recAnsX=${r.reconciledAnswerMismatch} recOk=${r.reconciledFullyOk} ` +
            `ocr=${r.ocrNeeded ? r.ocrPages.join(",") : "-"}` +
            (r.pdfFallback ? " pdfFallback=legacy-build" : "")
        );
      }
    });
  }

  it("ghi report.json", () => {
    const totals = {
      fixtures: results.length,
      expectedQuestions: results.reduce((s, r) => s + r.expected, 0),
      gotQuestions: results.reduce((s, r) => s + r.got, 0),
      missing: results.reduce((s, r) => s + r.missing.length, 0),
      extra: results.reduce((s, r) => s + r.extra.length, 0),
      duplicates: results.reduce((s, r) => s + r.duplicates.length, 0),
      stemMismatch: results.reduce((s, r) => s + r.stemMismatch, 0),
      optionsMismatch: results.reduce((s, r) => s + r.optionsMismatch, 0),
      answerMismatch: results.reduce((s, r) => s + r.answerMismatch, 0),
      errors: results.filter((r) => r.error).length,
      fullyOkQuestions: results.reduce(
        (s, r) => s + r.perQuestion.filter((q) => q.status === "ok").length,
        0
      ),
      // Bước 03: cộng thêm, không đổi các số trên.
      stemExactMatch: results.reduce((s, r) => s + r.stemExactMatch, 0),
      optionsExactMatch: results.reduce((s, r) => s + r.optionsExactMatch, 0),
      latencyMsTotal: results.reduce((s, r) => s + r.latencyMs, 0),
      latencyMsMax: results.reduce((s, r) => Math.max(s, r.latencyMs), 0),
      // Bước 10: đếm trạng thái Quality Gate tổng theo fixture (chỉ đo,
      // không gate test; không đổi các số benchmark ở trên).
      gateStatusCounts: {
        complete: results.filter((r) => r.gateStatus === "complete").length,
        partial: results.filter((r) => r.gateStatus === "partial").length,
        needs_review: results.filter((r) => r.gateStatus === "needs_review").length,
        failed: results.filter((r) => r.gateStatus === "failed").length,
      },
      // Bước 11: đếm verdict của Evidence Validator theo câu (chỉ đo,
      // không gate test; không đổi các số benchmark ở trên).
      evidenceVerdictCounts: {
        valid: results.reduce((s, r) => s + r.evidenceValid, 0),
        downgraded: results.reduce((s, r) => s + r.evidenceDowngraded, 0),
        conflict: results.reduce((s, r) => s + r.evidenceConflict, 0),
        invalid: results.reduce((s, r) => s + r.evidenceInvalid, 0),
        unchecked: results.reduce((s, r) => s + r.evidenceUnchecked, 0),
      },
      // Bước 13: số câu gốc giữ đúng (chỉ đo, không gate test; mẫu số là
      // câu matched, câu missing không tính vì không có got để so).
      sourceNumber: {
        match: results.reduce((s, r) => s + r.sourceNumberMatch, 0),
        total: results.reduce((s, r) => s + r.sourceNumberTotal, 0),
      },
      // Bước 15: số trang giữ đúng trên câu matched của fixture PDF
      // (chỉ đo, không gate test; DOCX/text không tính).
      page: {
        match: results.reduce((s, r) => s + r.pageMatch, 0),
        total: results.reduce((s, r) => s + r.pageTotal, 0),
      },
      // Bước 16: số fixture PDF cần OCR (toàn scan hoặc xen text/scan;
      // chỉ đo, không gate test).
      ocrNeededFixtures: results.filter((r) => r.ocrNeeded).length,
      // Bước 19: số chunk theo trạng thái trên toàn bộ fixture (chỉ đo,
      // không gate test; PDF: một chunk/trang, DOCX/text: một chunk).
      chunks: {
        complete: results.reduce((s, r) => s + r.chunkComplete, 0),
        partial: results.reduce((s, r) => s + r.chunkPartial, 0),
        failed: results.reduce((s, r) => s + r.chunkFailed, 0),
        total: results.reduce((s, r) => s + r.chunkTotal, 0),
      },
      // Bước 22: số sau Reconcile (chỉ đo, không gate test; số V1 ở trên
      // giữ nguyên để so với baseline đóng băng — reconciled đo riêng
      // trên câu matched, câu missing không tính).
      reconciled: {
        answerMismatch: results.reduce((s, r) => s + r.reconciledAnswerMismatch, 0),
        fullyOkQuestions: results.reduce((s, r) => s + r.reconciledFullyOk, 0),
        resolved: results.reduce((s, r) => s + r.reconciledResolved, 0),
        unresolved: results.reduce((s, r) => s + r.reconciledUnresolved, 0),
        pruned: results.reduce((s, r) => s + r.reconciledPruned, 0),
      },
    };
    const expected = totals.expectedQuestions;
    const matched = expected - totals.missing;
    // Hallucination proxy (đo được từ report): câu extra + câu có option
    // placeholder "Lựa chọn" do parser tự chèn. Là cận dưới, không phải
    // toàn bộ hallucination (mapper ["A"] nằm ngoài đường runner này).
    const placeholderQuestions = results.reduce(
      (s, r) =>
        s +
        r.perQuestion.filter((q) =>
          Object.values(q.gotOptions).some((v) => v.includes("Lựa chọn"))
        ).length,
      0
    );
    const rates = {
      questionRecall: expected ? matched / expected : 0,
      questionPrecision: totals.gotQuestions
        ? matched / totals.gotQuestions
        : 0,
      fullyOkRate: expected ? totals.fullyOkQuestions / expected : 0,
      reviewRate: expected ? (expected - totals.fullyOkQuestions) / expected : 0,
      stemNormalizedMatchRate: matched ? (matched - totals.stemMismatch) / matched : 0,
      optionsNormalizedMatchRate: matched
        ? (matched - totals.optionsMismatch) / matched
        : 0,
      answerMatchRate: matched ? (matched - totals.answerMismatch) / matched : 0,
      stemExactMatchRate: matched ? totals.stemExactMatch / matched : 0,
      optionsExactMatchRate: matched ? totals.optionsExactMatch / matched : 0,
      hallucinationProxyRate: totals.gotQuestions
        ? (totals.extra + placeholderQuestions) / totals.gotQuestions
        : 0,
      placeholderQuestions,
    };
    const report = {
      generatedAt: new Date().toISOString(),
      parser: "rule+docxAst/pdfjs hien tai (khong Gemini, khong OCR)",
      note: "Buoc 02 la do, buoc 03 moi dong bang baseline. Test khong fail khi parser lech ground truth.",
      totals,
      rates,
      // Bước 03: chi phí/quota của baseline Rule = 0 (không gọi API nào).
      // Gemini baseline CHƯA ĐO: chưa có consent/quota nên ghi null,
      // tuyệt đối không bịa số.
      cost: { apiCalls: 0, tokens: 0, currency: "VND", amount: 0 },
      geminiBaseline: null,
      geminiBaselineReason:
        "Chua do: PLAN_MAIN chi cho do Gemini khi co consent/quota; hien chua co, nen khong goi API that.",
      fixtures: results,
    };
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");
    // Bước 03: CSV benchmark theo fixture (để so sánh nhanh ở các bước sau).
    const csvHeader =
      "fixture,format,expected,got,missing,extra,duplicates,stemMismatch,optionsMismatch,answerMismatch,stemExactMatch,optionsExactMatch,fullyOk,latencyMs,error,pdfFallback,pageMatch,pageTotal,ocrNeeded,chunkComplete,chunkPartial,chunkFailed";
    const csvRows = results.map((r) =>
      [
        r.id,
        r.format,
        r.expected,
        r.got,
        r.missing.length,
        r.extra.length,
        r.duplicates.length,
        r.stemMismatch,
        r.optionsMismatch,
        r.answerMismatch,
        r.stemExactMatch,
        r.optionsExactMatch,
        r.perQuestion.filter((q) => q.status === "ok").length,
        r.latencyMs,
        r.error ? `"${String(r.error).replace(/"/g, '""')}"` : "",
        r.pdfFallback,
        r.pageMatch,
        r.pageTotal,
        r.ocrNeeded,
        r.chunkComplete,
        r.chunkPartial,
        r.chunkFailed,
      ].join(",")
    );
    fs.writeFileSync(
      path.join(FIXTURE_DIR, "benchmark.csv"),
      [csvHeader, ...csvRows].join("\n") + "\n",
      "utf-8"
    );
    console.log("TOTALS", JSON.stringify(totals));
    console.log("RATES", JSON.stringify(rates));
    expect(fs.existsSync(REPORT_PATH)).toBe(true);
    expect(results.length).toBe(fixtures.length);
  });
});
