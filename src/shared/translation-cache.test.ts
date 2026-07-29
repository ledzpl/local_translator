import { describe, expect, it } from "vitest";
import { createTranslationCacheKey } from "./translation-cache";

describe("createTranslationCacheKey", () => {
  it("separates cached translations by model and requested runtime", () => {
    const wasm = createTranslationCacheKey(
      "m2m100",
      "wasm",
      "en",
      "A visible sentence"
    );
    const webgpu = createTranslationCacheKey(
      "m2m100",
      "webgpu",
      "en",
      "A visible sentence"
    );
    const otherModel = createTranslationCacheKey(
      "small100",
      "wasm",
      "en",
      "A visible sentence"
    );

    expect(wasm).not.toBe(webgpu);
    expect(wasm).not.toBe(otherModel);
  });
});
