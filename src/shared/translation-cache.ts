import type {
  DevicePreference,
  ModelPreference
} from "./protocol";

export function createTranslationCacheKey(
  modelPreference: ModelPreference,
  devicePreference: DevicePreference,
  sourceLanguage: string,
  text: string,
  context = "",
  glossarySignature = ""
): string {
  return [
    modelPreference,
    devicePreference,
    sourceLanguage,
    text,
    context,
    glossarySignature
  ].join("\u0000");
}
