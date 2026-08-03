import { describe, expect, it } from "vitest";
import {
  shouldRetryModelPreparationOnWasm,
  shouldRetryTranslationOnWasm,
  shouldUseStoredWasmFallback
} from "./translation-recovery";

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

  it("reuses a recorded WebGPU failure for translation and model preparation", () => {
    expect(shouldUseStoredWasmFallback({
      fallbackReason: "WebGPU adapter lost",
      modelPreference: "translategemma",
      devicePreference: "webgpu"
    })).toBe(true);
    expect(shouldUseStoredWasmFallback({
      fallbackReason: "WebGPU adapter lost",
      modelPreference: "m2m100",
      devicePreference: "auto"
    })).toBe(true);
  });

  it("does not attach a stale fallback to WASM-only requests", () => {
    expect(shouldUseStoredWasmFallback({
      fallbackReason: "old failure",
      modelPreference: "small100",
      devicePreference: "webgpu"
    })).toBe(false);
    expect(shouldUseStoredWasmFallback({
      fallbackReason: "old failure",
      modelPreference: "m2m100",
      devicePreference: "wasm"
    })).toBe(false);
    expect(shouldUseStoredWasmFallback({
      fallbackReason: null,
      modelPreference: "translategemma",
      devicePreference: "webgpu"
    })).toBe(false);
  });

  it("falls back when preparing either WebGPU translation engine fails", () => {
    for (const modelPreference of ["translategemma", "m2m100"] as const) {
      expect(shouldRetryModelPreparationOnWasm({
        modelPreference,
        devicePreference: "webgpu",
        state: "error",
        fallbackFromDevice: "webgpu"
      })).toBe(true);
    }
  });

  it("does not retry a WASM-only or non-error model preparation", () => {
    expect(shouldRetryModelPreparationOnWasm({
      modelPreference: "small100",
      devicePreference: "webgpu",
      state: "error",
      fallbackFromDevice: "webgpu"
    })).toBe(false);
    expect(shouldRetryModelPreparationOnWasm({
      modelPreference: "m2m100",
      devicePreference: "wasm",
      state: "error",
      fallbackFromDevice: "webgpu"
    })).toBe(false);
    expect(shouldRetryModelPreparationOnWasm({
      modelPreference: "m2m100",
      devicePreference: "webgpu",
      state: "ready",
      fallbackFromDevice: "webgpu"
    })).toBe(false);
  });
});
