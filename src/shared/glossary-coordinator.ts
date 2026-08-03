import {
  GLOSSARY_STORAGE_KEY,
  MAX_GLOSSARY_ENTRIES,
  normalizeGlossaryEntries
} from "./glossary";
import type {
  GlossaryActionResponse,
  GlossaryEntry
} from "./protocol";
import { SerialTaskQueue } from "./serial-queue";

export interface GlossaryStorage {
  read: () => Promise<unknown>;
  write: (entries: readonly GlossaryEntry[]) => Promise<void>;
}

export class GlossaryCoordinator {
  private readonly updates = new SerialTaskQueue();

  constructor(private readonly storage: GlossaryStorage) {}

  get(): Promise<GlossaryActionResponse> {
    return this.updates.run(async () => ({
      ok: true,
      entries: normalizeGlossaryEntries(await this.storage.read())
    }));
  }

  upsert(entry: GlossaryEntry): Promise<GlossaryActionResponse> {
    const normalizedEntry = normalizeGlossaryEntries([entry])[0];
    if (!normalizedEntry) {
      return Promise.resolve({
        ok: false,
        entries: [],
        error: "저장할 용어가 올바르지 않습니다."
      });
    }

    return this.updates.run(async () => {
      const current = normalizeGlossaryEntries(await this.storage.read());
      const sourceKey = normalizedEntry.source.toLocaleLowerCase();
      const existing = current.find((candidate) =>
        candidate.source.toLocaleLowerCase() === sourceKey
      );
      if (!existing && current.length >= MAX_GLOSSARY_ENTRIES) {
        return {
          ok: false,
          entries: current,
          error:
            `용어는 최대 ${MAX_GLOSSARY_ENTRIES}개까지 저장할 수 있습니다. ` +
            "기존 항목을 지워 주세요."
        };
      }

      const next = normalizeGlossaryEntries([
        ...current.filter((candidate) =>
          candidate.source.toLocaleLowerCase() !== sourceKey
        ),
        normalizedEntry
      ]);
      await this.storage.write(next);
      return { ok: true, entries: next };
    });
  }

  remove(id: string): Promise<GlossaryActionResponse> {
    return this.updates.run(async () => {
      const current = normalizeGlossaryEntries(await this.storage.read());
      const next = current.filter((entry) => entry.id !== id);
      if (next.length !== current.length) await this.storage.write(next);
      return { ok: true, entries: next };
    });
  }
}

export function createChromeGlossaryStorage(): GlossaryStorage {
  return {
    read: async () => {
      const stored = await chrome.storage.local.get(GLOSSARY_STORAGE_KEY);
      return stored[GLOSSARY_STORAGE_KEY];
    },
    write: async (entries) => {
      await chrome.storage.local.set({ [GLOSSARY_STORAGE_KEY]: entries });
    }
  };
}
