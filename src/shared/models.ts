export const SMALL100_MODEL_ID = "casawolice/small100-onnx";
export const SMALL100_REVISION = "5c2c73ac70bee9c58f5a7ac5e84a36bee25db8ee";
export const SMALL100_KOREAN_TOKEN_ID = 128052;
export const M2M100_MODEL_ID = "Xenova/m2m100_418M";

export type ModelPreference = "small100" | "m2m100";

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
    downloadSize: "약 650MB",
    deviceNote: "WASM 또는 WebGPU"
  }
};

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
