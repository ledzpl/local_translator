import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVACY_CONSENT_VERSION,
  hasPrivacyConsent
} from "./privacy";

describe("privacy consent", () => {
  it("requires the current disclosure version", () => {
    expect(hasPrivacyConsent({ privacyConsentVersion: 0 })).toBe(false);
    expect(hasPrivacyConsent({
      privacyConsentVersion: CURRENT_PRIVACY_CONSENT_VERSION
    })).toBe(true);
  });
});
