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
  settings: Pick<
    ExtensionSettings,
    "modelPreference" | "devicePreference" | "youtubeTranslationMode"
  >,
  context = ""
): string {
  return [
    settings.modelPreference,
    settings.devicePreference,
    settings.youtubeTranslationMode,
    context,
    text
  ].join("\u0000");
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

export type CaptionRetryDecision = "scheduled" | "stale" | "exhausted";

export function decideCaptionRetry(options: {
  generationChanged: boolean;
  currentCaption: string;
  sourceText: string;
  nextAttempt: number;
  maxAttempts?: number;
}): CaptionRetryDecision {
  if (
    options.generationChanged ||
    !captionStillMatches(options.currentCaption, options.sourceText)
  ) {
    return "stale";
  }
  return options.nextAttempt > (options.maxAttempts ?? 2)
    ? "exhausted"
    : "scheduled";
}
