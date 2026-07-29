import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_PREFERENCE,
  TRANSLATEGEMMA_MODEL_ID
} from "./models";
import { DEFAULT_SETTINGS, MODEL_ID } from "./protocol";

describe("release engine defaults", () => {
  it("starts with TranslateGemma on the WebGPU-first path", () => {
    expect(DEFAULT_MODEL_PREFERENCE).toBe("translategemma");
    expect(DEFAULT_SETTINGS.modelPreference).toBe("translategemma");
    expect(DEFAULT_SETTINGS.devicePreference).toBe("webgpu");
    expect(MODEL_ID).toBe(TRANSLATEGEMMA_MODEL_ID);
  });
});
