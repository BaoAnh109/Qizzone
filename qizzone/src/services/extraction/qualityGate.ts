import type { ExtractionV2Result } from "@/types/extractionV2";

/**
 * Bước 10 (PLAN_MAIN, giai đoạn C): Quality Gate tổng cho ExtractionResult V2.
 *
 * Hàm thuần, test được, không gọi API, không đọc file. Gate đánh giá CHẤT
 * LƯỢNG TRÍCH XUẤT (đủ câu chưa, đủ trang chưa, câu có đầy đủ phương án
 * không, ID/chunk có trùng không, bảng đáp án có mâu thuẫn với đáp án từng
 * câu không) — KHÔNG phải gate xuất bản (bước 04/08/25). Ranh giới:
 * - Gate này trả `complete` nghĩa là trích xuất đầy đủ về mặt cấu trúc,
 *   KHÔNG nghĩa là đáp án đã xác minh. Câu thiếu đáp án, type "unknown",
 *   đáp án ai_suggested vẫn mang `status: "needs_review"` ở tầng câu hỏi
 *   và bị chặn xuất bản ở tầng publish — gate này cố tình KHÔNG hạ cấp
 *   chỉ vì thiếu đáp án, để tương thích với gate DOCX bước 07 (f13 không
 *   đáp án vẫn `complete` ở cả hai gate).
 * - Gate KHÔNG dùng confidence/điểm tin cậy làm điều kiện (kể cả không
 *   dùng làm điều kiện duy nhất): confidence là số tự khai của engine,
 *   không phải bằng chứng. Mọi tín hiệu ở đây đều đếm được từ dữ liệu.
 * - Gate tái dùng tín hiệu độc lập của bước 07 qua
 *   `documentQuality.detectedHeaders/unparsedHeaders` (quét header trên
 *   raw text DOCX) thay vì quét lại raw text — raw text không nằm trong
 *   V2, và bước 13 (Canonical IR) mới thay quét regex bằng đối chiếu block.
 *
 * Trạng thái tổng (thứ tự ưu tiên, diagnostic vẫn liệt kê đủ mọi vấn đề):
 * - "failed": không bóc tách được câu nào, hoặc documentQuality = failed
 *   mà vẫn có câu (trường hợp producer đánh dấu hỏng).
 * - "needs_review": vấn đề toàn vẹn/cần người xem (trùng ID, trùng chunk,
 *   đáp án ngoài phương án, mâu thuẫn bảng đáp án, không xác minh được
 *   độ phủ trang, không phát hiện header có nhãn nào dù tài liệu có nội
 *   dung — sau MVP, chống false-complete kiểu h04). Mâu thuẫn đáp án xếp trên thiếu câu vì đáp án sai âm
 *   thầm nguy hiểm hơn câu thiếu (câu thiếu thì lộ ra ngay ở review).
 * - "partial": thiếu nội dung (thiếu câu theo số đếm, trang chưa xử lý,
 *   câu thiếu phương án, câu trống nội dung, chunk hỏng/dở dang).
 * - "complete": không phát hiện vấn đề nào ở trên.
 */

/** Trạng thái tổng của gate. */
export type QualityGateStatus =
  | "complete"
  | "partial"
  | "needs_review"
  | "failed";

/** Mã vấn đề — mỗi mã có đúng một mức độ (xem SEVERITY). */
export type QualityGateIssueCode =
  | "no_questions"
  | "document_failed"
  | "missing_questions"
  | "no_headers_detected"
  | "unprocessed_pages"
  | "page_coverage_unknown"
  | "insufficient_options"
  | "empty_content"
  | "missing_id"
  | "duplicate_id"
  | "duplicate_option"
  | "answer_not_in_options"
  | "answer_key_conflict"
  | "chunk_failed"
  | "chunk_partial"
  | "duplicate_chunk";

export interface QualityGateIssue {
  code: QualityGateIssueCode;
  /** Số thứ tự hiển thị của câu (1-based); 0 khi vấn đề ở cấp tài liệu/chunk. */
  order: number;
  /** Index 0-based trong mảng questions; -1 khi không gắn với câu cụ thể. */
  questionIndex: number;
  /** Thông điệp tiếng Việt, ghi rõ số liệu và vị trí (không nêu tên số câu thiếu cụ thể — xem bước 07: parser đánh lại order nên không suy được số gốc). */
  message: string;
}

export interface QualityGateResult {
  status: QualityGateStatus;
  issues: QualityGateIssue[];
}

/**
 * Đầu vào phụ của gate (ngoài ExtractionV2Result):
 * - `totalPages`: tổng số trang của tài liệu gốc (PDF biết được từ pdfjs;
 *   DOCX không có pagination chắc chắn nên không truyền). Không truyền thì
 *   bỏ qua kiểm tra độ phủ trang, không bịa.
 * - `answerKey`: bảng đáp án đối chiếu. Bước 13: nối ƯU TIÊN theo số câu
 *   gốc (sourceNumber) khi câu có số gốc, fallback về order hiển thị khi
 *   không có — để bảng đáp án của đề đánh số không liên tục (f12) hoặc
 *   đề lặp header không bị nối nhầm. Chỉ so khi cả bảng và đáp án từng
 *   câu đều có — câu chưa có đáp án không tính là mâu thuẫn (thiếu đáp
 *   án là việc của gate publish, không phải gate này).
 */
export interface QualityGateOptions {
  totalPages?: number;
  answerKey?: ReadonlyMap<number, readonly string[]> | Record<number, readonly string[]>;
}

/** Mức độ của từng mã: failed (3) > needs_review (2) > partial (1). */
const SEVERITY: Record<QualityGateIssueCode, 1 | 2 | 3> = {
  no_questions: 3,
  document_failed: 3,
  missing_questions: 1,
  no_headers_detected: 2,
  unprocessed_pages: 1,
  page_coverage_unknown: 2,
  insufficient_options: 1,
  empty_content: 1,
  missing_id: 2,
  duplicate_id: 2,
  duplicate_option: 2,
  answer_not_in_options: 2,
  answer_key_conflict: 2,
  chunk_failed: 1,
  chunk_partial: 1,
  duplicate_chunk: 2,
};

function severityToStatus(level: number): QualityGateStatus {
  if (level >= 3) return "failed";
  if (level === 2) return "needs_review";
  if (level === 1) return "partial";
  return "complete";
}

function sameAnswerSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort().join(",");
  const sb = [...b].sort().join(",");
  return sa === sb;
}

export function assessExtractionQuality(
  result: ExtractionV2Result,
  options: QualityGateOptions = {}
): QualityGateResult {
  const issues: QualityGateIssue[] = [];
  const questions = result.questions ?? [];

  // 0 câu → failed, không kiểm tra gì thêm (mọi tín hiệu khác đều vô nghĩa).
  if (questions.length === 0) {
    issues.push({
      code: "no_questions",
      order: 0,
      questionIndex: -1,
      message: "Không bóc tách được câu hỏi nào từ file",
    });
    return { status: "failed", issues };
  }

  // Producer đánh dấu document failed nhưng vẫn có câu → tin producer.
  const dq = result.documentQuality;
  if (dq && dq.status === "failed") {
    issues.push({
      code: "document_failed",
      order: 0,
      questionIndex: -1,
      message:
        dq.reasons.length > 0
          ? `Tài liệu được đánh dấu hỏng: ${dq.reasons.join("; ")}`
          : "Tài liệu được đánh dấu hỏng",
    });
  }

  // Sau MVP (kiểu h04): tài liệu có nội dung nhưng quét header có nhãn
  // không ra header nào — header detection thất bại hoàn toàn thì không
  // thể xác minh số câu đầy đủ, gate KHÔNG được complete. Chỉ áp dụng
  // khi producer ĐÃ quét và báo rõ 0 (detectedHeaders === 0); undefined
  // nghĩa là không quét (PDF/TXT không có tín hiệu này) thì không suy.
  // Mức needs_review (cùng họ page_coverage_unknown): nghi ngờ toàn vẹn,
  // cần người xem, không phải mất dữ liệu chắc chắn.
  if (dq?.detectedHeaders === 0 && questions.length > 0) {
    issues.push({
      code: "no_headers_detected",
      order: 0,
      questionIndex: -1,
      message:
        `Không phát hiện header câu hỏi có nhãn nào trong tài liệu nhưng vẫn bóc tách được ${questions.length} câu — không xác minh được số câu đầy đủ, cần giáo viên xem lại`,
    });
  }

  // Số câu độc lập: lấy max các nguồn đếm được (header quét bước 07,
  // số câu phát hiện mà parser khai, số câu + số header chưa parse).
  // parsed > detected không phải tín hiệu thiếu (bước 07) nên chỉ tính khi dương.
  const candidates: number[] = [];
  if (dq?.detectedHeaders !== undefined) candidates.push(dq.detectedHeaders);
  if (dq?.unparsedHeaders !== undefined && dq.unparsedHeaders > 0) {
    candidates.push(questions.length + dq.unparsedHeaders);
  }
  if (result.totalQuestionsDetected !== undefined) {
    candidates.push(result.totalQuestionsDetected);
  }
  const expectedCount = candidates.length > 0 ? Math.max(...candidates) : 0;
  const missingCount = expectedCount - questions.length;
  if (missingCount > 0) {
    issues.push({
      code: "missing_questions",
      order: 0,
      questionIndex: -1,
      message:
        `Phát hiện ${expectedCount} câu hỏi trong file nhưng chỉ bóc tách được ` +
        `${questions.length} câu (thiếu ${missingCount} câu)`,
    });
  }

  // Độ phủ trang — chỉ khi caller biết tổng số trang.
  const totalPages = options.totalPages;
  if (totalPages !== undefined && totalPages > 0) {
    const covered = new Set<number>();
    for (const q of questions) {
      if (q.page !== null && q.page >= 1 && q.page <= totalPages) {
        covered.add(q.page);
      }
    }
    if (covered.size === 0) {
      // Parser chưa gắn trang cho câu nào (PDF hiện tại chưa emit page —
      // bước 15) nên không thể xác minh: báo needs_review, không bịa là đủ.
      issues.push({
        code: "page_coverage_unknown",
        order: 0,
        questionIndex: -1,
        message:
          `Không xác minh được độ phủ trang: tài liệu có ${totalPages} trang ` +
          `nhưng không câu nào gắn số trang nguồn`,
      });
    } else {
      const unprocessed: number[] = [];
      for (let p = 1; p <= totalPages; p++) {
        if (!covered.has(p)) unprocessed.push(p);
      }
      if (unprocessed.length > 0) {
        issues.push({
          code: "unprocessed_pages",
          order: 0,
          questionIndex: -1,
          message:
            `${unprocessed.length} trang chưa có câu hỏi nào được bóc tách ` +
            `(trang ${unprocessed.join(", ")})`,
        });
      }
    }
  }

  // Kiểm tra từng câu (theo thứ tự hiển thị — diagnostic có vị trí).
  const seenIds = new Set<string>();
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const order = q.order || i + 1;

    if (!q.id || !q.id.trim()) {
      issues.push({
        code: "missing_id",
        order,
        questionIndex: i,
        message: `Câu ${order} thiếu ID`,
      });
    } else if (seenIds.has(q.id)) {
      issues.push({
        code: "duplicate_id",
        order,
        questionIndex: i,
        message: `Câu ${order} trùng ID với câu trước (ID "${q.id}")`,
      });
    } else {
      seenIds.add(q.id);
    }

    if (!q.content || !q.content.trim()) {
      issues.push({
        code: "empty_content",
        order,
        questionIndex: i,
        message: `Câu ${order} trống nội dung`,
      });
    }

    if (q.options.length < 2) {
      issues.push({
        code: "insufficient_options",
        order,
        questionIndex: i,
        message: `Câu ${order} chỉ có ${q.options.length} phương án (cần ít nhất 2)`,
      });
    }

    const seenOptionIds = new Set<string>();
    for (const opt of q.options) {
      if (seenOptionIds.has(opt.id)) {
        issues.push({
          code: "duplicate_option",
          order,
          questionIndex: i,
          message: `Câu ${order} trùng phương án "${opt.id}"`,
        });
      } else {
        seenOptionIds.add(opt.id);
      }
    }

    for (const ans of q.correctAnswers ?? []) {
      if (!seenOptionIds.has(ans)) {
        issues.push({
          code: "answer_not_in_options",
          order,
          questionIndex: i,
          message: `Câu ${order} có đáp án "${ans}" không nằm trong các phương án`,
        });
      }
    }
  }

  // Trạng thái chunk (rỗng cho tới bước 19 — khi đó mới có tín hiệu).
  const seenChunks = new Set<number>();
  for (const chunk of result.chunks ?? []) {
    if (seenChunks.has(chunk.chunkIndex)) {
      issues.push({
        code: "duplicate_chunk",
        order: 0,
        questionIndex: -1,
        message: `Chunk ${chunk.chunkIndex} xuất hiện trùng lặp`,
      });
    } else {
      seenChunks.add(chunk.chunkIndex);
    }
    if (chunk.status === "failed") {
      issues.push({
        code: "chunk_failed",
        order: 0,
        questionIndex: -1,
        message:
          `Chunk ${chunk.chunkIndex} xử lý hỏng` +
          (chunk.reason ? `: ${chunk.reason}` : ""),
      });
    } else if (chunk.status === "partial") {
      issues.push({
        code: "chunk_partial",
        order: 0,
        questionIndex: -1,
        message:
          `Chunk ${chunk.chunkIndex} xử lý dở dang` +
          (chunk.reason ? `: ${chunk.reason}` : ""),
      });
    }
  }

  // Mâu thuẫn bảng đáp án — chỉ so khi cả hai phía đều có đáp án.
  const answerKey = options.answerKey;
  if (answerKey) {
    const keyMap =
      answerKey instanceof Map
        ? answerKey
        : new Map<number, readonly string[]>(
            Object.entries(answerKey).map(([k, v]) => [Number(k), v])
          );
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const order = q.order || i + 1;
      // Bước 13: nối theo số câu gốc trước (bảng đáp án ghi theo số in
      // trong đề), fallback về order hiển thị cho câu không có số gốc —
      // để caller dùng map keyed-by-order cũ vẫn chạy được.
      const expected =
        (q.sourceNumber != null ? keyMap.get(q.sourceNumber) : undefined) ??
        keyMap.get(order);
      const got = q.correctAnswers ?? [];
      if (expected !== undefined && got.length > 0 && !sameAnswerSet(got, expected)) {
        issues.push({
          code: "answer_key_conflict",
          order,
          questionIndex: i,
          message:
            `Câu ${order} mâu thuẫn bảng đáp án: đáp án từng câu là ` +
            `[${got.join(", ")}] nhưng bảng đáp án ghi [${[...expected].join(", ")}]`,
        });
      }
    }
  }

  const level = issues.reduce((max, iss) => Math.max(max, SEVERITY[iss.code]), 0);
  return { status: severityToStatus(level), issues };
}
