/**
 * UAT end-to-end ở mức pure pipeline (bước 34, PLAN_MAIN).
 *
 * Repo chưa có testing-library nên KHÔNG có test render component thật:
 * file này kiểm chứng luồng giáo viên ở mức dữ liệu + quyết định mà UI
 * dựa vào để render — parse thật trên fixture → orchestrate → display →
 * publish guard → AI fill (mock provider, KHÔNG gọi API thật). Wiring UI
 * (FileDropzone / BatchActionBar / CreateQuiz / DocumentViewer) được kiểm
 * chứng bằng tsc build + lint + assertion trên source (theo tiền lệ
 * securityArtifacts), và ghi rõ trong acceptance-report là chưa kiểm
 * chứng bằng tay trên browser thật.
 *
 * Mỗi case tương ứng một mục trong kịch bản UAT ở
 * work/docs/ai-parser-v2/34-acceptance-report.md.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseDocxFile } from "@/utils/parsers/docxParser";
import {
  orderPageLines,
  assignQuestionPages,
} from "@/utils/parsers/pdfParser";
import { cleanPdfPages } from "@/utils/parsers/pdfCleaner";
import { parseRawExamText } from "@/utils/parsers/ruleExtractor";
import * as pdfjsLegacy from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  ExtractedQuestion,
  ExtractionResult,
} from "@/types/extractor";
import {
  orchestrateExtraction,
  orchestrateWithAI,
  type HybridInput,
} from "@/services/extraction/hybridOrchestrator";
import { buildReviewDisplay } from "@/services/extraction/reviewDisplay";
import {
  assessPublishGuard,
  toPublishGuardSummary,
} from "@/services/extraction/publishGuard";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(
  HERE,
  "../../../tests/fixtures/extraction"
);
const SRC_DIR = path.resolve(HERE, "../../");

function readFixture(file: string): Buffer {
  return fs.readFileSync(path.join(FIXTURE_DIR, file));
}

async function parseDocx(file: string) {
  const buffer = readFixture(file);
  const f = new File([buffer as unknown as BlobPart], file);
  const out = await parseDocxFile(f);
  return out;
}

/** Mirror phần PDF của runner chính (legacy build chạy được trong Node). */
async function parsePdfLegacy(file: string) {
  const buffer = readFixture(file);
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
        items: Array<{ str?: string; transform?: number[]; width?: number }>;
      }>;
    }>;
  };
  const pagesText: string[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items = (
      textContent.items as Array<{
        str?: string;
        transform?: number[];
        width?: number;
      }>
    )
      .filter((it) => typeof it.str === "string" && it.transform)
      .map((it) => ({
        str: it.str as string,
        transform: it.transform as number[],
        width: it.width,
      }));
    pagesText.push(orderPageLines(items).join("\n"));
  }
  const cleanedPages = cleanPdfPages(pagesText);
  const cleaned = cleanedPages.filter((p) => p.length > 0).join("\n\n");
  const parsed = parseRawExamText(cleaned, {
    fileName: file,
    fileType: "pdf",
  });
  const scanPages = pagesText
    .map((t, i) => (t.trim() === "" ? i + 1 : -1))
    .filter((n) => n > 0);
  return {
    questions: assignQuestionPages(parsed.questions, cleanedPages),
    totalPages: pdf.numPages,
    scanPages,
  };
}

function emptyV1(): ExtractionResult {
  return {
    fileName: "scan.pdf",
    fileType: "pdf",
    fileSize: 0,
    title: "",
    subject: "",
    totalQuestionsDetected: 0,
    questions: [],
    hasAnswerKeyTable: false,
    warningsCount: 0,
    extractedAt: new Date().toISOString(),
  } as ExtractionResult;
}

describe("UAT flow (bước 34 — pure pipeline, không gọi API thật)", () => {
  it("UAT-01: DOCX tô vàng → review verified, publish không bị chặn", async () => {
    const out = await parseDocx("f01-docx-highlight.docx");
    const hybrid = orchestrateExtraction({
      result: out.result,
      documentQuality: out.quality,
    } as HybridInput);
    expect(hybrid.v1.questions).toHaveLength(4);
    const display = buildReviewDisplay(hybrid);
    expect(display.summary.verified).toBe(4);
    expect(display.summary.needs_review).toBe(0);
    expect(display.summary.invalid).toBe(0);
    const guard = assessPublishGuard(hybrid.v1, hybrid);
    expect(guard.publishBlocked).toBe(false);
    expect(guard.blockers).toHaveLength(0);
  });

  it("UAT-02: DOCX không đáp án → cần AI, publish bị chặn, draft chỉ cảnh báo, sửa tay gỡ chặn", async () => {
    const out = await parseDocx("f13-docx-no-answer.docx");
    const hybrid = orchestrateExtraction({
      result: out.result,
      documentQuality: out.quality,
    } as HybridInput);
    expect(hybrid.aiNeeded.needed).toBe(true);
    expect(
      hybrid.aiNeeded.questions.every((q) =>
        q.reasons.includes("missing_answer")
      )
    ).toBe(true);
    const guard = assessPublishGuard(hybrid.v1, hybrid);
    expect(guard.publishBlocked).toBe(true);
    // Draft không bao giờ bị chặn: mọi issue đều có mặt dưới dạng cảnh báo.
    expect(guard.draftWarnings.length).toBeGreaterThan(0);
    const summary = toPublishGuardSummary(guard);
    expect(summary.publishBlocked).toBe(true);
    expect(summary.warningMessages.length).toBeGreaterThan(0);

    // Giáo viên sửa tay: chọn đáp án đúng cho mọi câu (manual = xác nhận).
    const fixed: ExtractionResult = {
      ...hybrid.v1,
      questions: hybrid.v1.questions.map((q) => ({
        ...q,
        correctAnswers: [q.options[0].id],
        detectionStrategy: "manual" as const,
      })),
    };
    const guardFixed = assessPublishGuard(fixed, hybrid);
    expect(guardFixed.publishBlocked).toBe(false);
  });

  it("UAT-03: PDF scan → chunk failed + cần OCR, publish bị chặn cấp tài liệu, không im lặng ra 0 câu", () => {
    const hybrid = orchestrateExtraction({
      result: emptyV1(),
      totalPages: 1,
      scanPages: [1],
    });
    expect(hybrid.aiNeeded.ocrNeededPages).toEqual([1]);
    expect(hybrid.v2.chunks?.some((c) => c.status === "failed")).toBe(true);
    expect(hybrid.quality.status).toBe("failed");
    const guard = assessPublishGuard(hybrid.v1, hybrid);
    expect(guard.publishBlocked).toBe(true);
    expect(guard.docBlockers.length).toBeGreaterThan(0);
    // Wiring UI (tiền lệ securityArtifacts): FileDropzone phải báo rõ cần
    // OCR cho PDF scan thay vì success 0 câu.
    const dropzone = fs.readFileSync(
      path.join(
        SRC_DIR,
        "components/teacher/extraction/FileDropzone.tsx"
      ),
      "utf-8"
    );
    expect(dropzone).toContain("cần OCR");
  });

  it("UAT-04: nút AI lấp đáp án (mock) chỉ lấp câu rỗng, từ chối nhãn ai_inference", async () => {
    const out = await parseDocx("f13-docx-no-answer.docx");
    const input = {
      result: out.result,
      documentQuality: out.quality,
    } as HybridInput;
    const mockAi = vi.fn().mockResolvedValue({
      ...out.result,
      questions: out.result.questions.map((q) => ({
        ...q,
        correctAnswers: ["B"],
        detectionStrategy: "highlight_color" as const,
      })),
    } as ExtractionResult);
    const filled = await orchestrateWithAI(input, { aiExtract: mockAi });
    expect(mockAi).toHaveBeenCalledTimes(1);
    expect(filled.aiCalled).toBe(true);
    expect(filled.aiFilledCount).toBe(3);
    expect(
      filled.v1.questions.every((q) => q.correctAnswers?.length === 1)
    ).toBe(true);

    // Nhãn solving (ai_inference) không phải extraction có bằng chứng.
    const mockSolve = vi.fn().mockResolvedValue({
      ...out.result,
      questions: out.result.questions.map((q) => ({
        ...q,
        correctAnswers: ["B"],
        detectionStrategy: "ai_inference" as const,
      })),
    } as ExtractionResult);
    const refused = await orchestrateWithAI(input, { aiExtract: mockSolve });
    expect(refused.aiFilledCount).toBe(0);
    expect(
      refused.v1.questions.every(
        (q) => (q.correctAnswers ?? []).length === 0
      )
    ).toBe(true);
  });

  it("UAT-05: DOCX nhiều đáp án → reconcile sửa đủ [A, C] cho cả 3 câu", async () => {
    const out = await parseDocx("f07-docx-multi-answer.docx");
    const hybrid = orchestrateExtraction({
      result: out.result,
      documentQuality: out.quality,
    } as HybridInput);
    // V1 giữ nguyên [A] (parser luật), V2 sau reconcile phải đủ [A, C].
    expect(
      hybrid.v1.questions.every((q) => q.correctAnswers?.length === 1)
    ).toBe(true);
    expect(hybrid.reconcile.resolved).toBe(3);
    expect(hybrid.reconcile.unresolved).toBe(0);
    expect(
      hybrid.v2.questions.every(
        (q) =>
          q.correctAnswers.length === 2 &&
          q.correctAnswers.includes("A") &&
          q.correctAnswers.includes("C")
      )
    ).toBe(true);
  });

  it("UAT-06: PDF hai cột → gắn đúng trang, chunk theo trang, publish không bị chặn", async () => {
    const pdf = await parsePdfLegacy("f09-pdf-two-column.pdf");
    expect(pdf.questions).toHaveLength(4);
    expect(pdf.questions.every((q) => q.page !== undefined)).toBe(true);
    const hybrid = orchestrateExtraction({
      result: {
        fileName: "f09-pdf-two-column.pdf",
        fileType: "pdf",
        fileSize: 0,
        title: "",
        subject: "",
        totalQuestionsDetected: pdf.questions.length,
        questions: pdf.questions,
        hasAnswerKeyTable: false,
        warningsCount: 0,
        extractedAt: new Date().toISOString(),
      } as ExtractionResult,
      totalPages: pdf.totalPages,
      scanPages: pdf.scanPages,
    });
    expect(
      hybrid.v2.chunks?.every((c) => c.status === "complete")
    ).toBe(true);
    const guard = assessPublishGuard(hybrid.v1, hybrid);
    expect(guard.publishBlocked).toBe(false);
  });

  it("UAT-07: tóm tắt guard sang CreateQuiz giữ đúng hợp đồng chặn theo docBlockers", () => {
    const hybrid = orchestrateExtraction({
      result: emptyV1(),
      totalPages: 1,
      scanPages: [1],
    });
    const guard = assessPublishGuard(hybrid.v1, hybrid);
    const summary = toPublishGuardSummary(guard);
    // Scan: vấn đề cấp tài liệu → CreateQuiz cũng chặn publish theo nó.
    expect(summary.publishBlocked).toBe(true);
    expect(summary.docBlockerMessages.length).toBeGreaterThan(0);
    // Quiz không qua extraction (hybrid null) đi đường cũ, không chặn oan.
    const legacy = assessPublishGuard(
      {
        ...emptyV1(),
        questions: [
          {
            order: 1,
            content: "Câu mẫu",
            options: [
              { id: "A", content: "1", rawContent: "1" },
              { id: "B", content: "2", rawContent: "2" },
            ],
            correctAnswers: ["A"],
            detectionStrategy: "manual",
          } as unknown as ExtractedQuestion,
        ],
      } as ExtractionResult,
      null
    );
    expect(legacy.publishBlocked).toBe(false);
  });
});
