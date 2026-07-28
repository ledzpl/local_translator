export interface LanguageOption {
  code: string;
  label: string;
}

export const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { code: "auto", label: "언어 자동 감지" },
  { code: "en", label: "영어" },
  { code: "ja", label: "일본어" },
  { code: "zh", label: "중국어" },
  { code: "es", label: "스페인어" },
  { code: "fr", label: "프랑스어" },
  { code: "de", label: "독일어" },
  { code: "pt", label: "포르투갈어" },
  { code: "ru", label: "러시아어" },
  { code: "ar", label: "아랍어" },
  { code: "hi", label: "힌디어" },
  { code: "vi", label: "베트남어" },
  { code: "th", label: "태국어" },
  { code: "id", label: "인도네시아어" },
  { code: "it", label: "이탈리아어" },
  { code: "nl", label: "네덜란드어" },
  { code: "pl", label: "폴란드어" },
  { code: "tr", label: "튀르키예어" },
  { code: "uk", label: "우크라이나어" }
] as const;

const SUPPORTED = new Set([
  "af", "am", "ar", "ast", "az", "ba", "be", "bg", "bn", "br", "bs", "ca", "ceb",
  "cs", "cy", "da", "de", "el", "en", "es", "et", "fa", "ff", "fi", "fr", "fy", "ga",
  "gd", "gl", "gu", "ha", "he", "hi", "hr", "ht", "hu", "hy", "id", "ig", "ilo", "is",
  "it", "ja", "jv", "ka", "kk", "km", "kn", "ko", "lb", "lg", "ln", "lo", "lt", "lv",
  "mg", "mk", "ml", "mn", "mr", "ms", "my", "ne", "nl", "nn", "no", "ns", "oc", "or",
  "pa", "pl", "ps", "pt", "ro", "ru", "sd", "si", "sk", "sl", "so", "sq", "sr", "ss",
  "su", "sv", "sw", "ta", "th", "tl", "tn", "tr", "uk", "ur", "uz", "vi", "wo", "xh",
  "yi", "yo", "zh", "zu"
]);

const LANGUAGE_ALIASES: Record<string, string> = {
  "cmn": "zh",
  "fil": "tl",
  "iw": "he",
  "nb": "no",
  "zh-cn": "zh",
  "zh-hans": "zh",
  "zh-hant": "zh",
  "zh-tw": "zh"
};

export function normalizeLanguageCode(code: string | undefined): string {
  if (!code) return "en";
  const normalized = code.trim().toLowerCase().replace("_", "-");
  const aliased = LANGUAGE_ALIASES[normalized] ?? normalized.split("-")[0] ?? "en";
  return SUPPORTED.has(aliased) ? aliased : "en";
}

export function containsMostlyKorean(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return false;
  const korean = text.match(/[가-힣ㄱ-ㅎㅏ-ㅣ]/g) ?? [];
  return korean.length / letters.length >= 0.55;
}

export function pickDetectedLanguage(
  languages: readonly { language: string; percentage: number }[]
): string {
  const candidate = [...languages]
    .sort((a, b) => b.percentage - a.percentage)
    .find(({ language }) => normalizeLanguageCode(language) !== "en" || language.startsWith("en"));
  return normalizeLanguageCode(candidate?.language);
}
