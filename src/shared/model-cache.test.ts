import { describe, expect, it } from "vitest";
import {
  ALL_TRANSLATION_MODEL_IDS,
  liveTranslationModelIds,
  selectedTranslationModelIdsForClear,
  shouldResetEngineForModelCacheClear,
  translationModelIdForPreference
} from "./model-cache";
import {
  M2M100_MODEL_ID,
  SMALL100_MODEL_ID,
  TRANSLATEGEMMA_MODEL_ID
} from "./models";

describe("translation model ids", () => {
  it("maps every preference to its locked model id", () => {
    expect(translationModelIdForPreference("translategemma"))
      .toBe(TRANSLATEGEMMA_MODEL_ID);
    expect(translationModelIdForPreference("m2m100")).toBe(M2M100_MODEL_ID);
    expect(translationModelIdForPreference("small100")).toBe(SMALL100_MODEL_ID);
  });

  it("lists all translation model ids without duplicates", () => {
    expect([...ALL_TRANSLATION_MODEL_IDS].sort()).toEqual([
      M2M100_MODEL_ID,
      SMALL100_MODEL_ID,
      TRANSLATEGEMMA_MODEL_ID
    ].sort());
  });
});

describe("live translation model ids", () => {
  it("reports the loaded preference for a plain load", () => {
    expect(liveTranslationModelIds({
      loadedModelPreference: "m2m100",
      engineKind: "m2m100",
      loadInFlight: true,
      statusModelId: M2M100_MODEL_ID
    })).toEqual([M2M100_MODEL_ID]);
  });

  it("also reports the fallback model behind a SMaLL-100 request", () => {
    // getEngine records the requested preference, so a SMaLL-100 load that fell
    // back to M2M100 depends on both sets of weights.
    expect(liveTranslationModelIds({
      loadedModelPreference: "small100",
      engineKind: "m2m100",
      loadInFlight: true,
      statusModelId: M2M100_MODEL_ID
    }).sort()).toEqual([M2M100_MODEL_ID, SMALL100_MODEL_ID].sort());
  });

  it("reports the fallback while the load is still in flight", () => {
    // The engine object does not exist yet, but the status already points at
    // the fallback weights being downloaded.
    expect(liveTranslationModelIds({
      loadedModelPreference: "translategemma",
      engineKind: null,
      loadInFlight: true,
      statusModelId: M2M100_MODEL_ID
    }).sort()).toEqual([M2M100_MODEL_ID, TRANSLATEGEMMA_MODEL_ID].sort());
  });

  it("ignores a stale status once no engine is held", () => {
    expect(liveTranslationModelIds({
      loadedModelPreference: null,
      engineKind: null,
      loadInFlight: false,
      statusModelId: TRANSLATEGEMMA_MODEL_ID
    })).toEqual([]);
  });
});

describe("model cache clear selection", () => {
  it("selects only the requested model", () => {
    expect(selectedTranslationModelIdsForClear({
      preference: "m2m100",
      includeTranslation: true
    })).toEqual([M2M100_MODEL_ID]);
  });

  it("selects every model when no preference is given", () => {
    expect(selectedTranslationModelIdsForClear({
      preference: undefined,
      includeTranslation: true
    }).sort()).toEqual([...ALL_TRANSLATION_MODEL_IDS].sort());
  });

  it("selects nothing for a TTS-only clear", () => {
    expect(selectedTranslationModelIdsForClear({
      preference: "m2m100",
      includeTranslation: false
    })).toEqual([]);
    expect(selectedTranslationModelIdsForClear({
      preference: undefined,
      includeTranslation: false
    })).toEqual([]);
  });
});

describe("engine reset on model cache clear", () => {
  it("resets when the cleared model is the loaded one", () => {
    expect(shouldResetEngineForModelCacheClear({
      preference: "m2m100",
      includeTranslation: true,
      liveModelIds: [M2M100_MODEL_ID]
    })).toBe(true);
  });

  it("resets when the cleared model backs a fallback engine", () => {
    // Regression: clearing M2M100 while a SMaLL-100 request was serving from
    // the M2M100 fallback used to leave that engine running against deleted
    // cache entries.
    expect(shouldResetEngineForModelCacheClear({
      preference: "m2m100",
      includeTranslation: true,
      liveModelIds: [SMALL100_MODEL_ID, M2M100_MODEL_ID]
    })).toBe(true);
  });

  it("keeps an unrelated engine loaded", () => {
    expect(shouldResetEngineForModelCacheClear({
      preference: "small100",
      includeTranslation: true,
      liveModelIds: [TRANSLATEGEMMA_MODEL_ID]
    })).toBe(false);
  });

  it("always resets when every translation cache is cleared", () => {
    expect(shouldResetEngineForModelCacheClear({
      preference: undefined,
      includeTranslation: true,
      liveModelIds: []
    })).toBe(true);
  });

  it("never resets the translation engine for a TTS-only clear", () => {
    expect(shouldResetEngineForModelCacheClear({
      preference: undefined,
      includeTranslation: false,
      liveModelIds: [M2M100_MODEL_ID]
    })).toBe(false);
  });
});
