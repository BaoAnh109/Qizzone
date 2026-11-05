import type { OptionId } from "./quiz";

/**
 * Bước 13 (PLAN_MAIN, giai đoạn D): Canonical Document IR.
 *
 * IR là dạng trung gian ĐỘC LẬP VỚI NGUỒN (DOCX/PDF/text đều về cùng một
 * dạng block) để các bước sau không phải đoán lại cấu trúc tài liệu từ
 * chuỗi thô:
 * - Mỗi block có loại, vị trí, số câu gốc (sourceNumber) khi đọc được,
 *   định dạng gốc (bold/underline/highlight/marker) và tham chiếu asset.
 * - IR KHÔNG bịa trường nào: block không đọc được số gốc thì sourceNumber
 *   để trống; tài liệu không có phân trang chắc chắn (DOCX) thì page trống.
 * - IR không thay thế parser luật: parser vẫn là nơi quyết định đáp án
 *   theo Priority Waterfall; IR chỉ chuẩn hóa đầu vào (bỏ dòng header lặp,
 *   nhận diện mệnh đề Đúng/Sai, giữ số câu gốc) rồi đưa khối sạch cho
 *   parser — xem `src/services/extraction/documentIR.ts`.
 */

export type IRBlockKind =
  | "question_header" // Dòng mở đầu câu hỏi, vd "Câu 5."
  | "option" // Dòng lựa chọn trắc nghiệm, vd "A. ..."
  | "statement" // Dòng trần "Đúng"/"Sai" (mệnh đề đúng/sai, chưa có nhãn A-D)
  | "answer_key" // Tiêu đề/mục bảng đáp án cuối đề
  | "solution" // Dòng mở đầu lời giải ("Lời giải:", "Hướng dẫn giải:", ...)
  | "repeated_header" // Dòng lặp nguyên văn ở biên các câu (header/footer trang)
  | "text"; // Đoạn còn lại (stem, ghi chú, tiêu đề đề, ...)

/** Định dạng gốc của block, suy từ thẻ HTML/XML nguồn (không phải điểm số). */
export interface IRBlockFormat {
  bold?: boolean;
  underline?: boolean;
  highlight?: boolean;
  marker?: boolean;
}

export interface IRBlock {
  /** Vị trí đoạn trong tài liệu (0-based, theo thứ tự xuất hiện). */
  index: number;
  kind: IRBlockKind;
  /** Text đã dọn HTML/entity (để so sánh và phân loại). */
  text: string;
  /** Đoạn gốc (giữ thẻ HTML để parser giữ được định dạng khi cần). */
  raw: string;
  /** Số câu in trong tài liệu gốc (chỉ có khi kind = question_header). */
  sourceNumber?: number;
  /** Nhãn lựa chọn (chỉ có khi kind = option). */
  optionId?: OptionId;
  /** Trang nguồn khi xác minh được (PDF); DOCX/text để trống, không bịa. */
  page?: number;
  format?: IRBlockFormat;
}

/** Một mục bảng đáp án, key theo SỐ CÂU GỐC (không theo order hiển thị). */
export interface IRAnswerKeyEntry {
  sourceNumber: number;
  answers: OptionId[];
}

export interface IRDocument {
  fileName: string;
  fileType: "docx" | "pdf" | "image" | "text";
  blocks: IRBlock[];
  /** Bảng đáp án theo số câu gốc; rỗng khi tài liệu không có bảng đáp án. */
  answerKey: IRAnswerKeyEntry[];
  /** Các số câu gốc distinct quét được từ các question_header block. */
  detectedHeaders: number[];
  /** Các dòng lặp nguyên văn bị đánh dấu repeated_header. */
  repeatedLines: string[];
}

/**
 * Một câu hỏi sau khi gom block: header + các block thuộc câu đó.
 * `bodyText` là text khối đã dọn (bỏ repeated_header) để đưa vào parser
 * luật hiện tại; `isTrueFalse` cho biết câu là dạng mệnh đề Đúng/Sai
 * (có cả hai statement Đúng và Sai, không có option A-D).
 */
export interface IRQuestionSegment {
  /** Thứ tự hiển thị (theo vị trí xuất hiện, 1-based). */
  order: number;
  /** Số câu gốc trong tài liệu; null khi header không ghi số rõ ràng. */
  sourceNumber: number | null;
  /** Các block thuộc câu (đã bỏ repeated_header). */
  blocks: IRBlock[];
  /** Text khối đã dọn (nối các block.raw bằng xuống dòng). */
  bodyText: string;
  /** true khi câu là dạng mệnh đề Đúng/Sai. */
  isTrueFalse: boolean;
}
