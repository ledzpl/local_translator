import { describe, expect, it } from "vitest";
import type { TranslationJobState, TranslationResponse } from "./protocol";
import { TranslationJobCoordinator } from "./translation-job";

function runningJob(requestId: string): TranslationJobState {
  return {
    requestId,
    state: "running",
    text: requestId,
    sourceLanguage: "en",
    startedAt: 1,
    updatedAt: 1
  };
}

function success(requestId: string): TranslationResponse {
  return {
    ok: true,
    requestId,
    translation: "번역",
    sourceLanguage: "en",
    device: "wasm",
    elapsedMs: 1
  };
}

function createCoordinator() {
  let stored: TranslationJobState | null = null;
  const coordinator = new TranslationJobCoordinator({
    read: async () => stored,
    write: async (job) => {
      await Promise.resolve();
      stored = job;
    },
    clear: async () => {
      stored = null;
    }
  });
  return { coordinator, read: () => stored };
}

describe("translation job coordinator", () => {
  it("allows only one of two concurrent starts", async () => {
    const { coordinator, read } = createCoordinator();
    const [first, second] = await Promise.all([
      coordinator.start(runningJob("first")),
      coordinator.start(runningJob("second"))
    ]);
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(read()?.requestId).toBe("first");
  });

  it("does not let completion overwrite a cancellation that won first", async () => {
    const { coordinator, read } = createCoordinator();
    await coordinator.start(runningJob("job"));
    const cancelled: TranslationResponse = {
      ok: false,
      requestId: "job",
      code: "TRANSLATION_CANCELLED",
      error: "취소"
    };
    const [cancel, complete] = await Promise.all([
      coordinator.cancel("job", cancelled),
      coordinator.complete("job", success("job"))
    ]);
    expect(cancel.changed).toBe(true);
    expect(complete.changed).toBe(false);
    expect(read()?.state).toBe("cancelled");
  });

  it("rejects running and stale job clears", async () => {
    const { coordinator, read } = createCoordinator();
    await coordinator.start(runningJob("current"));
    expect((await coordinator.clear("current")).changed).toBe(false);
    await coordinator.complete("current", success("current"));
    expect((await coordinator.clear("older")).changed).toBe(false);
    expect(read()?.requestId).toBe("current");
    expect((await coordinator.clear("current")).changed).toBe(true);
    expect(read()).toBeNull();
  });
});
