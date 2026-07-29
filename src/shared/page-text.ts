import { containsMostlyKorean } from "./languages";
import { chunkText, normalizeText } from "./text";

export const PAGE_TRANSLATION_MAX_BLOCKS = 40;
export const PAGE_TRANSLATION_MAX_CHARS = 12_000;
export const PAGE_TRANSLATION_MAX_CHARS_PER_BLOCK = 2_000;

export function getPageTranslationTerminalState(
  total: number,
  failed: number
): "complete" | "partial" | "error" {
  if (total > 0 && failed >= total) return "error";
  return failed > 0 ? "partial" : "complete";
}

export function pageTranslationSourceStillMatches(
  isConnected: boolean,
  sourceSnapshot: string,
  currentText: string
): boolean {
  return isConnected && normalizeText(currentText) === sourceSnapshot;
}

export function getPageTranslationText(text: string): string | null {
  const normalized = normalizeText(text);
  if (
    normalized.length < 2 ||
    normalized.length > PAGE_TRANSLATION_MAX_CHARS_PER_BLOCK
  ) {
    return null;
  }
  if (!/\p{L}/u.test(normalized)) return null;
  if (containsMostlyKorean(normalized)) return null;
  return normalized;
}

export function getPageTranslationTexts(text: string): string[] {
  const normalized = normalizeText(text);
  if (normalized.length < 2 || !/\p{L}/u.test(normalized)) return [];
  if (containsMostlyKorean(normalized)) return [];
  return chunkText(normalized, PAGE_TRANSLATION_MAX_CHARS_PER_BLOCK);
}

export function isLikelyProsePreformatted(text: string): boolean {
  const normalized = normalizeText(text);
  if (normalized.split(/\s+/u).length < 8) return false;
  if (
    /(?:^|\n)\s*(?:[$>#]|const\b|let\b|var\b|function\b|class\b|import\b|export\b|SELECT\b|INSERT\b|curl\b)/imu
      .test(text)
  ) {
    return false;
  }
  if (/[{}][^.!?]{0,80}[{}]|=>|<\/?[a-z][^>]*>|;\s*(?:\n|$)/iu.test(text)) {
    return false;
  }
  return getPageTranslationTexts(normalized).length > 0;
}

export interface PageTranslationCandidate<T> {
  value: T;
  sourceText: string;
  visible: boolean;
}

export function prioritizePageTranslationCandidates<T>(
  candidates: readonly PageTranslationCandidate<T>[],
  maxBlocks = PAGE_TRANSLATION_MAX_BLOCKS,
  maxChars = PAGE_TRANSLATION_MAX_CHARS
): Array<PageTranslationCandidate<T>> {
  const ordered = [
    ...candidates.filter((candidate) => candidate.visible),
    ...candidates.filter((candidate) => !candidate.visible)
  ];
  const selected: Array<PageTranslationCandidate<T>> = [];
  let totalChars = 0;

  for (const candidate of ordered) {
    if (
      selected.length >= maxBlocks ||
      totalChars + candidate.sourceText.length > maxChars
    ) {
      continue;
    }
    selected.push(candidate);
    totalChars += candidate.sourceText.length;
  }
  return selected;
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
