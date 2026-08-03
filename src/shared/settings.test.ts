import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./protocol";
import { applyExtensionSettingChanges } from "./settings";

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
});
