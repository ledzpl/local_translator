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
    expect(protectedValue.text).toBe("ZXQONGEULTERM0QXZ and ZXQONGEULTERM1QXZ");
    expect(restoreGlossaryTerms(protectedValue.text, protectedValue.replacements))
      .toBe("OpenAI API and 오픈AI");
  });

  it("drops malformed entries and creates a stable cache signature", () => {
    const entries = normalizeGlossaryEntries([
      { id: "1", source: " WebGPU ", target: "", mode: "preserve" },
      { id: "2", source: "browser", target: "브라우저", mode: "translate" },
      { source: "", target: "누락" }
    ]);
    expect(entries).toHaveLength(2);
    expect(createGlossarySignature(entries)).toContain("preserve:WebGPU:WebGPU");
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
