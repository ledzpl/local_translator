import * as ort from "onnxruntime-web/webgpu";
import { describe, expect, it, vi } from "vitest";
import {
  SupertonicEngine,
  encodeSupertonicText,
  preprocessSupertonicText,
  releaseSupertonicResources,
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

  it("releases style tensors even when a session release fails", async () => {
    const released: string[] = [];
    await expect(releaseSupertonicResources(
      [{ release: async () => { throw new Error("session release failed"); } }],
      [
        { dispose: () => { released.push("ttl"); } },
        { dispose: () => { released.push("dp"); } }
      ]
    )).rejects.toBeInstanceOf(AggregateError);
    expect(released).toEqual(["ttl", "dp"]);
  });

  it("waits for sibling metadata loads before rejecting", async () => {
    let finishIndexer!: () => void;
    const indexerResponse = new Promise<Response>((resolve) => {
      finishIndexer = () => resolve(new Response("[0]"));
    });
    const originalCaches = globalThis.caches;
    const originalFetch = globalThis.fetch;
    Object.assign(globalThis, {
      caches: {
        open: async () => ({
          match: async () => undefined,
          put: async () => undefined,
          delete: async () => true
        })
      },
      fetch: (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/tts.json")) {
          return Promise.reject(new Error("config unavailable"));
        }
        if (url.endsWith("/unicode_indexer.json")) return indexerResponse;
        return Promise.resolve(new Response(JSON.stringify({
          style_ttl: { type: "float32", dims: [1], data: [0] },
          style_dp: { type: "float32", dims: [1], data: [0] }
        })));
      }
    });
    try {
      const loading = SupertonicEngine.load({
        modelBaseUrl: "https://example.invalid/onnx",
        voiceStyleUrl: "https://example.invalid/M1.json",
        device: "wasm"
      });
      let settled = false;
      void loading.then(
        () => { settled = true; },
        () => { settled = true; }
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(false);
      finishIndexer();
      await expect(loading).rejects.toThrow("config unavailable");
    } finally {
      finishIndexer();
      Object.assign(globalThis, {
        caches: originalCaches,
        fetch: originalFetch
      });
    }
  });
});

describe("SupertonicEngine synthesis", () => {
  it("disposes temporary input and output tensors after synthesis", async () => {
    const dispose = vi.spyOn(ort.Tensor.prototype, "dispose");
    let outputDisposals = 0;
    const outputTensor = (data: Float32Array | number[]) => ({
      data,
      dispose: () => { outputDisposals += 1; }
    }) as unknown as ort.Tensor;
    const vectorOutputs = Array.from({ length: 8 }, () =>
      outputTensor(new Float32Array(10).fill(0.1))
    );
    const Engine = SupertonicEngine as unknown as new (
      ...args: unknown[]
    ) => SupertonicEngine;
    const engine = new Engine(
      "wasm",
      {
        ae: { sample_rate: 1_000, base_chunk_size: 10 },
        ttl: { latent_dim: 1, chunk_compress_factor: 1 }
      },
      new Array<number>(70_000).fill(1),
      { ttl: {}, dp: {} },
      { run: async () => ({ duration: outputTensor([0.106]) }) },
      { run: async () => ({ text_emb: outputTensor([0.1]) }) },
      {
        run: async () => ({
          denoised_latent: vectorOutputs.shift()!
        })
      },
      {
        run: async () => ({
          wav_tts: outputTensor(new Float32Array(100).fill(0.1))
        })
      }
    );

    try {
      const result = await engine.synthesize("안녕하세요");
      expect(result.audio).toHaveLength(100);
      expect(dispose).toHaveBeenCalledTimes(21);
      expect(outputDisposals).toBe(11);
    } finally {
      dispose.mockRestore();
    }
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
      new Error("Supertonic 3 설정이 올바르지 않습니다.")
    )).toBe(true);
    expect(shouldRefreshSupertonicCache(
      new Error("Supertonic 3 style_ttl 음성 스타일 크기가 올바르지 않습니다.")
    )).toBe(true);
    expect(shouldRefreshSupertonicCache(
      new Error("Failed to create WebGPU buffer: out of memory")
    )).toBe(false);
    expect(shouldRefreshSupertonicCache(
      new Error("no available backend found")
    )).toBe(false);
  });
});
