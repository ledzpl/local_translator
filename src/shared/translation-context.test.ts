import { describe, expect, it } from "vitest";
import {
  TRANSLATION_CONTEXT_MARKER,
  createCaptionContext,
  createContextualTranslationInput,
  extractContextualTranslation
} from "./translation-context";

describe("subtitle translation context", () => {
  it("keeps prior captions separate and extracts only the current translation", () => {
    expect(createContextualTranslationInput("current", "previous"))
      .toContain(TRANSLATION_CONTEXT_MARKER);
    expect(extractContextualTranslation(
      `이전 문장 ${TRANSLATION_CONTEXT_MARKER} 현재 문장`,
      true
    )).toBe("현재 문장");
  });

  it("returns null when a model loses the boundary marker", () => {
    expect(extractContextualTranslation("경계가 사라진 결과", true)).toBeNull();
  });

  it("deduplicates recent captions and excludes the current caption", () => {
    expect(createCaptionContext(["first", "first", "second", "current"], "current"))
      .toBe("first second");
  });
});
