import { describe, expect, it } from "vitest";
import {
  TRANSLATION_OVERLAY_PREVIEW_CHARS,
  TRANSLATION_REQUEST_MAX_CHARS,
  chunkText,
  createTextPreview,
  hasUsableTranslationOutput,
  normalizeText
} from "./text";

describe("text helpers", () => {
  it("normalizes subtitle whitespace", () => {
    expect(normalizeText(" hello \n  world\u200b ")).toBe("hello world");
  });

  it("keeps short text in one model request", () => {
    expect(chunkText("One short sentence.", 100)).toEqual(["One short sentence."]);
  });

  it("chunks long text without losing its words", () => {
    const input = "First sentence. Second sentence is longer. Third sentence.";
    const chunks = chunkText(input, 28);
    expect(chunks.every((chunk) => chunk.length <= 28)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(input);
  });

  it("splits a single oversized token safely", () => {
    expect(chunkText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("keeps the public request limit aligned with the popup limit", () => {
    expect(TRANSLATION_REQUEST_MAX_CHARS).toBe(5_000);
  });

  it("keeps selection overlays bounded without changing the model limit", () => {
    const input = `  ${"a".repeat(300)}  `;
    const preview = createTextPreview(input);
    expect(preview).toHaveLength(TRANSLATION_OVERLAY_PREVIEW_CHARS);
    expect(preview.endsWith("…")).toBe(true);
    expect(createTextPreview(" short text ")).toBe("short text");
  });

  it("rejects empty, special-token, and punctuation-only model output", () => {
    expect(hasUsableTranslationOutput("Translate this sentence.", "")).toBe(false);
    expect(hasUsableTranslationOutput("Translate this sentence.", ",,")).toBe(false);
    expect(hasUsableTranslationOutput("Translate this sentence.", "<pad>")).toBe(false);
    expect(hasUsableTranslationOutput("Translate this sentence.", "이 문장을 번역하세요.")).toBe(
      true
    );
  });

  it("allows preserved names and punctuation-only source text", () => {
    expect(hasUsableTranslationOutput("OpenAI API", "OpenAI API")).toBe(true);
    expect(hasUsableTranslationOutput("?!", "?!")).toBe(true);
    expect(hasUsableTranslationOutput("Use the s element.", "<s>예시</s>")).toBe(true);
  });
});
