import type { OptionId } from "@/types/quiz";
import type {
  IRAnswerKeyEntry,
  IRBlock,
  IRBlockFormat,
  IRDocument,
  IRQuestionSegment,
} from "@/types/documentIR";

/**
 * Bước 13 (PLAN_MAIN, giai đoạn D): Canonical Document IR — builder và
 * các hàm chuẩn hóa dùng chung.
 *
 * Lớp này KHÔNG quyết định đáp án (việc đó vẫn là Priority Waterfall của
 * ruleExtractor) và KHÔNG tự gán đáp án/option. Nó chỉ:
 * 1. Tách tài liệu thô thành các đoạn (paragraph) giữ nguyên HTML nguồn.
 * 2. Phân loại đoạn: header câu hỏi (kèm số câu gốc), option A-D, mệnh đề
 *    Đúng/Sai trần, tiêu đề bảng đáp án, lời giải, dòng header lặp, text.
 * 3. Phát hiện dòng header lặp ở BIÊN các câu (dòng đứng cuối đoạn câu
 *    hỏi, hoặc đầu/cuối phần mở đầu trước câu đầu tiên, lặp nguyên văn
 *    ≥ 2 lần) để parser bỏ qua thay vì trộn vào option cuối của câu
 *    trước (gap f11 đã đo).
 * 4. Nhận diện khối mệnh đề Đúng/Sai (không có option A-D) để viết lại
 *    thành option A=Đúng, B=Sai theo đúng quy ước schema — giữ nguyên
 *    HTML định dạng bên trong (tô màu → waterfall vẫn bắt được đáp án).
 *
 * Heuristic dòng lặp CỐ TÌNH không xét đoạn ĐẦU thân câu hỏi — đoạn sau
 * header câu thuộc về câu đó. Tiền đề chung lặp nguyên văn ở đầu thân
 * nhiều câu (nhóm câu dùng chung dữ kiện, f16 bước 26) là nội dung câu
 * hỏi, không phải header lặp: bump nó sẽ strip nhầm tiền đề khỏi mọi
 * câu (bước 26 đo được lệch stem 3/3 trước khi sửa). Header/footer chạy
 * suốt tài liệu luôn đứng ở biên CUỐI khối (trước header câu tiếp theo)
 * hoặc trong phần mở đầu, nên chỉ xét hai vị trí đó là đủ cho f11.
 */

// --- Tách đoạn ---------------------------------------------------------------

export interface ParagraphUnit {
  /** Đoạn gốc (giữ thẻ <p>...</p> khi có, để parser giữ định dạng). */
  raw: string;
  /** Text đã dọn thẻ HTML/entity, gộp whitespace (để phân loại/so sánh). */
  text: string;
}

export function cleanParagraphText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tách nội dung thô thành các đoạn: ưu tiên thẻ <p>...</p> (định dạng
 * DOCX AST: các đoạn nối nhau bằng xuống dòng), phần còn lại tách theo
 * dòng. Đoạn rỗng sau khi dọn text bị bỏ (không mang thông tin).
 */
export function splitParagraphUnits(content: string): ParagraphUnit[] {
  const units: ParagraphUnit[] = [];
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  const pushLines = (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      const text = cleanParagraphText(line);
      if (text) units.push({ raw: line, text });
    }
  };
  while ((m = pRe.exec(content)) !== null) {
    pushLines(content.slice(last, m.index));
    const text = cleanParagraphText(m[1]);
    if (text) units.push({ raw: m[0], text });
    last = m.index + m[0].length;
  }
  pushLines(content.slice(last));
  return units;
}

// --- Phân loại đoạn ----------------------------------------------------------

const HEADER_RE =
  /^(?:Câu|Bài|Question|CÂU|BÀI|QUESTION|Q)\s*(\d+)\s*[.:)_-]/i;
const OPTION_RE = /^(?:[*✓•xX()[\]]\s*)?([A-Da-d])\s*[.:)/-](?!\d)/;
const STATEMENT_RE = /^(Đúng|Sai)\.?$/i;
const SOLUTION_RE =
  /^(Lời\s*giải|Hướng\s*dẫn\s*giải|Giải\s*thích|Giải|Explanation)\s*[:-]/i;
const TRAILING_ANSWER_RE =
  /^(Đáp\s*án|ĐA|Answer(?:\s*key)?)\s*[:：\-–—]?\s*[A-D]\s*[.)]?$/i;
const ANSWER_KEY_TITLE_RE =
  /(BẢNG\s+ĐÁP\s+ÁN|ĐÁP\s+ÁN\s+ĐỀ\s+THI|ĐÁP\s+ÁN\s+CHI\s+TIẾT|HƯỚNG\s+DẪN\s+CHẤM|PHIẾU\s+TRẢ\s+LỜI|ANSWER\s+KEY|BẢNG\s+CHỌN\s+ĐÁP\s+ÁN)/i;

export function parseHeaderNumber(text: string): number | null {
  const m = text.match(HEADER_RE);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n > 0 && n <= 300 ? n : null;
}

function detectFormat(raw: string, text: string): IRBlockFormat | undefined {
  const format: IRBlockFormat = {};
  if (/<strong[\s>]|<b[\s>]|\*\*[^*]+\*\*/i.test(raw)) format.bold = true;
  if (/<u[\s>]|is-underline|text-decoration:\s*underline/i.test(raw))
    format.underline = true;
  if (
    /<mark[\s>]|is-highlighted|background(?:-color)?:\s*(?:yellow|#ff|rgba)/i.test(
      raw
    )
  )
    format.highlight = true;
  if (/^[*✓•]\s*/.test(text)) format.marker = true;
  return Object.keys(format).length > 0 ? format : undefined;
}

/**
 * Một dòng có phải ứng viên "header lặp" không: đủ dài, không phải câu
 * hỏi (không kết thúc bằng "?"), không phải header/option/mệnh đề/lời
 * giải/dòng đáp án/tiêu đề bảng đáp án. Các loại bị loại trừ ở đây đều
 * là nội dung hợp lệ có thể lặp (vd "Đúng"/"Sai" lặp ở mọi câu Đúng/Sai,
 * "Đáp án: A" lặp ở nhiều câu) nên không bao giờ được coi là header lặp.
 * OPTION_RE chấp nhận cả marker thường a–d (sau MVP): option cuối "d.
 * Toàn vẹn" lặp ở nhiều câu mà bị bump thì strip sẽ cắt mất đáp án D
 * thật của câu hỏi (đo được trên file ATTT: 6 câu MC mất option D).
 */
function isRepeatedHeaderCandidate(text: string): boolean {
  if (text.length < 4) return false;
  if (text.endsWith("?")) return false;
  if (HEADER_RE.test(text)) return false;
  if (OPTION_RE.test(text)) return false;
  if (STATEMENT_RE.test(text)) return false;
  if (SOLUTION_RE.test(text)) return false;
  if (TRAILING_ANSWER_RE.test(text)) return false;
  if (ANSWER_KEY_TITLE_RE.test(text)) return false;
  return true;
}

/**
 * Thu thập các dòng header lặp từ các nhóm đoạn (nhóm đầu = phần mở đầu
 * trước câu đầu tiên, các nhóm sau = từng khối câu hỏi): chỉ xét đoạn
 * ĐẦU và CUỐI của nhóm mở đầu, và đoạn CUỐI của mỗi khối câu hỏi — vì
 * header/footer trang luôn đứng ở biên cuối khối (trước header câu tiếp
 * theo, tức cuối khối câu trước). Dòng lặp nguyên văn ≥ 2 lần ở các vị
 * trí đó mới được coi là header lặp.
 *
 * CỐ TÌNH KHÔNG xét đoạn ĐẦU của khối câu hỏi (bước 26, f16): đoạn sau
 * header câu thuộc về câu đó — tiền đề chung lặp ở đầu thân nhiều câu
 * là nội dung câu hỏi, bump nó sẽ strip nhầm tiền đề khỏi mọi câu.
 * Trường hợp duy nhất mất đi là header đứng ngay sau header câu (hiếm
 * trong DOCX body vì header trang nằm ở part riêng, parser AST không đọc;
 * PDF đã có cleanPdfPages gỡ header/footer theo vị trí trang).
 */
export function collectRepeatedHeaderLines(
  groups: ParagraphUnit[][]
): Set<string> {
  const counts = new Map<string, number>();
  const bump = (text: string) => {
    if (isRepeatedHeaderCandidate(text)) {
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }
  };
  groups.forEach((group, groupIndex) => {
    if (group.length === 0) return;
    if (groupIndex === 0) {
      bump(group[0].text);
      if (group.length > 1) bump(group[group.length - 1].text);
    } else {
      // Khối câu hỏi: chỉ bump đoạn cuối. Nhóm 1 đoạn thì đoạn đó vừa
      // là đầu vừa là cuối — bump một lần như hành vi cũ (không đổi).
      bump(group[group.length - 1].text);
    }
  });
  const out = new Set<string>();
  for (const [text, count] of counts) {
    if (count >= 2) out.add(text);
  }
  return out;
}

function classifyUnit(
  unit: ParagraphUnit,
  index: number,
  repeated: ReadonlySet<string>
): IRBlock {
  const { raw, text } = unit;
  const format = detectFormat(raw, text);
  const base: IRBlock = { index, kind: "text", text, raw, format };
  if (repeated.has(text)) return { ...base, kind: "repeated_header" };
  const headerNumber = parseHeaderNumber(text);
  if (headerNumber !== null) {
    return { ...base, kind: "question_header", sourceNumber: headerNumber };
  }
  const optionMatch = text.match(OPTION_RE);
  if (optionMatch) {
    return {
      ...base,
      kind: "option",
      optionId: optionMatch[1].toUpperCase() as OptionId,
    };
  }
  if (STATEMENT_RE.test(text)) return { ...base, kind: "statement" };
  if (ANSWER_KEY_TITLE_RE.test(text)) return { ...base, kind: "answer_key" };
  if (SOLUTION_RE.test(text)) return { ...base, kind: "solution" };
  return base;
}

/**
 * Xây IR từ nội dung thô. `answerKey` (nếu caller đã quét được, vd
 * ruleExtractor quét bảng đáp án) được đưa vào theo số câu gốc; không
 * truyền thì IR để trống chứ không tự quét lại (tránh hai nguồn sự thật).
 */
export function buildDocumentIR(
  rawContent: string,
  meta: { fileName: string; fileType: IRDocument["fileType"] },
  answerKey?: Record<number, OptionId>
): IRDocument {
  const units = splitParagraphUnits(rawContent);
  // Nhóm đoạn theo header câu hỏi để phát hiện header lặp ở biên khối.
  const groups: ParagraphUnit[][] = [];
  let current: ParagraphUnit[] = [];
  for (const unit of units) {
    if (parseHeaderNumber(unit.text) !== null) {
      groups.push(current);
      current = [unit];
    } else {
      current.push(unit);
    }
  }
  groups.push(current);
  const repeated = collectRepeatedHeaderLines(groups);

  const blocks = units.map((unit, index) =>
    classifyUnit(unit, index, repeated)
  );
  const detectedHeaders = Array.from(
    new Set(
      blocks
        .filter(
          (b): b is IRBlock & { sourceNumber: number } =>
            b.kind === "question_header" && b.sourceNumber !== undefined
        )
        .map((b) => b.sourceNumber)
    )
  ).sort((a, b) => a - b);

  const answerKeyEntries: IRAnswerKeyEntry[] = answerKey
    ? Object.entries(answerKey)
        .map(([k, v]) => ({
          sourceNumber: Number(k),
          answers: [v],
        }))
        .filter((e) => e.sourceNumber > 0)
        .sort((a, b) => a.sourceNumber - b.sourceNumber)
    : [];

  return {
    fileName: meta.fileName,
    fileType: meta.fileType,
    blocks,
    answerKey: answerKeyEntries,
    detectedHeaders,
    repeatedLines: Array.from(repeated).sort(),
  };
}

// --- Gom block thành câu hỏi -------------------------------------------------

/**
 * Gom các block IR thành từng câu hỏi: header mở đầu một câu; các block
 * sau thuộc câu đó cho tới header tiếp theo hoặc tới tiêu đề bảng đáp
 * án (phần sau bảng đáp án không còn là câu hỏi). Block repeated_header
 * bị bỏ khỏi mọi câu. Tài liệu không có header nào → một segment duy
 * nhất chứa toàn bộ block (khớp fallback của parser luật).
 */
export function groupIRQuestions(ir: IRDocument): IRQuestionSegment[] {
  const segments: IRQuestionSegment[] = [];
  let current: IRBlock[] = [];
  let currentSource: number | null = null;
  let inAnswerKey = false;
  // Phần mở đầu trước header đầu tiên (tiêu đề đề, hướng dẫn...) không
  // phải là câu hỏi — chỉ khi tài liệu KHÔNG có header nào thì toàn bộ
  // mới thành một segment duy nhất (khớp fallback của parser luật).
  let started = false;

  const flush = () => {
    if (!started || current.length === 0) return;
    const hasDung = current.some(
      (b) => b.kind === "statement" && /^Đúng\.?$/i.test(b.text)
    );
    const hasSai = current.some(
      (b) => b.kind === "statement" && /^Sai\.?$/i.test(b.text)
    );
    const hasOption = current.some((b) => b.kind === "option");
    segments.push({
      order: segments.length + 1,
      sourceNumber: currentSource,
      blocks: [...current],
      // bodyText bỏ block header đầu (parser luật cũng tách header riêng
      // khỏi thân câu); segment không header thì giữ toàn bộ.
      bodyText: current
        .filter((b, i) => !(i === 0 && b.kind === "question_header"))
        .map((b) => b.raw)
        .join("\n"),
      isTrueFalse: hasDung && hasSai && !hasOption,
    });
    current = [];
    currentSource = null;
  };

  for (const block of ir.blocks) {
    if (block.kind === "repeated_header") continue;
    if (block.kind === "answer_key") {
      inAnswerKey = true;
      flush();
      continue;
    }
    if (inAnswerKey) continue;
    if (block.kind === "question_header") {
      flush();
      started = true;
      currentSource = block.sourceNumber ?? null;
      current = [block];
      continue;
    }
    if (started) current.push(block);
  }
  flush();
  if (segments.length === 0) {
    // Không có header nào: toàn bộ tài liệu (trừ repeated_header) là một
    // segment duy nhất, sourceNumber null — khớp fallback của parser.
    const blocks = ir.blocks.filter((b) => b.kind !== "repeated_header");
    if (blocks.length > 0) {
      const hasDung = blocks.some(
        (b) => b.kind === "statement" && /^Đúng\.?$/i.test(b.text)
      );
      const hasSai = blocks.some(
        (b) => b.kind === "statement" && /^Sai\.?$/i.test(b.text)
      );
      const hasOption = blocks.some((b) => b.kind === "option");
      segments.push({
        order: 1,
        sourceNumber: null,
        blocks,
        bodyText: blocks.map((b) => b.raw).join("\n"),
        isTrueFalse: hasDung && hasSai && !hasOption,
      });
    }
  }
  return segments;
}

// --- Chuẩn hóa dùng cho live path (ruleExtractor) -----------------------------

/**
 * Bỏ các đoạn có text nằm trong tập dòng lặp khỏi nội dung thô (nối lại
 * bằng xuống dòng — đúng định dạng parser vẫn đọc: <p>...</p> hoặc dòng).
 */
export function stripRepeatedParagraphs(
  content: string,
  repeatedLines: ReadonlySet<string>
): string {
  if (repeatedLines.size === 0) return content;
  const units = splitParagraphUnits(content);
  return units
    .filter((u) => !repeatedLines.has(u.text))
    .map((u) => u.raw)
    .join("\n");
}

/**
 * Viết lại khối mệnh đề Đúng/Sai thành option A/B: chỉ khi khối có đúng
 * một dòng "Đúng" và một dòng "Sai" và KHÔNG có option A-D nào. HTML bên
 * trong đoạn được giữ nguyên (tô màu → waterfall bắt được đáp án), chỉ
 * thêm tiền tố "A. "/"B. " theo quy ước schema (Đúng=A, Sai=B). Vị trí
 * các dòng giữ nguyên (không sắp xếp lại) — option mang đúng ID nên
 * thứ tự hiển thị không ảnh hưởng đáp án.
 */
export function synthesizeTrueFalseBlock(bodyText: string): {
  text: string;
  synthesized: boolean;
} {
  const units = splitParagraphUnits(bodyText);
  const dungIndexes: number[] = [];
  const saiIndexes: number[] = [];
  let hasOption = false;
  units.forEach((u, i) => {
    if (/^Đúng\.?$/i.test(u.text)) dungIndexes.push(i);
    else if (/^Sai\.?$/i.test(u.text)) saiIndexes.push(i);
    else if (OPTION_RE.test(u.text)) hasOption = true;
  });
  if (hasOption || dungIndexes.length !== 1 || saiIndexes.length !== 1) {
    return { text: bodyText, synthesized: false };
  }
  const rewrite = (unit: ParagraphUnit, label: string): string => {
    const pMatch = unit.raw.match(/^<p[^>]*>([\s\S]*)<\/p>$/i);
    if (pMatch) {
      const openTag = unit.raw.slice(0, unit.raw.indexOf(">") + 1);
      return `${openTag}${label}. ${pMatch[1]}</p>`;
    }
    return `${label}. ${unit.raw}`;
  };
  const rewritten = units.map((u, i) => {
    if (i === dungIndexes[0]) return rewrite(u, "A");
    if (i === saiIndexes[0]) return rewrite(u, "B");
    return u.raw;
  });
  return { text: rewritten.join("\n"), synthesized: true };
}
