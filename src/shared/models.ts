import modelLock from "../../models.lock.json";

export const SMALL100_MODEL_ID = modelLock.small100.id;
export const SMALL100_REVISION = modelLock.small100.revision;
export const SMALL100_KOREAN_TOKEN_ID = 128052;
export const M2M100_MODEL_ID = modelLock.m2m100.id;
export const M2M100_REVISION = modelLock.m2m100.revision;
export const TRANSLATEGEMMA_MODEL_ID = modelLock.translategemma.id;
export const TRANSLATEGEMMA_REVISION = modelLock.translategemma.revision;
export const TTS_MODEL_ID = modelLock.tts.id;
export const TTS_MODEL_REVISION = modelLock.tts.revision;
export const TTS_VOICE_STYLE = "M1";

export function getTtsModelFileUrl(path: string): string {
  return `https://huggingface.co/${TTS_MODEL_ID}/resolve/${TTS_MODEL_REVISION}/${path}`;
}

export type ModelPreference = "translategemma" | "small100" | "m2m100";
export const DEFAULT_MODEL_PREFERENCE: ModelPreference = "translategemma";

export interface ModelDefinition {
  id: string;
  label: string;
  downloadSize: string;
  deviceNote: string;
}

export const MODEL_DEFINITIONS: Record<ModelPreference, ModelDefinition> = {
  translategemma: {
    id: TRANSLATEGEMMA_MODEL_ID,
    label: "TranslateGemma 4B",
    downloadSize: "약 3.1GB",
    deviceNote: "WebGPU 전용 · 미지원 시 M2M100 WASM 폴백"
  },
  small100: {
    id: SMALL100_MODEL_ID,
    label: "SMaLL-100",
    downloadSize: "약 620MB",
    deviceNote: "WASM 최적화"
  },
  m2m100: {
    id: M2M100_MODEL_ID,
    label: "M2M100",
    downloadSize: "경로별 약 650~750MB",
    deviceNote: "WASM 또는 WebGPU"
  }
};

export const DEFAULT_MODEL_ID =
  MODEL_DEFINITIONS[DEFAULT_MODEL_PREFERENCE].id;

export function createSmall100InputIds(
  sourceIds: ArrayLike<number | bigint>
): BigInt64Array {
  const inputIds = new BigInt64Array(sourceIds.length + 1);
  inputIds[0] = BigInt(SMALL100_KOREAN_TOKEN_ID);
  for (let index = 0; index < sourceIds.length; index += 1) {
    inputIds[index + 1] = BigInt(sourceIds[index]!);
  }
  return inputIds;
}
