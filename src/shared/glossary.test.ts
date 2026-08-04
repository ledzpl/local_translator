import { describe, expect, it } from "vitest";
import {
  MAX_GLOSSARY_ENTRIES,
  createGlossarySignature,
  normalizeGlossaryEntries,
  protectGlossaryTerms,
  restoreGlossaryTerms
} from "./glossary";

describe("local glossary", () => {
  it("protects longer terms first and restores requested Korean wording", () => {
    const protectedValue = protectGlossaryTerms("OpenAI API and OpenAI", [
      { id: "1", source: "OpenAI", target: "오픈AI", mode: "translate" },
      { id: "2", source: "OpenAI API", target: "OpenAI API", mode: "preserve" }
    ]);
    expect(protectedValue.text).toBe(
      "ZXQONGEULGLOSSARY0TERM0QXZ and ZXQONGEULGLOSSARY0TERM1QXZ"
    );
    expect(restoreGlossaryTerms(protectedValue.text, protectedValue.replacements))
      .toBe("OpenAI API and 오픈AI");
  });

  it("does not match later glossary terms inside generated protection tokens", () => {
    const protectedValue = protectGlossaryTerms("OpenAI API term", [
      { id: "1", source: "OpenAI API", target: "API", mode: "translate" },
      { id: "2", source: "term", target: "용어", mode: "translate" }
    ]);
    expect(restoreGlossaryTerms(protectedValue.text, protectedValue.replacements))
      .toBe("API 용어");
  });

  it("preserves literal token-looking source text", () => {
    const literal = "ZXQONGEULGLOSSARY0TERM0QXZ";
    const protectedValue = protectGlossaryTerms(`OpenAI ${literal}`, [
      { id: "1", source: "OpenAI", target: "오픈AI", mode: "translate" }
    ]);
    expect(restoreGlossaryTerms(protectedValue.text, protectedValue.replacements))
      .toBe(`오픈AI ${literal}`);
  });

  it("preserves the exact spelling of every case-insensitive match", () => {
    const source = "WebGPU webgpu WEBGPU";
    const protectedValue = protectGlossaryTerms(source, [
      { id: "1", source: "WebGPU", target: "WebGPU", mode: "preserve" }
    ]);

    expect(restoreGlossaryTerms(protectedValue.text, protectedValue.replacements))
      .toBe(source);
  });

  it("restores replacement values without interpreting dollar substitutions", () => {
    const protectedValue = protectGlossaryTerms("OpenAI", [
      { id: "1", source: "OpenAI", target: "$& $` $'", mode: "translate" }
    ]);
    expect(restoreGlossaryTerms(protectedValue.text, protectedValue.replacements))
      .toBe("$& $` $'");
  });

  it("does not process token-looking text introduced by another replacement", () => {
    expect(restoreGlossaryTerms("TOKEN0 TOKEN1", [
      { token: "TOKEN0", value: "TOKEN1" },
      { token: "TOKEN1", value: "완료" }
    ])).toBe("TOKEN1 완료");
  });

  it("drops malformed entries and creates a stable cache signature", () => {
    const entries = normalizeGlossaryEntries([
      { id: "1", source: " WebGPU ", target: "", mode: "preserve" },
      { id: "2", source: "browser", target: "브라우저", mode: "translate" },
      { source: "", target: "누락" }
    ]);
    expect(entries).toHaveLength(2);
    expect(createGlossarySignature(entries)).toContain(
      '["preserve","WebGPU","WebGPU"]'
    );
  });

  it("does not collide when sources and targets contain signature delimiters", () => {
    expect(createGlossarySignature([
      { id: "1", source: "API:v1", target: "서비스", mode: "translate" }
    ])).not.toBe(createGlossarySignature([
      { id: "2", source: "API", target: "v1:서비스", mode: "translate" }
    ]));
  });

  it("caps local entries to keep extension storage and prompts bounded", () => {
    const entries = normalizeGlossaryEntries(Array.from(
      { length: MAX_GLOSSARY_ENTRIES + 5 },
      (_, index) => ({
        id: String(index),
        source: `term-${index}`,
        target: `용어-${index}`,
        mode: "translate"
      })
    ));
    expect(entries).toHaveLength(MAX_GLOSSARY_ENTRIES);
  });
});
