import { describe, expect, it } from "vitest";
import {
  captionStillMatches,
  captionTranslationKey,
  decideCaptionRetry,
  isYoutubeCaptionWindowVisible,
  joinCaptionSegments,
  shouldRequestPendingCaption
} from "./captions";

describe("YouTube caption helpers", () => {
  it("joins YouTube caption segments without duplicated whitespace", () => {
    expect(joinCaptionSegments(["Hello ", "  from", "\nYouTube"])).toBe("Hello from YouTube");
  });

  it("rejects caption windows hidden by layout, attributes, or CSS", () => {
    const visible = {
      hasLayoutBox: true,
      hidden: false,
      ariaHidden: null,
      display: "block",
      opacity: "1",
      visibility: "visible"
    };
    expect(isYoutubeCaptionWindowVisible(visible)).toBe(true);
    expect(isYoutubeCaptionWindowVisible({
      ...visible,
      hasLayoutBox: false
    })).toBe(false);
    expect(isYoutubeCaptionWindowVisible({
      ...visible,
      hidden: true
    })).toBe(false);
    expect(isYoutubeCaptionWindowVisible({
      ...visible,
      ariaHidden: "true"
    })).toBe(false);
    expect(isYoutubeCaptionWindowVisible({
      ...visible,
      display: "none"
    })).toBe(false);
    expect(isYoutubeCaptionWindowVisible({
      ...visible,
      opacity: "0"
    })).toBe(false);
    expect(isYoutubeCaptionWindowVisible({
      ...visible,
      visibility: "hidden"
    })).toBe(false);
  });

  it("allows a translated partial cue while YouTube appends words", () => {
    expect(captionStillMatches("This is a growing caption", "This is")).toBe(true);
    expect(captionStillMatches("A new caption", "This is")).toBe(false);
  });

  it("separates caption cache entries by model and runtime", () => {
    const text = "A visible caption";
    const wasm = captionTranslationKey(text, {
      modelPreference: "small100",
      devicePreference: "wasm",
      youtubeTranslationMode: "speed"
    });
    const webgpu = captionTranslationKey(text, {
      modelPreference: "m2m100",
      devicePreference: "webgpu",
      youtubeTranslationMode: "context"
    });
    expect(wasm).not.toBe(webgpu);
  });

  it("separates the same caption by preceding context", () => {
    const settings = {
      modelPreference: "m2m100" as const,
      devicePreference: "wasm" as const,
      youtubeTranslationMode: "context" as const
    };
    expect(captionTranslationKey("It works", settings, "The browser is ready"))
      .not.toBe(captionTranslationKey("It works", settings, "The model is ready"));
  });

  it("requeues the same visible caption when settings changed in flight", () => {
    expect(shouldRequestPendingCaption({
      pendingCaption: "A visible caption",
      currentCaption: "A visible caption",
      sourceText: "A visible caption",
      requestKey: "small100\u0000wasm\u0000A visible caption",
      currentRequestKey: "m2m100\u0000wasm\u0000A visible caption",
      generationChanged: true
    })).toBe(true);
  });

  it("does not duplicate the same request after an unchanged cue mutation", () => {
    const requestKey = "small100\u0000wasm\u0000A visible caption";
    expect(shouldRequestPendingCaption({
      pendingCaption: "A visible caption",
      currentCaption: "A visible caption",
      sourceText: "A visible caption",
      requestKey,
      currentRequestKey: requestKey,
      generationChanged: false
    })).toBe(false);
  });

  it("does not hide a newer cached cue when an older request fails", () => {
    expect(decideCaptionRetry({
      generationChanged: false,
      currentCaption: "new cached cue",
      sourceText: "old request",
      nextAttempt: 1
    })).toBe("stale");
    expect(decideCaptionRetry({
      generationChanged: false,
      currentCaption: "current cue",
      sourceText: "current cue",
      nextAttempt: 3
    })).toBe("exhausted");
  });
});
