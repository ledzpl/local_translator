import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./protocol";
import {
  applyExtensionSettingChanges,
  normalizeExtensionSettings
} from "./settings";

describe("extension setting changes", () => {
  it("applies explicit values without replacing unrelated settings", () => {
    const current = {
      ...DEFAULT_SETTINGS,
      youtubeEnabled: true,
      pageDisplayMode: "hover" as const
    };

    expect(applyExtensionSettingChanges(current, {
      subtitleSize: { newValue: 34 }
    })).toEqual({
      ...current,
      subtitleSize: 34
    });
  });

  it("restores defaults when Chrome reports a removed sync key", () => {
    const current = {
      ...DEFAULT_SETTINGS,
      privacyConsentVersion: 4,
      youtubeEnabled: true,
      autoEnableCaptions: true,
      pageDisplayMode: "translation" as const
    };

    expect(applyExtensionSettingChanges(current, {
      privacyConsentVersion: { newValue: undefined },
      youtubeEnabled: { newValue: undefined },
      autoEnableCaptions: { newValue: undefined },
      pageDisplayMode: { newValue: undefined }
    })).toEqual({
      ...current,
      privacyConsentVersion: DEFAULT_SETTINGS.privacyConsentVersion,
      youtubeEnabled: DEFAULT_SETTINGS.youtubeEnabled,
      autoEnableCaptions: DEFAULT_SETTINGS.autoEnableCaptions,
      pageDisplayMode: DEFAULT_SETTINGS.pageDisplayMode
    });
  });

  it("repairs malformed sync values before they reach UI and engine code", () => {
    expect(normalizeExtensionSettings({
      ...DEFAULT_SETTINGS,
      privacyConsentVersion: "4",
      youtubeEnabled: "yes",
      subtitleSize: 500,
      youtubeTranslationMode: "slow",
      pageDisplayMode: "replace",
      sourceLanguage: "xx",
      modelPreference: "unknown-model",
      devicePreference: "cpu"
    })).toEqual({
      ...DEFAULT_SETTINGS,
      subtitleSize: 42
    });
  });

  it("normalizes malformed live sync changes without replacing valid settings", () => {
    const current = {
      ...DEFAULT_SETTINGS,
      privacyConsentVersion: 4,
      youtubeEnabled: true,
      sourceLanguage: "fr",
      modelPreference: "m2m100" as const,
      devicePreference: "wasm" as const
    };

    expect(applyExtensionSettingChanges(current, {
      subtitleSize: { newValue: Number.NaN },
      modelPreference: { newValue: "removed-model" }
    })).toEqual({
      ...current,
      subtitleSize: DEFAULT_SETTINGS.subtitleSize,
      modelPreference: DEFAULT_SETTINGS.modelPreference
    });
  });
});
