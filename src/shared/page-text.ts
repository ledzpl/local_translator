import { containsMostlyKorean } from "./languages";
import { normalizeText } from "./text";

export const PAGE_TRANSLATION_MAX_BLOCKS = 40;
export const PAGE_TRANSLATION_MAX_CHARS = 12_000;

export function getPageTranslationText(text: string): string | null {
  const normalized = normalizeText(text);
  if (normalized.length < 2 || normalized.length > 2_000) return null;
  if (!/\p{L}/u.test(normalized)) return null;
  if (containsMostlyKorean(normalized)) return null;
  return normalized;
}

export function limitPageTranslationTexts(
  texts: readonly string[],
  maxBlocks = PAGE_TRANSLATION_MAX_BLOCKS,
  maxChars = PAGE_TRANSLATION_MAX_CHARS
): string[] {
  const selected: string[] = [];
  let totalChars = 0;
  for (const text of texts) {
    if (selected.length >= maxBlocks || totalChars + text.length > maxChars) break;
    selected.push(text);
    totalChars += text.length;
  }
  return selected;
}
