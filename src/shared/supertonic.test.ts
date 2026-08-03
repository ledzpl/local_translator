import { describe, expect, it } from "vitest";
import {
  SupertonicEngine,
  encodeSupertonicText,
  preprocessSupertonicText,
  releaseSupertonicSessions,
  shouldRefreshSupertonicCache
} from "./supertonic";

describe("SupertonicEngine loading", () => {
  it("stops before cache or network work when the load was invalidated", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(SupertonicEngine.load({
      modelBaseUrl: "https://example.invalid/onnx",
      voiceStyleUrl: "https://example.invalid/M1.json",
      device: "wasm",
      signal: controller.signal
    })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("waits for every session release before reporting a cleanup failure", async () => {
    let finishSlowRelease!: () => void;
    let slowReleaseFinished = false;
    const slowRelease = new Promise<void>((resolve) => {
      finishSlowRelease = () => {
        slowReleaseFinished = true;
        resolve();
      };
    });
    const release = releaseSupertonicSessions([
      { release: async () => { throw new Error("release failed"); } },
      { release: () => slowRelease }
    ]);
    let rejected = false;
    void release.catch(() => {
      rejected = true;
    });

    await Promise.resolve();
    expect(rejected).toBe(false);
    finishSlowRelease();
    await expect(release).rejects.toBeInstanceOf(AggregateError);
    expect(slowReleaseFinished).toBe(true);
  });
});

describe("preprocessSupertonicText", () => {
  it("한국어를 NFKD로 정규화하고 언어 태그를 붙인다", () => {
    const result = preprocessSupertonicText(" 안녕하세요 😊 ", "ko");

    expect(result).toBe(`<ko>${"안녕하세요".normalize("NFKD")}.</ko>`);
  });

  it("문장 부호가 이미 있으면 마침표를 중복하지 않는다", () => {
    expect(preprocessSupertonicText("온글 AI 2026!", "ko"))
      .toBe(`<ko>${"온글".normalize("NFKD")} AI 2026!</ko>`);
  });
});

describe("encodeSupertonicText", () => {
  it("Unicode indexer를 사용해 모델 입력 ID를 만든다", () => {
    const indexer = new Array<number>(128).fill(-1);
    indexer["<".codePointAt(0)!] = 7;
    indexer["k".codePointAt(0)!] = 8;
    indexer["o".codePointAt(0)!] = 9;

    expect(encodeSupertonicText("<ko", indexer)).toEqual([7, 8, 9]);
  });

  it("indexer가 지원하지 않는 문자를 거부한다", () => {
    expect(() => encodeSupertonicText("가", []))
      .toThrow("지원하지 않는 문자");
  });
});

describe("shouldRefreshSupertonicCache", () => {
  it("retries malformed model data but preserves caches for hardware failures", () => {
    expect(shouldRefreshSupertonicCache(
      new Error("Failed to load model because protobuf parsing failed")
    )).toBe(true);
    expect(shouldRefreshSupertonicCache(
      new SyntaxError("Unexpected end of JSON input")
    )).toBe(true);
    expect(shouldRefreshSupertonicCache(
      new Error("Failed to create WebGPU buffer: out of memory")
    )).toBe(false);
    expect(shouldRefreshSupertonicCache(
      new Error("no available backend found")
    )).toBe(false);
  });
});
