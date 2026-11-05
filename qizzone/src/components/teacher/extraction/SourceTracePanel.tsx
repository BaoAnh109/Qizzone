import type { QuestionSourceTrace } from "@/services/extraction/sourceTrace";

/**
 * Bước 24 (PLAN_MAIN, giai đoạn F): panel đối chiếu nguồn trong card câu
 * hỏi đã chọn. Hiển thị những gì đối chiếu được thật — vị trí, đoạn
 * trích, nguồn thắng/thua — và nói rõ khi không có nguồn, thay vì bịa
 * vị trí. % hiển thị (nếu có) là % waterfall quy ước của nguồn thắng
 * (bước 23), không phải xác suất đo được.
 */
export function SourceTracePanel({ trace }: { trace: QuestionSourceTrace }) {
  return (
    <div
      className="mx-4 mb-4 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3 text-xs text-neutral-700 space-y-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="font-bold text-indigo-900 text-[11px] uppercase tracking-wider">
        Đối chiếu nguồn
      </p>

      {!trace.hasSource ? (
        <p className="text-neutral-500">
          Không có nguồn đối chiếu
          {trace.noSourceReason ? ` — ${trace.noSourceReason}` : ""}.
        </p>
      ) : (
        <>
          <p>
            <span className="font-bold text-neutral-800">Vị trí: </span>
            {trace.positionLabel ?? "Không xác định vị trí trang/khối"}
            {trace.chunkLabel ? ` · ${trace.chunkLabel}` : ""}
          </p>

          {trace.evidenceExcerpt ? (
            <p>
              <span className="font-bold text-neutral-800">
                Đoạn trích bằng chứng:{" "}
              </span>
              <span className="font-mono text-[11px] bg-white px-1.5 py-0.5 rounded border border-neutral-200">
                {trace.evidenceExcerpt}
              </span>
            </p>
          ) : trace.rawSegment ? (
            <p>
              <span className="font-bold text-neutral-800">
                Đoạn gốc parser giữ lại:{" "}
              </span>
              <span className="font-mono text-[11px] bg-white px-1.5 py-0.5 rounded border border-neutral-200">
                {trace.rawSegment}
              </span>
            </p>
          ) : null}

          {trace.winningLabel ? (
            <p>
              <span className="font-bold text-neutral-800">
                Nguồn đáp án:{" "}
              </span>
              {trace.winningLabel}
              {trace.winningPercent !== null
                ? ` · ${trace.winningPercent}% (mức ưu tiên)`
                : ""}
            </p>
          ) : (
            <p>
              <span className="font-bold text-neutral-800">
                Nguồn đáp án:{" "}
              </span>
              Chưa xác định — cần giáo viên chọn
            </p>
          )}

          {trace.losingLabels.length > 0 && (
            <p>
              <span className="font-bold text-neutral-800">
                Nguồn khác / mâu thuẫn:{" "}
              </span>
              {trace.losingLabels.join(", ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
