/**
 * Làm sạch văn bản thô trích xuất từ PDF: loại bỏ watermark Studocu, header, footer, số trang
 *
 * Bước 15 (PLAN_MAIN): tách `cleanPdfPages` (trả về mảng đã làm sạch theo
 * từng trang, giữ đúng chỉ số trang) khỏi `cleanPdfExtractedText` (nối các
 * trang còn nội dung như trước). Thêm quy tắc header/footer lặp theo vị
 * trí: một dòng là dòng đầu (hoặc dòng cuối) giống nhau trên >= 2 trang
 * thì bị gỡ khỏi mọi trang mà nó đứng ở vị trí đó — vì đó là header/footer
 * chạy suốt tài liệu, không phải nội dung câu hỏi. Dòng lặp ở GIỮA trang
 * (vd "Đáp án: B" lặp ở nhiều câu) KHÔNG bị gỡ. Tài liệu 1 trang không
 * đổi gì so với trước (quy tắc cần >= 2 trang mới kích hoạt).
 */

/** Chuẩn hóa một dòng để so sánh lặp: trim + gộp whitespace + thường. */
function normLine(line: string): string {
  return line.trim().replace(/\s+/g, " ").toLowerCase();
}

function isWatermarkOrPageNumber(trimmed: string): boolean {
  return (
    /^messages\./i.test(trimmed) ||
    /^lOMoARcPSD/i.test(trimmed) ||
    /^downloaded_by/i.test(trimmed) ||
    /^studocu/i.test(trimmed) ||
    /^Trang\s+\d+(\/\d+)?$/i.test(trimmed) ||
    /^Page\s+\d+(\s+of\s+\d+)?$/i.test(trimmed)
  );
}

function isHardcodedRunningHeader(trimmed: string, pageIdx: number): boolean {
  return (
    pageIdx > 0 &&
    (trimmed === "Chương 3" ||
      trimmed.includes("BÀI TẬP TRẮC NGHIỆM CHƯƠNG 3") ||
      trimmed.includes("Trường Đại học Công nghệ Giao thông Vận tải"))
  );
}

/**
 * Dòng nội dung câu hỏi — KHÔNG BAO GIỜ là header/footer chạy, dù nó
 * lặp ở biên trang (sau MVP, file ATTT): mệnh đề "Sai" đứng cuối trang
 * ở nhiều trang (câu Đúng/Sai ngắt trang) từng bị gỡ mất như footer,
 * làm 4 câu TF mất vế "Sai" và không tổng hợp được option. Cùng họ:
 * dòng option (a–d thường/A–D hoa), dòng đáp án cuối câu, header câu.
 * Đối xứng với isRepeatedHeaderCandidate của documentIR (bước 13).
 */
const CONTENT_LINE_RES: RegExp[] = [
  /^(Đúng|Sai)\.?$/i,
  /^(?:[*✓•xX()[\]]\s*)?[A-Da-d]\s*[.:)/-](?!\d)/,
  /^(Đáp\s*án|ĐA|Answer(?:\s*key)?)\s*[:：\-–—]?\s*[A-Da-d]\s*[.)]?$/i,
  /^(?:Câu|Bài|Question|CÂU|BÀI|QUESTION|Q)\s*(\d+|[IVXLCDM]+)\s*[.:)_-]/i,
];

function isContentLine(trimmed: string): boolean {
  return CONTENT_LINE_RES.some((re) => re.test(trimmed));
}

/**
 * Làm sạch từng trang, trả về mảng cùng độ dài với đầu vào (trang rỗng
 * thành "" để giữ đúng chỉ số trang — caller cần map câu hỏi → trang).
 * Các bộ lọc cũ giữ nguyên; chỉ cộng thêm quy tắc header/footer lặp
 * theo vị trí (dòng đầu/dòng cuối giống nhau trên >= 2 trang).
 */
export function cleanPdfPages(rawPages: string[]): string[] {
  // Lượt 1: lọc watermark/số trang/header hardcode từng trang (giữ nguyên
  // hành vi cũ), thu thập dòng đầu/dòng cuối của mỗi trang.
  const perPageLines: string[][] = rawPages.map((pageText, pageIdx) => {
    const lines = pageText.split("\n");
    const filtered: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      // Dòng trống giữ nguyên như hành vi cũ (chỉ là ký tự phân tách);
      // chỉ lọc watermark/số trang/header hardcode.
      if (trimmed && isWatermarkOrPageNumber(trimmed)) continue;
      if (trimmed && isHardcodedRunningHeader(trimmed, pageIdx)) continue;
      filtered.push(line);
    }
    return filtered;
  });

  // Đếm dòng đầu/dòng cuối KHÔNG RỖNG (chuẩn hóa) xuất hiện trên bao
  // nhiêu trang.
  const firstLinePages = new Map<string, number>();
  const lastLinePages = new Map<string, number>();
  const firstIdx = new Map<number, number>();
  const lastIdx = new Map<number, number>();
  perPageLines.forEach((lines, pageIdx) => {
    let first = -1;
    let last = -1;
    lines.forEach((line, idx) => {
      if (line.trim()) {
        if (first === -1) first = idx;
        last = idx;
      }
    });
    if (first !== -1) {
      firstIdx.set(pageIdx, first);
      const n = normLine(lines[first]);
      firstLinePages.set(n, (firstLinePages.get(n) ?? 0) + 1);
    }
    if (last !== -1) {
      lastIdx.set(pageIdx, last);
      const n = normLine(lines[last]);
      lastLinePages.set(n, (lastLinePages.get(n) ?? 0) + 1);
    }
  });

  // Lượt 2: gỡ dòng đầu/dòng cuối lặp trên >= 2 trang khỏi vị trí đó.
  // Chỉ gỡ đúng ở vị trí đầu/cuối — cùng một dòng xuất hiện ở giữa trang
  // khác vẫn được giữ (đó có thể là nội dung câu hỏi thật).
  // Sau MVP: dòng nội dung (Đúng/Sai, option, dòng đáp án, header câu)
  // KHÔNG BAO GIỜ bị gỡ dù lặp ở biên — "Sai" cuối trang không phải
  // footer (đo được trên file ATTT: 4 câu TF mất vế Sai).
  return perPageLines.map((lines, pageIdx) => {
    const kept = lines.filter((line, idx) => {
      if (isContentLine(line.trim())) return true;
      const n = normLine(line);
      if (idx === firstIdx.get(pageIdx) && (firstLinePages.get(n) ?? 0) >= 2) return false;
      if (idx === lastIdx.get(pageIdx) && (lastLinePages.get(n) ?? 0) >= 2) return false;
      return true;
    });
    return kept.join("\n").trim();
  });
}

export function cleanPdfExtractedText(rawPages: string[]): string {
  const cleanedPages = cleanPdfPages(rawPages);
  // Hành vi cũ: bỏ trang rỗng rồi ghép các trang còn lại bằng "\n\n".
  return cleanedPages.filter((p) => p.length > 0).join("\n\n");
}
