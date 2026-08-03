import { describe, expect, it } from "vitest";
import { CancellableRequestRegistry } from "./cancellable-requests";

describe("cancellable request registry", () => {
  it("ignores cancellation tombstones for requests that were never accepted", () => {
    const requests = new CancellableRequestRegistry();

    expect(requests.cancel("queued-elsewhere")).toBe(false);
    expect(requests.isCancelled("queued-elsewhere")).toBe(false);
  });

  it("cancels an accepted request and releases all state when it finishes", () => {
    const requests = new CancellableRequestRegistry();
    requests.start("active");

    expect(requests.cancel("active")).toBe(true);
    expect(requests.isCancelled("active")).toBe(true);

    requests.finish("active");
    expect(requests.isCancelled("active")).toBe(false);
    expect(requests.cancel("active")).toBe(false);
  });
});
