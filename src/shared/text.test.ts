import { describe, expect, it } from "vitest";
import { chunkText, normalizeText } from "./text";

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
});
