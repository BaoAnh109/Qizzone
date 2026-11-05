import type {
  ExtractedQuestion,
  ExtractionResult,
} from "@/types/extractor";
import type {
  ExtractionV2Result,
  V2DocumentQuality,
} from "@/types/extractionV2";
import { fromV1Result } from "@/services/extraction/v2Adapter";
import {
  attachChunksToV2,
  buildDocumentChunk,
  buildPageChunks,
} from "@/services/extraction/chunking";
import {
  assessExtractionQuality,
  type QualityGateResult,
} from "@/services/extraction/qualityGate";
import {
  applyEvidenceValidation,
  validateEvidence,
  type EvidenceValidationResult,
} from "@/services/extraction/evidenceValidator";
import {
  buildFormatContexts,
  reconcileResult,
  type ReconcileQuestionResult,
  type ReconcileSummary,
} from "@/services/extraction/reconcile";
import { QuotaExceededError } from "@/services/extraction/aiProvider";

/**
 * Bước 21 (PLAN_MAIN, giai đoạn F): Hybrid Orchestrator — nối chunking
 * (bước 19) + provider/quota (bước 20) vào live path.
 *
 * Thứ tự tầng (rẻ → đắt, có bằng chứng → AI):
 *  1. Parser luật / IR (bước 13–15) đã chạy trước và cho ra V1 — rẻ,
 *     nhanh, đáp án có bằng chứng. Orchestrator KHÔNG chạy lại parser.
 *  2. V2 + chunking + Quality Gate + Evidence Validator (bước 09–11, 19)
 *     đánh giá kết quả luật, hoàn toàn cục bộ, không gọi AI.
 *  3. AI extraction (bước 17–18, 20) CHỈ khi còn lỗ hổng mà AI có thể
 *     lấp (xem aiNeeded) và chỉ qua `orchestrateWithAI` — live path
 *     FileDropzone hiện chỉ chạy tầng đồng bộ (2), AI enhancement là
 *     on-demand cho UI bước 24 gọi, không tự chạy ngầm trên mọi upload
 *     (tránh tốn quota cho đề luật đã đủ).
 *
 * RANH GIỚI (ghi rõ, không đoán):
 * - Orchestrator KHÔNG BAO GIỜ giải đề: không gọi solveMissingAnswersWithAI
 *   (bước 17, opt-in riêng). Đáp án AI hợp nhất chỉ khi là extraction có
 *   bằng chứng (detectionStrategy khác "ai_inference" — nhãn solving);
 *   đáp án AI mang nhãn ai_inference bị từ chối hợp nhất.
 * - Orchestrator KHÔNG ghi đè đáp án luật: chỉ lấp đáp án cho câu luật
 *   đang rỗng (correctAnswers []). Nội dung/phương án luật giữ nguyên.
 * - Orchestrator KHÔNG bịa: câu không gán được chunk, trang scan, hay
 *   AI lỗi/quota đều trả về kết quả luật kèm cảnh báo, không tự điền.
 * - V1 gốc giữ nguyên tham chiếu: live path vẫn lưu đúng V1 parser/AI
 *   trả về (review UI cũ không đổi hành vi); metadata V2/gate/evidence
 *   nằm ở trường riêng để UI bước 24 dùng.
 * - Bước 22 (Reconcile): sau Evidence Validator, V2 chạy qua reconcile
 *   với context định dạng dựng từ flag option của V1 (cùng logic runner
 *   bước 11). Reconcile chỉ đổi V2 — V1 giữ nguyên nên review UI cũ
 *   không đổi hành vi; câu đã lược/không giải quyết được mang cờ trong
 *   V2 để UI bước 24 hiển thị cho giáo viên xác nhận.
 */

export interface HybridInput {
  result: ExtractionResult;
  /** Chất lượng tài liệu caller đã đo (DOCX bước 07); vắng mặt thì mặc định theo số câu. */
  documentQuality?: V2DocumentQuality;
  /** Tổng số trang (PDF, từ pdfjs); có thì chunk theo trang, không thì chunk toàn tài liệu. */
  totalPages?: number;
  /** Trang scan 1-based (PDF, bước 16); chunk các trang này là failed, không phải tín hiệu gọi AI. */
  scanPages?: number[];
}

/** Lý do một câu cần AI enhancement (chỉ lỗ hổng AI extraction có thể lấp). */
export type AiNeededReason = "missing_answer" | "insufficient_options";

export interface AiNeededQuestion {
  questionIndex: number;
  order: number;
  reasons: AiNeededReason[];
}

export interface AiNeeded {
  needed: boolean;
  questions: AiNeededQuestion[];
  /** Trang scan cần OCR (bước 16), không phải tín hiệu gọi AI extraction. */
  ocrNeededPages: number[];
}

export interface HybridOrchestrationResult {
  /** V1 gốc, giữ nguyên (live path lưu đúng bản này). */
  v1: ExtractionResult;
  /** V2 sau chunking + gate + evidence validation + reconcile (bước 22). */
  v2: ExtractionV2Result;
  quality: QualityGateResult;
  evidence: EvidenceValidationResult;
  /** Kết quả reconcile bước 22 (đếm resolved/unresolved/pruned). */
  reconcile: ReconcileSummary;
  /**
   * Bước 23: báo cáo reconcile từng câu (nguồn thắng/thua, thông điệp)
   * để display model hiển thị cho giáo viên. Chỉ thêm field, không đổi
   * luồng tính toán của orchestrator.
   */
  reconcileQuestions: ReconcileQuestionResult[];
  aiNeeded: AiNeeded;
  /** Cảnh báo cấp tài liệu cho UI (gate issues + evidence issues + OCR). */
  warnings: string[];
}

/**
 * Tầng đồng bộ: V1 → V2 → chunking → gate → evidence. Hàm thuần về mặt
 * quyết định (không gọi AI, không đọc file, không mutate input).
 */
export function orchestrateExtraction(input: HybridInput): HybridOrchestrationResult {
  const { result } = input;
  const baseV2 = fromV1Result(result, input.documentQuality);

  // Chunking (bước 19): PDF có totalPages hợp lệ → một chunk/trang;
  // còn lại → một chunk cho toàn tài liệu (runner cũng làm vậy vì không
  // có IR segment từ V1 để chunk theo khối).
  const chunkOutput =
    input.totalPages !== undefined &&
    Number.isInteger(input.totalPages) &&
    input.totalPages >= 1
      ? buildPageChunks(result.questions, input.totalPages, input.scanPages ?? [])
      : buildDocumentChunk(result.questions);
  const v2WithChunks = attachChunksToV2(baseV2, chunkOutput);

  // Bước 22 (Reconcile): context định dạng dựng từ flag option của V1
  // (cùng logic runner bước 11 — chỉ câu có flag mới có context).
  // Evidence Validator chạy CÓ context để đối chiếu nguồn, rồi reconcile
  // chọn nguồn thắng / lược đáp án sai; gate + validator chạy lại trên
  // V2 đã reconcile để metadata cuối phản ánh đúng trạng thái cuối
  // (vd đáp án ngoài phương án đã lược thì không còn đếm là invalid).
  const contexts = buildFormatContexts(result.questions);
  const evidenceBefore = validateEvidence(v2WithChunks, contexts);
  const v2Validated = applyEvidenceValidation(v2WithChunks, evidenceBefore);
  const reconciled = reconcileResult(v2Validated, contexts);
  const quality = assessExtractionQuality(reconciled.result, {
    totalPages: input.totalPages,
  });
  const evidence = validateEvidence(reconciled.result, contexts);
  const v2 = applyEvidenceValidation(reconciled.result, evidence);

  // AI chỉ lấp được 2 lỗ hổng: câu thiếu đáp án và câu thiếu phương án.
  // Evidence verdict invalid/conflict KHÔNG phải tín hiệu gọi AI (đó là
  // việc của Reconcile bước 22, không phải gọi thêm model). aiNeeded vẫn
  // tính từ V1 (live path lưu V1): câu đã lược/không giải quyết được ở
  // V2 là việc của giáo viên ở UI review, không phải việc AI tự điền.
  const aiQuestions: AiNeededQuestion[] = [];
  for (let i = 0; i < result.questions.length; i++) {
    const q = result.questions[i];
    const reasons: AiNeededReason[] = [];
    if (!q.correctAnswers || q.correctAnswers.length === 0) {
      reasons.push("missing_answer");
    }
    if (!q.options || q.options.length < 2) {
      reasons.push("insufficient_options");
    }
    if (reasons.length > 0) {
      aiQuestions.push({ questionIndex: i, order: q.order, reasons });
    }
  }

  const warnings: string[] = [];
  for (const issue of quality.issues) {
    if (!warnings.includes(issue.message)) warnings.push(issue.message);
  }
  for (const issue of evidence.issues) {
    if (!warnings.includes(issue.message)) warnings.push(issue.message);
  }
  if (reconciled.summary.unresolved > 0) {
    warnings.push(
      `Có ${reconciled.summary.unresolved} câu mâu thuẫn bằng chứng cùng mức ưu tiên — cần giáo viên xác nhận`
    );
  }
  if (reconciled.summary.pruned > 0) {
    warnings.push(
      `Đã lược đáp án ngoài phương án ở ${reconciled.summary.pruned} câu — cần giáo viên xác nhận`
    );
  }
  const ocrNeededPages = [...(input.scanPages ?? [])].sort((a, b) => a - b);
  if (ocrNeededPages.length > 0) {
    warnings.push(
      `Còn ${ocrNeededPages.length} trang scan (${ocrNeededPages.join(", ")}) cần OCR`
    );
  }

  return {
    v1: result,
    v2,
    quality,
    evidence,
    reconcile: reconciled.summary,
    reconcileQuestions: reconciled.questions,
    aiNeeded: {
      needed: aiQuestions.length > 0,
      questions: aiQuestions,
      ocrNeededPages,
    },
    warnings,
  };
}

export type AiSkippedReason = "not-needed" | "no-provider" | "quota" | "error";

export interface HybridWithAiResult extends HybridOrchestrationResult {
  /** true khi đã gọi AI và hợp nhất (dù hợp nhất được 0 câu thì vẫn là đã gọi). */
  aiCalled: boolean;
  aiSkippedReason: AiSkippedReason | null;
  /** Số câu được AI lấp đáp án (chỉ tính câu luật rỗng nay có đáp án). */
  aiFilledCount: number;
}

export interface HybridAiDeps {
  /**
   * Hàm gọi AI extraction, trả về V1 (vd () => extractQuizWithAI({text})
   * — hàm này đã đi qua provider runner + quota bước 20). Test dùng mock.
   * Orchestrator không tự tạo provider ở đây để không kẹt vào một model.
   */
  aiExtract: (input: HybridInput) => Promise<ExtractionResult>;
}

/**
 * Tầng AI (on-demand): gọi AI đúng một lần khi còn lỗ hổng, hợp nhất
 * CHỈ đáp án còn thiếu bằng đáp án có bằng chứng, rồi chạy lại tầng
 * đồng bộ trên V1 đã hợp nhất để gate/evidence phản ánh đúng trạng thái
 * cuối. AI lỗi hoặc vượt quota → trả kết quả luật kèm cảnh báo (không
 * throw lên caller, đúng ngữ nghĩa fallback của main).
 */
export async function orchestrateWithAI(
  input: HybridInput,
  deps: HybridAiDeps | null
): Promise<HybridWithAiResult> {
  const base = orchestrateExtraction(input);

  if (!base.aiNeeded.needed) {
    return { ...base, aiCalled: false, aiSkippedReason: "not-needed", aiFilledCount: 0 };
  }
  if (!deps) {
    return {
      ...base,
      aiCalled: false,
      aiSkippedReason: "no-provider",
      aiFilledCount: 0,
      warnings: [...base.warnings, "Chưa có provider AI để lấp đáp án còn thiếu"],
    };
  }

  let aiResult: ExtractionResult;
  try {
    aiResult = await deps.aiExtract(input);
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return {
        ...base,
        aiCalled: false,
        aiSkippedReason: "quota",
        aiFilledCount: 0,
        warnings: [...base.warnings, `Đã vượt giới hạn gọi AI (${err.reason}) — giữ kết quả parser luật`],
      };
    }
    return {
      ...base,
      aiCalled: false,
      aiSkippedReason: "error",
      aiFilledCount: 0,
      warnings: [...base.warnings, "Gọi AI thất bại — giữ kết quả parser luật"],
    };
  }

  // Hợp nhất theo order hiển thị (AI và luật cùng một tài liệu nên order
  // tương ứng; không khớp order thì bỏ qua, không đoán câu).
  const aiByOrder = new Map<number, ExtractedQuestion>();
  for (const q of aiResult.questions) {
    if (!aiByOrder.has(q.order)) aiByOrder.set(q.order, q);
  }
  let filled = 0;
  const mergedQuestions = base.v1.questions.map((q) => {
    if (q.correctAnswers && q.correctAnswers.length > 0) return q;
    const aiQ = aiByOrder.get(q.order);
    if (!aiQ || !aiQ.correctAnswers || aiQ.correctAnswers.length === 0) return q;
    // Guard bước 17: nhãn ai_inference là đáp án GIẢI (solving), không
    // phải extraction có bằng chứng → từ chối hợp nhất.
    if (aiQ.detectionStrategy === "ai_inference") return q;
    filled++;
    return {
      ...q,
      correctAnswers: [...aiQ.correctAnswers],
      detectionStrategy: aiQ.detectionStrategy,
      confidenceScore: aiQ.confidenceScore ?? 0,
    };
  });

  const mergedV1: ExtractionResult = {
    ...base.v1,
    questions: mergedQuestions,
    warningsCount: mergedQuestions.reduce(
      (sum, q) => sum + (q.warningFlags?.length || 0),
      0
    ),
  };
  const final = orchestrateExtraction({ ...input, result: mergedV1 });
  return {
    ...final,
    aiCalled: true,
    aiSkippedReason: null,
    aiFilledCount: filled,
  };
}
