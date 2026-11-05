/**
 * Runner HOLDOUT đo parser trên template chưa từng xuất hiện trong quá trình
 * phát triển (bước 27, PLAN_MAIN) — tách riêng khỏi runner chính bước 02.
 *
 * - Đọc mọi `*.expected.json` trong `qizzone/tests/fixtures/extraction-holdout/`
 *   (h01–h04), chạy cùng pipeline đo như runner chính: parser luật
 *   (parseDocxFile / parsePdfFile / legacy fallback) → V2 → chunking →
 *   Quality Gate → Evidence Validator → Reconcile bằng bằng chứng.
 * - Ghi `tests/fixtures/extraction-holdout/holdout-report.json` +
 *   `holdout-benchmark.csv`. KHÔNG ghi vào report.json của bộ chính, KHÔNG
 *   sửa baseline đóng băng.
 * - CỐ TÌNH KHÔNG fail test khi parser lệch ground truth: bước 27 là ĐO
 *   generalization gap, KHÔNG sửa code để xanh holdout (sửa theo holdout
 *   sẽ làm nó không còn unseen). Test chỉ fail khi runner không chạy được.
 * - Logic so sánh (norm/exact) và pipeline đo được mirror từ runner chính
 *   bước 02 (không import từ file test đó để hai runner độc lập).
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
// Fallback này chỉ đo phần "text layer + rule parser" của PDF, giống
// runner chính — không giả vờ là parsePdfFile.
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
const HOLDOUT_DIR = path.resolve(
  HERE,
  "../../../tests/fixtures/extraction-holdout"
);
const REPORT_PATH = path.join(HOLDOUT_DIR, "holdout-report.json");

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
  stemExact: boolean;
  optionsExact: boolean;
  gotSourceNumber: number | null;
  sourceNumberOk: boolean;
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
  latencyMs: number;
  stemExactMatch: number;
  optionsExactMatch: number;
  gateStatus: QualityGateStatus;
  gateIssueCodes: string[];
  evidenceValid: number;
  evidenceDowngraded: number;
  evidenceConflict: number;
  evidenceInvalid: number;
  evidenceUnchecked: number;
  evidenceIssueCodes: string[];
  sourceNumberMatch: number;
  sourceNumberTotal: number;
  pageMatch: number;
  pageTotal: number;
  ocrNeeded: boolean;
  ocrPages: number[];
  chunkComplete: number;
  chunkPartial: number;
  chunkFailed: number;
  chunkTotal: number;
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
    pagesText.push(orderPageLines(items).join("\n"));
  }
  const cleanedPages = cleanPdfPages(pagesText);
  const cleaned = cleanedPages.filter((p) => p.length > 0).join("\n\n");
  const parsed = parseRawExamText(cleaned, {
    fileName,
    fileType: "pdf",
  });
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

/** Chuẩn hóa để so sánh (mirror runner chính): giải HTML entity, bỏ
 *  placeholder "[Hình ảnh]", NFC + thường + chỉ giữ chữ/số. */
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

/** Exact match (mirror runner chính): NFC + trim + gộp whitespace, vẫn
 *  giải entity. Chặt hơn norm(): giữ hoa/thường, dấu câu, ký tự LaTeX. */
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
  const buffer = fs.readFileSync(path.join(HOLDOUT_DIR, fx.file));
  let questions: ExtractedQuestion[] = [];
  let error: string | null = null;
  let pdfFallback = false;
  let ocrNeeded = false;
  let ocrPages: number[] = [];
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
  const gate = assessExtractionQuality(
    v2WithChunks,
    gateTotalPages !== undefined ? { totalPages: gateTotalPages } : {}
  );

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
    const labelNumber = parseInt(exp.label.replace(/\D/g, ""), 10);
    const gotSourceNumber = got.sourceNumber ?? null;
    const sourceNumberOk =
      !isNaN(labelNumber) && gotSourceNumber === labelNumber;
    sourceNumberTotal += 1;
    if (sourceNumberOk) sourceNumberMatch += 1;
    const gotPage = got.page ?? null;
    const pageOk = fx.format === "pdf" && gotPage === exp.page;
    if (fx.format === "pdf") {
      pageTotal += 1;
      if (pageOk) pageMatch += 1;
    }
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
    .readdirSync(HOLDOUT_DIR)
    .filter((f) => f.endsWith(".expected.json"))
    .sort()
    .map((f) =>
      JSON.parse(fs.readFileSync(path.join(HOLDOUT_DIR, f), "utf-8")) as ExpectedFixture
    );
}

describe("Extraction holdout (bước 27 — đo, không gate)", () => {
  const fixtures = loadFixtures();
  const results: FixtureResult[] = [];

  it("đọc được fixtures holdout", () => {
    expect(fixtures.length).toBeGreaterThan(0);
    for (const fx of fixtures) {
      expect(fs.existsSync(path.join(HOLDOUT_DIR, fx.file))).toBe(true);
    }
  });

  for (const fx of fixtures) {
    it(`chạy parser trên holdout ${fx.id} (${fx.file})`, async () => {
      const r = await runFixture(fx);
      results.push(r);
      if (r.error) {
        console.log(`[holdout ${fx.id}] ERROR: ${r.error}`);
      } else {
        console.log(
          `[holdout ${fx.id}] expected=${r.expected} got=${r.got} ` +
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

  it("ghi holdout-report.json", () => {
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
      stemExactMatch: results.reduce((s, r) => s + r.stemExactMatch, 0),
      optionsExactMatch: results.reduce((s, r) => s + r.optionsExactMatch, 0),
      latencyMsTotal: results.reduce((s, r) => s + r.latencyMs, 0),
      latencyMsMax: results.reduce((s, r) => Math.max(s, r.latencyMs), 0),
      gateStatusCounts: {
        complete: results.filter((r) => r.gateStatus === "complete").length,
        partial: results.filter((r) => r.gateStatus === "partial").length,
        needs_review: results.filter((r) => r.gateStatus === "needs_review").length,
        failed: results.filter((r) => r.gateStatus === "failed").length,
      },
      evidenceVerdictCounts: {
        valid: results.reduce((s, r) => s + r.evidenceValid, 0),
        downgraded: results.reduce((s, r) => s + r.evidenceDowngraded, 0),
        conflict: results.reduce((s, r) => s + r.evidenceConflict, 0),
        invalid: results.reduce((s, r) => s + r.evidenceInvalid, 0),
        unchecked: results.reduce((s, r) => s + r.evidenceUnchecked, 0),
      },
      sourceNumber: {
        match: results.reduce((s, r) => s + r.sourceNumberMatch, 0),
        total: results.reduce((s, r) => s + r.sourceNumberTotal, 0),
      },
      page: {
        match: results.reduce((s, r) => s + r.pageMatch, 0),
        total: results.reduce((s, r) => s + r.pageTotal, 0),
      },
      ocrNeededFixtures: results.filter((r) => r.ocrNeeded).length,
      chunks: {
        complete: results.reduce((s, r) => s + r.chunkComplete, 0),
        partial: results.reduce((s, r) => s + r.chunkPartial, 0),
        failed: results.reduce((s, r) => s + r.chunkFailed, 0),
        total: results.reduce((s, r) => s + r.chunkTotal, 0),
      },
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
      note: "Buoc 27 la do HOLDOUT (template unseen), khong phai benchmark chinh. Test khong fail khi parser lech ground truth; KHONG sua code theo holdout.",
      holdout: true,
      totals,
      rates,
      cost: { apiCalls: 0, tokens: 0, currency: "VND", amount: 0 },
      geminiBaseline: null,
      geminiBaselineReason:
        "Chua do: PLAN_MAIN chi cho do Gemini khi co consent/quota; hien chua co, nen khong goi API that.",
      fixtures: results,
    };
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");
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
      path.join(HOLDOUT_DIR, "holdout-benchmark.csv"),
      [csvHeader, ...csvRows].join("\n") + "\n",
      "utf-8"
    );
    console.log("HOLDOUT TOTALS", JSON.stringify(totals));
    console.log("HOLDOUT RATES", JSON.stringify(rates));
    expect(fs.existsSync(REPORT_PATH)).toBe(true);
    expect(results.length).toBe(fixtures.length);
  });
});
