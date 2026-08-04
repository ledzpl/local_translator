export const TRANSLATION_CONTEXT_MARKER = "ZXQONGEULCONTEXTQXZ";

export interface ContextualTranslationInput {
  text: string;
  marker: string | null;
}

export function createContextualTranslationInput(
  text: string,
  context?: string
): ContextualTranslationInput {
  const normalizedContext = String(context ?? "").trim();
  if (!normalizedContext) return { text, marker: null };
  const marker = createUnusedContextMarker(normalizedContext, text);
  return {
    text: `${normalizedContext}\n${marker}\n${text}`,
    marker
  };
}

export function extractContextualTranslation(
  translated: string,
  marker: string | null
): string | null {
  if (!marker) return translated.trim();
  const match = new RegExp(marker, "iu").exec(translated);
  if (!match) return null;
  return translated.slice(match.index + match[0].length).trim();
}

function createUnusedContextMarker(context: string, text: string): string {
  const source = `${context}\n${text}`.toUpperCase();
  let marker = TRANSLATION_CONTEXT_MARKER;
  let suffix = 0;
  while (source.includes(marker)) {
    suffix += 1;
    marker = `${TRANSLATION_CONTEXT_MARKER}${suffix}QXZ`;
  }
  return marker;
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
