import { normalizeText } from "./text";

export function joinCaptionSegments(segments: Iterable<string | null | undefined>): string {
  return normalizeText(Array.from(segments, (segment) => segment ?? "").join(" "));
}

export function captionStillMatches(current: string, translatedSource: string): boolean {
  return current === translatedSource || current.startsWith(`${translatedSource} `);
}
