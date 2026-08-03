import { describe, expect, it } from "vitest";
import { AsyncTeardownBarrier } from "./async-teardown";

describe("async teardown barrier", () => {
  it("keeps new work blocked until deferred cleanup settles", async () => {
    let finishCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    const barrier = new AsyncTeardownBarrier();
    const teardown = barrier.run(() => cleanup);
    let continued = false;
    const nextWork = barrier.wait().then(() => {
      continued = true;
    });

    await Promise.resolve();
    expect(continued).toBe(false);
    finishCleanup();
    await Promise.all([teardown, nextWork]);
    expect(continued).toBe(true);
  });
});
