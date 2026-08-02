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
  const markerIndex = translated.toUpperCase().lastIndexOf(TRANSLATION_CONTEXT_MARKER);
  if (markerIndex < 0) return null;
  return translated.slice(markerIndex + TRANSLATION_CONTEXT_MARKER.length).trim();
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
