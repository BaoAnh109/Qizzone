import type { OptionId } from "@/types/quiz";
import type {
  DetectionStrategy,
  ExtractedOption,
  ExtractedQuestion,
  ExtractionResult,
} from "@/types/extractor";

/**
 * Nhận diện dòng đáp án nằm ở cuối từng câu hỏi, ví dụ: "Đáp án: A".
 *
 * Pattern cho phép dữ liệu đến từ cả Direct OpenXML AST (HTML theo đoạn) và
 * Mammoth fallback (text có xuống dòng), đồng thời chịu được thẻ định dạng
 * bao quanh nhãn hoặc chữ cái đáp án.
 */
const TRAILING_ANSWER_PATTERN =
  /((?:^|<p[^>]*>|<div[^>]*>|<li[^>]*>|<br\s*\/?>|\r?\n)\s*)(?:<[^>]*>\s*)*(?:Đáp\s*án|ĐA|Answer(?:\s*key)?)\s*[:：\-–—]?\s*(?:<[^>]*>\s*)*([A-D])\s*(?:[.)])?\s*(?:<\/[^>]*>\s*)*$/iu;

/**
 * Lấy đáp án từ dòng cuối câu hỏi nếu tài liệu ghi rõ "Đáp án: A".
 */
export function extractTrailingAnswer(rawBlock: string): OptionId | undefined {
  const match = rawBlock.match(TRAILING_ANSWER_PATTERN);
  const answer = match?.[2]?.toUpperCase() as OptionId | undefined;

  return answer && ["A", "B", "C", "D"].includes(answer)
    ? answer
    : undefined;
}

/**
 * Bỏ dòng đáp án cuối câu khỏi vùng dùng để tách nội dung các lựa chọn.
 */
function removeTrailingAnswer(rawBlock: string): string {
  return rawBlock.replace(TRAILING_ANSWER_PATTERN, "$1").trim();
}

/**
 * Phân tích bảng đáp án ở cuối đề thi (Answer Key Table / Grid)
 * Chỉ kích hoạt khi có khu vực tiêu đề bảng đáp án rõ ràng (BẢNG ĐÁP ÁN, ĐÁP ÁN, HƯỚNG DẪN CHẤM,...)
 */
export function extractAnswerKeyTable(rawText: string, conflictSink?: Record<number, OptionId[]>): Record<number, OptionId> {
  const answerMap: Record<number, OptionId> = {};
  const candidates: Record<number, Set<OptionId>> = {};
  const recordAnswer = (questionNumber: number, answer: OptionId) => {
    candidates[questionNumber] ??= new Set<OptionId>();
    candidates[questionNumber].add(answer);
    answerMap[questionNumber] ??= answer;
  };

  // Tìm khu vực bảng đáp án ở cuối đề nếu có (phải là tiêu đề rõ ràng hoặc có dấu hai chấm)
  const tableSectionMatch = rawText.match(
    /(?:^|[\n\r]|<p[^>]*>|<div[^>]*>|<h\d[^>]*>)\s*(?:<[^>]*>)*\s*(?:BẢNG\s+ĐÁP\s+ÁN|ĐÁP\s*ÁN(?=\s*(?:<\/[^>]*>\s*)*(?:\r?\n|$))|ĐÁP\s+ÁN\s*[:-]|\b(?:ĐÁP\s+ÁN\s+ĐỀ\s+THI|ĐÁP\s+ÁN\s+CHI\s+TIẾT|HƯỚNG\s+DẪN\s+CHẤM|PHIẾU\s+TRẢ\s+LỜI|ANSWER\s+KEY|KEY\s+ĐÁP\s+ÁN|BẢNG\s+CHỌN\s+ĐÁP\s+ÁN)\b)[\s\S]*$/i
  );

  // Bắt buộc phải có phần tiêu đề bảng đáp án mới quét (tránh nhận diện nhầm số trong đề bài)
  if (!tableSectionMatch) {
    return answerMap;
  }

  const textToScan = tableSectionMatch[0];

  // Một dòng "Đáp án: A" ở cuối từng câu cũng khớp tiền tố "ĐÁP ÁN:" ở
  // trên, nhưng đó không phải bảng đáp án chung. Bỏ qua section kiểu này để
  // parser không cắt toàn bộ đề ngay từ câu đầu tiên.
  const firstSectionLine = cleanMathAndHtml(textToScan)
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .find(Boolean);
  if (firstSectionLine && /^Đáp\s*án\s*[:：\-–—]\s*[A-D]$/iu.test(firstSectionLine)) {
    return answerMap;
  }

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
            recordAnswer(qNum, ans);
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
          recordAnswer(qNum, ans);
        }
      }
    }
  }

  // Bỏ HTML trước khi quét để xử lý nhất quán cả DOCX AST và văn bản thường.
  // Hỗ trợ các dấu bọc/đánh dấu thường gặp: [A], (A), ✓ A, → B, ★ C, “Đáp án C”.
  const answerText = cleanMathAndHtml(textToScan);
  const pairRegexes = [
    /(?:Câu|Question|Bài|Q)\s*(\d{1,3})\s*[:.)-]\s*(?:(?:Đáp\s*án|Answer)\s*[:：-]?\s*)?(?:[✓✔★*→➜➤➔]\s*)*(?:\[|\()?\s*([A-D])\s*(?:\]|\))?(?=$|[\s,;.])/gim,
    /\b(\d{1,3})\s*(?:[.:)-]\s*)?(?:(?:Đáp\s*án|Answer)\s*[:：-]?\s*)?(?:[✓✔★*→➜➤➔]\s*)*(?:\[|\()?\s*([A-D])\s*(?:\]|\))?(?=$|[\s,;.])/gi,
  ];

  for (const regex of pairRegexes) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(answerText)) !== null) {
      const questionNum = parseInt(match[1], 10);
      const answer = match[2].toUpperCase() as OptionId;
      if (questionNum > 0 && questionNum <= 300 && ["A", "B", "C", "D"].includes(answer)) {
        recordAnswer(questionNum, answer);
      }
    }
  }

  if (conflictSink) {
    for (const [questionNumber, answers] of Object.entries(candidates)) {
      if (answers.size > 1) conflictSink[Number(questionNumber)] = [...answers];
    }
  }
  return answerMap;
}

/**
 * Some true/false PDFs print the two choices as standalone lines without A/B
 * labels. Add stable internal labels only after confirming that both sides of
 * the pair are present; the source wording remains unchanged.
 */
function labelStandaloneTrueFalseOptions(questionBlockText: string): string | undefined {
  const candidates: Array<{ index: number; value: "true" | "false" }> = [];
  const lines = questionBlockText.split(/(?<=\n)/);
  let offset = 0;

  for (const segment of lines) {
    const rawLine = segment.replace(/[\r\n]+$/, "");
    const plainLine = cleanMathAndHtml(rawLine).trim().toLocaleLowerCase("vi");
    const value = plainLine === "đúng" || plainLine === "true"
      ? "true"
      : plainLine === "sai" || plainLine === "false"
        ? "false"
        : undefined;
    if (value) candidates.push({ index: offset, value });
    offset += segment.length;
  }

  const trueOptions = candidates.filter(candidate => candidate.value === "true");
  const falseOptions = candidates.filter(candidate => candidate.value === "false");
  if (trueOptions.length !== 1 || falseOptions.length !== 1) return undefined;

  const sourceOrdered = [...candidates].sort((a, b) => a.index - b.index);
  let normalized = questionBlockText;
  for (const [position, candidate] of [...sourceOrdered.entries()].reverse()) {
    const label = position === 0 ? "A. " : "B. ";
    normalized = normalized.slice(0, candidate.index) + label + normalized.slice(candidate.index);
  }
  return normalized;
}

function joinWrappedQuestionText(text: string): string {
  return text
    .replace(/[\t ]*\r?\n[\t ]*/g, " ")
    .replace(/[\t ]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

/**
 * Tách nội dung câu hỏi và các lựa chọn A, B, C, D một cách chuẩn xác từ khối văn bản
 */
export function splitOptionsFromBlock(questionBlockText: string): {
  questionPrompt: string;
  options: ExtractedOption[];
} {
  const labeledBinaryBlock = labelStandaloneTrueFalseOptions(questionBlockText);
  if (labeledBinaryBlock) return splitOptionsFromBlock(labeledBinaryBlock);

  // Regex tìm các đáp án A, B, C, D (chữ HOA [A-D], tránh nhầm với từ thường như "công.", "bộ.")
  const headerRegex =
    /(?:^|[\n\r]|<p[^>]*>|<div[^>]*>|<li[^>]*>|<td[^>]*>|\t|\s{2,}|(?<=[.;!?)])\s+)(?:<[^>]*>)*\s*([*✓•xX()[\]])?\s*(?:<[^>]*>)*\s*([A-D]|[①②③④])\s*([*✓])?\s*([.:)/-])?(?![\p{L}\p{N}])/giu;

  const matches: Array<{
    index: number;
    letter: OptionId;
    marker?: string;
    headerLength: number;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = headerRegex.exec(questionBlockText)) !== null) {
    if (!match[4] && !/[①②③④]/.test(match[2])) continue;
    const marker = match[1] || match[3] || undefined;
    const rawLetter = match[2].toUpperCase();
    const letter = (rawLetter === "①" ? "A" : rawLetter === "②" ? "B" : rawLetter === "③" ? "C" : rawLetter === "④" ? "D" : rawLetter) as OptionId;
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
  const questionPrompt = joinWrappedQuestionText(cleanMathAndHtml(
    questionBlockText.substring(0, firstMatch.index)
  ));

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
      /[*✓]\s*[A-D]/i.test(rawSlice);

    // Bỏ phần chữ cái "A.", "B." ở đầu để lấy nội dung đáp án
    const contentWithoutHeader = rawSlice.replace(
      /^(?:[\s\n\r]|<[^>]*>|[*✓•[\]xX()])*(?:[A-D]|[①②③④])\s*[.:)/-]?(?:<\/[^>]*>)*/i,
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

  // Đọc đáp án được ghi rõ ở cuối câu hỏi trước khi tách option, để dòng
  // "Đáp án: A" không bị dính vào nội dung lựa chọn D.
  const trailingAnswer = extractTrailingAnswer(questionAndOptionsText);
  if (trailingAnswer) {
    questionAndOptionsText = removeTrailingAnswer(questionAndOptionsText);
  }

  // Tách câu hỏi và options
  const { questionPrompt, options } = splitOptionsFromBlock(questionAndOptionsText);

  // Evidence-first: không tạo phương án giả khi tài liệu chỉ có 2–4 lựa chọn.
  // Nếu chưa nhận diện đủ 2 phương án, giữ nguyên dữ liệu để người dùng sửa hoặc AI fallback.
  if (options.length < 2) {
    warningFlags.push("Không xác định đủ 2 phương án từ tài liệu; cần kiểm tra hoặc AI fallback");
  }
  if (options.some(option => !option.content.trim())) {
    warningFlags.push("Có phương án rỗng; cần kiểm tra nội dung gốc");
  }

  // -------------------------------------------------------------
  // THUẬT TOÁN PRIORITY WATERFALL XÁC ĐỊNH ĐÁP ÁN ĐÚNG
  // -------------------------------------------------------------
  let correctAnswers: OptionId[] = [];
  let detectionStrategy: DetectionStrategy = "unknown";
  let confidenceScore = 0.85;

  // Chiến lược 1: Bảng đáp án cuối đề (Answer Key Table) -> 99%
  if (tableAnswer && ["A", "B", "C", "D"].includes(tableAnswer) && options.some(option => option.id === tableAnswer)) {
    correctAnswers = [tableAnswer];
    detectionStrategy = "answer_table";
    confidenceScore = 0.99;
  }

  // Chiến lược 2: Dòng đáp án ở cuối câu ("Đáp án: A") -> 99%
  if (correctAnswers.length === 0 && trailingAnswer && options.some(option => option.id === trailingAnswer)) {
    correctAnswers = [trailingAnswer];
    detectionStrategy = "answer_at_end";
    confidenceScore = 0.99;
  }

  // Chiến lược 3: Ký hiệu tiền tố đặc biệt (*A, ✓A, [x]) -> 98%
  if (correctAnswers.length === 0) {
    const markerOptions = options.filter((opt) => opt.hasSpecialMarker);
    if (markerOptions.length) {
      correctAnswers = markerOptions.map(option => option.id);
      detectionStrategy = "special_marker";
      confidenceScore = 0.98;
    }
  }

  // Chiến lược 4: Định dạng gạch chân (Underline <u>A.</u>) -> 95%
  if (correctAnswers.length === 0) {
    const underlineOptions = options.filter((opt) => opt.isUnderline);
    if (underlineOptions.length) {
      correctAnswers = underlineOptions.map(option => option.id);
      detectionStrategy = "underline";
      confidenceScore = 0.95;
    }
  }

  // Chiến lược 5: Tô màu Highlight / Chữ đỏ -> 95%
  if (correctAnswers.length === 0) {
    const highlightOptions = options.filter((opt) => opt.isHighlighted);
    if (highlightOptions.length) {
      correctAnswers = highlightOptions.map(option => option.id);
      detectionStrategy = "highlight_color";
      confidenceScore = 0.95;
    }
  }

  // Chiến lược 6: In đậm duy nhất (Distinct Bold <b>A.</b>) -> 90%
  const boldOptions = options.filter((opt) => opt.isBold);
  if (correctAnswers.length === 0) {
    if (boldOptions.length === 1 && options.some((opt) => !opt.isBold)) {
      correctAnswers = [boldOptions[0].id];
      detectionStrategy = "distinct_bold";
      confidenceScore = 0.9;
    }
  }

  // Chiến lược 7: Trích xuất từ Lời giải chi tiết ("Chọn A", "Đáp án A") -> 88%
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

  const allEvidence: Array<{ kind: DetectionStrategy; optionIds: OptionId[]; ruleId: string }> = [];
  const addEvidence = (kind: DetectionStrategy, ids: OptionId[], ruleId: string) => {
    const validIds = [...new Set(ids)].filter(id => options.some(option => option.id === id));
    if (validIds.length) allEvidence.push({ kind, optionIds: validIds, ruleId });
  };
  if (tableAnswer) addEvidence("answer_table", [tableAnswer], "answer_key_mapping_v1");
  if (trailingAnswer) addEvidence("answer_at_end", [trailingAnswer], "explicit_answer_line_v1");
  addEvidence("special_marker", options.filter(option => option.hasSpecialMarker).map(option => option.id), "option_marker_v1");
  addEvidence("underline", options.filter(option => option.isUnderline).map(option => option.id), "option_underline_v1");
  addEvidence("highlight_color", options.filter(option => option.isHighlighted).map(option => option.id), "option_highlight_or_color_v1");
  const explanationEvidence = explanation?.match(
    /(?:Chọn|Đáp\s*án(?:\s*đúng)?|Câu\s*trả\s*lời(?:\s*là)?|Suy\s*ra(?:\s*chọn)?|Do\s*đó(?:\s*chọn)?)[\s.:\->]*([A-D])\b/i
  );
  if (explanationEvidence) {
    addEvidence("explanation_text", [explanationEvidence[1].toUpperCase() as OptionId], "explicit_explanation_choice_v1");
  }
  if (boldOptions.length === 1 && options.some(option => !option.isBold)) {
    addEvidence("distinct_bold", [boldOptions[0].id], "unique_bold_among_options_v1");
  }
  const evidenceAnswers = new Set(allEvidence.map(item => [...item.optionIds].sort().join(",")));
  const answerIsAmbiguous = evidenceAnswers.size > 1;
  if (answerIsAmbiguous) {
    correctAnswers = [];
    detectionStrategy = "unknown";
    confidenceScore = 0;
    warningFlags.push("Bằng chứng đáp án trong tài liệu mâu thuẫn; cần giáo viên xác nhận");
  }

  // Chiến lược 8: Không tìm thấy đáp án đánh dấu trong tài liệu
  if (correctAnswers.length === 0) {
    correctAnswers = []; // Để rỗng: KHÔNG tự ý gán bừa đáp án A
    detectionStrategy = "unknown";
    confidenceScore = 0.0;
    if (!answerIsAmbiguous) warningFlags.push("Chưa có đáp án (chưa tìm thấy bằng chứng trong tài liệu)");
  }

  const tempId = `ext-${order}-${Date.now().toString(36)}`;

  return {
    id: `q-ext-${order}`,
    tempId,
    order,
    content: questionPrompt,
    options,
    correctAnswers,
    explanation,
    points: 1,
    confidenceScore,
    detectionStrategy,
    answerStatus: answerIsAmbiguous ? "ambiguous" : correctAnswers.length ? "evidence_supported" : "unknown",
    answerEvidence: allEvidence,
    reviewStatus: "pending",
    warningFlags: warningFlags.length > 0 ? warningFlags : undefined,
    rawTextSegment: rawBlock.substring(0, 1500),
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
  const scannedAnswerKeyConflicts: Record<number, OptionId[]> = {};
  const scannedAnswerKey = extractAnswerKeyTable(rawContent, scannedAnswerKeyConflicts);
  const answerKeyConflicts = { ...scannedAnswerKeyConflicts };
  for (const [questionNumber, scannedAnswer] of Object.entries(scannedAnswerKey)) {
    const initialAnswer = options?.initialAnswerKey?.[Number(questionNumber)];
    if (initialAnswer && initialAnswer !== scannedAnswer) {
      answerKeyConflicts[Number(questionNumber)] = [...new Set([initialAnswer, scannedAnswer])];
    }
  }
  const globalAnswerKey = { ...(options?.initialAnswerKey || {}), ...scannedAnswerKey };
  for (const questionNumber of Object.keys(answerKeyConflicts)) delete globalAnswerKey[Number(questionNumber)];
  const hasAnswerKeyTable = Object.keys(globalAnswerKey).length > 0 || Object.keys(answerKeyConflicts).length > 0;

  // Cắt bỏ phần bảng đáp án khỏi nội dung bóc tách câu hỏi CHỈ KHI thực sự quét được bảng đáp án (>= 2 câu)
  let contentToScan = rawContent;
  if (Object.keys(scannedAnswerKey).length > 0 || Object.keys(answerKeyConflicts).length > 0) {
    const tableSectionMatch = rawContent.match(
      /(?:^|[\n\r]|<p[^>]*>|<div[^>]*>|<h\d[^>]*>)\s*(?:<[^>]*>)*\s*(?:BẢNG\s+ĐÁP\s+ÁN|ĐÁP\s*ÁN(?=\s*(?:<\/[^>]*>\s*)*(?:\r?\n|$))|ĐÁP\s+ÁN\s*[:-]|\b(?:ĐÁP\s+ÁN\s+ĐỀ\s+THI|ĐÁP\s+ÁN\s+CHI\s+TIẾT|HƯỚNG\s+DẪN\s+CHẤM|PHIẾU\s+TRẢ\s+LỜI|ANSWER\s+KEY|KEY\s+ĐÁP\s+ÁN|BẢNG\s+CHỌN\s+ĐÁP\s+ÁN)\b)[\s\S]*$/i
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
    sourceOrder: number;
  }

  const boundaries: Boundary[] = [];
  let headerMatch: RegExpExecArray | null;

  while ((headerMatch = questionHeaderRegex.exec(contentToScan)) !== null) {
    const rawNum =
      headerMatch[1] || headerMatch[2] || headerMatch[3] || headerMatch[4];
    const explicitOrder = parseInt(rawNum, 10);
    const sourceOrder = !isNaN(explicitOrder)
      ? explicitOrder
      : boundaries.length + 1;

    // Bỏ qua nếu là số thứ tự không hợp lý (ví dụ số năm 2024 hoặc quá lớn)
    if (sourceOrder > 0 && sourceOrder <= 300) {
      boundaries.push({
        startIndex: headerMatch.index,
        headerLength: headerMatch[0].length,
        sourceOrder,
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
        // Số hiển thị luôn theo vị trí xuất hiện. Điều này giữ lại toàn bộ
        // câu hỏi khi file lặp header (ví dụ Câu 51 đến Câu 150 lần hai),
        // đồng thời đổi chúng thành Câu 151 đến Câu 250.
        const normalizedOrder = i + 1;
        const parsed = parseSingleQuestionBlock(
          blockBody,
          normalizedOrder,
          globalAnswerKey[current.sourceOrder]
        );
        if (parsed) {
          const conflictingAnswers = answerKeyConflicts[current.sourceOrder];
          if (conflictingAnswers) {
            parsed.correctAnswers = [];
            parsed.answerStatus = "ambiguous";
            parsed.detectionStrategy = "unknown";
            parsed.confidenceScore = 0;
            parsed.warningFlags = [...new Set([...(parsed.warningFlags || []), "Bảng đáp án có nhiều giá trị mâu thuẫn; cần giáo viên xác nhận"])];
            parsed.answerEvidence = [
              ...(parsed.answerEvidence || []),
              { kind: "answer_table", optionIds: conflictingAnswers, ruleId: "conflicting_answer_key_entries_v1" },
            ];
          }
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

  // Cân bằng điểm số đều cho các câu (Tổng 10 điểm, độ chính xác cao tránh sai số làm tròn)
  const totalPoints = 10;
  const count = extractedQuestions.length || 1;
  const pointsPerQuestion = count > 0 ? totalPoints / count : 1;

  extractedQuestions.forEach((q) => {
    q.points = pointsPerQuestion;
  });

  const warningsCount = extractedQuestions.reduce(
    (sum, q) => sum + (q.warningFlags?.length || 0),
    0
  );
  const sourceQuestionNumbers = boundaries.map(boundary => boundary.sourceOrder);
  const qualityFlags: string[] = [];
  if (boundaries.length && extractedQuestions.length !== boundaries.length) qualityFlags.push("question_count_mismatch");
  if (sourceQuestionNumbers.some((number, index) => index > 0 && number !== sourceQuestionNumbers[index - 1] + 1)) {
    qualityFlags.push("question_number_gap_or_duplicate");
  }
  if (extractedQuestions.some(question => question.options.length < 2 || question.options.length > 4 || question.options.some(option => !option.content.trim()))) {
    qualityFlags.push("invalid_option_structure");
  }
  if (extractedQuestions.some(question => question.answerStatus === "ambiguous")) qualityFlags.push("answer_evidence_conflict");
  if (Object.keys(answerKeyConflicts).length) qualityFlags.push("answer_key_table_conflict");
  if (extractedQuestions.some(question => question.answerStatus === "unknown")) qualityFlags.push("answer_evidence_missing");
  const expectedQuestions = boundaries.length || extractedQuestions.length;

  return {
    schemaVersion: "2.0",
    extractionMethod: "native_parser",
    fileName,
    fileType,
    fileSize: rawContent.length,
    title: fileName.replace(/\.[^/.]+$/, "").replace(/_/g, " "),
    subject: "",
    totalQuestionsDetected: extractedQuestions.length,
    questions: extractedQuestions,
    hasAnswerKeyTable,
    warningsCount,
    qualityFlags,
    coverage: {
      expectedQuestions,
      extractedQuestions: extractedQuestions.length,
      sourceQuestionNumbers,
    },
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
