import { describe, expect, it } from "vitest";
import { LruCache } from "./cache";

describe("LruCache", () => {
  it("evicts the least recently used translation", () => {
    const cache = new LruCache<string>(2);
    cache.set("a", "A");
    cache.set("b", "B");
    expect(cache.get("a")).toBe("A");
    cache.set("c", "C");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("A");
    expect(cache.get("c")).toBe("C");
  });
});
