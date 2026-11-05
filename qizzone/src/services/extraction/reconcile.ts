import type { OptionId } from "@/types/quiz";
import type {
  AnswerEvidence,
  AnswerOrigin,
  ExtractionV2Question,
  ExtractionV2Result,
  V2QuestionStatus,
} from "@/types/extractionV2";
import type {
  OptionFormatFlags,
  QuestionEvidenceContext,
} from "@/services/extraction/evidenceValidator";
import type { ExtractedQuestion } from "@/types/extractor";

/**
 * Bước 22 (PLAN_MAIN, giai đoạn F): Reconcile bằng bằng chứng.
 *
 * Vai trò: khi một câu có nhiều nguồn bằng chứng mâu thuẫn nhau (bảng đáp
 * án cuối đề vs dòng đáp án cuối câu vs tô vàng vs in đậm vs gạch chân),
 * chọn đáp án thắng theo Waterfall ưu tiên đã khóa ở bước 11 — KHÔNG gọi
 * AI, KHÔNG đoán, KHÔNG tự cắt đáp án hay đổi type câu.
 *
 * Waterfall (bước 11, ghi rõ số % để khỏi tranh cãi):
 * - teacher_confirmed: con người xác nhận — cao nhất, không nằm trong
 *   waterfall máy nhưng luôn thắng mọi nguồn máy.
 * - answer_table 99% = answer_line 99% (đồng hạng)
 * - marker 98%
 * - underline 95% = highlight 95% (đồng hạng)
 * - bold 90% (chỉ khi đúng 1 phương án in đậm — xem buildCandidates)
 * - solution 88%
 * - ai_suggested: KHÔNG BAO GIỜ là ứng viên (nhãn solving, bước 17).
 * - none: không phải nguồn, không phải ứng viên.
 *
 * QUY TẮC ĐỒNG HẠNG (quyết định khóa ở bước này, vì plan chỉ cho số %):
 * hai nguồn đồng hạng mà ghi đáp án KHÁC NHAU thì KHÔNG có nguồn thắng
 * (không bịa thứ tự trong cùng một mức %) → giữ nguyên đáp án hiện tại,
 * gắn cờ mâu thuẫn, status needs_review, để giáo viên xác nhận ở bước 24.
 * Ngược lại, nguồn thắng ở mức cao hơn thì thay đáp án hiện tại — kể cả
 * khi đáp án hiện tại đến từ nguồn thấp hơn (parser luật chạy waterfall
 * theo thứ tự 1→7 nên trường hợp này xảy ra khi context đối chiếu có
 * thêm nguồn mà parser bỏ sót, hoặc khi nguồn thắng cho TẬP đáp án đầy
 * đủ hơn — vd f07: parser chỉ lấy 1 phương án tô vàng đầu tiên, còn
 * context flag cho thấy cả 2 phương án đều tô vàng).
 *
 * Thứ tự xử lý trong một câu (không trộn hai việc vào nhau):
 *  1. Lược đáp án ngoài phương án (lỗi cấu trúc): chỉ lược phần sai, kèm
 *     cờ, KHÔNG thay bằng đáp án khác trong cùng lượt — câu đã lược thì
 *     dừng ở đó để giáo viên xem, không chạy tiếp chọn nguồn thắng.
 *  2. Giáo viên đã xác nhận (teacher_confirmed) thì không bao giờ bị
 *     nguồn máy thay thế — lược cấu trúc ở bước 1 vẫn áp dụng vì đó là
 *     vệ sinh dữ liệu, không phải chọn nguồn.
 *  3. Chọn nguồn thắng trong các ứng viên (xem reconcileQuestion).
 *
 * Module này là hàm thuần: không gọi AI, không đọc file, không mutate
 * input. Câu hỏi giữ nguyên options/content/type — chỉ correctAnswers,
 * answerEvidence, status, quality, warnings có thể đổi.
 */

/** Một ứng viên đáp án từ một nguồn bằng chứng cụ thể. */
export interface AnswerCandidate {
  /** Tập đáp án nguồn này ghi (so sánh theo tập, không theo thứ tự). */
  answers: readonly OptionId[];
  /** Nguồn bằng chứng; ai_suggested/none bị lược ở reconcileQuestion. */
  origin: AnswerOrigin;
  /** Trích đoạn nguồn nếu có (vd "Đáp án: B", "Bảng đáp án: A, C"). */
  sourceExcerpt?: string;
}

/** Mức ưu tiên waterfall; số càng cao càng thắng. Đồng hạng = cùng số. */
const WATERFALL_PRIORITY: Record<string, number> = {
  teacher_confirmed: 100,
  answer_table: 99,
  answer_line: 99,
  marker: 98,
  underline: 95,
  highlight: 95,
  bold: 90,
  solution: 88,
};

/** Confidence ghi vào evidence của nguồn thắng (bằng đúng % waterfall). */
const WATERFALL_CONFIDENCE: Record<string, number> = {
  teacher_confirmed: 1,
  answer_table: 0.99,
  answer_line: 0.99,
  marker: 0.98,
  underline: 0.95,
  highlight: 0.95,
  bold: 0.9,
  solution: 0.88,
};

export type ReconcileOutcome =
  | "unchanged"
  | "resolved"
  | "unresolved-conflict"
  | "pruned-invalid";

export interface ReconcileQuestionResult {
  order: number;
  questionIndex: number;
  outcome: ReconcileOutcome;
  /** Nguồn thắng (nếu có ứng viên để chọn, kể cả khi thắng trùng đáp án cũ). */
  winningOrigin: AnswerOrigin | null;
  /** Các nguồn thua trong cùng lượt đối chiếu (không tính nguồn thắng). */
  losingOrigins: AnswerOrigin[];
  /** True khi câu này không có ứng viên nào để đối chiếu. */
  noCandidate: boolean;
  /** Thông điệp tiếng Việt cho UI review; null khi không có gì để báo. */
  message: string | null;
}

export interface ReconcileSummary {
  total: number;
  resolved: number;
  unresolved: number;
  pruned: number;
  unchanged: number;
  noCandidate: number;
}

export interface ReconcileResult {
  result: ExtractionV2Result;
  questions: ReconcileQuestionResult[];
  summary: ReconcileSummary;
}

function sameAnswerSet(
  a: readonly OptionId[],
  b: readonly OptionId[]
): boolean {
  if (a.length !== b.length) return false;
  return [...a].sort().join(",") === [...b].sort().join(",");
}

function setKey(answers: readonly OptionId[]): string {
  return [...answers].sort().join(",");
}

const ORIGIN_LABEL: Record<string, string> = {
  teacher_confirmed: "giáo viên xác nhận",
  answer_table: "bảng đáp án",
  answer_line: "dòng đáp án cuối câu",
  marker: "ký hiệu tiền tố",
  underline: "gạch chân",
  highlight: "tô vàng",
  bold: "in đậm duy nhất",
  solution: "lời giải",
};

function label(origin: AnswerOrigin): string {
  return ORIGIN_LABEL[origin] ?? origin;
}

/**
 * Dựng ứng viên từ context đối chiếu (bước 11). Chỉ dùng những tín hiệu
 * caller thực sự cấp — tín hiệu vắng mặt thì không có ứng viên, không suy.
 * - Bảng/dòng/lời giải: mỗi tín hiệu là một ứng viên (tập đáp án của nó).
 * - Định dạng: ứng viên của một origin là TẬP ĐẦY ĐỦ các phương án mang
 *   flag đó (không phải phương án đầu tiên — đó chính là lỗi f07 mà
 *   parser luật mắc: chỉ lấy 1 trong 2 phương án tô vàng).
 * - Bold chỉ thành ứng viên khi đúng 1 phương án in đậm (quy tắc "duy
 *   nhất" của chiến lược 6, bước 11); in đậm 2+ phương án thì không có
 *   ứng viên bold — không đoán xem phương án nào trong số đó mới đúng.
 */
export function buildCandidatesFromContext(
  context: QuestionEvidenceContext | undefined
): AnswerCandidate[] {
  if (!context) return [];
  const candidates: AnswerCandidate[] = [];
  if (context.answerKeyEntry !== undefined && context.answerKeyEntry.length > 0) {
    candidates.push({
      answers: [...context.answerKeyEntry] as OptionId[],
      origin: "answer_table",
    });
  }
  if (context.trailingAnswer !== undefined) {
    candidates.push({
      answers: [context.trailingAnswer as OptionId],
      origin: "answer_line",
    });
  }
  if (context.solutionAnswer !== undefined) {
    candidates.push({
      answers: [context.solutionAnswer as OptionId],
      origin: "solution",
    });
  }
  if (context.optionFormats) {
    const formats = context.optionFormats;
    const origins: Array<{
      origin: AnswerOrigin;
      flag: keyof OptionFormatFlags;
    }> = [
      { origin: "marker", flag: "marker" },
      { origin: "underline", flag: "underline" },
      { origin: "highlight", flag: "highlight" },
      { origin: "bold", flag: "bold" },
    ];
    for (const { origin, flag } of origins) {
      const flagged = (Object.keys(formats) as OptionId[]).filter(
        (id) => formats[id]?.[flag] === true
      );
      if (flagged.length === 0) continue;
      // Bold "duy nhất": 2+ phương án in đậm thì không có ứng viên bold.
      if (origin === "bold" && flagged.length !== 1) continue;
      candidates.push({ answers: flagged, origin });
    }
  }
  return candidates;
}

/**
 * Dựng context định dạng từ câu hỏi V1 (cùng logic runner bước 11): chỉ
 * cấp map cho câu nào parser thực sự ghi nhận ít nhất một flag — câu
 * không có dữ liệu định dạng thì không có context, không suy thành sai.
 * Key theo order hiển thị (cùng quy ước validateEvidence).
 */
export function buildFormatContexts(
  questions: readonly ExtractedQuestion[]
): Map<number, QuestionEvidenceContext> {
  const contexts = new Map<number, QuestionEvidenceContext>();
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
    if (hasAnyFlag) contexts.set(q.order, { optionFormats: formats });
  }
  return contexts;
}

export function reconcileQuestion(
  question: ExtractionV2Question,
  questionIndex: number,
  candidates: readonly AnswerCandidate[]
): { question: ExtractionV2Question; result: ReconcileQuestionResult } {
  const order = question.order || questionIndex + 1;
  const base: Omit<ReconcileQuestionResult, "outcome" | "message"> = {
    order,
    questionIndex,
    winningOrigin: null,
    losingOrigins: [],
    noCandidate: false,
  };

  const optionIds = new Set(question.options.map((o) => o.id));
  const current = question.correctAnswers ?? [];

  // Bước 1: lược đáp án ngoài phương án (lỗi cấu trúc). Chỉ lược phần
  // sai, không thay bằng đáp án khác trong cùng lượt.
  const invalid = current.filter((a) => !optionIds.has(a));
  if (invalid.length > 0) {
    const kept = current.filter((a) => optionIds.has(a));
    const message =
      `Câu ${order} đã lược đáp án ngoài phương án [${invalid.join(", ")}] ` +
      `— cần giáo viên xác nhận, không tự thay bằng đáp án khác`;
    return {
      question: {
        ...question,
        correctAnswers: kept,
        answerEvidence: kept.length > 0 ? question.answerEvidence : null,
        status: "needs_review" as V2QuestionStatus,
        quality: { status: "partial", reasons: [message] },
        warnings: question.warnings.includes(message)
          ? question.warnings
          : [...question.warnings, message],
      },
      result: { ...base, outcome: "pruned-invalid", message },
    };
  }

  // Bước 2: giáo viên đã xác nhận thì nguồn máy không được thay thế.
  const currentOrigin = question.answerEvidence?.origin ?? "none";
  if (currentOrigin === "teacher_confirmed" && current.length > 0) {
    return {
      question,
      result: { ...base, outcome: "unchanged", message: null },
    };
  }

  // Bước 3: lọc ứng viên hợp lệ — bỏ ai_suggested/none, bỏ tập rỗng,
  // bỏ đáp án ngoài phương án; gộp trùng (cùng origin + cùng tập).
  const seen = new Set<string>();
  const valid: AnswerCandidate[] = [];
  for (const c of candidates) {
    if (c.origin === "ai_suggested" || c.origin === "none") continue;
    if (!(c.origin in WATERFALL_PRIORITY)) continue;
    if (c.answers.length === 0) continue;
    if (c.answers.some((a) => !optionIds.has(a))) continue;
    const key = `${c.origin}:${setKey(c.answers)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(c);
  }
  if (valid.length === 0) {
    return {
      question,
      result: { ...base, outcome: "unchanged", noCandidate: true, message: null },
    };
  }

  // Nguồn thắng: mức ưu tiên cao nhất; các nguồn thấp hơn đều là thua.
  const topPriority = Math.max(
    ...valid.map((c) => WATERFALL_PRIORITY[c.origin])
  );
  const top = valid.filter((c) => WATERFALL_PRIORITY[c.origin] === topPriority);
  const losingOrigins = valid
    .filter((c) => WATERFALL_PRIORITY[c.origin] < topPriority)
    .map((c) => c.origin);
  const distinctSets = new Set(top.map((c) => setKey(c.answers)));

  // Đồng hạng mà khác tập đáp án → không có nguồn thắng.
  if (distinctSets.size > 1) {
    const topDesc = top
      .map((c) => `${label(c.origin)} ghi [${[...c.answers].sort().join(", ")}]`)
      .join("; ");
    const message =
      `Câu ${order} có bằng chứng mâu thuẫn cùng mức ưu tiên (${topDesc}) ` +
      `— giữ nguyên đáp án hiện tại, cần giáo viên xác nhận`;
    return {
      question: {
        ...question,
        status: "needs_review" as V2QuestionStatus,
        quality: { status: "partial", reasons: [message] },
        warnings: question.warnings.includes(message)
          ? question.warnings
          : [...question.warnings, message],
      },
      result: {
        ...base,
        outcome: "unresolved-conflict",
        winningOrigin: null,
        losingOrigins,
        message,
      },
    };
  }

  const winner = top[0];
  // Nguồn thắng trùng tập đáp án hiện tại → không đổi gì.
  if (sameAnswerSet(current, winner.answers)) {
    return {
      question,
      result: {
        ...base,
        outcome: "unchanged",
        winningOrigin: winner.origin,
        losingOrigins,
        message: null,
      },
    };
  }

  // Nguồn thắng khác đáp án hiện tại → thay đáp án, ghi rõ nguồn thắng
  // và các nguồn thua để UI review đối chiếu (bước 24).
  const evidence: AnswerEvidence = {
    origin: winner.origin,
    confidence: WATERFALL_CONFIDENCE[winner.origin],
    ...(winner.sourceExcerpt ? { sourceExcerpt: winner.sourceExcerpt } : {}),
  };
  const losingDesc =
    losingOrigins.length > 0
      ? ` (các nguồn ghi khác: ${losingOrigins.map(label).join(", ")})`
      : "";
  const message =
    `Câu ${order} đã đối chiếu bằng chứng: ${label(winner.origin)} thắng ` +
    `với đáp án [${[...winner.answers].sort().join(", ")}]${losingDesc}`;
  const status: V2QuestionStatus =
    question.options.length >= 2 ? "verified" : "needs_review";
  return {
    question: {
      ...question,
      correctAnswers: [...winner.answers].sort(),
      answerEvidence: evidence,
      status,
      quality: { status: "complete", reasons: [] },
      warnings: question.warnings.includes(message)
        ? question.warnings
        : [...question.warnings, message],
    },
    result: {
      ...base,
      outcome: "resolved",
      winningOrigin: winner.origin,
      losingOrigins,
      message,
    },
  };
}

/**
 * Áp reconcile cho toàn bộ kết quả V2. Context key theo order hiển thị
 * (cùng quy ước validateEvidence). Không mutate input.
 */
export function reconcileResult(
  result: ExtractionV2Result,
  contexts?:
    | ReadonlyMap<number, QuestionEvidenceContext>
    | Record<number, QuestionEvidenceContext>
): ReconcileResult {
  const contextMap =
    contexts instanceof Map
      ? contexts
      : new Map<number, QuestionEvidenceContext>(
          Object.entries(contexts ?? {}).map(([k, v]) => [Number(k), v])
        );
  const questions: ExtractionV2Question[] = [];
  const reports: ReconcileQuestionResult[] = [];
  for (let i = 0; i < result.questions.length; i++) {
    const q = result.questions[i];
    const order = q.order || i + 1;
    const candidates = buildCandidatesFromContext(contextMap.get(order));
    const { question, result: report } = reconcileQuestion(q, i, candidates);
    questions.push(question);
    reports.push(report);
  }
  const summary: ReconcileSummary = {
    total: reports.length,
    resolved: reports.filter((r) => r.outcome === "resolved").length,
    unresolved: reports.filter((r) => r.outcome === "unresolved-conflict").length,
    pruned: reports.filter((r) => r.outcome === "pruned-invalid").length,
    unchanged: reports.filter((r) => r.outcome === "unchanged").length,
    noCandidate: reports.filter((r) => r.noCandidate).length,
  };
  return { result: { ...result, questions }, questions: reports, summary };
}
