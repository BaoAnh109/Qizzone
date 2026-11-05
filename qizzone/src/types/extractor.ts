import type { OptionId, QuestionType } from "./quiz";

export type DetectionStrategy =
  | "answer_table"     // Bảng đáp án cuối đề (1.A 2.B 3.C)
  | "answer_at_end"    // Dòng cuối mỗi câu: "Đáp án: A"
  | "special_marker"   // Ký hiệu tiền tố (*A, ✓A, [x])
  | "underline"        // Gạch chân <u>A.</u> hoặc <w:u>
  | "highlight_color"  // Tô màu highlight hoặc chữ màu đỏ
  | "distinct_bold"    // In đậm duy nhất <b>A.</b>
  | "explanation_text" // Trích xuất từ lời giải "Chọn A vì..."
  | "ai_inference"     // AI Gemini tự suy luận và gợi ý
  | "manual";          // Giáo viên tự chọn thủ công

export interface ExtractedOption {
  id: OptionId;
  content: string; // Nội dung đã chuẩn hóa KaTeX
  rawContent: string;
  isUnderline?: boolean;
  isBold?: boolean;
  isHighlighted?: boolean;
  hasSpecialMarker?: boolean;
  textColor?: string;
}

export interface ExtractedQuestion {
  id: string;
  tempId: string;
  order: number;
  /**
   * Bước 13: số câu in trong tài liệu gốc (vd "Câu 5" → 5). Vắng mặt =
   * parser không giữ được số gốc (đường fallback không có header, hoặc
   * câu tạo tay) — KHÔNG được suy ra từ order (f12: header 2/5/9/14 →
   * order 1–4). Dùng để nối bảng đáp án theo số gốc ở Quality Gate.
   */
  sourceNumber?: number;
  /**
   * Bước 15: số trang nguồn (1-based) chứa thân câu hỏi, chỉ PDF parser
   * điền (từ text layer). Vắng mặt = không xác định được trang (DOCX
   * không có phân trang chắc chắn, câu từ fallback, hoặc stem không
   * khớp được với trang nào) — KHÔNG được suy ra từ order hay đoán.
   * Câu bị ngắt qua trang thì lấy trang đầu tiên chứa stem.
   */
  page?: number;
  content: string; // Câu hỏi chuẩn KaTeX
  /**
   * Bước 12: loại câu hỏi thật khi nguồn đã biết (AI extraction passthrough,
   * hoặc parser các bước 13/14 về sau). Vắng mặt = chưa xác định — mapper
   * suy luận từ dữ liệu (cặp Đúng/Sai, nhiều đáp án) rồi mới fallback về
   * single_choice theo hành vi cũ, KHÔNG tự ép mọi câu thành single_choice.
   */
  questionType?: QuestionType;
  options: ExtractedOption[];
  correctAnswers: OptionId[];
  explanation?: string;
  points: number;
  confidenceScore: number; // 0.0 - 1.0 (0% - 100%)
  detectionStrategy: DetectionStrategy;
  warningFlags?: string[]; // "Thiếu đáp án D", "Chưa có đáp án đúng", "Độ tin cậy thấp"
  /**
   * Bước 05: câu nháp tạo thủ công (addEmptyQuestion), KHÔNG phải câu
   * trích xuất hợp lệ từ tài liệu. Luôn đi kèm correctAnswers: [] nên
   * validator bước 04 đã chặn xuất bản (missing_answer); cờ này để
   * bước 08/25 phân biệt "nháp cần hoàn thiện" với "câu trích xuất
   * đang chờ đáp án". Toggle/chọn đáp án không tự xóa cờ này — nội
   * dung nháp vẫn là placeholder cho tới khi giáo viên sửa xong.
   */
  isManualDraft?: boolean;
  rawTextSegment: string; // Đoạn text gốc tương ứng trong file
  images?: string[]; // Danh sách URL hoặc Base64 ảnh đính kèm câu hỏi
}

export interface UploadedExamDocument {
  id: string;
  file: File | null;
  fileName: string;
  fileType: "docx" | "pdf" | "image" | "text";
  fileSize: number;
  previewUrl?: string;
  rawText?: string;
  rawHtml?: string;
  imageBase64?: string;
  totalPages?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfDoc?: any;
  uploadedAt: string;
}

export interface ExtractionResult {
  fileName: string;
  fileType: "docx" | "pdf" | "image" | "text";
  fileSize: number;
  title: string;
  subject: string;
  totalQuestionsDetected: number;
  questions: ExtractedQuestion[];
  hasAnswerKeyTable: boolean;
  warningsCount: number;
  extractedAt: string;
}
