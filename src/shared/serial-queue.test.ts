import { describe, expect, it } from "vitest";
import { SerialTaskQueue } from "./serial-queue";

describe("SerialTaskQueue", () => {
  it("does not run reset-like work until active inference completes", async () => {
    const queue = new SerialTaskQueue();
    const events: string[] = [];
    let finishInference!: () => void;
    const inferenceGate = new Promise<void>((resolve) => {
      finishInference = resolve;
    });

    const inference = queue.run(async () => {
      events.push("inference:start");
      await inferenceGate;
      events.push("inference:end");
      return "translation";
    });
    const reset = queue.run(async () => {
      events.push("reset");
    });

    await Promise.resolve();
    expect(events).toEqual(["inference:start"]);
    finishInference();
    await Promise.all([inference, reset]);
    expect(events).toEqual(["inference:start", "inference:end", "reset"]);
  });

  it("continues after a failed task", async () => {
    const queue = new SerialTaskQueue();
    await expect(queue.run(async () => {
      throw new Error("failed");
    })).rejects.toThrow("failed");
    await expect(queue.run(async () => "next")).resolves.toBe("next");
  });

  it("never overlaps replacement speech inference", async () => {
    const queue = new SerialTaskQueue();
    let active = 0;
    let maxActive = 0;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.run(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await firstGate;
      active -= 1;
    });
    const replacement = queue.run(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      active -= 1;
    });

    await Promise.resolve();
    expect(active).toBe(1);
    releaseFirst();
    await Promise.all([first, replacement]);
    expect(maxActive).toBe(1);
  });
});
