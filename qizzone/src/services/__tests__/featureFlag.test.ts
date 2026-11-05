import { describe, expect, it } from "vitest";
import {
  AI_PARSER_V2_DEFAULT_ENABLED,
  AI_PARSER_V2_FLAG_NAME,
  isAiParserV2Enabled,
  parseFeatureFlag,
} from "@/services/extraction/featureFlag";

/**
 * Bước 33: test feature flag VITE_AI_PARSER_V2_ENABLED.
 * Chỉ test parse/đọc flag — không chạm import.meta.env thật (test inject
 * env qua tham số), không gọi AI, không đổi code khác.
 */
describe("parseFeatureFlag (fail-closed: mơ hồ → OFF)", () => {
  it.each(["1", "true", "TRUE", "True", "yes", "YES", "on", "ON", "  true  "])(
    "%s → ON",
    (raw) => {
      expect(parseFeatureFlag(raw)).toBe(true);
    }
  );

  it.each(["0", "false", "FALSE", "no", "off", "", "  ", "maybe", "2", "enabled"])(
    "%s → OFF",
    (raw) => {
      expect(parseFeatureFlag(raw)).toBe(false);
    }
  );

  it("undefined / null → OFF (mặc định)", () => {
    expect(parseFeatureFlag(undefined)).toBe(false);
    expect(parseFeatureFlag(null)).toBe(false);
    expect(AI_PARSER_V2_DEFAULT_ENABLED).toBe(false);
  });
});

describe("isAiParserV2Enabled (đọc env inject)", () => {
  it("bật khi env có giá trị truthy", () => {
    expect(
      isAiParserV2Enabled({ [AI_PARSER_V2_FLAG_NAME]: "true" })
    ).toBe(true);
    expect(isAiParserV2Enabled({ [AI_PARSER_V2_FLAG_NAME]: "1" })).toBe(true);
  });

  it("tắt khi env vắng mặt hoặc không hợp lệ", () => {
    expect(isAiParserV2Enabled({})).toBe(false);
    expect(isAiParserV2Enabled({ [AI_PARSER_V2_FLAG_NAME]: "false" })).toBe(
      false
    );
    expect(isAiParserV2Enabled({ [AI_PARSER_V2_FLAG_NAME]: "maybe" })).toBe(
      false
    );
  });
});
