/**
 * Bước 33 (PLAN_MAIN, giai đoạn I): feature flag AI Parser V2.
 *
 * Flag duy nhất: `VITE_AI_PARSER_V2_ENABLED` (biến môi trường build-time
 * của Vite — đổi flag phải build/deploy lại, không có toggle runtime,
 * không có remote config).
 *
 * MẶC ĐỊNH: OFF. V2 chỉ bật khi production quyết — cho tới lúc đó mọi
 * lần upload đều đi đúng đường V1 cũ (Rule/Gemini hiện tại của main),
 * kể cả khi code V2 đã có mặt trong bundle.
 *
 * PHẠM VI CỦA FLAG (ghi rõ để khỏi hiểu lầm):
 * - Flag chỉ gating ở phía CLIENT, tại điểm vào duy nhất là FileDropzone:
 *   OFF → bỏ qua Hybrid Orchestrator, không set hybridReview, review UI
 *   rơi về hành vi V1 (các component bước 23–25 đã degrade về V1 khi
 *   hybridReview là null — không cần sửa từng component).
 * - Flag KHÔNG nới lỏng bất cứ kiểm tra server-side nào: auth,
 *   permissions (teacher/admin), quota (bước 20) và RLS vẫn do Edge
 *   Function + Supabase cưỡng chế như bước 32 đã kiểm chứng. Tắt flag
 *   không tắt quota; bật flag không mở thêm quyền.
 * - Flag KHÔNG đổi dữ liệu: tắt flag không xóa extractionResult V1 đang
 *   có, không đổi quiz đã lưu, không migration DB.
 *
 * LỘ TRÌNH ROLLOUT (không tự deploy — từng nấc cần quyết riêng):
 *   local (flag OFF) → staging (flag ON, dữ liệu thử) → opt-in
 *   (flag ON cho nhóm giáo viên thử) → production (flag ON mặc định).
 * Quay lại nấc trước = set flag về OFF rồi build/deploy lại — xem
 * `work/docs/ai-parser-v2/33-observability-flag-rollback.md`.
 */

export const AI_PARSER_V2_FLAG_NAME = "VITE_AI_PARSER_V2_ENABLED";

/** Giá trị mặc định khi biến môi trường vắng mặt hoặc không hợp lệ. */
export const AI_PARSER_V2_DEFAULT_ENABLED = false;

/** Giá trị chuỗi được coi là bật (không phân biệt hoa/thường, trim trước). */
const TRUTHY_FLAG_VALUES = new Set(["1", "true", "yes", "on"]);

/**
 * Parse giá trị chuỗi của flag. Mọi giá trị khác (kể cả "0", "false",
 * chuỗi lạ, undefined, null) đều là OFF — fail-closed: không bật V2
 * vì một giá trị mơ hồ.
 */
export function parseFeatureFlag(raw: string | undefined | null): boolean {
  if (raw === undefined || raw === null) return AI_PARSER_V2_DEFAULT_ENABLED;
  return TRUTHY_FLAG_VALUES.has(raw.trim().toLowerCase());
}

function readEnvValue(key: string): string | undefined {
  try {
    const env = (
      import.meta as unknown as { env?: Record<string, string | undefined> }
    ).env;
    return env?.[key];
  } catch {
    return undefined;
  }
}

/**
 * Flag V2 có đang bật không. `env` chỉ dùng cho test (inject giá trị);
 * production luôn đọc `import.meta.env` thật.
 */
export function isAiParserV2Enabled(
  env?: Record<string, string | undefined>
): boolean {
  const raw =
    env !== undefined
      ? env[AI_PARSER_V2_FLAG_NAME]
      : readEnvValue(AI_PARSER_V2_FLAG_NAME);
  return parseFeatureFlag(raw);
}
