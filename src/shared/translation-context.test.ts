import { describe, expect, it } from "vitest";
import {
  TRANSLATION_CONTEXT_MARKER,
  createCaptionContext,
  createContextualTranslationInput,
  extractContextualTranslation
} from "./translation-context";

describe("subtitle translation context", () => {
  it("keeps prior captions separate and extracts only the current translation", () => {
    const input = createContextualTranslationInput("current", "previous");
    expect(input.text).toBe(`previous\n${TRANSLATION_CONTEXT_MARKER}\ncurrent`);
    expect(extractContextualTranslation(
      `이전 문장 ${TRANSLATION_CONTEXT_MARKER} 현재 문장`,
      input.marker
    )).toBe("현재 문장");
  });

  it("returns null when a model loses the boundary marker", () => {
    expect(extractContextualTranslation(
      "경계가 사라진 결과",
      TRANSLATION_CONTEXT_MARKER
    )).toBeNull();
  });

  it("uses the marker's original index when earlier Unicode changes case length", () => {
    expect(extractContextualTranslation(
      `ßßß ${TRANSLATION_CONTEXT_MARKER.toLowerCase()} 현재 문장`,
      TRANSLATION_CONTEXT_MARKER
    )).toBe("현재 문장");
  });

  it("does not confuse a literal marker in the current caption with the boundary", () => {
    const current = `앞부분 ${TRANSLATION_CONTEXT_MARKER} 뒷부분`;
    const input = createContextualTranslationInput(current, "previous");
    expect(input.marker).not.toBe(TRANSLATION_CONTEXT_MARKER);
    expect(extractContextualTranslation(
      `이전 번역 ${input.marker} 앞부분 ${TRANSLATION_CONTEXT_MARKER} 뒷부분`,
      input.marker
    )).toBe(`앞부분 ${TRANSLATION_CONTEXT_MARKER} 뒷부분`);
  });

  it("returns plain translated text when no context marker was needed", () => {
    const input = createContextualTranslationInput("current");
    expect(input).toEqual({ text: "current", marker: null });
    expect(extractContextualTranslation(" 현재 문장 ", input.marker))
      .toBe("현재 문장");
  });

  it("deduplicates recent captions and excludes the current caption", () => {
    expect(createCaptionContext(["first", "first", "second", "current"], "current"))
      .toBe("first second");
  });
});
