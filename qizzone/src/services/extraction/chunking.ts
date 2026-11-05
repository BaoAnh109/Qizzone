import type {
  ExtractionV2Question,
  ExtractionV2Result,
  V2ChunkStatus,
} from "@/types/extractionV2";

/**
 * Bước 19 (PLAN_MAIN, giai đoạn E): chunking theo trang/khối.
 *
 * Hàm thuần, không gọi API, không đọc file. Chunking chia tài liệu thành
 * các chunk để Quality Gate (bước 10) đọc được trạng thái từng chunk
 * THẬT thay vì mảng rỗng — gate đã đọc `result.chunks` từ bước 10
 * (chunk_failed / chunk_partial / duplicate_chunk), bước này chỉ điền
 * dữ liệu vào, không sửa gate.
 *
 * RANH GIỚI (ghi rõ, không đoán):
 * - Chunk status chỉ phản ánh MỨC ĐỘ XỬ LÝ của chunk, KHÔNG phản ánh
 *   chất lượng từng câu (câu thiếu đáp án, type unknown, ai_suggested
 *   vẫn nằm ở `question.quality`/`status` và gate publish — một chunk
 *   chứa câu needs_review vẫn là `complete` nếu chunk đó đã xử lý xong).
 * - Câu thuộc về ĐÚNG MỘT chunk, không nhân đôi:
 *   - PDF: chunk của trang chứa stem câu hỏi (`question.page`, luật
 *     bước 15: câu ngắt qua trang lấy trang đầu chứa stem). Câu không
 *     có page, page ngoài khoảng, hoặc page là trang scan thì KHÔNG
 *     gán vào chunk nào — ghi vào `unassignedQuestionIndexes`, không
 *     đoán chunk.
 *   - DOCX/text (IR segment): chỉ gán khi số segment BẰNG số câu hỏi
 *     (segment thứ i ↔ câu thứ i theo thứ tự xuất hiện). Lệch số lượng
 *     thì không gán câu nào — gán nhầm còn tệ hơn không gán.
 * - Trang scan (scanPages của bước 16) không bao giờ nhận câu: trang
 *   scan không có text layer nên không thể có câu từ text layer; câu
 *   nào khai page là trang scan là dữ liệu mâu thuẫn, để unassigned.
 * - Chunk index 0-based, duy nhất theo construction (gate vẫn kiểm tra
 *   duplicate_chunk phòng thủ).
 * - Builder không mutate input: `attachChunksToV2` trả kết quả mới.
 */

// --- Kiểu đầu vào tối thiểu (để builder không phụ thuộc V2 đầy đủ) --------

/** Câu hỏi dùng cho chunking: chỉ cần page (PDF) và order hiển thị. */
export interface ChunkableQuestion {
  readonly page?: number | null;
  readonly order: number;
}

/** Một segment IR dùng cho chunking: chỉ cần index các block thuộc nó. */
export interface ChunkableSegment {
  readonly blocks: ReadonlyArray<{ readonly index: number }>;
}

/** Một lần gán: câu thứ questionIndex (0-based trong mảng questions) vào chunk thứ chunkIndex. */
export interface ChunkAssignment {
  questionIndex: number;
  chunkIndex: number;
}

export interface ChunkBuildOutput {
  chunks: V2ChunkStatus[];
  assignments: ChunkAssignment[];
  /**
   * Index 0-based của câu không gán được vào chunk nào. Không đoán —
   * caller (bước 21) quyết định hiển thị/xử lý tiếp, không tự gán.
   */
  unassignedQuestionIndexes: number[];
}

function sortedOrders(orders: number[]): number[] {
  return [...orders].sort((a, b) => a - b);
}

// --- Chunk theo trang (PDF) -------------------------------------------------

/**
 * Một chunk cho mỗi trang 1..totalPages.
 * - Trang scan (trong scanPages) → `failed`, không nhận câu nào.
 * - Trang có text layer và có ≥ 1 câu → `complete`.
 * - Trang có text layer nhưng 0 câu → `partial` (trang chưa xử lý —
 *   khớp tín hiệu unprocessed_pages của gate, mức partial).
 * totalPages phải là số nguyên ≥ 1, ngược lại throw RangeError (caller
 * bug, không im lặng trả chunk rỗng).
 */
export function buildPageChunks(
  questions: ReadonlyArray<ChunkableQuestion>,
  totalPages: number,
  scanPages: ReadonlyArray<number> = []
): ChunkBuildOutput {
  if (!Number.isInteger(totalPages) || totalPages < 1) {
    throw new RangeError(
      `buildPageChunks: totalPages phải là số nguyên ≥ 1, nhận được ${totalPages}`
    );
  }
  const scans = new Set(
    scanPages.filter((p) => Number.isInteger(p) && p >= 1 && p <= totalPages)
  );
  const chunks: V2ChunkStatus[] = [];
  const assignments: ChunkAssignment[] = [];
  const unassignedQuestionIndexes: number[] = [];

  for (let page = 1; page <= totalPages; page++) {
    const chunkIndex = page - 1;
    if (scans.has(page)) {
      chunks.push({
        chunkIndex,
        status: "failed",
        reason: `Trang ${page} là trang scan (không có text layer), chưa có OCR`,
        page,
        questionOrders: [],
      });
      continue;
    }
    const assigned: number[] = [];
    questions.forEach((q, qi) => {
      if (q.page === page) assigned.push(qi);
    });
    if (assigned.length > 0) {
      chunks.push({
        chunkIndex,
        status: "complete",
        page,
        questionOrders: sortedOrders(assigned.map((qi) => questions[qi].order)),
      });
      for (const qi of assigned) assignments.push({ questionIndex: qi, chunkIndex });
    } else {
      chunks.push({
        chunkIndex,
        status: "partial",
        reason: `Trang ${page} có text layer nhưng không bóc tách được câu hỏi nào`,
        page,
        questionOrders: [],
      });
    }
  }

  questions.forEach((_, qi) => {
    const assigned = assignments.some((a) => a.questionIndex === qi);
    if (!assigned) unassignedQuestionIndexes.push(qi);
  });

  return { chunks, assignments, unassignedQuestionIndexes };
}

// --- Chunk theo khối (DOCX/text, từ IR segment) ------------------------------

/**
 * Một chunk cho mỗi IR segment (khối câu hỏi).
 * - Số segment == số câu hỏi: segment thứ i ↔ câu thứ i (theo thứ tự
 *   xuất hiện), chunk `complete`, blockStart/blockEnd là index block
 *   IR đầu/cuối của segment (vắng mặt khi segment không có block nào).
 * - Số segment != số câu hỏi: KHÔNG gán câu nào (gán theo vị trí khi
 *   lệch số lượng là gán nhầm), mọi chunk `partial` kèm lý do lệch số
 *   lượng, mọi câu vào unassigned.
 * - segments rỗng → không có chunk nào, mọi câu unassigned (caller dùng
 *   buildDocumentChunk làm fallback, không tự bịa khối).
 */
export function buildSegmentChunks(
  segments: ReadonlyArray<ChunkableSegment>,
  questions: ReadonlyArray<{ readonly order: number }>
): ChunkBuildOutput {
  const chunks: V2ChunkStatus[] = [];
  const assignments: ChunkAssignment[] = [];
  const unassignedQuestionIndexes: number[] = questions.map((_, i) => i);

  if (segments.length === 0) {
    return { chunks, assignments, unassignedQuestionIndexes };
  }

  const countsMatch = segments.length === questions.length;
  segments.forEach((segment, i) => {
    const indexes = segment.blocks.map((b) => b.index);
    const blockStart = indexes.length > 0 ? Math.min(...indexes) : undefined;
    const blockEnd = indexes.length > 0 ? Math.max(...indexes) : undefined;
    if (countsMatch) {
      chunks.push({
        chunkIndex: i,
        status: "complete",
        blockStart,
        blockEnd,
        questionOrders: [questions[i].order],
      });
      assignments.push({ questionIndex: i, chunkIndex: i });
    } else {
      chunks.push({
        chunkIndex: i,
        status: "partial",
        reason:
          `Số khối (${segments.length}) khác số câu hỏi (${questions.length}), ` +
          `không gán câu vào khối để tránh gán nhầm`,
        blockStart,
        blockEnd,
        questionOrders: [],
      });
    }
  });

  return {
    chunks,
    assignments,
    unassignedQuestionIndexes: countsMatch ? [] : unassignedQuestionIndexes,
  };
}

// --- Chunk fallback: toàn tài liệu là một chunk ------------------------------

/**
 * Fallback khi không có phân trang (DOCX/text không qua IR) hoặc không
 * có segment: toàn tài liệu là một chunk duy nhất.
 * - 0 câu → `failed` (khớp no_questions của gate).
 * - Có câu → `complete` (chunk đã xử lý xong; chất lượng từng câu nằm
 *   ở question.quality, không kéo chunk xuống partial).
 */
export function buildDocumentChunk(
  questions: ReadonlyArray<{ readonly order: number }>
): ChunkBuildOutput {
  if (questions.length === 0) {
    return {
      chunks: [
        {
          chunkIndex: 0,
          status: "failed",
          reason: "Không bóc tách được câu hỏi nào",
          questionOrders: [],
        },
      ],
      assignments: [],
      unassignedQuestionIndexes: [],
    };
  }
  return {
    chunks: [
      {
        chunkIndex: 0,
        status: "complete",
        questionOrders: sortedOrders(questions.map((q) => q.order)),
      },
    ],
    assignments: questions.map((_, i) => ({ questionIndex: i, chunkIndex: 0 })),
    unassignedQuestionIndexes: [],
  };
}

// --- Gắn chunk vào kết quả V2 ------------------------------------------------

/**
 * Trả kết quả V2 mới với `chunks` đã điền và mỗi câu được gán thì có
 * `chunkIndex` trỏ về chunk của nó. Không mutate input.
 * - `sourceRef`: chỉ điền khi câu chưa có sourceRef VÀ chunk của nó có
 *   page (dạng `pdf:page N`, đúng quy ước bước 09). Chunk theo khối
 *   không tự bịa sourceRef (block index không đủ ngữ cảnh tài liệu).
 * - Câu unassigned giữ nguyên (không chunkIndex, không sourceRef mới).
 */
export function attachChunksToV2(
  result: ExtractionV2Result,
  output: ChunkBuildOutput
): ExtractionV2Result {
  const chunkByIndex = new Map<number, V2ChunkStatus>(
    output.chunks.map((c) => [c.chunkIndex, c])
  );
  const chunkIndexByQuestion = new Map<number, number>(
    output.assignments.map((a) => [a.questionIndex, a.chunkIndex])
  );
  const questions: ExtractionV2Question[] = result.questions.map((q, qi) => {
    const chunkIndex = chunkIndexByQuestion.get(qi);
    if (chunkIndex === undefined) return q;
    const chunk = chunkByIndex.get(chunkIndex);
    const sourceRef =
      !q.sourceRef && chunk?.page !== undefined
        ? `pdf:page ${chunk.page}`
        : q.sourceRef;
    return { ...q, chunkIndex, sourceRef };
  });
  return { ...result, chunks: output.chunks, questions };
}
