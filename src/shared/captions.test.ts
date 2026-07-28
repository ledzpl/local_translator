import { describe, expect, it } from "vitest";
import { captionStillMatches, joinCaptionSegments } from "./captions";

describe("YouTube caption helpers", () => {
  it("joins YouTube caption segments without duplicated whitespace", () => {
    expect(joinCaptionSegments(["Hello ", "  from", "\nYouTube"])).toBe("Hello from YouTube");
  });

  it("allows a translated partial cue while YouTube appends words", () => {
    expect(captionStillMatches("This is a growing caption", "This is")).toBe(true);
    expect(captionStillMatches("A new caption", "This is")).toBe(false);
  });
});
