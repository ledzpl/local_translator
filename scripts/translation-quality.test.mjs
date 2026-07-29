import { describe, expect, it } from "vitest";
import {
  assertSemanticTranslation,
  normalizeTranslation
} from "./translation-quality.mjs";

describe("assertSemanticTranslation", () => {
  const fixture = {
    id: "navigation",
    requiredConcepts: [
      [/탐색/u, /내비게이션/u],
      [/독자/u, /읽는 사람/u],
      [/복잡/u],
      [/웹\s*페이지/u, /웹페이지/u]
    ],
    forbidden: [/\bnavigation\b/iu]
  };

  it("accepts Korean synonyms that retain every required concept", () => {
    expect(() => assertSemanticTranslation({
      ...fixture,
      translation: "명확한 탐색은 독자가 복잡한 웹 페이지를 이해하는 데 도움이 됩니다."
    })).not.toThrow();
  });

  it("rejects a result that merely contains Hangul", () => {
    expect(() => assertSemanticTranslation({
      ...fixture,
      translation: "명확한 navigation은 독자가 복잡한 웹 페이지를 이해하는 데 도움이 됩니다."
    })).toThrow("필수 의미");
  });

  it("rejects a forbidden source token even when a synonym is also present", () => {
    expect(() => assertSemanticTranslation({
      ...fixture,
      translation: "navigation 내비게이션은 독자가 복잡한 웹페이지를 이해하도록 돕습니다."
    })).toThrow("금지된 오역");
  });

  it("checks important numbers independently from Korean text", () => {
    expect(() => assertSemanticTranslation({
      id: "numbers",
      translation: "버전 2.1은 여러 언어를 지원합니다.",
      requiredConcepts: [[/버전/u], [/언어/u]],
      preservedNumbers: ["2.1", "40"]
    })).toThrow("숫자 40");
  });
});

describe("normalizeTranslation", () => {
  it("normalizes Unicode width and whitespace without deleting meaning", () => {
    expect(normalizeTranslation("  버전　２.１\n지원  ")).toBe("버전 2.1 지원");
  });
});
