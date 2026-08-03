import { describe, expect, it } from "vitest";
import { MAX_GLOSSARY_ENTRIES } from "./glossary";
import {
  GlossaryCoordinator,
  type GlossaryStorage
} from "./glossary-coordinator";
import type { GlossaryEntry } from "./protocol";

function entry(id: string): GlossaryEntry {
  return {
    id,
    source: `source-${id}`,
    target: `target-${id}`,
    mode: "translate"
  };
}

function createStorage(initial: GlossaryEntry[] = []) {
  let stored = initial;
  const storage: GlossaryStorage = {
    read: async () => {
      await Promise.resolve();
      return stored;
    },
    write: async (entries) => {
      await Promise.resolve();
      stored = [...entries];
    }
  };
  return { storage, read: () => stored };
}

describe("GlossaryCoordinator", () => {
  it("serializes concurrent panel additions without losing either entry", async () => {
    const { storage, read } = createStorage();
    const coordinator = new GlossaryCoordinator(storage);

    await Promise.all([
      coordinator.upsert(entry("panel-a")),
      coordinator.upsert(entry("panel-b"))
    ]);

    expect(read().map((candidate) => candidate.id)).toEqual([
      "panel-a",
      "panel-b"
    ]);
  });

  it("updates an existing source without consuming another slot", async () => {
    const { storage, read } = createStorage([entry("old")]);
    const coordinator = new GlossaryCoordinator(storage);

    const result = await coordinator.upsert({
      ...entry("replacement"),
      source: "SOURCE-OLD"
    });

    expect(result.ok).toBe(true);
    expect(read()).toEqual([{
      ...entry("replacement"),
      source: "SOURCE-OLD"
    }]);
  });

  it("keeps the stored list intact when the limit is reached", async () => {
    const initial = Array.from(
      { length: MAX_GLOSSARY_ENTRIES },
      (_, index) => entry(String(index))
    );
    const { storage, read } = createStorage(initial);
    const coordinator = new GlossaryCoordinator(storage);

    const result = await coordinator.upsert(entry("overflow"));

    expect(result.ok).toBe(false);
    expect(read()).toEqual(initial);
  });
});
