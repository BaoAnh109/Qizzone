import type { ReviewProgress } from "@/services/extraction/reviewProgress";

/**
 * Bước 24 (PLAN_MAIN, giai đoạn F): panel tiến trình thật của màn review.
 * Số liệu lấy từ Hybrid Orchestrator (chunk theo trang/khối, trạng thái
 * hiển thị từng câu, aiNeeded) — không phải tiến trình giả theo số câu
 * giáo viên đã bấm qua. "Đã xác minh" nghĩa hẹp theo display bước 23
 * (bằng chứng gốc + đủ phương án).
 */
export function ReviewProgressPanel({ progress }: { progress: ReviewProgress }) {
  const verifiedRatio =
    progress.totalQuestions > 0
      ? Math.round((progress.verified / progress.totalQuestions) * 100)
      : 0;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 text-xs text-neutral-700 space-y-1.5 shadow-2xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>
          <strong className="text-neutral-900">Tiến trình: </strong>
          Đã xác minh {progress.verified}/{progress.totalQuestions} câu
          ({verifiedRatio}%) · Cần xem lại {progress.needsReview} · Có thể
          đúng {progress.likely} · Không hợp lệ {progress.invalid}
        </span>
        <span>
          <strong className="text-neutral-900">Chunk: </strong>
          {progress.chunksComplete} đã xử lý / {progress.chunksPartial} một
          phần / {progress.chunksFailed} chưa xử lý
          {progress.chunksTotal > 0 ? ` (tổng ${progress.chunksTotal})` : ""}
        </span>
      </div>

      {(progress.missingAnswers > 0 || progress.aiNeededCount > 0) && (
        <p>
          {progress.missingAnswers > 0 && (
            <>Chưa có đáp án: {progress.missingAnswers} câu. </>
          )}
          {progress.aiNeededCount > 0 && (
            <>
              Cần AI lấp đáp án: {progress.aiNeededCount} câu
              {progress.aiNeededOrders.length > 0
                ? ` (câu ${progress.aiNeededOrders.join(", ")})`
                : ""}
              .
            </>
          )}
        </p>
      )}

      {progress.failedChunks.length > 0 && (
        <p className="text-amber-800">
          Chunk chưa xử lý:{" "}
          {progress.failedChunks
            .map((c) =>
              c.page !== undefined
                ? `chunk ${c.chunkIndex} (trang ${c.page})`
                : `chunk ${c.chunkIndex}`
            )
            .join(", ")}
          {progress.ocrNeededPages.length > 0 && (
            <>
              {" "}
              — trang scan cần OCR: {progress.ocrNeededPages.join(", ")}.
            </>
          )}
        </p>
      )}
    </div>
  );
}
