import { describe, expect, it } from "vitest";
import { shouldApplyInitialSelection } from "./popup-state";

describe("popup initial selection", () => {
  it("fills an untouched empty input", () => {
    expect(shouldApplyInitialSelection({
      requestRevision: 0,
      currentRevision: 0,
      currentValue: "",
      selectionText: "Selected on the page"
    })).toBe(true);
  });

  it("preserves text edited while runtime state was loading", () => {
    expect(shouldApplyInitialSelection({
      requestRevision: 0,
      currentRevision: 1,
      currentValue: "Text pasted by the user",
      selectionText: "Older page selection"
    })).toBe(false);
  });

  it("does not overwrite a prefilled value even without an input event", () => {
    expect(shouldApplyInitialSelection({
      requestRevision: 0,
      currentRevision: 0,
      currentValue: "Restored input",
      selectionText: "Page selection"
    })).toBe(false);
  });
});
