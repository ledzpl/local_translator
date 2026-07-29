import type { ExtensionSettings } from "./protocol";

export const CURRENT_PRIVACY_CONSENT_VERSION = 1;

export function hasPrivacyConsent(
  settings: Pick<ExtensionSettings, "privacyConsentVersion">
): boolean {
  return settings.privacyConsentVersion >= CURRENT_PRIVACY_CONSENT_VERSION;
}
