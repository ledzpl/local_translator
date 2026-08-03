import type {
  TranslationJobState,
  TranslationResponse
} from "./protocol";
import { SerialTaskQueue } from "./serial-queue";

export interface TranslationJobStorage {
  read: () => Promise<TranslationJobState | null>;
  write: (job: TranslationJobState) => Promise<void>;
  clear: () => Promise<void>;
}

export interface TranslationJobTransition {
  changed: boolean;
  job: TranslationJobState | null;
}

export class TranslationJobCoordinator {
  private readonly updates = new SerialTaskQueue();

  constructor(private readonly storage: TranslationJobStorage) {}

  get(): Promise<TranslationJobState | null> {
    return this.updates.run(() => this.storage.read());
  }

  start(job: TranslationJobState): Promise<TranslationJobTransition> {
    return this.updates.run(async () => {
      const current = await this.storage.read();
      if (current?.state === "running") {
        return { changed: false, job: current };
      }
      await this.storage.write(job);
      return { changed: true, job };
    });
  }

  complete(
    requestId: string,
    response: TranslationResponse
  ): Promise<TranslationJobTransition> {
    return this.updates.run(async () => {
      const current = await this.storage.read();
      if (current?.requestId !== requestId || current.state !== "running") {
        return { changed: false, job: current };
      }
      const job: TranslationJobState = {
        ...current,
        state: response.ok
          ? "complete"
          : response.code === "TRANSLATION_CANCELLED"
            ? "cancelled"
            : "error",
        response,
        updatedAt: Date.now()
      };
      await this.storage.write(job);
      return { changed: true, job };
    });
  }

  cancel(
    requestId: string,
    response: TranslationResponse
  ): Promise<TranslationJobTransition> {
    return this.updates.run(async () => {
      const current = await this.storage.read();
      if (current?.requestId !== requestId || current.state !== "running") {
        return { changed: false, job: current };
      }
      const job: TranslationJobState = {
        ...current,
        state: "cancelled",
        response,
        updatedAt: Date.now()
      };
      await this.storage.write(job);
      return { changed: true, job };
    });
  }

  clear(requestId: string): Promise<TranslationJobTransition> {
    return this.updates.run(async () => {
      const current = await this.storage.read();
      if (!current) return { changed: true, job: null };
      if (current.requestId !== requestId || current.state === "running") {
        return { changed: false, job: current };
      }
      await this.storage.clear();
      return { changed: true, job: null };
    });
  }
}
