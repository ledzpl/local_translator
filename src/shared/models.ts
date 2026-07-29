export const SMALL100_MODEL_ID = "casawolice/small100-onnx";
export const SMALL100_REVISION = "5c2c73ac70bee9c58f5a7ac5e84a36bee25db8ee";
export const SMALL100_KOREAN_TOKEN_ID = 128052;
export const M2M100_MODEL_ID = "Xenova/m2m100_418M";
export const M2M100_REVISION = "9c374f0b7aca709787cea97b047bfbbd1559d177";
export const TTS_MODEL_ID = "Supertone/supertonic-3";
export const TTS_MODEL_REVISION = "3cadd1ee6394adea1bd021217a0e650ede09a323";
export const TTS_VOICE_STYLE = "M1";

export function getTtsModelFileUrl(path: string): string {
  return `https://huggingface.co/${TTS_MODEL_ID}/resolve/${TTS_MODEL_REVISION}/${path}`;
}

export type ModelPreference = "small100" | "m2m100";
export const DEFAULT_MODEL_PREFERENCE: ModelPreference = "m2m100";

export interface ModelDefinition {
  id: string;
  label: string;
  downloadSize: string;
  deviceNote: string;
}

export const MODEL_DEFINITIONS: Record<ModelPreference, ModelDefinition> = {
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

export function isM2m100WebGpuWeightUrl(value: string): boolean {
  let normalized = value;
  try {
    normalized = decodeURIComponent(value);
  } catch {
    // A malformed cache key cannot match the reviewed model path below.
  }
  normalized = normalized.toLowerCase();
  return (
    normalized.includes("/xenova/m2m100_418m/") &&
    /\/onnx\/[^/?#]*_q4f16\.onnx(?:[?#]|$)/u.test(normalized)
  );
}

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
