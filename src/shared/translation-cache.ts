import type {
  DevicePreference,
  ModelPreference
} from "./protocol";

export function createTranslationCacheKey(
  modelPreference: ModelPreference,
  devicePreference: DevicePreference,
  sourceLanguage: string,
  text: string
): string {
  return [
    modelPreference,
    devicePreference,
    sourceLanguage,
    text
  ].join("\u0000");
}
