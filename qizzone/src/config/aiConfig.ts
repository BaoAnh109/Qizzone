/**
 * CẤU HÌNH TRUNG TÂM CHO ENGINE TRÍ TUỆ NHÂN TẠO (AI CONFIGURATION)
 * 
 * 👉 HƯỚNG DẪN CẤU HÌNH GEMINI API KEY:
 * Cách 1: Dán trực tiếp API Key của bạn vào biến DEFAULT_GEMINI_API_KEY ở dòng 15 bên dưới.
 * Cách 2: Tạo file `.env` ở thư mục gốc `qizzone/` và thêm dòng:
 *         VITE_GEMINI_API_KEY=AIzaSy...
 */

export const AI_CONFIG = {
  /**
   * 👉 DÁN GEMINI API KEY CỦA BẠN VÀO ĐÂY NẾU KHÔNG DÙNG FILE .env
   * Lấy API Key miễn phí tại: https://aistudio.google.com/app/apikey
   */
  DEFAULT_GEMINI_API_KEY: "AQ.Ab8RN6JAuduwKvXQAwG9WURX6Zyo7o3bVUsKLeyJ8arBRFgPzg",

  /**
   * Mô hình AI ưu tiên cao nhất cho độ chính xác giải toán & bóc tách:
   * - "gemini-2.0-flash": Mô hình thế hệ mới nhất của Google, suy luận toán học cực nhanh & chính xác.
   * - "gemini-1.5-pro": Mô hình pro chuyên xử lý tài liệu dài và công thức phức tạp.
   * - "gemini-1.5-flash": Mô hình nhẹ, ổn định.
   */
  DEFAULT_MODEL: "gemini-2.0-flash",

  /**
   * Mô hình dự phòng khi model chính bận
   */
  FALLBACK_MODEL: "gemini-1.5-flash",

  /**
   * Nhiệt độ sinh mẫu: 0.1 đảm bảo tính tất định, chính xác tuyệt đối
   */
  TEMPERATURE: 0.1,
};

/**
 * Lấy Gemini API Key từ biến môi trường hoặc cấu hình mặc định
 */
export function getGeminiApiKey(): string {
  // Ưu tiên đọc từ biến môi trường VITE_GEMINI_API_KEY (file .env)
  const envKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (envKey && typeof envKey === "string" && envKey.trim().length > 0) {
    return envKey.trim();
  }

  // Nếu không có trong .env, lấy từ DEFAULT_GEMINI_API_KEY
  return AI_CONFIG.DEFAULT_GEMINI_API_KEY.trim();
}
