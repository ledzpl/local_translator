import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_PREFERENCE,
  M2M100_REVISION,
  MODEL_DEFINITIONS,
  SMALL100_KOREAN_TOKEN_ID,
  SMALL100_REVISION,
  TTS_MODEL_REVISION,
  createSmall100InputIds,
  isM2m100WebGpuWeightUrl
} from "./models";

describe("translation model configuration", () => {
  it("uses the stronger multilingual model as the release default", () => {
    expect(DEFAULT_MODEL_PREFERENCE).toBe("m2m100");
    expect(DEFAULT_MODEL_ID).toBe("Xenova/m2m100_418M");
  });

  it("pins the optimized SMaLL-100 conversion", () => {
    expect(MODEL_DEFINITIONS.small100.id).toBe("casawolice/small100-onnx");
    expect(SMALL100_REVISION).toBe("5c2c73ac70bee9c58f5a7ac5e84a36bee25db8ee");
  });

  it("pins every remotely downloaded model to a reviewed commit", () => {
    expect(M2M100_REVISION).toBe("9c374f0b7aca709787cea97b047bfbbd1559d177");
    expect(TTS_MODEL_REVISION).toBe("76e23d9c3552b7b29a1074d664e6a1337d3e24ef");
  });

  it("identifies only the failed M2M100 WebGPU weight cache entries", () => {
    expect(isM2m100WebGpuWeightUrl(
      "https://huggingface.co/Xenova/m2m100_418M/resolve/revision/onnx/encoder_model_q4f16.onnx"
    )).toBe(true);
    expect(isM2m100WebGpuWeightUrl(
      "https://huggingface.co/Xenova%2Fm2m100_418M/resolve/revision/onnx/decoder_model_merged_q4f16.onnx"
    )).toBe(true);
    expect(isM2m100WebGpuWeightUrl(
      "https://huggingface.co/Xenova/m2m100_418M/resolve/revision/onnx/encoder_model_quantized.onnx"
    )).toBe(false);
    expect(isM2m100WebGpuWeightUrl(
      "https://huggingface.co/other/model/resolve/revision/onnx/encoder_model_q4f16.onnx"
    )).toBe(false);
  });

  it("prepends the Korean target token without changing source ids", () => {
    const result = createSmall100InputIds(new BigInt64Array([42n, 2n]));

    expect(Array.from(result)).toEqual([
      BigInt(SMALL100_KOREAN_TOKEN_ID),
      42n,
      2n
    ]);
  });
});
