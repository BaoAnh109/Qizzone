import type { OptionId } from "./quiz";

export type DetectionStrategy =
  | "answer_table"     // Bảng đáp án cuối đề (1.A 2.B 3.C)
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
  content: string; // Câu hỏi chuẩn KaTeX
  options: ExtractedOption[];
  correctAnswers: OptionId[];
  explanation?: string;
  points: number;
  confidenceScore: number; // 0.0 - 1.0 (0% - 100%)
  detectionStrategy: DetectionStrategy;
  warningFlags?: string[]; // "Thiếu đáp án D", "Chưa có đáp án đúng", "Độ tin cậy thấp"
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
