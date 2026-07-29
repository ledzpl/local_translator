import { describe, expect, it } from "vitest";
import {
  getPageTranslationTerminalState,
  getPageTranslationText,
  getPageTranslationTexts,
  isLikelyProsePreformatted,
  limitPageTranslationTexts,
  pageTranslationSourceStillMatches,
  prioritizePageTranslationCandidates
} from "./page-text";

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

  it("splits long prose without dropping it", () => {
    const prose = "A long article sentence. ".repeat(120).trim();
    const chunks = getPageTranslationTexts(prose);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 2_000)).toBe(true);
    expect(chunks.join(" ")).toBe(prose);
  });

  it("accepts prose-style pre blocks and rejects source code", () => {
    expect(isLikelyProsePreformatted(
      "This article is written as plain preformatted prose with enough words to read naturally."
    )).toBe(true);
    expect(isLikelyProsePreformatted(
      "const answer = () => {\n  return 42;\n};"
    )).toBe(false);
  });

  it("applies the budget after moving viewport blocks first", () => {
    const candidates = [
      ...Array.from({ length: 45 }, (_, index) => ({
        value: `offscreen-${index}`,
        sourceText: `Offscreen paragraph ${index}`,
        visible: false
      })),
      {
        value: "viewport",
        sourceText: "The paragraph currently visible to the reader.",
        visible: true
      }
    ];
    const selected = prioritizePageTranslationCandidates(candidates, 40, 20_000);
    expect(selected[0]?.value).toBe("viewport");
    expect(selected).toHaveLength(40);
  });

  it("enforces block and character budgets", () => {
    expect(limitPageTranslationTexts(["aaaa", "bbbb", "cccc"], 2, 20)).toEqual([
      "aaaa",
      "bbbb"
    ]);
    expect(limitPageTranslationTexts(["aaaa", "bbbb"], 5, 7)).toEqual(["aaaa"]);
  });

  it("distinguishes complete, partial, and fully failed page runs", () => {
    expect(getPageTranslationTerminalState(4, 0)).toBe("complete");
    expect(getPageTranslationTerminalState(4, 1)).toBe("partial");
    expect(getPageTranslationTerminalState(4, 4)).toBe("error");
  });

  it("rejects a page translation result after its source node was replaced or changed", () => {
    const source = "A paragraph collected before an asynchronous translation.";
    expect(pageTranslationSourceStillMatches(true, source, source)).toBe(true);
    expect(pageTranslationSourceStillMatches(
      false,
      source,
      source
    )).toBe(false);
    expect(pageTranslationSourceStillMatches(
      true,
      source,
      "A replacement paragraph rendered by the SPA."
    )).toBe(false);
  });
});
