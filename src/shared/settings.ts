import {
  DEFAULT_SETTINGS,
  type ExtensionSettings
} from "./protocol";
import { LANGUAGE_OPTIONS } from "./languages";

export interface ExtensionSettingChange {
  newValue?: unknown;
}

const BOOLEAN_SETTING_KEYS = new Set<keyof ExtensionSettings>([
  "youtubeEnabled",
  "autoEnableCaptions",
  "showOriginalCaptions",
  "pageContinuous"
]);
const SOURCE_LANGUAGE_CODES = new Set(
  LANGUAGE_OPTIONS.map((language) => language.code)
);

export function normalizeExtensionSettingValue<
  Key extends keyof ExtensionSettings
>(
  key: Key,
  value: unknown
): ExtensionSettings[Key] {
  let normalized: unknown;
  if (BOOLEAN_SETTING_KEYS.has(key)) {
    normalized = typeof value === "boolean" ? value : DEFAULT_SETTINGS[key];
  } else {
    switch (key) {
      case "privacyConsentVersion":
        normalized =
          typeof value === "number" && Number.isInteger(value) && value >= 0
            ? value
            : DEFAULT_SETTINGS.privacyConsentVersion;
        break;
      case "subtitleSize":
        normalized =
          typeof value === "number" && Number.isFinite(value)
            ? Math.min(42, Math.max(18, Math.round(value)))
            : DEFAULT_SETTINGS.subtitleSize;
        break;
      case "youtubeTranslationMode":
        normalized = value === "speed" || value === "context"
          ? value
          : DEFAULT_SETTINGS.youtubeTranslationMode;
        break;
      case "pageDisplayMode":
        normalized =
          value === "bilingual" || value === "translation" || value === "hover"
            ? value
            : DEFAULT_SETTINGS.pageDisplayMode;
        break;
      case "sourceLanguage":
        normalized =
          typeof value === "string" && SOURCE_LANGUAGE_CODES.has(value)
            ? value
            : DEFAULT_SETTINGS.sourceLanguage;
        break;
      case "modelPreference":
        normalized =
          value === "translategemma" || value === "m2m100" || value === "small100"
            ? value
            : DEFAULT_SETTINGS.modelPreference;
        break;
      case "devicePreference":
        normalized = value === "auto" || value === "webgpu" || value === "wasm"
          ? value
          : DEFAULT_SETTINGS.devicePreference;
        break;
      default:
        normalized = DEFAULT_SETTINGS[key];
    }
  }
  return normalized as ExtensionSettings[Key];
}

export function normalizeExtensionSettings(value: unknown): ExtensionSettings {
  const candidate = value && typeof value === "object"
    ? value as Partial<Record<keyof ExtensionSettings, unknown>>
    : {};
  const normalized = { ...DEFAULT_SETTINGS };
  const mutable = normalized as unknown as Record<keyof ExtensionSettings, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof ExtensionSettings>) {
    mutable[key] = normalizeExtensionSettingValue(key, candidate[key]);
  }
  return normalized;
}

export function applyExtensionSettingChanges(
  current: ExtensionSettings,
  changes: Partial<Record<keyof ExtensionSettings, ExtensionSettingChange>>
): ExtensionSettings {
  const next = { ...current } as unknown as Record<keyof ExtensionSettings, unknown>;

  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof ExtensionSettings>) {
    const change = changes[key];
    if (!change) continue;
    next[key] = change.newValue;
  }

  return normalizeExtensionSettings(next);
}
