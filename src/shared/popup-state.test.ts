import { describe, expect, it } from "vitest";
import type { TranslationJobState } from "./protocol";
import {
  shouldApplyInitialSelection,
  shouldApplyRuntimeSnapshot,
  shouldApplyTranslationJobAction,
  shouldApplyTrackedTranslationResponse,
  shouldApplyUntrackedTranslationResponse,
  shouldLockModelControls
} from "./popup-state";

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

describe("initial runtime snapshots", () => {
  it("applies a snapshot only when no newer live update arrived", () => {
    expect(shouldApplyRuntimeSnapshot(2, 2)).toBe(true);
    expect(shouldApplyRuntimeSnapshot(2, 3)).toBe(false);
  });

  it("does not let a late action response replace a newer or cleared job", () => {
    const job = (
      requestId: string,
      state: TranslationJobState["state"],
      updatedAt: number
    ): TranslationJobState => ({
      requestId,
      state,
      text: requestId,
      sourceLanguage: "en",
      startedAt: 1,
      updatedAt
    });
    expect(shouldApplyTranslationJobAction(
      "old",
      job("old", "running", 1),
      job("old", "cancelled", 2)
    )).toBe(true);
    expect(shouldApplyTranslationJobAction(
      "old",
      job("new", "running", 3),
      job("old", "cancelled", 2)
    )).toBe(false);
    expect(shouldApplyTranslationJobAction(
      "old",
      job("old", "complete", 3),
      job("old", "running", 2)
    )).toBe(false);
    expect(shouldApplyTranslationJobAction("old", null, null)).toBe(false);
  });

  it("keeps model controls locked for every model mutation phase", () => {
    expect(shouldLockModelControls({
      preparing: true,
      clearingCache: false,
      updatingSettings: false
    })).toBe(true);
    expect(shouldLockModelControls({
      preparing: false,
      clearingCache: true,
      updatingSettings: false
    })).toBe(true);
    expect(shouldLockModelControls({
      preparing: false,
      clearingCache: false,
      updatingSettings: true
    })).toBe(true);
  });

  it("drops a late direct translation response after live job state changed", () => {
    expect(shouldApplyUntrackedTranslationResponse({
      requestRevision: 2,
      currentRevision: 2,
      jobRequestIdAtStart: "previous",
      currentJobRequestId: "previous"
    })).toBe(true);
    expect(shouldApplyUntrackedTranslationResponse({
      requestRevision: 2,
      currentRevision: 4,
      jobRequestIdAtStart: "previous",
      currentJobRequestId: "new"
    })).toBe(false);
  });

  it("keeps a same-request terminal broadcast authoritative", () => {
    const cancelled: TranslationJobState = {
      requestId: "request",
      state: "cancelled",
      text: "text",
      sourceLanguage: "en",
      startedAt: 1,
      updatedAt: 2
    };
    expect(shouldApplyTrackedTranslationResponse("request", cancelled)).toBe(false);
    expect(shouldApplyTrackedTranslationResponse("request", {
      ...cancelled,
      state: "running"
    })).toBe(true);
  });
});
