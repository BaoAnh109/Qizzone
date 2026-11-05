import type {
  AnswerOrigin,
  ExtractionV2Question,
} from "@/types/extractionV2";
import type { EvidenceVerdict } from "@/services/extraction/evidenceValidator";
import type { ReconcileQuestionResult } from "@/services/extraction/reconcile";
import type { HybridOrchestrationResult } from "@/services/extraction/hybridOrchestrator";

/**
 * Bước 23 (PLAN_MAIN, giai đoạn F): Confidence/quality UX có ý nghĩa.
 *
 * Vấn đề bước này sửa: card review cũ render `confidenceScore` của V1
 * thẳng ra UI ("Tin cậy: 96%") — mà con số đó là tự khai, không đo được
 * (vd solving opt-in gán cố định 0.96, xem aiExtractionService.ts; adapter
 * V1 → V2 còn copy nó vào evidence.confidence). Hiển thị số đó là nói
 * dối giáo viên bằng một con số trông khoa học.
 *
 * Display model này là tầng DUY NHẤT được phép quyết định UI hiển thị
 * gì về độ tin cậy, và nó tuân hai quy tắc sắt:
 *
 * 1. KHÔNG BAO GIỜ đọc `confidenceScore` của V1 hay `confidence` của
 *    evidence V2 để hiển thị. Số % duy nhất được hiển thị là % waterfall
 *    của nguồn bằng chứng thắng (bước 11/22) — và đó là mức ưu tiên
 *    quy ước, không phải xác suất đo được trên câu này; tên field
 *    `answerConfidencePercent` giữ từ vựng plan nhưng code + PROGRESS
 *    ghi rõ bản chất này. Nguồn không có % waterfall (giáo viên xác
 *    nhận, AI gợi ý, không bằng chứng) thì KHÔNG hiển thị số nào.
 * 2. Phân biệt ĐỘ TIN CẬY NHẬN DIỆN CÂU HỎI với ĐỘ TIN CẬY ĐÁP ÁN:
 *    - Nhận diện câu hỏi: cấu trúc có đủ không (nội dung + ≥ 2 phương
 *      án) — nhãn định tính, không có số %.
 *    - Đáp án: trạng thái xác minh + nguồn bằng chứng (+ % waterfall
 *      nếu có) hoặc "Chưa có bằng chứng".
 *
 * Trạng thái hiển thị (theo plan bước 23):
 * - verified: đáp án có bằng chứng gốc + đủ ≥ 2 phương án (V2 status).
 * - likely: có đáp án nhưng chỉ là gợi ý AI (ai_suggested) — có thể
 *   đúng, cần giáo viên xác nhận; KHÔNG hiển thị % solving.
 * - invalid: đáp án nằm ngoài phương án (dữ liệu sai, phải sửa).
 * - needs_review: mọi trường hợp còn lại (thiếu đáp án, thiếu phương
 *   án, mâu thuẫn, đã lược, tạo tay, OCR, scan, type unknown).
 *
 * Module thuần: không gọi AI, không đọc file, không mutate input.
 * `flagKeys` để UI lọc được mọi câu flagged (DONE bước 23).
 */

/** Trạng thái hiển thị của một câu trong UI review. */
export type ReviewDisplayStatus =
  | "verified"
  | "likely"
  | "needs_review"
  | "invalid";

export const REVIEW_STATUS_LABELS: Record<ReviewDisplayStatus, string> = {
  verified: "Đã xác minh",
  likely: "Có thể đúng",
  needs_review: "Cần xem lại",
  invalid: "Không hợp lệ",
};

/** Nhãn tiếng Việt cho nguồn bằng chứng (cùng từ vựng reconcile.ts). */
export const ORIGIN_LABELS: Record<string, string> = {
  teacher_confirmed: "Giáo viên xác nhận",
  answer_table: "Bảng đáp án",
  answer_line: "Dòng đáp án cuối câu",
  marker: "Ký hiệu tiền tố",
  underline: "Gạch chân",
  highlight: "Tô vàng",
  bold: "In đậm duy nhất",
  solution: "Lời giải",
  ai_suggested: "AI gợi ý",
  none: "Chưa có bằng chứng",
};

/**
 * % waterfall của nguồn bằng chứng gốc (bước 11/22). Đây là MỨC ƯU TIÊN
 * quy ước để chọn nguồn thắng, KHÔNG phải xác suất đo được trên câu này
 * — vì vậy chỉ các origin bằng chứng gốc mới có số; giáo viên xác nhận
 * (con người, không đo bằng %) và AI gợi ý (nhãn solving) thì không có.
 */
export const WATERFALL_PERCENT: Partial<Record<AnswerOrigin, number>> = {
  answer_table: 99,
  answer_line: 99,
  marker: 98,
  underline: 95,
  highlight: 95,
  bold: 90,
  solution: 88,
};

/** Các origin được coi là bằng chứng gốc (không phải solving, không phải rỗng). */
const ORIGINAL_EVIDENCE_ORIGINS = new Set<AnswerOrigin>([
  "teacher_confirmed",
  "answer_table",
  "answer_line",
  "marker",
  "underline",
  "highlight",
  "bold",
  "solution",
]);

export interface QuestionDetectionDisplay {
  /** true khi nội dung + ≥ 2 phương án đều có (nhận diện cấu trúc đủ). */
  complete: boolean;
  label: string;
  reasons: string[];
}

export interface QuestionReviewDisplay {
  order: number;
  questionIndex: number;
  status: ReviewDisplayStatus;
  statusLabel: string;
  /** Nhãn nguồn đáp án; null khi không có bằng chứng (UI hiển thị "Chưa có bằng chứng"). */
  answerSourceLabel: string | null;
  /**
   * % waterfall của nguồn thắng; null = không hiển thị số (giáo viên xác
   * nhận, AI gợi ý, không bằng chứng). KHÔNG BAO GIỜ lấy từ
   * evidence.confidence hay V1 confidenceScore.
   */
  answerConfidencePercent: number | null;
  questionDetection: QuestionDetectionDisplay;
  /** Lý do cần xem lại (rỗng khi verified); UI hiển thị nguyên văn. */
  reasons: string[];
  /** Hành động gợi ý cho giáo viên; null khi verified (không cần thao tác). */
  suggestedAction: string | null;
  /** Key lọc được: status + từng lý do (vd "missing_answer", "conflict"). */
  flagKeys: string[];
}

export interface ReviewDisplaySummary {
  total: number;
  verified: number;
  likely: number;
  needs_review: number;
  invalid: number;
  byFlag: Record<string, number>;
}

export interface ReviewDisplay {
  questions: QuestionReviewDisplay[];
  summary: ReviewDisplaySummary;
}

export interface BuildQuestionDisplayInput {
  question: ExtractionV2Question;
  questionIndex: number;
  /** Verdict evidence của câu (từ HybridOrchestrationResult.evidence); vắng mặt thì suy từ cấu trúc. */
  evidenceVerdict?: EvidenceVerdict;
  /** Báo cáo reconcile của câu (từ HybridOrchestrationResult.reconcileQuestions). */
  reconcile?: ReconcileQuestionResult;
  /** true khi trang chứa câu này là trang scan cần OCR (chunk failed hoặc aiNeeded.ocrNeededPages). */
  scanPage?: boolean;
}

function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

function pushFlag(flags: string[], key: string): void {
  if (!flags.includes(key)) flags.push(key);
}

export function buildQuestionReviewDisplay(
  input: BuildQuestionDisplayInput
): QuestionReviewDisplay {
  const { question, questionIndex, reconcile } = input;
  const order = question.order || questionIndex + 1;
  const answers = question.correctAnswers ?? [];
  const optionIds = new Set(question.options.map((o) => o.id));
  const origin: AnswerOrigin = question.answerEvidence?.origin ?? "none";

  const reasons: string[] = [];
  const flagKeys: string[] = [];

  // --- Nhận diện câu hỏi (tách khỏi độ tin cậy đáp án) ---
  const detectionReasons: string[] = [];
  if (!question.content || question.content.trim().length === 0) {
    detectionReasons.push("Thiếu nội dung câu hỏi");
  }
  if (question.options.length < 2) {
    detectionReasons.push(
      `Thiếu phương án (chỉ có ${question.options.length} phương án)`
    );
  }
  const questionDetection: QuestionDetectionDisplay = {
    complete: detectionReasons.length === 0,
    label:
      detectionReasons.length === 0
        ? "Nhận diện đầy đủ"
        : "Nhận diện chưa đầy đủ",
    reasons: detectionReasons,
  };

  // --- Trạng thái đáp án: invalid trước, rồi verified / likely / needs_review ---
  // Câu rỗng nội dung không bao giờ verified dù đáp án có bằng chứng:
  // không có đề thì không có gì để xác minh.
  const contentEmpty =
    !question.content || question.content.trim().length === 0;
  const invalidAnswers = answers.filter((a) => !optionIds.has(a));
  let status: ReviewDisplayStatus;
  if (invalidAnswers.length > 0 || input.evidenceVerdict === "invalid") {
    status = "invalid";
  } else if (
    !contentEmpty &&
    question.status === "verified" &&
    answers.length > 0 &&
    ORIGINAL_EVIDENCE_ORIGINS.has(origin)
  ) {
    status = "verified";
  } else if (answers.length > 0 && origin === "ai_suggested") {
    status = "likely";
  } else {
    status = "needs_review";
  }
  pushFlag(flagKeys, status);

  // --- Lý do (theo thứ tự ưu tiên hiển thị, không trùng) ---
  // Lý do nhận diện (cấu trúc câu) đi trước lý do đáp án để giáo viên
  // thấy hai tầng riêng biệt: câu hỏi nhận diện ra sao, đáp án ra sao.
  for (const r of detectionReasons) {
    reasons.push(r);
  }
  if (!questionDetection.complete) {
    pushFlag(flagKeys, "incomplete_detection");
  }
  if (status === "invalid") {
    const shown =
      invalidAnswers.length > 0
        ? invalidAnswers.join(", ")
        : "ngoài phương án";
    pushUnique(reasons, `Đáp án ngoài phương án: ${shown}`);
    pushFlag(flagKeys, "invalid_answer");
  }
  if (answers.length === 0) {
    pushUnique(reasons, "Chưa có đáp án");
    pushFlag(flagKeys, "missing_answer");
  }
  if (question.options.length < 2) {
    pushUnique(
      reasons,
      `Thiếu phương án (chỉ có ${question.options.length} phương án)`
    );
    pushFlag(flagKeys, "insufficient_options");
  }
  if (input.evidenceVerdict === "conflict") {
    pushUnique(reasons, "Đáp án mâu thuẫn giữa các nguồn bằng chứng");
    pushFlag(flagKeys, "conflict");
  }
  if (reconcile?.outcome === "unresolved-conflict") {
    if (reconcile.message) pushUnique(reasons, reconcile.message);
    pushFlag(flagKeys, "conflict");
  }
  if (reconcile?.outcome === "pruned-invalid") {
    if (reconcile.message) pushUnique(reasons, reconcile.message);
    pushFlag(flagKeys, "pruned");
  }
  if (question.type === "unknown") {
    reasons.push("Chưa xác định loại câu");
    pushFlag(flagKeys, "unknown_type");
  }
  if (question.engine === "manual") {
    reasons.push("Câu tạo tay");
    pushFlag(flagKeys, "manual");
  }
  if (question.engine === "ocr") {
    reasons.push("Câu từ OCR — cần đối chiếu file gốc");
    pushFlag(flagKeys, "ocr");
  }
  if (input.scanPage) {
    reasons.push("Trang scan — cần OCR");
    pushFlag(flagKeys, "scan");
  }
  if (answers.length === 0) {
    pushFlag(flagKeys, "no_evidence");
  } else if (origin === "ai_suggested") {
    pushFlag(flagKeys, "ai_suggested");
  }
  // Lý do chất lượng từng câu (đã dedup với các lý do trên).
  for (const r of question.quality?.reasons ?? []) {
    pushUnique(reasons, r);
  }
  for (const w of question.warnings ?? []) {
    pushUnique(reasons, w);
  }
  // Không lược lý do theo status: câu verified vẫn có thể mang ghi chú
  // (vd thông điệp reconcile "nguồn X thắng") — đó là thông tin đối
  // chiếu, không phải lỗi; giấu nó đi mới là giấu flag khỏi giáo viên.

  // --- Nguồn + % hiển thị ---
  // % chỉ từ waterfall của origin bằng chứng gốc; evidence.confidence
  // (có thể là số tự khai từ V1, vd 0.96 solving) KHÔNG BAO GIỜ được đọc.
  const answerSourceLabel =
    answers.length > 0 && origin !== "none" ? ORIGIN_LABELS[origin] : null;
  const answerConfidencePercent =
    answers.length > 0 ? WATERFALL_PERCENT[origin] ?? null : null;

  // --- Hành động gợi ý ---
  let suggestedAction: string | null = null;
  if (status === "invalid") {
    suggestedAction = "Sửa đáp án ngoài phương án";
  } else if (status === "likely") {
    suggestedAction = "Xác nhận đáp án gợi ý";
  } else if (status === "needs_review") {
    if (reconcile?.outcome === "unresolved-conflict") {
      suggestedAction = "Chọn đáp án đúng trong các nguồn mâu thuẫn";
    } else if (reconcile?.outcome === "pruned-invalid") {
      suggestedAction = "Chọn lại đáp án";
    } else if (answers.length === 0) {
      suggestedAction = "Chọn đáp án đúng";
    } else if (question.options.length < 2) {
      suggestedAction = "Bổ sung phương án";
    } else if (question.engine === "manual") {
      suggestedAction = "Xác nhận câu tạo tay";
    } else if (question.engine === "ocr" || input.scanPage) {
      suggestedAction = "Đối chiếu với file gốc";
    } else if (question.type === "unknown") {
      suggestedAction = "Xác định loại câu";
    } else {
      suggestedAction = "Xem lại câu hỏi";
    }
  }

  return {
    order,
    questionIndex,
    status,
    statusLabel: REVIEW_STATUS_LABELS[status],
    answerSourceLabel,
    answerConfidencePercent,
    questionDetection,
    reasons,
    suggestedAction,
    flagKeys,
  };
}

/**
 * Build display cho toàn bộ kết quả Hybrid Orchestrator. Key khớp theo
 * order hiển thị (cùng quy ước evidence/reconcile). Câu không có báo cáo
 * evidence/reconcile thì suy từ cấu trúc V2, không đoán.
 */
export function buildReviewDisplay(
  hybrid: HybridOrchestrationResult
): ReviewDisplay {
  const evidenceByOrder = new Map<number, EvidenceVerdict>();
  for (const r of hybrid.evidence.questions ?? []) {
    if (!evidenceByOrder.has(r.order)) evidenceByOrder.set(r.order, r.verdict);
  }
  const reconcileByOrder = new Map<number, ReconcileQuestionResult>();
  for (const r of hybrid.reconcileQuestions ?? []) {
    if (!reconcileByOrder.has(r.order)) reconcileByOrder.set(r.order, r);
  }
  const failedPages = new Set<number>();
  for (const c of hybrid.v2.chunks ?? []) {
    if (c.status === "failed" && c.page !== undefined) failedPages.add(c.page);
  }
  const ocrPages = new Set<number>(hybrid.aiNeeded.ocrNeededPages ?? []);

  const questions = hybrid.v2.questions.map((q, i) => {
    const order = q.order || i + 1;
    const scanPage =
      (q.page !== null && failedPages.has(q.page)) ||
      (q.page !== null && ocrPages.has(q.page));
    return buildQuestionReviewDisplay({
      question: q,
      questionIndex: i,
      evidenceVerdict: evidenceByOrder.get(order),
      reconcile: reconcileByOrder.get(order),
      scanPage,
    });
  });

  const byFlag: Record<string, number> = {};
  for (const d of questions) {
    for (const f of d.flagKeys) {
      byFlag[f] = (byFlag[f] ?? 0) + 1;
    }
  }
  return {
    questions,
    summary: {
      total: questions.length,
      verified: questions.filter((d) => d.status === "verified").length,
      likely: questions.filter((d) => d.status === "likely").length,
      needs_review: questions.filter((d) => d.status === "needs_review").length,
      invalid: questions.filter((d) => d.status === "invalid").length,
      byFlag,
    },
  };
}
