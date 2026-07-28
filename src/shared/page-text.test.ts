import { describe, expect, it } from "vitest";
import { getPageTranslationText, limitPageTranslationTexts } from "./page-text";

describe("page translation text selection", () => {
  it("accepts foreign-language prose and normalizes it", () => {
    expect(getPageTranslationText("  A useful web paragraph.  ")).toBe(
      "A useful web paragraph."
    );
  });

  it("skips Korean, numeric-only, and oversized blocks", () => {
    expect(getPageTranslationText("이미 한국어인 문장입니다.")).toBeNull();
    expect(getPageTranslationText("12345")).toBeNull();
    expect(getPageTranslationText("a".repeat(2_001))).toBeNull();
  });

  it("enforces block and character budgets", () => {
    expect(limitPageTranslationTexts(["aaaa", "bbbb", "cccc"], 2, 20)).toEqual([
      "aaaa",
      "bbbb"
    ]);
    expect(limitPageTranslationTexts(["aaaa", "bbbb"], 5, 7)).toEqual(["aaaa"]);
  });
});
