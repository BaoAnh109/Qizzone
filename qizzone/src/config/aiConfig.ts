/**
 * CẤU HÌNH TRUNG TÂM CHO ENGINE TRÍ TUỆ NHÂN TẠO (AI CONFIGURATION)
 */

export const AI_CONFIG = {
  /**
   * Khóa API mặc định nếu có
   */
  DEFAULT_GEMINI_API_KEY: "AQ.Ab8RN6LYOM2uynUSPFQUFEiS_58wyIWnB82wNoCzBMKuvGB3Og",

  /**
   * Mô hình AI ưu tiên cao nhất cho độ chính xác giải toán & bóc tách:
   * - "gemini-3.6-flash": Mô hình thế hệ mới nhất của Google, suy luận toán học cực nhanh & chính xác.
   * - "gemini-3.7-flash": Mô hình flagship mạnh nhất.
   */
  DEFAULT_MODEL: "gemini-3.6-flash",

  /**
   * Mô hình dự phòng khi model chính bận
   */
  FALLBACK_MODEL: "gemini-3.7-flash",

  /**
   * Nhiệt độ sinh mẫu: 0.1 đảm bảo tính tất định, chính xác tuyệt đối
   */
  TEMPERATURE: 0.1,
};

const STORAGE_KEY = "qizzone_gemini_api_key";

/**
 * Lấy Gemini API Key từ localStorage, biến môi trường .env hoặc cấu hình mặc định
 */
export function getGeminiApiKey(): string {
  // 1. Ưu tiên lấy từ localStorage nếu người dùng đã nhập trên giao diện web
  if (typeof window !== "undefined" && window.localStorage) {
    const localKey = localStorage.getItem(STORAGE_KEY);
    if (localKey && localKey.trim().length > 0) {
      return localKey.trim();
    }
  }

  // 2. Lấy từ biến môi trường VITE_GEMINI_API_KEY (file .env)
  const envKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (envKey && typeof envKey === "string" && envKey.trim().length > 0) {
    return envKey.trim();
  }

  // 3. Fallback lấy từ DEFAULT_GEMINI_API_KEY
  return (AI_CONFIG.DEFAULT_GEMINI_API_KEY || "").trim();
}

/**
 * Lưu Gemini API Key vào localStorage
 */
export function saveGeminiApiKey(apiKey: string): void {
  if (typeof window !== "undefined" && window.localStorage) {
    localStorage.setItem(STORAGE_KEY, apiKey.trim());
  }
}

/**
 * Xóa Gemini API Key khỏi localStorage
 */
export function removeGeminiApiKey(): void {
  if (typeof window !== "undefined" && window.localStorage) {
    localStorage.removeItem(STORAGE_KEY);
  }
}

/**
 * Kiểm tra tính hợp lệ của Gemini API Key bằng cách gửi request test thực tế đến Google API
 */
export async function testGeminiApiKey(apiKeyInput?: string): Promise<{
  valid: boolean;
  message: string;
  model?: string;
}> {
  const apiKey = (apiKeyInput || getGeminiApiKey()).trim();

  if (!apiKey || apiKey.length < 10) {
    return {
      valid: false,
      message: "Chưa nhập API Key hợp lệ. Vui lòng dán khóa API của Google Gemini.",
    };
  }

  const model = AI_CONFIG.DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: "Trả lời ngắn gọn chữ 'OK'." }],
          },
        ],
      }),
    });

    if (response.ok) {
      return {
        valid: true,
        message: "Kết nối thành công! Gemini AI đã sẵn sàng hoạt động.",
        model,
      };
    }

    const errData = await response.json().catch(() => null);
    const errorMsg =
      errData?.error?.message ||
      `Lỗi kết nối (${response.status}: ${response.statusText})`;

    return {
      valid: false,
      message: `Google từ chối API Key: ${errorMsg}`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Lỗi mạng hoặc CORS";
    return {
      valid: false,
      message: `Không thể kết nối đến máy chủ Google Gemini: ${msg}`,
    };
  }
}
