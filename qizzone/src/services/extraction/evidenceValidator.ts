import type { OptionId } from "@/types/quiz";
import type {
  AnswerOrigin,
  ExtractionV2Question,
  ExtractionV2Result,
  V2QuestionStatus,
} from "@/types/extractionV2";

/**
 * Bước 11 (PLAN_MAIN, giai đoạn C): Evidence Validator cho ExtractionResult V2.
 *
 * Vai trò: kiểm tra MỖI đáp án được gán có bằng chứng gốc hợp lệ không —
 * khác với Quality Gate bước 10 (đánh giá cấu trúc trích xuất: đủ câu,
 * đủ trang, không trùng) và khác với gate publish bước 04/08 (chặn xuất
 * bản). Validator này KHÔNG bịa, KHÔNG xóa dữ liệu, KHÔNG tự chọn đáp án
 * khác: nó chỉ xác nhận hoặc hạ cấp trạng thái verified → needs_review và
 * báo diagnostics có vị trí. Việc chọn đáp án thắng khi các nguồn mâu
 * thuẫn thuộc bước 22 (Reconcile), không thuộc bước này.
 *
 * Mapping origin → Priority Waterfall của ruleExtractor (bước 01):
 * - answer_table  ← chiến lược 1, bảng đáp án cuối đề (99%)
 * - answer_line   ← chiến lược 2, dòng "Đáp án: X" cuối câu (99%)
 * - marker        ← chiến lược 3, ký hiệu tiền tố (*A, ✓A, [x]) (98%)
 * - underline     ← chiến lược 4, gạch chân phương án (95%)
 * - highlight     ← chiến lược 5, tô màu highlight / chữ đỏ (95%)
 * - bold          ← chiến lược 6, in đậm DUY NHẤT (90% — đúng 1 phương án in đậm)
 * - solution      ← chiến lược 7, trích từ lời giải ("Chọn A vì...") (88%)
 * - none          ← chiến lược 8, không tìm thấy đáp án → correctAnswers []
 * - ai_suggested  ← KHÔNG nằm trong waterfall luật: AI giải đề (opt-in),
 *   không bao giờ là bằng chứng gốc, không bao giờ được verified.
 * - teacher_confirmed ← KHÔNG nằm trong waterfall: giáo viên tự chọn/xác
 *   nhận thủ công; con người chính là bằng chứng, không cần đối chiếu nguồn.
 *
 * Trường hợp validator bác bỏ kết quả waterfall (downgrade/conflict):
 * - Waterfall gán đáp án nhưng nguồn khai báo không khớp dữ liệu thật của
 *   câu (vd khai highlight nhưng phương án đó không có flag highlight;
 *   khai bold nhưng có tới 2 phương án in đậm nên không còn "duy nhất").
 * - Đáp án khai từ bảng đáp án nhưng bảng đáp án đối chiếu ghi khác
 *   (thường do lệch số thứ tự khi parser đánh lại order — bước 13 mới
 *   nối theo sourceNumber).
 * - Hai nguồn độc lập mâu thuẫn nhau (bảng nói A, dòng cuối câu nói B):
 *   báo conflict ngay cả khi đáp án khai báo khớp một trong hai nguồn.
 * - Đáp án nằm ngoài các phương án, hoặc status verified nhưng origin
 *   không phải bằng chứng gốc / thiếu phương án / thiếu đáp án.
 *
 * Hai tầng kiểm tra (ghi rõ ranh giới):
 * 1. Cấu trúc (luôn chạy, không cần context): đáp án ⊆ phương án, tính
 *    nhất quán evidence ↔ correctAnswers, origin có phải bằng chứng gốc,
 *    status verified có đủ điều kiện không.
 * 2. Đối chiếu nguồn (chỉ khi caller cấp context cho câu đó): flag định
 *    dạng từng phương án (từ parser V1), bảng đáp án, dòng đáp án cuối
 *    câu, đáp án trong lời giải. KHÔNG có context thì kết luận là
 *    "unchecked" (crossChecked = false), KHÔNG suy thành mismatch —
 *    thiếu dữ liệu đối chiếu không phải là bằng chứng sai.
 *
 * Cấm dùng confidence: validator KHÔNG đọc confidence dưới bất kỳ dạng
 * nào (mạnh hơn cả cấm "làm điều kiện duy nhất" của plan) — confidence
 * là số tự khai của engine, không phải bằng chứng.
 */

/** Kết luận cho một câu: valid (giữ nguyên) / downgraded (hạ verified) / conflict (nguồn mâu thuẫn) / invalid (đáp án sai cấu trúc). */
export type EvidenceVerdict = "valid" | "downgraded" | "conflict" | "invalid";

export type EvidenceIssueCode =
  | "answer_not_in_options"
  | "missing_evidence"
  | "evidence_without_answer"
  | "status_mismatch"
  | "evidence_mismatch"
  | "answer_key_conflict"
  | "answer_line_conflict"
  | "solution_conflict"
  | "evidence_conflict";

export interface EvidenceIssue {
  code: EvidenceIssueCode;
  /** Số thứ tự hiển thị của câu (1-based). */
  order: number;
  /** Index 0-based trong mảng questions. */
  questionIndex: number;
  /** Thông điệp tiếng Việt, ghi rõ số liệu và vị trí. */
  message: string;
}

export interface QuestionEvidenceReport {
  order: number;
  questionIndex: number;
  verdict: EvidenceVerdict;
  /** Trạng thái sau validation: "verified" chỉ khi verdict valid VÀ status gốc đã verified. Validator KHÔNG BAO GIỜ nâng needs_review → verified. */
  effectiveStatus: V2QuestionStatus;
  /** True khi nguồn khai báo đã được đối chiếu với dữ liệu nguồn (hoặc không cần đối chiếu: none/ai_suggested/teacher_confirmed). */
  crossChecked: boolean;
  issues: EvidenceIssue[];
}

export interface EvidenceValidationResult {
  questions: QuestionEvidenceReport[];
  issues: EvidenceIssue[];
  summary: {
    total: number;
    valid: number;
    downgraded: number;
    conflict: number;
    invalid: number;
    verified: number;
    needsReview: number;
    crossChecked: number;
    unchecked: number;
  };
}

/** Flag định dạng của một phương án, lấy từ parser nguồn (V1 ExtractedOption). */
export interface OptionFormatFlags {
  underline?: boolean;
  highlight?: boolean;
  bold?: boolean;
  marker?: boolean;
}

/**
 * Dữ liệu nguồn để đối chiếu cho một câu. Caller CHỈ cấp những tín hiệu
 * mình thực sự có: tín hiệu không cấp thì bỏ qua, không suy thành sai.
 * Riêng optionFormats: map được cấp thì được coi là đầy đủ cho câu đó
 * (phương án vắng mặt trong map = không có flag); caller chỉ có dữ liệu
 * định dạng một phần thì KHÔNG nên cấp map (để unchecked) thay vì cấp
 * map thiếu — xem quy tắc ở runner bước 11.
 */
export interface QuestionEvidenceContext {
  /** Flag định dạng theo từng ID phương án. */
  optionFormats?: Partial<Record<OptionId, OptionFormatFlags>>;
  /** Mục bảng đáp án của câu này (theo order hiển thị), nếu đề có bảng. */
  answerKeyEntry?: readonly string[];
  /** Đáp án ghi ở cuối câu ("Đáp án: X"), nếu có. */
  trailingAnswer?: string;
  /** Đáp án nêu trong lời giải ("Chọn X"), nếu trích được. */
  solutionAnswer?: string;
}

/** Các origin được coi là bằng chứng gốc (đủ điều kiện verified khi đủ phương án) — cùng tập với adapter bước 09. */
const EVIDENCE_BACKED_ORIGINS: ReadonlySet<AnswerOrigin> = new Set([
  "answer_table",
  "answer_line",
  "marker",
  "underline",
  "highlight",
  "bold",
  "solution",
  "teacher_confirmed",
]);

/** Mức độ của từng mã: invalid (3) > conflict (2) > downgraded (1). */
const SEVERITY: Record<EvidenceIssueCode, 1 | 2 | 3> = {
  answer_not_in_options: 3,
  missing_evidence: 1,
  evidence_without_answer: 1,
  status_mismatch: 1,
  evidence_mismatch: 1,
  answer_key_conflict: 2,
  answer_line_conflict: 2,
  solution_conflict: 2,
  evidence_conflict: 2,
};

function severityToVerdict(level: number): EvidenceVerdict {
  if (level >= 3) return "invalid";
  if (level === 2) return "conflict";
  if (level === 1) return "downgraded";
  return "valid";
}

function sameAnswerSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return [...a].sort().join(",") === [...b].sort().join(",");
}

export function validateQuestionEvidence(
  question: ExtractionV2Question,
  questionIndex: number,
  context?: QuestionEvidenceContext
): QuestionEvidenceReport {
  const order = question.order || questionIndex + 1;
  const issues: EvidenceIssue[] = [];
  const push = (code: EvidenceIssueCode, message: string) => {
    issues.push({ code, order, questionIndex, message });
  };

  const answers = question.correctAnswers ?? [];
  const optionIds = new Set(question.options.map((o) => o.id));
  const evidence = question.answerEvidence;
  const origin: AnswerOrigin = evidence?.origin ?? "none";

  // --- Tầng 1: cấu trúc (luôn chạy) ---------------------------------------

  // Đáp án phải nằm trong các phương án.
  for (const ans of answers) {
    if (!optionIds.has(ans)) {
      push(
        "answer_not_in_options",
        `Câu ${order} có đáp án "${ans}" không nằm trong các phương án`
      );
    }
  }

  // Tính nhất quán evidence ↔ correctAnswers.
  if (answers.length > 0 && evidence === null) {
    push(
      "missing_evidence",
      `Câu ${order} có đáp án [${answers.join(", ")}] nhưng không có bằng chứng nào kèm theo`
    );
  } else if (answers.length > 0 && origin === "none") {
    push(
      "missing_evidence",
      `Câu ${order} có đáp án [${answers.join(", ")}] nhưng bằng chứng khai là "none" (không có nguồn)`
    );
  } else if (answers.length === 0 && evidence !== null && origin !== "none") {
    push(
      "evidence_without_answer",
      `Câu ${order} không có đáp án nhưng bằng chứng khai nguồn "${origin}" — bằng chứng không gắn với đáp án nào`
    );
  }

  // --- Tầng 2: đối chiếu nguồn (chỉ khi có context) ------------------------

  // Cross-checked = true khi nguồn khai báo không cần đối chiếu bên ngoài
  // (none / ai_suggested / teacher_confirmed), hoặc khi context cấp đúng
  // tín hiệu của origin đó.
  let crossChecked =
    origin === "none" || origin === "ai_suggested" || origin === "teacher_confirmed";

  // Đối chiếu flag định dạng cho các origin dạng định dạng.
  const formatOrigin =
    origin === "marker" ||
    origin === "underline" ||
    origin === "highlight" ||
    origin === "bold";
  if (formatOrigin && context?.optionFormats) {
    crossChecked = true;
    const flagKey =
      origin === "marker"
        ? "marker"
        : origin === "underline"
          ? "underline"
          : origin === "highlight"
            ? "highlight"
            : "bold";
    const flaggedOptions = question.options.filter(
      (opt) => context.optionFormats?.[opt.id]?.[flagKey] === true
    );
    // Bold "duy nhất" (chiến lược 6) yêu cầu đúng 1 phương án in đậm.
    if (origin === "bold" && flaggedOptions.length !== 1) {
      push(
        "evidence_mismatch",
        `Câu ${order} khai đáp án từ "in đậm duy nhất" nhưng có ${flaggedOptions.length} phương án in đậm (cần đúng 1)`
      );
    }
    for (const ans of answers) {
      const flags = context.optionFormats[ans];
      if (flags?.[flagKey] !== true) {
        push(
          "evidence_mismatch",
          `Câu ${order} khai đáp án "${ans}" từ nguồn "${origin}" nhưng phương án "${ans}" không có dấu hiệu định dạng đó trong tài liệu gốc`
        );
      }
    }
  }

  // Đối chiếu bảng đáp án cho origin answer_table.
  if (origin === "answer_table" && context?.answerKeyEntry !== undefined) {
    crossChecked = true;
    if (!sameAnswerSet(answers, context.answerKeyEntry)) {
      push(
        "answer_key_conflict",
        `Câu ${order} khai đáp án [${answers.join(", ")}] từ bảng đáp án nhưng bảng ghi [${[...context.answerKeyEntry].join(", ")}]`
      );
    }
  }

  // Đối chiếu dòng đáp án cuối câu cho origin answer_line.
  if (origin === "answer_line" && context?.trailingAnswer !== undefined) {
    crossChecked = true;
    if (answers.length !== 1 || answers[0] !== context.trailingAnswer) {
      push(
        "answer_line_conflict",
        `Câu ${order} khai đáp án [${answers.join(", ")}] từ dòng đáp án cuối câu nhưng dòng đó ghi "${context.trailingAnswer}"`
      );
    }
  }

  // Đối chiếu đáp án trong lời giải cho origin solution.
  if (origin === "solution" && context?.solutionAnswer !== undefined) {
    crossChecked = true;
    if (answers.length !== 1 || answers[0] !== context.solutionAnswer) {
      push(
        "solution_conflict",
        `Câu ${order} khai đáp án [${answers.join(", ")}] từ lời giải nhưng lời giải nêu đáp án "${context.solutionAnswer}"`
      );
    }
  }

  // Các nguồn độc lập mâu thuẫn nhau — báo conflict ngay cả khi đáp án
  // khai báo khớp một trong các nguồn (việc chọn nguồn thắng thuộc bước 22).
  const independentSources: Array<{ label: string; value: readonly string[] }> = [];
  if (context?.answerKeyEntry !== undefined) {
    independentSources.push({ label: "bảng đáp án", value: context.answerKeyEntry });
  }
  if (context?.trailingAnswer !== undefined) {
    independentSources.push({ label: "dòng đáp án cuối câu", value: [context.trailingAnswer] });
  }
  if (context?.solutionAnswer !== undefined) {
    independentSources.push({ label: "lời giải", value: [context.solutionAnswer] });
  }
  for (let i = 0; i < independentSources.length; i++) {
    for (let j = i + 1; j < independentSources.length; j++) {
      const a = independentSources[i];
      const b = independentSources[j];
      if (!sameAnswerSet(a.value, b.value)) {
        push(
          "evidence_conflict",
          `Câu ${order} có nguồn mâu thuẫn nhau: ${a.label} ghi [${[...a.value].join(", ")}] nhưng ${b.label} ghi [${[...b.value].join(", ")}]`
        );
      }
    }
  }

  // --- Tính nhất quán status verified --------------------------------------
  // Verified chỉ hợp lệ khi: có đáp án + origin là bằng chứng gốc + đủ
  // ≥ 2 phương án (cùng quy tắc với adapter bước 09). ai_suggested và
  // none không bao giờ verified; validator không nâng cấp status.
  if (question.status === "verified") {
    if (answers.length === 0) {
      push(
        "status_mismatch",
        `Câu ${order} ở trạng thái verified nhưng không có đáp án nào`
      );
    } else if (!EVIDENCE_BACKED_ORIGINS.has(origin)) {
      push(
        "status_mismatch",
        `Câu ${order} ở trạng thái verified nhưng nguồn "${origin}" không phải bằng chứng gốc (ai_suggested không bao giờ được verified)`
      );
    } else if (question.options.length < 2) {
      push(
        "status_mismatch",
        `Câu ${order} ở trạng thái verified nhưng chỉ có ${question.options.length} phương án (cần ít nhất 2)`
      );
    }
  }

  const level = issues.reduce((max, iss) => Math.max(max, SEVERITY[iss.code]), 0);
  const verdict = severityToVerdict(level);
  return {
    order,
    questionIndex,
    verdict,
    effectiveStatus:
      verdict === "valid" && question.status === "verified"
        ? "verified"
        : "needs_review",
    crossChecked,
    issues,
  };
}

export function validateEvidence(
  result: ExtractionV2Result,
  contexts?:
    | ReadonlyMap<number, QuestionEvidenceContext>
    | Record<number, QuestionEvidenceContext>
): EvidenceValidationResult {
  const contextMap =
    contexts instanceof Map
      ? contexts
      : new Map<number, QuestionEvidenceContext>(
          Object.entries(contexts ?? {}).map(([k, v]) => [Number(k), v])
        );
  const reports: QuestionEvidenceReport[] = [];
  const allIssues: EvidenceIssue[] = [];
  for (let i = 0; i < result.questions.length; i++) {
    const q = result.questions[i];
    const order = q.order || i + 1;
    const report = validateQuestionEvidence(q, i, contextMap.get(order));
    reports.push(report);
    allIssues.push(...report.issues);
  }
  const summary = {
    total: reports.length,
    valid: reports.filter((r) => r.verdict === "valid").length,
    downgraded: reports.filter((r) => r.verdict === "downgraded").length,
    conflict: reports.filter((r) => r.verdict === "conflict").length,
    invalid: reports.filter((r) => r.verdict === "invalid").length,
    verified: reports.filter((r) => r.effectiveStatus === "verified").length,
    needsReview: reports.filter((r) => r.effectiveStatus === "needs_review").length,
    crossChecked: reports.filter((r) => r.crossChecked).length,
    unchecked: reports.filter((r) => !r.crossChecked).length,
  };
  return { questions: reports, issues: allIssues, summary };
}

/**
 * Áp kết quả validation lên bản sao của ExtractionV2Result: câu nào
 * verdict khác valid thì status verified → needs_review, quality suy
 * thành partial, và thông điệp vấn đề được thêm vào warnings (không trùng
 * lặp). Đáp án và bằng chứng khai báo GIỮ NGUYÊN — validator không xóa,
 * không sửa, không tự chọn đáp án khác (việc đó thuộc bước 22).
 */
export function applyEvidenceValidation(
  result: ExtractionV2Result,
  validation: EvidenceValidationResult
): ExtractionV2Result {
  const byIndex = new Map(
    validation.questions.map((r) => [r.questionIndex, r])
  );
  return {
    ...result,
    questions: result.questions.map((q, i) => {
      const report = byIndex.get(i);
      if (!report || report.verdict === "valid") return q;
      const newWarnings = [...q.warnings];
      for (const iss of report.issues) {
        if (!newWarnings.includes(iss.message)) newWarnings.push(iss.message);
      }
      return {
        ...q,
        status: "needs_review" as V2QuestionStatus,
        quality: {
          status: "partial" as const,
          reasons:
            q.quality.reasons.length > 0
              ? q.quality.reasons
              : report.issues.map((iss) => iss.message),
        },
        warnings: newWarnings,
      };
    }),
  };
}
