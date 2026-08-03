export const TRANSLATION_CONTEXT_MARKER = "ZXQONGEULCONTEXTQXZ";

export function createContextualTranslationInput(
  text: string,
  context?: string
): string {
  const normalizedContext = String(context ?? "").trim();
  if (!normalizedContext) return text;
  return `${normalizedContext}\n${TRANSLATION_CONTEXT_MARKER}\n${text}`;
}

export function extractContextualTranslation(
  translated: string,
  hasContext: boolean
): string | null {
  if (!hasContext) return translated.trim();
  const markerPattern = new RegExp(TRANSLATION_CONTEXT_MARKER, "giu");
  let lastMatch: RegExpExecArray | null = null;
  for (let match = markerPattern.exec(translated); match; match = markerPattern.exec(translated)) {
    lastMatch = match;
  }
  if (!lastMatch) return null;
  return translated.slice(lastMatch.index + lastMatch[0].length).trim();
}

export function createCaptionContext(
  captions: readonly string[],
  current: string,
  maxChars = 260
): string {
  const unique: string[] = [];
  for (const caption of captions) {
    const normalized = caption.trim();
    if (!normalized || normalized === current || unique.at(-1) === normalized) continue;
    unique.push(normalized);
  }
  while (unique.join(" ").length > maxChars && unique.length > 1) unique.shift();
  return unique.join(" ").slice(-maxChars);
}
