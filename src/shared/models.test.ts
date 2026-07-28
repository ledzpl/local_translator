import { describe, expect, it } from "vitest";
import {
  MODEL_DEFINITIONS,
  SMALL100_KOREAN_TOKEN_ID,
  SMALL100_REVISION,
  createSmall100InputIds
} from "./models";

describe("translation model configuration", () => {
  it("pins the optimized SMaLL-100 conversion", () => {
    expect(MODEL_DEFINITIONS.small100.id).toBe("casawolice/small100-onnx");
    expect(SMALL100_REVISION).toHaveLength(40);
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
