import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_PREFERENCE,
  M2M100_REVISION,
  MODEL_DEFINITIONS,
  SMALL100_KOREAN_TOKEN_ID,
  SMALL100_REVISION,
  TRANSLATEGEMMA_MODEL_ID,
  TRANSLATEGEMMA_REVISION,
  TTS_MODEL_ID,
  TTS_MODEL_REVISION,
  createSmall100InputIds,
  getTtsModelFileUrl
} from "./models";

describe("translation model configuration", () => {
  it("uses the stronger multilingual model as the release default", () => {
    expect(DEFAULT_MODEL_PREFERENCE).toBe("translategemma");
    expect(DEFAULT_MODEL_ID).toBe(
      "onnx-community/translategemma-text-4b-it-ONNX"
    );
  });

  it("pins the optimized SMaLL-100 conversion", () => {
    expect(MODEL_DEFINITIONS.small100.id).toBe("casawolice/small100-onnx");
    expect(SMALL100_REVISION).toBe("5c2c73ac70bee9c58f5a7ac5e84a36bee25db8ee");
  });

  it("pins every remotely downloaded model to a reviewed commit", () => {
    expect(M2M100_REVISION).toBe("9c374f0b7aca709787cea97b047bfbbd1559d177");
    expect(TRANSLATEGEMMA_MODEL_ID).toBe(
      "onnx-community/translategemma-text-4b-it-ONNX"
    );
    expect(TRANSLATEGEMMA_REVISION).toBe(
      "f7874a1ac60758872a4f78aac0df95b17b776994"
    );
    expect(TTS_MODEL_ID).toBe("Supertone/supertonic-3");
    expect(TTS_MODEL_REVISION).toBe("3cadd1ee6394adea1bd021217a0e650ede09a323");
    expect(getTtsModelFileUrl("onnx/tts.json")).toBe(
      `https://huggingface.co/Supertone/supertonic-3/resolve/` +
      `${TTS_MODEL_REVISION}/onnx/tts.json`
    );
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
