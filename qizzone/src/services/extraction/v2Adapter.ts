import type {
  DetectionStrategy,
  ExtractedQuestion,
  ExtractionResult,
} from "@/types/extractor";
import type { OptionId, Question } from "@/types/quiz";
import type {
  AnswerEvidence,
  AnswerOrigin,
  ExtractionV2Question,
  ExtractionV2Result,
  V2DocumentQuality,
  V2QuestionStatus,
} from "@/types/extractionV2";
import type { DocxParseOutput } from "@/utils/parsers/docxParser";
import type { MappingDiagnostic } from "@/utils/extractedQuestionMapper";

/**
 * Bước 09 (PLAN_MAIN): adapter V1 ↔ V2 và V2 → Quiz.
 *
 * - V1 UI đọc được V2 qua `toV1Question` / `toV1Result` (DONE của bước 09).
 * - Quiz/DB cũ không cần migration: `v2ToQuizQuestions` trả về `Question`
 *   theo kiểu cũ, chỉ khác ở chỗ type thật được giữ khi V2 biết type.
 * - Adapter KHÔNG bịa dữ liệu: chiều nào mất thông tin cũng được ghi rõ
 *   (xem chú thích từng hàm). Không tự gán đáp án, không tự chèn option.
 */

// --- V1 detectionStrategy ↔ V2 answerOrigin --------------------------------

const STRATEGY_TO_ORIGIN: Record<DetectionStrategy, AnswerOrigin> = {
  answer_table: "answer_table",
  answer_at_end: "answer_line",
  special_marker: "marker",
  underline: "underline",
  highlight_color: "highlight",
  distinct_bold: "bold",
  explanation_text: "solution",
  ai_inference: "ai_suggested",
  manual: "teacher_confirmed",
};

const ORIGIN_TO_STRATEGY: Record<AnswerOrigin, DetectionStrategy> = {
  answer_table: "answer_table",
  answer_line: "answer_at_end",
  marker: "special_marker",
  underline: "underline",
  highlight: "highlight_color",
  bold: "distinct_bold",
  solution: "explanation_text",
  teacher_confirmed: "manual",
  ai_suggested: "ai_inference",
  none: "ai_inference", // V1 không có strategy "none": nhánh "không đáp án" của V1
  // vốn dùng ai_inference + confidence 0.0 nên map ngược về đúng nhánh đó.
};

/** Các origin được coi là bằng chứng gốc (đủ điều kiện verified khi đủ phương án). */
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

// --- V1 → V2 -----------------------------------------------------------------

/**
 * V1 → V2 cho một câu. Mất mát thông tin (ghi rõ, không giấu):
 * - `sourceNumber`: bước 13 parser giữ số gốc từ boundary (f12: header
 *   2/5/9/14 → sourceNumber thật, order vẫn 1–4); câu không có số gốc
 *   (fallback, câu tạo tay) thì null — KHÔNG suy ra từ order.
 * - `sourceRef`: V1 không giữ vị trí nguồn → để trống (IR bước 13 có
 *   block index nhưng V1 chưa mang theo; sourceRef thật thuộc bước 19).
 * - `page`: bước 15 PDF parser gắn số trang thật vào V1 (`page?`) nên
 *   V2 giữ nguyên; DOCX/text vẫn null (không có phân trang chắc chắn).
 * - `type`: lấy từ `questionType` khi parser đã biết (bước 12 AI path,
 *   bước 13 Đúng/Sai), còn lại "unknown" (bước 12 suy luận ở tầng map).
 * - Nháp tạo tay (`isManualDraft`) luôn `needs_review` kể cả khi đã có đáp
 *   án, vì cờ không tự xóa (quyết định bước 05: tránh xuất bản nhầm nội
 *   dung placeholder); hoàn thiện được xét theo tính hợp lệ ở bước 08/25.
 */
export function fromV1Question(q: ExtractedQuestion): ExtractionV2Question {
  const answers = q.correctAnswers ? [...q.correctAnswers] : [];
  const hasAnswers = answers.length > 0;

  let origin: AnswerOrigin;
  let evidence: AnswerEvidence | null;
  if (!hasAnswers) {
    // Nguồn thực sự không có đáp án: evidence null, origin "none" chỉ dùng
    // để suy status (không tạo AnswerEvidence giả với confidence > 0).
    origin = "none";
    evidence = null;
  } else {
    origin = STRATEGY_TO_ORIGIN[q.detectionStrategy] ?? "ai_suggested";
    evidence = {
      origin,
      confidence: q.confidenceScore ?? 0,
    };
  }

  const engine: ExtractionV2Question["engine"] = q.isManualDraft
    ? "manual"
    : q.detectionStrategy === "ai_inference" && hasAnswers
      ? "gemini"
      : "rule";

  const status: V2QuestionStatus =
    !q.isManualDraft &&
    hasAnswers &&
    q.options.length >= 2 &&
    EVIDENCE_BACKED_ORIGINS.has(origin)
      ? "verified"
      : "needs_review";

  // Không tự tổng hợp thêm warning: V1 rule parser đã push cờ "Chưa có
  // đáp án..." khi thiếu đáp án; status needs_review tự nó đã là tín hiệu.
  const warnings = q.warningFlags ? [...q.warningFlags] : [];

  return {
    id: q.id,
    order: q.order,
    sourceNumber: q.sourceNumber ?? null,
    content: q.content,
    type: q.questionType ?? "unknown",
    options: q.options.map((opt) => ({ id: opt.id, content: opt.content })),
    correctAnswers: answers,
    answerEvidence: evidence,
    status,
    quality: {
      status: status === "verified" ? "complete" : "partial",
      reasons: [...warnings],
    },
    explanation: q.explanation,
    points: q.points || 1,
    warnings,
    assetRefs: q.images ? [...q.images] : [],
    engine,
    page: q.page ?? null,
  };
}

/** V1 → V2 cho toàn bộ kết quả. `documentQuality` mặc định complete khi caller không đưa gate. */
export function fromV1Result(
  result: ExtractionResult,
  documentQuality?: V2DocumentQuality
): ExtractionV2Result {
  const questions = result.questions.map(fromV1Question);
  return {
    fileName: result.fileName,
    fileType: result.fileType,
    fileSize: result.fileSize,
    title: result.title,
    subject: result.subject,
    totalQuestionsDetected: result.totalQuestionsDetected,
    questions,
    hasAnswerKeyTable: result.hasAnswerKeyTable,
    documentQuality: documentQuality ?? {
      status: questions.length > 0 ? "complete" : "failed",
      parsedQuestions: questions.length,
      reasons:
        questions.length > 0 ? [] : ["Không bóc tách được câu hỏi nào từ file"],
    },
    warnings: [],
    chunks: [],
    extractedAt: result.extractedAt,
  };
}

/**
 * DOCX (bước 07) → V2: gắn quality gate của DOCX vào V2.
 * - `documentQuality` lấy trực tiếp từ `assessDocxQuality` (status/reasons/số đếm).
 * - Partial do thiếu-số-câu (unparsedHeaders > 0) KHÔNG gắn được vào câu cụ
 *   thể (câu thiếu thì không tồn tại để gắn) nên lý do nằm ở `warnings`
 *   cấp tài liệu; per-question quality vẫn suy từ dữ liệu từng câu.
 * - Việc chặn publish theo documentQuality thuộc bước 25 — bước này chỉ
 *   mang dữ liệu, không tự thêm gate mới.
 */
export function fromDocxParseOutput(
  output: DocxParseOutput
): ExtractionV2Result {
  const v2 = fromV1Result(output.result, {
    status: output.quality.status,
    parsedQuestions: output.quality.parsedQuestions,
    detectedHeaders: output.quality.detectedHeaders,
    unparsedHeaders: output.quality.unparsedHeaders,
    invalidOptionOrders: output.quality.invalidOptionOrders,
    reasons: [...output.quality.reasons],
  });
  if (output.quality.status !== "complete") {
    v2.warnings = [...output.quality.reasons];
  }
  return v2;
}

// --- V2 → V1 (để UI V1 đọc được V2) ------------------------------------------

/**
 * V2 → V1 cho một câu. Mất mát thông tin (ghi rõ):
 * - `type` thật được giữ qua `questionType` của V1 (bước 12 thêm trường
 *   này); chỉ type "unknown" mới để trống để mapper suy luận lại.
 * - `sourceNumber` được giữ lại (bước 13 V1 đã có trường này);
 *   `page` được giữ lại (bước 15 PDF parser gắn trang vào V1);
 *   `sourceRef`/`status`/`quality` bị mất; status needs_review được
 *   gấp thành warningFlags để UI V1 vẫn thấy cần review.
 * - `answerEvidence` gấp thành `detectionStrategy` + `confidenceScore`
 *   (origin "none" → ai_inference + 0.0, đúng nhánh "không đáp án" của V1).
 */
export function toV1Question(v2: ExtractionV2Question): ExtractedQuestion {
  const answers = [...v2.correctAnswers];
  const origin = v2.answerEvidence?.origin ?? "none";
  const warnings = [...v2.warnings];
  if (v2.status === "needs_review" && !warnings.includes("Cần xem lại (Extraction V2)")) {
    warnings.push("Cần xem lại (Extraction V2)");
  }
  return {
    id: v2.id,
    tempId: `ext-${v2.order}`,
    order: v2.order,
    sourceNumber: v2.sourceNumber ?? undefined,
    page: v2.page ?? undefined,
    questionType: v2.type === "unknown" ? undefined : v2.type,
    content: v2.content,
    options: v2.options.map((opt) => ({
      id: opt.id,
      content: opt.content,
      rawContent: opt.content,
    })),
    correctAnswers: answers,
    explanation: v2.explanation,
    points: v2.points || 1,
    confidenceScore: v2.answerEvidence?.confidence ?? 0,
    detectionStrategy: ORIGIN_TO_STRATEGY[origin],
    warningFlags: warnings.length > 0 ? warnings : undefined,
    isManualDraft: v2.engine === "manual" ? true : undefined,
    rawTextSegment: v2.content.substring(0, 300),
    images: v2.assetRefs.length > 0 ? [...v2.assetRefs] : undefined,
  };
}

/** V2 → V1 cho toàn bộ kết quả (warningsCount theo đúng công thức V1: tổng warningFlags). */
export function toV1Result(v2: ExtractionV2Result): ExtractionResult {
  const questions = v2.questions.map(toV1Question);
  return {
    fileName: v2.fileName,
    fileType: v2.fileType,
    fileSize: v2.fileSize,
    title: v2.title,
    subject: v2.subject,
    totalQuestionsDetected: v2.totalQuestionsDetected,
    questions,
    hasAnswerKeyTable: v2.hasAnswerKeyTable,
    warningsCount: questions.reduce(
      (sum, q) => sum + (q.warningFlags?.length || 0),
      0
    ),
    extractedAt: v2.extractedAt,
  };
}

// --- V2 → Quiz (flow main, giữ hành vi cho đề hợp lệ) -------------------------

/**
 * Bước 12 — diagnostics cho type ở biên V2 → Quiz. Đây là phần "xử lý
 * tiếp" mà bước 09 để lại: câu type "unknown" map về single_choice theo
 * hành vi cũ NHƯNG phải được đánh dấu cần review, không im lặng.
 * - unknown → diagnostic "unknown_type", blocksPublish: false (cảnh báo,
 *   không chặn — vì V1-derived V2 luôn unknown, chặn sẽ phá flow main).
 * - single/true_false có > 1 đáp án → "type_answer_mismatch",
 *   blocksPublish: true (cùng mã với mapper V1 để flow finalization
 *   dùng chung một bảng chặn xuất bản).
 * Hàm này chỉ báo cáo, không sửa type hay đáp án.
 */
export function validateV2QuestionTypes(
  questions: ExtractionV2Question[]
): MappingDiagnostic[] {
  const diagnostics: MappingDiagnostic[] = [];
  questions.forEach((q, idx) => {
    const order = q.order || idx + 1;
    const questionId = q.id || `q-ext-${idx}`;
    const answers = q.correctAnswers || [];
    if (q.type === "unknown") {
      diagnostics.push({
        questionId,
        order,
        code: "unknown_type",
        message: `Câu ${order} chưa xác định được loại câu hỏi — đang map tạm về single_choice, cần giáo viên xác nhận loại câu.`,
        blocksPublish: false,
      });
    }
    if (
      answers.length > 1 &&
      (q.type === "single_choice" || q.type === "true_false")
    ) {
      diagnostics.push({
        questionId,
        order,
        code: "type_answer_mismatch",
        message: `Câu ${order} là loại ${q.type} nhưng có ${answers.length} đáp án đúng — cần sửa loại câu hoặc đáp án trước khi xuất bản.`,
        blocksPublish: true,
      });
    }
  });
  return diagnostics;
}

/**
 * V2 → Question (kiểu Quiz cũ). Khác với mapper V1 ở đúng một điểm: type
 * thật được giữ khi V2 biết type (single/multiple/true_false); chỉ khi
 * type là "unknown" mới map về `single_choice` theo hành vi cũ của main —
 * và câu đó được đánh dấu cần review qua validateV2QuestionTypes()
 * (bước 12), không im lặng.
 * Không gán đáp án, không chèn option: [] giữ nguyên [].
 */
export function v2ToQuizQuestions(
  questions: ExtractionV2Question[]
): Question[] {
  return questions.map((q, idx) => ({
    id: q.id || `q-ext-${Date.now().toString(36)}-${idx}`,
    order: idx + 1,
    content: q.content,
    type: q.type === "unknown" ? "single_choice" : q.type,
    options: q.options.map((opt) => ({
      id: opt.id as OptionId,
      content: opt.content,
    })),
    correctAnswers: [...q.correctAnswers],
    explanation: q.explanation || "",
    points: q.points || 1,
  }));
}
