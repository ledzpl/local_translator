import { describe, expect, it } from "vitest";
import { shouldRetryTranslationOnWasm } from "./translation-recovery";

describe("translation device recovery", () => {
  it("retries invalid TranslateGemma WebGPU output through the WASM fallback", () => {
    expect(shouldRetryTranslationOnWasm({
      engineKind: "translategemma",
      runtimeDevice: "webgpu",
      devicePreference: "webgpu"
    })).toBe(true);
  });

  it("also retries M2M100 WebGPU failures", () => {
    expect(shouldRetryTranslationOnWasm({
      engineKind: "m2m100",
      runtimeDevice: "webgpu",
      devicePreference: "auto"
    })).toBe(true);
  });

  it("does not retry engines that are already on WASM", () => {
    expect(shouldRetryTranslationOnWasm({
      engineKind: "m2m100",
      runtimeDevice: "wasm",
      devicePreference: "webgpu"
    })).toBe(false);
    expect(shouldRetryTranslationOnWasm({
      engineKind: "small100",
      runtimeDevice: "wasm",
      devicePreference: "webgpu"
    })).toBe(false);
  });
});
