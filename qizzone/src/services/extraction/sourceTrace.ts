import type { ExtractedQuestion } from "@/types/extractor";
import type {
  AnswerOrigin,
  ExtractionV2Question,
  V2ChunkStatus,
} from "@/types/extractionV2";
import type { HybridOrchestrationResult } from "@/services/extraction/hybridOrchestrator";
import type { ReconcileQuestionResult } from "@/services/extraction/reconcile";
import {
  ORIGIN_LABELS,
  WATERFALL_PERCENT,
} from "@/services/extraction/reviewDisplay";

/**
 * Bước 24 (PLAN_MAIN, giai đoạn F): Review đối chiếu nguồn.
 *
 * Giáo viên click một câu trong màn review thì thấy được nguồn gốc của
 * nó: vị trí trang/khối/chunk, đoạn trích nguồn, nguồn bằng chứng thắng
 * và các nguồn thua/mâu thuẫn (nếu có). Module thuần: không gọi AI,
 * không đọc file, không mutate input.
 *
 * QUY TẮC TRUNG THỰC (ghi rõ, không bịa vị trí):
 * - Vị trí chính xác chỉ khi có: trang PDF (bước 15) hoặc khoảng khối
 *   IR (bước 13). Chunk toàn tài liệu (DOCX/text không có IR segment)
 *   KHÔNG được tính là vị trí — nó chỉ là "cả tài liệu".
 * - Đoạn trích bằng chứng lấy từ evidence.sourceExcerpt; khi vắng mặt
 *   thì dùng đoạn gốc V1 rawTextSegment (parser giữ lại) với nhãn riêng
 *   — không gán nhãn đoạn gốc thành "bằng chứng".
 * - Câu tạo tay (engine manual) không có nguồn trong tài liệu: đoạn
 *   rawTextSegment placeholder của nó ("Câu hỏi thêm mới thủ công")
 *   KHÔNG được tính là nguồn. Ngoại lệ: câu đã sửa tay nhưng vẫn giữ
 *   được vị trí trang/khối từ lần trích xuất gốc thì vẫn có nguồn
 *   (vị trí thắng quy tắc này).
 * - Nguồn thắng: reconcile.winningOrigin trước, fallback về origin của
 *   evidence khi reconcile không có báo cáo; khi reconcile kết luận
 *   mâu thuẫn chưa giải quyết thì KHÔNG có nguồn thắng (giấu nguồn
 *   thắng đi mới là giấu flag khỏi giáo viên).
 * - % hiển thị chỉ là % waterfall quy ước (bước 23); giáo viên xác nhận
 *   và AI gợi ý thì không có số.
 */

export const CHUNK_STATUS_LABELS: Record<V2ChunkStatus["status"], string> = {
  complete: "đã xử lý",
  partial: "xử lý một phần",
  failed: "chưa xử lý",
};

export interface QuestionSourceTrace {
  order: number;
  questionIndex: number;
  /**
   * Vị trí chính xác: "Trang N" (PDF) hoặc "Khối B–E" (IR segment);
   * null khi không xác định được (DOCX không giữ pagination, câu tạo
   * tay, câu không gán được chunk có vị trí).
   */
  positionLabel: string | null;
  /** Nhãn chunk chứa câu ("Chunk k — trạng thái"); null khi câu không thuộc chunk nào. */
  chunkLabel: string | null;
  chunkStatus: V2ChunkStatus["status"] | null;
  /** Đoạn trích bằng chứng (evidence.sourceExcerpt); null khi không có. */
  evidenceExcerpt: string | null;
  /** Đoạn gốc parser giữ lại (V1 rawTextSegment); null khi vắng hoặc trùng excerpt. */
  rawSegment: string | null;
  winningOrigin: AnswerOrigin | null;
  winningLabel: string | null;
  /** % waterfall quy ước của nguồn thắng; null = không hiển thị số. */
  winningPercent: number | null;
  losingLabels: string[];
  /** true khi có ít nhất một mẩu đối chiếu (vị trí, trích đoạn, nguồn thắng). */
  hasSource: boolean;
  /** Lý do không có nguồn đối chiếu; chỉ có khi hasSource false. */
  noSourceReason: string | null;
}

export interface BuildQuestionSourceTraceInput {
  question: ExtractionV2Question;
  questionIndex: number;
  /** Câu V1 tương ứng (để lấy rawTextSegment); vắng mặt thì không có đoạn gốc. */
  v1question?: ExtractedQuestion;
  /** Chunk chứa câu (theo chunkIndex); vắng mặt thì câu không thuộc chunk nào. */
  chunk?: V2ChunkStatus;
  /** Báo cáo reconcile của câu; vắng mặt thì suy nguồn thắng từ evidence. */
  reconcile?: ReconcileQuestionResult;
}

function nonEmpty(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildQuestionSourceTrace(
  input: BuildQuestionSourceTraceInput
): QuestionSourceTrace {
  const { question, questionIndex, v1question, chunk, reconcile } = input;
  const order = question.order || questionIndex + 1;
  const isManual = question.engine === "manual";

  // Vị trí: trang PDF trước, khoảng khối IR sau, sourceRef cuối cùng.
  // Chunk toàn tài liệu không có page/block nên không cho vị trí.
  let positionLabel: string | null = null;
  if (question.page !== null && question.page !== undefined) {
    positionLabel = `Trang ${question.page}`;
  } else if (
    chunk !== undefined &&
    chunk.blockStart !== undefined &&
    chunk.blockEnd !== undefined
  ) {
    positionLabel =
      chunk.blockStart === chunk.blockEnd
        ? `Khối ${chunk.blockStart}`
        : `Khối ${chunk.blockStart}–${chunk.blockEnd}`;
  } else if (nonEmpty(question.sourceRef)) {
    positionLabel = question.sourceRef as string;
  }

  const chunkLabel =
    chunk !== undefined
      ? `Chunk ${chunk.chunkIndex} — ${CHUNK_STATUS_LABELS[chunk.status]}`
      : null;

  const evidenceExcerpt = nonEmpty(question.answerEvidence?.sourceExcerpt);
  // Đoạn gốc của câu tạo tay là placeholder, không phải nguồn tài liệu.
  const rawCandidate = isManual ? null : nonEmpty(v1question?.rawTextSegment);
  const rawSegment =
    rawCandidate !== null && rawCandidate !== evidenceExcerpt
      ? rawCandidate
      : null;

  // Nguồn thắng: reconcile trước, evidence sau; mâu thuẫn chưa giải
  // quyết thì không có nguồn thắng dù evidence vẫn còn origin cũ.
  const evidenceOrigin: AnswerOrigin =
    question.answerEvidence?.origin ?? "none";
  let winningOrigin: AnswerOrigin | null = null;
  if (reconcile !== undefined) {
    if (reconcile.outcome !== "unresolved-conflict") {
      winningOrigin =
        reconcile.winningOrigin ??
        (evidenceOrigin !== "none" ? evidenceOrigin : null);
    }
  } else {
    winningOrigin = evidenceOrigin !== "none" ? evidenceOrigin : null;
  }
  const losingOrigins: AnswerOrigin[] = reconcile?.losingOrigins ?? [];

  const hasSource =
    positionLabel !== null ||
    evidenceExcerpt !== null ||
    rawSegment !== null ||
    winningOrigin !== null;

  let noSourceReason: string | null = null;
  if (!hasSource) {
    noSourceReason = isManual
      ? "Câu tạo tay — không có nguồn trong tài liệu gốc"
      : "Parser không giữ được vị trí hay bằng chứng của câu này";
  }

  return {
    order,
    questionIndex,
    positionLabel,
    chunkLabel,
    chunkStatus: chunk?.status ?? null,
    evidenceExcerpt,
    rawSegment,
    winningOrigin,
    winningLabel:
      winningOrigin !== null ? ORIGIN_LABELS[winningOrigin] ?? null : null,
    winningPercent:
      winningOrigin !== null ? WATERFALL_PERCENT[winningOrigin] ?? null : null,
    losingLabels: losingOrigins.map((o) => ORIGIN_LABELS[o] ?? o),
    hasSource,
    noSourceReason,
  };
}

/**
 * Build trace cho toàn bộ kết quả Hybrid Orchestrator, khớp theo order
 * hiển thị (cùng quy ước evidence/reconcile). Câu V1 khớp theo order,
 * fallback theo index; chunk khớp theo chunkIndex; câu không có báo
 * cáo reconcile thì suy từ evidence, không đoán.
 */
export function buildSourceTraces(
  hybrid: HybridOrchestrationResult,
  v1questions: ExtractedQuestion[]
): Map<number, QuestionSourceTrace> {
  const v1ByOrder = new Map<number, ExtractedQuestion>();
  for (const q of v1questions) {
    if (!v1ByOrder.has(q.order)) v1ByOrder.set(q.order, q);
  }
  const chunkByIndex = new Map<number, V2ChunkStatus>();
  for (const c of hybrid.v2.chunks ?? []) {
    if (!chunkByIndex.has(c.chunkIndex)) chunkByIndex.set(c.chunkIndex, c);
  }
  const reconcileByOrder = new Map<number, ReconcileQuestionResult>();
  for (const r of hybrid.reconcileQuestions ?? []) {
    if (!reconcileByOrder.has(r.order)) reconcileByOrder.set(r.order, r);
  }

  const traces = new Map<number, QuestionSourceTrace>();
  hybrid.v2.questions.forEach((q, i) => {
    const order = q.order || i + 1;
    traces.set(
      order,
      buildQuestionSourceTrace({
        question: q,
        questionIndex: i,
        v1question: v1ByOrder.get(order) ?? v1questions[i],
        chunk:
          q.chunkIndex !== undefined
            ? chunkByIndex.get(q.chunkIndex)
            : undefined,
        reconcile: reconcileByOrder.get(order),
      })
    );
  });
  return traces;
}
