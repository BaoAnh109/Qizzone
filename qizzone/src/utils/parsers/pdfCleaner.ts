/**
 * Làm sạch văn bản thô trích xuất từ PDF: loại bỏ watermark Studocu, header, footer, số trang
 */
export function cleanPdfExtractedText(rawPages: string[]): string {
  const cleanedPages: string[] = [];

  for (let pageIdx = 0; pageIdx < rawPages.length; pageIdx++) {
    const pageText = rawPages[pageIdx];
    const lines = pageText.split("\n");
    const filteredLines: string[] = [];

    for (let line of lines) {
      const trimmed = line.trim();

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
