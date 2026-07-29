import { normalizeText } from "./text";
import type { ExtensionSettings } from "./protocol";

export function joinCaptionSegments(segments: Iterable<string | null | undefined>): string {
  return normalizeText(Array.from(segments, (segment) => segment ?? "").join(" "));
}

export function isYoutubeCaptionWindowVisible(options: {
  hasLayoutBox: boolean;
  hidden: boolean | string;
  ariaHidden: string | null;
  display: string;
  opacity: string;
  visibility: string;
}): boolean {
  const opacity = Number.parseFloat(options.opacity);
  return (
    options.hasLayoutBox &&
    !options.hidden &&
    options.ariaHidden?.trim().toLowerCase() !== "true" &&
    options.display !== "none" &&
    (Number.isNaN(opacity) || opacity > 0) &&
    options.visibility !== "hidden" &&
    options.visibility !== "collapse"
  );
}

export function captionStillMatches(current: string, translatedSource: string): boolean {
  return current === translatedSource || current.startsWith(`${translatedSource} `);
}

export function captionTranslationKey(
  text: string,
  settings: Pick<ExtensionSettings, "modelPreference" | "devicePreference">
): string {
  return `${settings.modelPreference}\u0000${settings.devicePreference}\u0000${text}`;
}

export function shouldRequestPendingCaption(options: {
  pendingCaption: string;
  currentCaption: string;
  sourceText: string;
  requestKey: string;
  currentRequestKey: string;
  generationChanged: boolean;
}): boolean {
  return Boolean(
    options.pendingCaption &&
    options.pendingCaption === options.currentCaption &&
    (
      options.pendingCaption !== options.sourceText ||
      options.generationChanged ||
      options.currentRequestKey !== options.requestKey
    )
  );
}
