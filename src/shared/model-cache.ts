import {
  M2M100_MODEL_ID,
  SMALL100_MODEL_ID,
  TRANSLATEGEMMA_MODEL_ID,
  type ModelPreference
} from "./models";

export const ALL_TRANSLATION_MODEL_IDS: readonly string[] = [
  TRANSLATEGEMMA_MODEL_ID,
  M2M100_MODEL_ID,
  SMALL100_MODEL_ID
];

export function translationModelIdForPreference(
  preference: ModelPreference
): string {
  return preference === "translategemma"
    ? TRANSLATEGEMMA_MODEL_ID
    : preference === "m2m100"
      ? M2M100_MODEL_ID
      : SMALL100_MODEL_ID;
}

export interface LiveTranslationEngineState {
  /** Preference recorded when the current load started, if any. */
  loadedModelPreference: ModelPreference | null;
  /** Kind of the engine that finished loading, if one is live. */
  engineKind: ModelPreference | null;
  /** True while an engine object or its load promise is still held. */
  loadInFlight: boolean;
  /** Model id the broadcast engine status currently points at. */
  statusModelId: string | null;
}

/**
 * Model ids the live translation engine depends on.
 *
 * A load can fall back to another model (SMaLL-100 or TranslateGemma to
 * M2M100), so the requested preference alone does not say which weights are in
 * use. Reporting every id keeps a cache clear from deleting files underneath a
 * running engine.
 */
export function liveTranslationModelIds(
  state: LiveTranslationEngineState
): string[] {
  const ids = new Set<string>();
  if (state.loadedModelPreference) {
    ids.add(translationModelIdForPreference(state.loadedModelPreference));
  }
  // An idle status still names the default model, so only trust it while an
  // engine or its load promise is actually held.
  if (state.loadInFlight) {
    if (state.engineKind) {
      ids.add(translationModelIdForPreference(state.engineKind));
    }
    if (state.statusModelId) ids.add(state.statusModelId);
  }
  return [...ids];
}

export function selectedTranslationModelIdsForClear(options: {
  preference: ModelPreference | undefined;
  includeTranslation: boolean;
}): string[] {
  if (!options.includeTranslation) return [];
  return options.preference
    ? [translationModelIdForPreference(options.preference)]
    : [...ALL_TRANSLATION_MODEL_IDS];
}

export function shouldResetEngineForModelCacheClear(options: {
  preference: ModelPreference | undefined;
  includeTranslation: boolean;
  liveModelIds: readonly string[];
}): boolean {
  if (!options.includeTranslation) return false;
  // Clearing every translation cache invalidates whatever is loaded, and also
  // republishes an idle status after a failed load left an error behind.
  if (!options.preference) return true;
  return options.liveModelIds.includes(
    translationModelIdForPreference(options.preference)
  );
}
