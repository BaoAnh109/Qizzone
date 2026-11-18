/**
 * Làm sạch văn bản thô trích xuất từ PDF: loại bỏ watermark Studocu, header, footer, số trang
 */
export function cleanPdfExtractedText(rawPages: string[]): string {
  const cleanedPages: string[] = [];

  for (let pageIdx = 0; pageIdx < rawPages.length; pageIdx++) {
    const pageText = rawPages[pageIdx];
    const lines = pageText.split("\n");
    const filteredLines: string[] = [];

    for (const line of lines) {
      const plainLine = line.replace(/<[^>]*>/g, "");
      const trimmed = plainLine.trim();

      // Exam PDFs often place the publisher, page count, and exam code on one
      // footer line. Keep it out of question text even when PDF.js combines
      // the whole footer into a single text row (for example, "Trang 1/4 - Ma
      // de thi 1116" beside the publisher and copyright).
      const hasPageNumber = /\b(?:trang|page)\s+\d+(?:\s*\/\s*\d+|\s+of\s+\d+)?\b/i.test(trimmed);
      const hasExamCode = /\bmã\s*đề(?:\s*thi)?\s*[:#-]?\s*[\p{L}\p{N}-]+/iu.test(trimmed);
      const hasExamPublisher = /\b(?:tailieudieuky|vietnamairlines\.com)\b/i.test(trimmed);
      const hasCopyrightYear = /©\s*20\d{2}/u.test(trimmed);

      if ((hasPageNumber && hasExamCode) ||
        (hasExamPublisher && (hasPageNumber || hasExamCode || hasCopyrightYear))) {
        continue;
      }

      // Bỏ qua các dòng watermark Studocu / tài liệu tải về
      if (
        /^messages\./i.test(trimmed) ||
        /^lOMoARcPSD/i.test(trimmed) ||
        /^downloaded_by/i.test(trimmed) ||
        /^studocu/i.test(trimmed) ||
        /^Trang\s+\d+(\/\d+)?$/i.test(trimmed) ||
        /^Page\s+\d+(\s+of\s+\d+)?$/i.test(trimmed)
      ) {
        continue;
      }

      // Bỏ qua tiêu đề lặp lại ở đầu trang (Running header) nếu có
      if (
        pageIdx > 0 &&
        (trimmed === "Chương 3" ||
          trimmed.includes("BÀI TẬP TRẮC NGHIỆM CHƯƠNG 3") ||
          trimmed.includes("Trường Đại học Công nghệ Giao thông Vận tải"))
      ) {
        continue;
      }

      filteredLines.push(line);
    }

    const cleanedPageText = filteredLines.join("\n").trim();
    if (cleanedPageText.length > 0) {
      cleanedPages.push(cleanedPageText);
    }
  }

  // Ghép các trang lại thành 1 văn bản liền mạch
  return cleanedPages.join("\n\n");
}
