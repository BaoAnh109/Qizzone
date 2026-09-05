import type { OptionId } from "@/types/quiz";
import type {
  DetectionStrategy,
  ExtractedOption,
  ExtractedQuestion,
  ExtractionResult,
} from "@/types/extractor";

/**
 * Phân tích bảng đáp án ở cuối đề thi (Answer Key Table / Grid)
 * Chỉ kích hoạt khi có khu vực tiêu đề bảng đáp án rõ ràng (BẢNG ĐÁP ÁN, ĐÁP ÁN, HƯỚNG DẪN CHẤM,...)
 */
export function extractAnswerKeyTable(rawText: string): Record<number, OptionId> {
  const answerMap: Record<number, OptionId> = {};

  // Tìm khu vực bảng đáp án ở cuối đề nếu có (phải là tiêu đề rõ ràng hoặc có dấu hai chấm)
  const tableSectionMatch = rawText.match(
    /(?:^|[\n\r]|<p[^>]*>|<div[^>]*>|<h\d[^>]*>)\s*(?:<[^>]*>)*\s*(?:BẢNG\s+ĐÁP\s+ÁN|ĐÁP\s+ÁN\s*[:-]|\b(?:BẢNG\s+ĐÁP\s+ÁN|ĐÁP\s+ÁN\s+ĐỀ\s+THI|ĐÁP\s+ÁN\s+CHI\s+TIẾT|HƯỚNG\s+DẪN\s+CHẤM|PHIẾU\s+TRẢ\s+LỜI|ANSWER\s+KEY|KEY\s+ĐÁP\s+ÁN|BẢNG\s+CHỌN\s+ĐÁP\s+ÁN)\b)[\s\S]*$/i
  );

  // Bắt buộc phải có phần tiêu đề bảng đáp án mới quét (tránh nhận diện nhầm số trong đề bài)
  if (!tableSectionMatch) {
    return answerMap;
  }

  const textToScan = tableSectionMatch[0];

  // 1. Quét định dạng bảng HTML nếu có
  const htmlTableRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;
  const tableRows: string[][] = [];

  while ((trMatch = htmlTableRegex.exec(textToScan)) !== null) {
    const rowContent = trMatch[1];
    const cells: string[] = [];
    const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let tdMatch: RegExpExecArray | null;
    while ((tdMatch = tdRegex.exec(rowContent)) !== null) {
      cells.push(cleanMathAndHtml(tdMatch[1]).trim());
    }
    if (cells.length > 0) {
      tableRows.push(cells);
    }
  }

  // Nếu là bảng ma trận (Hàng 1: Câu 1, 2, 3... - Hàng 2: A, B, C...)
  if (tableRows.length >= 2) {
    for (let r = 0; r < tableRows.length - 1; r += 2) {
      const qRow = tableRows[r];
      const aRow = tableRows[r + 1];
      if (qRow && aRow) {
        for (let c = 0; c < Math.min(qRow.length, aRow.length); c++) {
          const qNum = parseInt(qRow[c].replace(/\D/g, ""), 10);
          const ans = aRow[c].toUpperCase().trim() as OptionId;
          if (qNum > 0 && qNum <= 300 && ["A", "B", "C", "D"].includes(ans)) {
            answerMap[qNum] = ans;
          }
        }
      }
    }

    // Kiểu bảng nhiều cột: [Câu 1 | A] [Câu 2 | B]
    for (const row of tableRows) {
      for (let c = 0; c < row.length - 1; c += 2) {
        const qNum = parseInt(row[c].replace(/\D/g, ""), 10);
        const ans = row[c + 1].toUpperCase().trim() as OptionId;
        if (qNum > 0 && qNum <= 300 && ["A", "B", "C", "D"].includes(ans)) {
          answerMap[qNum] = ans;
        }
      }
    }
  }

  // 2. Quét regex dạng cặp 1.A, 1-A, 1:A, 1A, Câu 1: A
  const pairRegexes = [
    /(?:(?:Câu|Question|Bài)\s*)?(\d+)[\s.:\-)_]+([A-D])\b/gi,
    /\b(\d+)\s*([A-D])\b/gi,
  ];

  for (const regex of pairRegexes) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(textToScan)) !== null) {
      const questionNum = parseInt(match[1], 10);
      const answer = match[2].toUpperCase() as OptionId;
      if (questionNum > 0 && questionNum <= 300 && ["A", "B", "C", "D"].includes(answer)) {
        if (!answerMap[questionNum]) {
          answerMap[questionNum] = answer;
        }
      }
    }
  }

  return answerMap;
}

/**
 * Tách nội dung câu hỏi và các lựa chọn A, B, C, D một cách chuẩn xác từ khối văn bản
 */
export function splitOptionsFromBlock(questionBlockText: string): {
  questionPrompt: string;
  options: ExtractedOption[];
} {
  // Regex tìm các đáp án A, B, C, D (chữ HOA [A-D], tránh nhầm với từ thường như "công.", "bộ.")
  const headerRegex =
    /(?:^|[\n\r]|<p[^>]*>|<div[^>]*>|<li[^>]*>|<td[^>]*>|\t|\s{2,}|(?<=[.;!?)])\s+)(?:<[^>]*>)*\s*([*✓•xX()[\]])?\s*(?:<[^>]*>)*\s*([A-D])\s*([*✓])?\s*([.:)/-])(?!\d)/g;

  const matches: Array<{
    index: number;
    letter: OptionId;
    marker?: string;
    headerLength: number;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = headerRegex.exec(questionBlockText)) !== null) {
    const marker = match[1] || match[3] || undefined;
    const letter = match[2].toUpperCase() as OptionId;
    matches.push({
      index: match.index,
      letter,
      marker,
      headerLength: match[0].length,
    });
  }

  // Lọc chỉ giữ lại A, B, C, D theo thứ tự hợp lệ (A -> B -> C -> D)
  const orderedMatches: typeof matches = [];
  const expectedOrder: OptionId[] = ["A", "B", "C", "D"];
  let expectedIndex = 0;

  for (const m of matches) {
    if (expectedIndex < expectedOrder.length && m.letter === expectedOrder[expectedIndex]) {
      orderedMatches.push(m);
      expectedIndex++;
    } else if (expectedIndex === 0 && m.letter === "A") {
      orderedMatches.push(m);
      expectedIndex = 1;
    }
  }

  // Nếu không đủ thứ tự chặt chẽ, lấy theo Set không trùng lặp
  if (orderedMatches.length < 2) {
    orderedMatches.length = 0;
    const seenLetters = new Set<string>();
    for (const m of matches) {
      if (!seenLetters.has(m.letter)) {
        seenLetters.add(m.letter);
        orderedMatches.push(m);
      }
    }
    orderedMatches.sort((a, b) => a.index - b.index);
  }

  if (orderedMatches.length === 0) {
    return {
      questionPrompt: cleanMathAndHtml(questionBlockText),
      options: [],
    };
  }

  // Prompt là toàn bộ phần trước option đầu tiên
  const firstMatch = orderedMatches[0];
  const questionPrompt = cleanMathAndHtml(
    questionBlockText.substring(0, firstMatch.index)
  );

  const options: ExtractedOption[] = [];

  for (let i = 0; i < orderedMatches.length; i++) {
    const current = orderedMatches[i];
    const next = orderedMatches[i + 1];

    const sliceEnd = next ? next.index : questionBlockText.length;
    const rawSlice = questionBlockText.substring(current.index, sliceEnd).trim();

    // Phân tích các định dạng đặc biệt trong slice này
    const isUnderline =
      /<u\b|<span[^>]*class=["'][^"']*is-underline|<span[^>]*style=["'][^"']*text-decoration:\s*underline/i.test(
        rawSlice
      );
    const isBold =
      /<strong\b|<b\b|<span[^>]*class=["'][^"']*is-bold|\*\*[^*]+\*\*/i.test(
        rawSlice
      );
    const isHighlighted =
      /<mark\b|<span[^>]*class=["'][^"']*is-highlighted|<span[^>]*style=["'][^"']*background(?:-color)?:\s*(?:yellow|#ff|rgba)/i.test(
        rawSlice
      );
    const isRedColor =
      /<span[^>]*class=["'][^"']*text-color-red|<span[^>]*style=["'][^"']*color:\s*(?:red|#e11d48|#ff0000|rgb\(255,\s*0,\s*0\))/i.test(
        rawSlice
      );

    const hasSpecialMarker =
      (current.marker && /[*✓xX]/.test(current.marker)) ||
      /(?:^|\s)[*✓]\s*[A-D]/i.test(rawSlice) ||
      /\([A-D]\)/i.test(rawSlice);

    // Bỏ phần chữ cái "A.", "B." ở đầu để lấy nội dung đáp án
    const contentWithoutHeader = rawSlice.replace(
      /^(?:[\s\n\r]|<[^>]*>|[*✓•[\]xX()])*[A-D]\s*[.:)/-](?:<\/[^>]*>)*/i,
      ""
    );

    let cleanContent = cleanMathAndHtml(contentWithoutHeader);

    // Cắt bỏ phần ghi chú cuối đề nếu bị dính vào option cuối cùng (Ghi chú:, Chú ý:, Lưu ý:, Hết, v.v.)
    if (i === orderedMatches.length - 1) {
      cleanContent = cleanContent
        .replace(
          /(?:^|[\n\r])\s*(?:Ghi\s*chú|Chú\s*ý|Lưu\s*ý|Hết|---+\s*HẾT\s*---+|Cán\s*bộ\s*coi\s*thi|Thí\s*sinh)[\s.:\-_]+[\s\S]*$/i,
          ""
        )
        .trim();
    }

    options.push({
      id: current.letter,
      content: cleanContent,
      rawContent: rawSlice,
      isUnderline,
      isBold,
      isHighlighted: isHighlighted || isRedColor,
      hasSpecialMarker: !!hasSpecialMarker,
      textColor: isRedColor ? "#e11d48" : undefined,
    });
  }

  return {
    questionPrompt,
    options,
  };
}

/**
 * Phân tích nội dung của một khối câu hỏi riêng lẻ và áp dụng Priority Waterfall để tìm đáp án đúng
 */
export function parseSingleQuestionBlock(
  rawBlock: string,
  order: number,
  tableAnswer?: OptionId
): ExtractedQuestion | null {
  const warningFlags: string[] = [];

  // Tách phần lời giải (nếu có): "Lời giải:", "Hướng dẫn giải:", "Giải thích:", "Giải:"
  let questionAndOptionsText = rawBlock;
  let explanation: string | undefined = undefined;

  const explanationMatch = rawBlock.match(
    /(?:^|[\n\r]|<p[^>]*>|<div[^>]*>)\s*(?:<[^>]*>)*\s*(?:Lời\s*giải(?:\s*chi\s*tiết)?|Hướng\s*dẫn\s*giải|Giải\s*thích|Explanation|Phương\s*pháp\s*giải|(?:Giải|GIẢI))\s*[:-]\s*([\s\S]*)$/i
  );
  if (explanationMatch && explanationMatch.index !== undefined) {
    explanation = cleanMathAndHtml(explanationMatch[1].trim());
    questionAndOptionsText = rawBlock.substring(0, explanationMatch.index).trim();
  }

  // Tách câu hỏi và options
  const { questionPrompt, options } = splitOptionsFromBlock(questionAndOptionsText);

  // Đảm bảo đủ 4 options nếu thiếu
  if (options.length < 2) {
    options.push(
      { id: "A", content: "Lựa chọn A", rawContent: "A. Lựa chọn A" },
      { id: "B", content: "Lựa chọn B", rawContent: "B. Lựa chọn B" },
      { id: "C", content: "Lựa chọn C", rawContent: "C. Lựa chọn C" },
      { id: "D", content: "Lựa chọn D", rawContent: "D. Lựa chọn D" }
    );
    warningFlags.push("Chưa bóc tách được đầy đủ các lựa chọn A, B, C, D");
  } else if (options.length === 3) {
    warningFlags.push("Chỉ tìm thấy 3 lựa chọn (Thiếu đáp án D)");
  }

  // -------------------------------------------------------------
  // THUẬT TOÁN PRIORITY WATERFALL XÁC ĐỊNH ĐÁP ÁN ĐÚNG
  // -------------------------------------------------------------
  let correctAnswers: OptionId[] = [];
  let detectionStrategy: DetectionStrategy = "ai_inference";
  let confidenceScore = 0.85;

  // Chiến lược 1: Bảng đáp án cuối đề (Answer Key Table) -> 99%
  if (tableAnswer && ["A", "B", "C", "D"].includes(tableAnswer)) {
    correctAnswers = [tableAnswer];
    detectionStrategy = "answer_table";
    confidenceScore = 0.99;
  }

  // Chiến lược 2: Ký hiệu tiền tố đặc biệt (*A, ✓A, [x]) -> 98%
  if (correctAnswers.length === 0) {
    const markerOption = options.find((opt) => opt.hasSpecialMarker);
    if (markerOption) {
      correctAnswers = [markerOption.id];
      detectionStrategy = "special_marker";
      confidenceScore = 0.98;
    }
  }

  // Chiến lược 3: Định dạng gạch chân (Underline <u>A.</u>) -> 95%
  if (correctAnswers.length === 0) {
    const underlineOption = options.find((opt) => opt.isUnderline);
    if (underlineOption) {
      correctAnswers = [underlineOption.id];
      detectionStrategy = "underline";
      confidenceScore = 0.95;
    }
  }

  // Chiến lược 4: Tô màu Highlight / Chữ đỏ -> 95%
  if (correctAnswers.length === 0) {
    const highlightOption = options.find((opt) => opt.isHighlighted);
    if (highlightOption) {
      correctAnswers = [highlightOption.id];
      detectionStrategy = "highlight_color";
      confidenceScore = 0.95;
    }
  }

  // Chiến lược 5: In đậm duy nhất (Distinct Bold <b>A.</b>) -> 90%
  if (correctAnswers.length === 0) {
    const boldOptions = options.filter((opt) => opt.isBold);
    if (boldOptions.length === 1) {
      correctAnswers = [boldOptions[0].id];
      detectionStrategy = "distinct_bold";
      confidenceScore = 0.9;
    }
  }

  // Chiến lược 6: Trích xuất từ Lời giải chi tiết ("Chọn A", "Đáp án A") -> 88%
  if (correctAnswers.length === 0 && explanation) {
    const explAnswerMatch = explanation.match(
      /(?:Chọn|Đáp\s*án(?:\s*đúng)?|Câu\s*trả\s*lời(?:\s*là)?|Suy\s*ra(?:\s*chọn)?|Do\s*đó(?:\s*chọn)?)[\s.:\->]*([A-D])\b/i
    );
    if (explAnswerMatch) {
      const detected = explAnswerMatch[1].toUpperCase() as OptionId;
      correctAnswers = [detected];
      detectionStrategy = "explanation_text";
      confidenceScore = 0.88;
    }
  }

  // Chiến lược 7: Không tìm thấy đáp án đánh dấu trong tài liệu
  if (correctAnswers.length === 0) {
    correctAnswers = []; // Để rỗng: KHÔNG tự ý gán bừa đáp án A
    detectionStrategy = "ai_inference";
    confidenceScore = 0.0;
    warningFlags.push("Chưa có đáp án (Cần chọn đáp án hoặc dùng AI giải)");
  }

  const tempId = `ext-${order}-${Date.now().toString(36)}`;

  return {
    id: `q-ext-${order}`,
    tempId,
    order,
    content: questionPrompt || `Câu hỏi ${order}`,
    options,
    correctAnswers,
    explanation,
    points: 1,
    confidenceScore,
    detectionStrategy,
    warningFlags: warningFlags.length > 0 ? warningFlags : undefined,
    rawTextSegment: rawBlock.substring(0, 300),
  };
}

/**
 * Trích xuất các câu hỏi từ văn bản thô hoặc HTML bằng Multi-Pass Boundary Tokenizer
 * Đảm bảo 100% bóc tách đầy đủ TOÀN BỘ các câu hỏi từ câu 1 đến câu N
 */
export function parseRawExamText(
  rawContent: string,
  options?: {
    fileName?: string;
    fileType?: "docx" | "pdf" | "image" | "text";
    initialAnswerKey?: Record<number, OptionId>;
    extractedImages?: Record<string, string>;
  }
): ExtractionResult {
  const fileName = options?.fileName || "DeThi_Upload.docx";
  const fileType = options?.fileType || "docx";

  // 1. Quét bảng đáp án cuối đề trước (chỉ khi có tiêu đề rõ ràng)
  const scannedAnswerKey = extractAnswerKeyTable(rawContent);
  const globalAnswerKey = { ...(options?.initialAnswerKey || {}), ...scannedAnswerKey };
  const hasAnswerKeyTable = Object.keys(globalAnswerKey).length > 0;

  // Cắt bỏ phần bảng đáp án khỏi nội dung bóc tách câu hỏi CHỈ KHI thực sự quét được bảng đáp án (>= 2 câu)
  let contentToScan = rawContent;
  if (Object.keys(scannedAnswerKey).length >= 2) {
    const tableSectionMatch = rawContent.match(
      /(?:^|[\n\r]|<p[^>]*>|<div[^>]*>|<h\d[^>]*>)\s*(?:<[^>]*>)*\s*(?:BẢNG\s+ĐÁP\s+ÁN|ĐÁP\s+ÁN\s*[:-]|\b(?:BẢNG\s+ĐÁP\s+ÁN|ĐÁP\s+ÁN\s+ĐỀ\s+THI|ĐÁP\s+ÁN\s+CHI\s+TIẾT|HƯỚNG\s+DẪN\s+CHẤM|PHIẾU\s+TRẢ\s+LỜI|ANSWER\s+KEY|KEY\s+ĐÁP\s+ÁN|BẢNG\s+CHỌN\s+ĐÁP\s+ÁN)\b)[\s\S]*$/i
    );
    if (tableSectionMatch && tableSectionMatch.index !== undefined) {
      contentToScan = rawContent.substring(0, tableSectionMatch.index);
    }
  }

  // 2. Tìm toàn bộ các ranh giới câu hỏi (Multi-Pass Boundary Finder)
  // Hỗ trợ: Câu 1., CÂU 1:, Bài 1 [NB] (1.0đ):, Question 1, 1. , 1: , 1) , **Câu 1:**, <b>Câu 1:</b>, 10.Nội dung
  const questionHeaderRegex =
    /(?:^|[\n\r]|<p[^>]*>|<div[^>]*>|<tr[^>]*>|<li[^>]*>)\s*(?:<[^>]*>)*\s*(?:(?:(?:Câu|Bài|Question|CÂU|BÀI|QUESTION|Q)\s*(\d+)|\*{1,2}(?:Câu|Bài)\s*(\d+)\*{0,2}|(?:<[^>]*>)*(?:Câu|Bài)\s*(\d+)(?:<\/[^>]*>)*)(?:\s*\[[^\]]+\]|\s*\([^)]+\))*\s*[.:)_-]\s*|(\d+)\s*[.:)/-]\s*)/gi;

  interface Boundary {
    startIndex: number;
    headerLength: number;
    order: number;
  }

  const boundaries: Boundary[] = [];
  let headerMatch: RegExpExecArray | null;

  while ((headerMatch = questionHeaderRegex.exec(contentToScan)) !== null) {
    const rawNum =
      headerMatch[1] || headerMatch[2] || headerMatch[3] || headerMatch[4];
    const explicitOrder = parseInt(rawNum, 10);
    const order = !isNaN(explicitOrder) ? explicitOrder : boundaries.length + 1;

    // Bỏ qua nếu là số thứ tự không hợp lý (ví dụ số năm 2024 hoặc quá lớn)
    if (order > 0 && order <= 300) {
      boundaries.push({
        startIndex: headerMatch.index,
        headerLength: headerMatch[0].length,
        order,
      });
    }
  }

  const extractedQuestions: ExtractedQuestion[] = [];

  if (boundaries.length > 0) {
    // Sắp xếp các mốc câu hỏi theo vị trí tăng dần
    boundaries.sort((a, b) => a.startIndex - b.startIndex);

    for (let i = 0; i < boundaries.length; i++) {
      const current = boundaries[i];
      const next = boundaries[i + 1];

      const blockStart = current.startIndex + current.headerLength;
      const blockEnd = next ? next.startIndex : contentToScan.length;

      const blockBody = contentToScan.substring(blockStart, blockEnd).trim();
      if (blockBody.length >= 2) {
        const parsed = parseSingleQuestionBlock(
          blockBody,
          current.order,
          globalAnswerKey[current.order]
        );
        if (parsed) {
          extractedQuestions.push(parsed);
        }
      }
    }
  }

  // Fallback nếu không tách được theo header "Câu 1", thử phân tích toàn bộ văn bản
  if (extractedQuestions.length === 0 && contentToScan.trim().length > 0) {
    const fallbackQuestion = parseSingleQuestionBlock(
      contentToScan,
      1,
      globalAnswerKey[1]
    );
    if (fallbackQuestion) {
      extractedQuestions.push(fallbackQuestion);
    }
  }

  // Cân bằng điểm số đều cho các câu (Tổng 10 điểm)
  const totalPoints = 10;
  const count = extractedQuestions.length || 1;
  const pointsPerQuestion = Math.round((totalPoints / count) * 100) / 100;

  extractedQuestions.forEach((q) => {
    q.points = pointsPerQuestion;
  });

  const warningsCount = extractedQuestions.reduce(
    (sum, q) => sum + (q.warningFlags?.length || 0),
    0
  );

  return {
    fileName,
    fileType,
    fileSize: rawContent.length,
    title: fileName.replace(/\.[^/.]+$/, "").replace(/_/g, " "),
    subject: "Toán học",
    totalQuestionsDetected: extractedQuestions.length,
    questions: extractedQuestions,
    hasAnswerKeyTable,
    warningsCount,
    extractedAt: new Date().toISOString(),
  };
}

/**
 * Chuẩn hóa các công thức toán học và dọn dẹp các thẻ HTML dư thừa
 */
export function cleanMathAndHtml(htmlOrText: string): string {
  if (!htmlOrText) return "";

  let cleaned = htmlOrText
    .replace(/<sup>(.*?)<\/sup>/gi, "^{$1}")
    .replace(/<sub>(.*?)<\/sub>/gi, "_{$1}")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<div[^>]*>/gi, "")
    .replace(/<\/div>/gi, "\n")
    .replace(/<td[^>]*>/gi, " ")
    .replace(/<\/td>/gi, " ")
    .replace(/<tr[^>]*>/gi, "")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<table[^>]*>/gi, "")
    .replace(/<\/table>/gi, "\n")
    .replace(/<span[^>]*>/gi, "")
    .replace(/<\/span>/gi, "")
    .replace(/<strong[^>]*>/gi, "")
    .replace(/<\/strong>/gi, "")
    .replace(/<b[^>]*>/gi, "")
    .replace(/<\/b>/gi, "")
    .replace(/<u[^>]*>/gi, "")
    .replace(/<\/u>/gi, "")
    .replace(/<mark[^>]*>/gi, "")
    .replace(/<\/mark>/gi, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

  // Chuyển đổi công thức LaTeX dạng \(...\) sang $...$ và \[...\] sang $$...$$
  cleaned = cleaned.replace(/\\\(([\s\S]*?)\\\)/g, "$$$1$$");
  cleaned = cleaned.replace(/\\\[([\s\S]*?)\\\]/g, "$$$$$1$$$$");

  return cleaned.trim();
}
