import { describe, expect, it } from "vitest";
import {
  containsMostlyKorean,
  normalizeLanguageCode,
  pickDetectedLanguage,
  supportsTranslateGemmaLanguage
} from "./languages";

describe("language helpers", () => {
  it("normalizes browser language variants for M2M100", () => {
    expect(normalizeLanguageCode("zh-CN")).toBe("zh");
    expect(normalizeLanguageCode("iw")).toBe("he");
    expect(normalizeLanguageCode("en-US")).toBe("en");
  });

  it("falls back to English for unsupported detector results", () => {
    expect(normalizeLanguageCode("xx")).toBe("en");
  });

  it("recognizes Korean text without model inference", () => {
    expect(containsMostlyKorean("오늘 날씨가 정말 좋습니다.")).toBe(true);
    expect(containsMostlyKorean("This is an English caption.")).toBe(false);
  });

  it("uses the highest confidence detected language", () => {
    expect(pickDetectedLanguage([
      { language: "fr", percentage: 18 },
      { language: "es", percentage: 82 }
    ])).toBe("es");
  });

  it("routes detector codes missing from the pinned TranslateGemma template", () => {
    expect(supportsTranslateGemmaLanguage("en")).toBe(true);
    expect(supportsTranslateGemmaLanguage("fr")).toBe(true);
    expect(supportsTranslateGemmaLanguage("ko")).toBe(true);
    expect(supportsTranslateGemmaLanguage("cs")).toBe(true);
    expect(supportsTranslateGemmaLanguage("ast")).toBe(false);
    expect(supportsTranslateGemmaLanguage("ceb")).toBe(false);
    expect(supportsTranslateGemmaLanguage("ilo")).toBe(false);
    expect(supportsTranslateGemmaLanguage("ns")).toBe(false);
  });
});
