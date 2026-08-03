import {
  DEFAULT_SETTINGS,
  type ExtensionSettings
} from "./protocol";

export interface ExtensionSettingChange {
  newValue?: unknown;
}

export function applyExtensionSettingChanges(
  current: ExtensionSettings,
  changes: Partial<Record<keyof ExtensionSettings, ExtensionSettingChange>>
): ExtensionSettings {
  const next = { ...current };
  const mutable = next as unknown as Record<keyof ExtensionSettings, unknown>;

  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof ExtensionSettings>) {
    const change = changes[key];
    if (!change) continue;
    mutable[key] = change.newValue ?? DEFAULT_SETTINGS[key];
  }

  return next;
}
