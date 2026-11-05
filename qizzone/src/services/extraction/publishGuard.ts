import type {
  ExtractedQuestion,
  ExtractionResult,
} from "@/types/extractor";
import type { HybridOrchestrationResult } from "@/services/extraction/hybridOrchestrator";
import {
  validateExtractedQuestions,
  type MappingDiagnostic,
} from "@/utils/extractedQuestionMapper";
import {
  fromV1Result,
  validateV2QuestionTypes,
} from "@/services/extraction/v2Adapter";

/**
 * Bước 25 (PLAN_MAIN, giai đoạn F): Guard Configure / Finalize /
 * Save Draft / Publish — nối metadata hybridReview (gate, evidence,
 * reconcile, chunk, type) vào flow xuất bản, trên nền guard V1 bước 04
 * và validation theo trạng thái bước 08.
 *
 * NGUYÊN TẮC (khóa ở bước này, không đoán):
 *
 * 1. Publish chặn, draft không bao giờ chặn. Mọi issue đều trở thành
 *    cảnh báo khi lưu nháp, vì nháp là nơi giáo viên sửa tiếp. Tầng này
 *    chỉ là client/store layer: quizStore (bước 08) và DB vẫn là chốt
 *    chặn cuối cùng, nên guard ở đây không nới lỏng được gì ở dưới.
 *
 * 2. Dữ liệu live thắng dữ liệu stale. hybridReview được tính lúc upload
 *    (FileDropzone, bước 21); giáo viên sửa câu ở màn review sau đó thì
 *    V1 live đã khác. Vì vậy:
 *    - V1 diagnostics (bước 04) và type check tính LẠI từ V1 live — luôn
 *      tươi, không stale.
 *    - Evidence / reconcile trong hybrid là stale: một câu đã bị XÓA
 *      khỏi review thì blocker của nó bị bỏ qua (không chặn xuất bản vì
 *      câu không còn tồn tại); một câu giáo viên đã SỬA đáp án ở review
 *      (detectionStrategy "manual", bước 05) thì được miễn blocker
 *      evidence/reconcile cũ — vì cú sửa tay của giáo viên chính là xác
 *      nhận, và V1 diagnostics live vẫn bắt lỗi cấu trúc (thiếu đáp án,
 *      đáp án ngoài phương án) nếu cú sửa đó chưa đạt.
 *    - Chỉ miễn "manual" (sửa tay không mơ hồ). "answer_table" không được
 *      miễn vì parser cũng dùng strategy này cho bảng đáp án trong tài
 *      liệu — không phân biệt được key do giáo viên áp với key do parser
 *      đọc; giáo viên muốn gỡ chặn thì toggle đáp án (manual).
 *
 * 3. Không chặn vì needs_review đơn thuần. Một câu ở trạng thái
 *    needs_review nhưng đáp án hợp lệ (vd bằng chứng chưa đối chiếu được
 *    — unchecked, bước 11 — hay đáp án AI gợi ý đã opt-in, bước 17) thì
 *    KHÔNG bị chặn: chặn mọi needs_review sẽ chặn cả đáp án đúng chỉ vì
 *    bằng chứng không đối chiếu được, phá flow main. Chỉ chặn khi có vấn
 *    đề cụ thể: thiếu đáp án, thiếu phương án, đáp án ngoài phương án,
 *    evidence invalid/conflict, reconcile mâu thuẫn chưa giải quyết,
 *    gate failed, chunk failed, type mismatch.
 *
 * 4. Không nhân đôi cùng một nguyên nhân. Evidence invalid trùng gốc với
 *    V1 answer_not_in_options (cùng là "đáp án ngoài phương án") thì giữ
 *    V1, bỏ evidence; reconcile unresolved trùng với evidence
 *    conflict/invalid cùng câu thì giữ evidence, bỏ reconcile. Gate
 *    per-question trùng (order, code) với V1 diagnostic thì giữ V1.
 *
 * 5. Chunk failed chỉ chặn khi có trang (trang scan, bước 16/19). Chunk
 *    toàn tài liệu failed khi 0 câu hỏi thì gate failed đã chặn rồi, nên
 *    không liệt kê thêm. Chunk partial chỉ cảnh báo.
 *
 * 6. Quiz không qua extraction (không có hybridReview) đi đường cũ:
 *    chỉ V1 diagnostics — không bị chặn oan vì thiếu metadata.
 *
 * 7. Type unknown chỉ cảnh báo, không chặn (đúng mức đã khóa bước 12);
 *    type mismatch chặn (cả V1 diagnostics live lẫn V2 check tươi đều
 *    bắt, dedup theo (order, code) giữ cái đầu tiên).
 *
 * Mức chặn tóm tắt (Publish | Draft):
 * - missing_answer, insufficient_options, answer_not_in_options,
 *   type_answer_mismatch (V1 live): CHẶN | cảnh báo.
 * - type unknown (V2 tươi): cảnh báo | cảnh báo.
 * - gate failed (document_failed / no_questions): CHẶN (cấp tài liệu) |
 *   cảnh báo. Gate partial / needs_review: cảnh báo | cảnh báo.
 * - evidence invalid / conflict (câu còn tồn tại, chưa sửa tay): CHẶN |
 *   cảnh báo. Evidence downgraded: cảnh báo | cảnh báo.
 * - reconcile unresolved-conflict (câu còn tồn tại, chưa sửa tay): CHẶN
 *   | cảnh báo. Reconcile pruned-invalid: cảnh báo | cảnh báo.
 * - chunk failed có trang: CHẶN (cấp tài liệu) | cảnh báo.
 *   Chunk partial: cảnh báo | cảnh báo.
 */

export type PublishGuardIssueCode =
  | "missing_answer"
  | "insufficient_options"
  | "answer_not_in_options"
  | "type_answer_mismatch"
  | "unknown_type"
  | "gate_failed"
  | "gate_issue"
  | "evidence_invalid"
  | "evidence_conflict"
  | "evidence_downgraded"
  | "reconcile_unresolved"
  | "reconcile_pruned"
  | "chunk_failed"
  | "chunk_partial";

export interface PublishGuardIssue {
  /** Số thứ tự hiển thị (1-based); 0 khi vấn đề ở cấp tài liệu. */
  order: number;
  /** Index 0-based trong mảng câu hỏi live; -1 khi ở cấp tài liệu. */
  questionIndex: number;
  code: PublishGuardIssueCode;
  /** Thông điệp đầy đủ cho UI/toast: đã nêu câu nào, lý do nào, giáo viên phải làm gì. */
  message: string;
  /** true = chặn xuất bản; false = chỉ cảnh báo. */
  blocksPublish: boolean;
}

export interface PublishGuardResult {
  /** true khi có ít nhất một blocker cho xuất bản. */
  publishBlocked: boolean;
  /** Các issue chặn xuất bản (rỗng khi không bị chặn). */
  blockers: PublishGuardIssue[];
  /** Các issue chỉ cảnh báo (không chặn xuất bản). */
  warnings: PublishGuardIssue[];
  /** Blockers ở cấp tài liệu (questionIndex -1) — không bị sửa câu ở
   *  CreateQuiz làm mất hiệu lực nên CreateQuiz cũng chặn theo chúng. */
  docBlockers: PublishGuardIssue[];
  /** Mọi issue, dùng cho lưu nháp (draft không chặn, chỉ cảnh báo). */
  draftWarnings: PublishGuardIssue[];
}

/**
 * Bản tóm tắt serializable để truyền qua navigation state sang CreateQuiz.
 * CreateQuiz chỉ chặn xuất bản theo docBlockerMessages (cấp tài liệu, không
 * bị sửa câu làm mất hiệu lực); warningMessages là MỌI issue dưới dạng cảnh
 * báo (blockers + warnings) để CreateQuiz đếm đúng khi lưu nháp — blocker
 * per-question ở đây KHÔNG chặn ở CreateQuiz vì có thể đã stale sau khi
 * giáo viên sửa câu ở đó, và validation live (bước 08) kiểm tra lại.
 */
export interface PublishGuardSummary {
  publishBlocked: boolean;
  docBlockerMessages: string[];
  warningMessages: string[];
}

export function toPublishGuardSummary(
  result: PublishGuardResult
): PublishGuardSummary {
  return {
    publishBlocked: result.publishBlocked,
    docBlockerMessages: result.docBlockers.map((i) => i.message),
    warningMessages: result.draftWarnings.map((i) => i.message),
  };
}

const V1_ACTION: Record<string, string> = {
  missing_answer:
    "Hãy chọn đáp án đúng cho câu này ở màn review, hoặc dùng nút “AI lấp đáp án còn thiếu”.",
  insufficient_options: "Hãy bổ sung phương án cho câu này ở màn review.",
  answer_not_in_options:
    "Hãy sửa đáp án về một trong các phương án của câu.",
  type_answer_mismatch:
    "Hãy sửa loại câu hoặc đáp án cho khớp trước khi xuất bản.",
};

function v1Issue(
  d: MappingDiagnostic,
  questionIndex: number
): PublishGuardIssue {
  const action = V1_ACTION[d.code] ?? "Hãy sửa câu này ở màn review.";
  return {
    order: d.order,
    // V1 diagnostic không mang index — tra index live theo order.
    questionIndex,
    code: d.code as PublishGuardIssueCode,
    message: `${d.message} ${action}`,
    blocksPublish: d.blocksPublish,
  };
}

export function assessPublishGuard(
  result: ExtractionResult,
  hybrid: HybridOrchestrationResult | null
): PublishGuardResult {
  const questions = result.questions;
  const blockers: PublishGuardIssue[] = [];
  const warnings: PublishGuardIssue[] = [];
  const seen = new Set<string>();
  const push = (issue: PublishGuardIssue) => {
    const key = `${issue.order}:${issue.code}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (issue.blocksPublish) blockers.push(issue);
    else warnings.push(issue);
  };

  // Live V1 questions tra theo order (order ổn định qua sửa/xóa ở review;
  // index thì không, vì deleteQuestion làm lệch index của câu sau đó).
  const liveByOrder = new Map<number, ExtractedQuestion>();
  questions.forEach((q, idx) => {
    const order = q.order || idx + 1;
    if (!liveByOrder.has(order)) liveByOrder.set(order, q);
  });
  const liveIndexByOrder = new Map<number, number>();
  questions.forEach((q, idx) => {
    const order = q.order || idx + 1;
    if (!liveIndexByOrder.has(order)) liveIndexByOrder.set(order, idx);
  });

  // 1. V1 diagnostics live (bước 04) — luôn tươi, là nền của guard.
  const v1Diagnostics = validateExtractedQuestions(questions);
  for (const d of v1Diagnostics) {
    push(v1Issue(d, liveIndexByOrder.get(d.order) ?? -1));
  }
  const v1CodesByOrder = new Map<number, Set<string>>();
  for (const d of v1Diagnostics) {
    const set = v1CodesByOrder.get(d.order) ?? new Set<string>();
    set.add(d.code);
    v1CodesByOrder.set(d.order, set);
  }

  // 2. Type check tươi từ V1 live (bước 12): unknown chỉ cảnh báo;
  //    mismatch trùng V1 thì dedup giữ V1 (cùng (order, code)).
  const freshV2 = fromV1Result(result);
  for (const d of validateV2QuestionTypes(freshV2.questions)) {
    if (d.code === "unknown_type") {
      push({
        order: d.order,
        questionIndex: liveIndexByOrder.get(d.order) ?? -1,
        code: "unknown_type",
        message: `${d.message} Hãy xác nhận loại câu ở màn review.`,
        blocksPublish: false,
      });
    } else if (d.blocksPublish) {
      push({
        order: d.order,
        questionIndex: liveIndexByOrder.get(d.order) ?? -1,
        code: "type_answer_mismatch",
        message: `${d.message} ${V1_ACTION.type_answer_mismatch}`,
        blocksPublish: true,
      });
    }
  }

  if (!hybrid) {
    return finish(blockers, warnings);
  }

  // 3. Gate (bước 10): failed chặn ở cấp tài liệu; partial/needs_review cảnh báo.
  const gate = hybrid.quality;
  if (gate.status === "failed") {
    const reasons = gate.issues
      .filter((i) => i.code === "document_failed" || i.code === "no_questions")
      .map((i) => i.message);
    push({
      order: 0,
      questionIndex: -1,
      code: "gate_failed",
      message:
        `Tài liệu: bóc tách thất bại` +
        (reasons.length > 0 ? ` — ${reasons.join("; ")}` : "") +
        `. Hãy tải lại tài liệu khác hoặc kiểm tra lại file gốc.`,
      blocksPublish: true,
    });
  } else if (gate.status === "partial" || gate.status === "needs_review") {
    for (const issue of gate.issues) {
      // Trùng (order, code) với V1 diagnostic thì giữ V1, không nhân đôi.
      if (
        issue.order > 0 &&
        v1CodesByOrder.get(issue.order)?.has(issue.code)
      ) {
        continue;
      }
      // Vấn đề của câu đã bị xóa thì không cảnh báo nữa.
      if (issue.order > 0 && !liveByOrder.has(issue.order)) continue;
      push({
        order: issue.order,
        questionIndex:
          issue.questionIndex >= 0
            ? issue.questionIndex
            : (liveIndexByOrder.get(issue.order) ?? -1),
        code: "gate_issue",
        message: `${issue.message} Hãy xem lại ở màn review.`,
        blocksPublish: false,
      });
    }
  }

  // 4. Evidence (bước 11): invalid/conflict chặn, downgraded cảnh báo;
  //    bỏ qua câu đã xóa và câu giáo viên đã sửa tay (manual).
  const evidenceBlockerOrders = new Set<number>();
  for (const report of hybrid.evidence.questions) {
    const live = liveByOrder.get(report.order);
    if (!live) continue; // Câu đã bị xóa khỏi review.
    if (live.detectionStrategy === "manual") continue; // Giáo viên đã sửa = xác nhận.
    const qIndex = liveIndexByOrder.get(report.order) ?? -1;
    if (report.verdict === "invalid") {
      // Trùng gốc với V1 answer_not_in_options thì giữ V1.
      if (v1CodesByOrder.get(report.order)?.has("answer_not_in_options")) {
        continue;
      }
      evidenceBlockerOrders.add(report.order);
      push({
        order: report.order,
        questionIndex: qIndex,
        code: "evidence_invalid",
        message:
          `Câu ${report.order}: đáp án không khớp bằng chứng` +
          (report.issues[0] ? ` — ${report.issues[0].message}` : "") +
          `. Hãy sửa đáp án về một trong các phương án của câu.`,
        blocksPublish: true,
      });
    } else if (report.verdict === "conflict") {
      evidenceBlockerOrders.add(report.order);
      push({
        order: report.order,
        questionIndex: qIndex,
        code: "evidence_conflict",
        message:
          `Câu ${report.order}: các nguồn bằng chứng mâu thuẫn` +
          (report.issues[0] ? ` — ${report.issues[0].message}` : "") +
          `. Hãy chọn đáp án đúng trong các nguồn mâu thuẫn ở màn review.`,
        blocksPublish: true,
      });
    } else if (report.verdict === "downgraded") {
      push({
        order: report.order,
        questionIndex: qIndex,
        code: "evidence_downgraded",
        message:
          `Câu ${report.order}: bằng chứng chưa đủ để xác minh` +
          (report.issues[0] ? ` — ${report.issues[0].message}` : "") +
          `. Hãy xem lại đáp án ở màn review.`,
        blocksPublish: false,
      });
    }
  }

  // 5. Reconcile (bước 22): mâu thuẫn chưa giải quyết chặn; đã lược cảnh báo.
  //    Trùng evidence cùng câu thì giữ evidence (cụ thể hơn).
  for (const rq of hybrid.reconcileQuestions) {
    const live = liveByOrder.get(rq.order);
    if (!live) continue;
    if (live.detectionStrategy === "manual") continue;
    const qIndex = liveIndexByOrder.get(rq.order) ?? -1;
    if (rq.outcome === "unresolved-conflict") {
      if (evidenceBlockerOrders.has(rq.order)) continue;
      push({
        order: rq.order,
        questionIndex: qIndex,
        code: "reconcile_unresolved",
        message:
          `Câu ${rq.order}: các nguồn đáp án mâu thuẫn chưa giải quyết được` +
          (rq.message ? ` — ${rq.message}` : "") +
          `. Hãy chọn đáp án đúng ở màn review.`,
        blocksPublish: true,
      });
    } else if (rq.outcome === "pruned-invalid") {
      push({
        order: rq.order,
        questionIndex: qIndex,
        code: "reconcile_pruned",
        message:
          `Câu ${rq.order}: đáp án không hợp lệ đã bị lược ở bản đối chiếu` +
          (rq.message ? ` — ${rq.message}` : "") +
          `. Hãy sửa đáp án ở màn review trước khi xuất bản.`,
        blocksPublish: false,
      });
    }
  }

  // 6. Chunk (bước 19): failed có trang chặn ở cấp tài liệu; partial cảnh báo.
  const failedPages = (hybrid.v2.chunks ?? [])
    .filter((c) => c.status === "failed" && c.page !== undefined)
    .map((c) => c.page as number);
  if (failedPages.length > 0) {
    push({
      order: 0,
      questionIndex: -1,
      code: "chunk_failed",
      message:
        `Tài liệu: trang ${failedPages.join(", ")} chưa được xử lý (trang scan cần OCR). ` +
        `OCR trình duyệt chưa được kích hoạt (bước 16) — hãy tải lại tài liệu không có trang scan, hoặc chờ OCR.`,
      blocksPublish: true,
    });
  }
  for (const chunk of hybrid.v2.chunks ?? []) {
    if (chunk.status !== "partial") continue;
    const where =
      chunk.page !== undefined
        ? `trang ${chunk.page}`
        : chunk.blockStart !== undefined
          ? `khối ${chunk.blockStart}–${chunk.blockEnd ?? chunk.blockStart}`
          : `chunk ${chunk.chunkIndex}`;
    push({
      order: 0,
      questionIndex: -1,
      code: "chunk_partial",
      message:
        `Tài liệu: ${where} xử lý chưa đầy đủ` +
        (chunk.reason ? ` — ${chunk.reason}` : "") +
        `. Hãy kiểm tra các câu thuộc phần này ở màn review.`,
      blocksPublish: false,
    });
  }

  return finish(blockers, warnings);
}

function finish(
  blockers: PublishGuardIssue[],
  warnings: PublishGuardIssue[]
): PublishGuardResult {
  return {
    publishBlocked: blockers.length > 0,
    blockers,
    warnings,
    docBlockers: blockers.filter((b) => b.questionIndex === -1),
    draftWarnings: [...blockers, ...warnings],
  };
}
