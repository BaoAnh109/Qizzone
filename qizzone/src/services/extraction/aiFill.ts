import type {
  ExtractionResult,
  UploadedExamDocument,
} from "@/types/extractor";
import type { AIExtractParams } from "@/services/aiExtractionService";
import type {
  HybridInput,
  HybridOrchestrationResult,
} from "@/services/extraction/hybridOrchestrator";

/**
 * Bước 24 (PLAN_MAIN, giai đoạn F): helper thuần cho nút "AI lấp đáp án
 * còn thiếu" trong UI review. Tách khỏi component để test được mà không
 * cần render infra (repo chưa có testing-library).
 *
 * Nút này là EXTRACTION, không phải solving: nó gọi orchestrateWithAI
 * (bước 21) — chỉ lấp đáp án cho câu luật đang rỗng bằng đáp án AI có
 * bằng chứng, từ chối nhãn ai_inference (solving), không ghi đè đáp án
 * luật đã có, vượt quota thì giữ luật kèm cảnh báo. Nút "AI Giải tự
 * động" sẵn có trong BatchActionBar là solving opt-in (bước 17) — hai
 * nút khác nhau và nhãn UI phải phân biệt rõ.
 */

/** Nút chỉ hiện khi còn câu cần AI theo aiNeeded (bước 21). */
export function shouldShowAiFillButton(
  hybrid: HybridOrchestrationResult | null | undefined
): boolean {
  return hybrid !== null && hybrid !== undefined && hybrid.aiNeeded.needed;
}

/**
 * Nguồn AI đối chiếu từ tài liệu đã tải: ảnh → imageBase64, còn lại →
 * rawText (DOCX/PDF/text/dán text đều có rawText trong store.document).
 * Trả null khi không có nguồn nào — khi đó orchestrateWithAI chạy với
 * deps null và trả "no-provider" kèm cảnh báo, không gọi AI mù.
 */
export function buildAiExtractParams(
  document: UploadedExamDocument | null | undefined
): AIExtractParams | null {
  if (!document) return null;
  if (document.fileType === "image" && document.imageBase64) {
    return { file: document.file ?? undefined, imageBase64: document.imageBase64 };
  }
  if (document.rawText && document.rawText.trim().length > 0) {
    return { file: document.file ?? undefined, text: document.rawText };
  }
  return null;
}

/**
 * Input cho orchestrateWithAI tại thời điểm bấm nút: kết quả V1 HIỆN
 * TẠI (đã gồm mọi sửa tay của giáo viên) + metadata lần trích xuất gốc
 * (documentQuality/totalPages/scanPages) từ input đã lưu ở store. Dùng
 * V1 hiện tại — không dùng V1 cũ trong stored input — để nút AI không
 * hoàn tác sửa tay của giáo viên. Khi không có stored input (trạng thái
 * cũ) thì chỉ còn V1 hiện tại, chunk theo toàn tài liệu.
 */
export function buildAiFillInput(
  currentResult: ExtractionResult,
  storedInput: HybridInput | null | undefined
): HybridInput {
  return {
    result: currentResult,
    documentQuality: storedInput?.documentQuality,
    totalPages: storedInput?.totalPages,
    scanPages: storedInput?.scanPages,
  };
}
