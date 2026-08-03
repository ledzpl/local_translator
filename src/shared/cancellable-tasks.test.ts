import { describe, expect, it } from "vitest";
import {
  TaskCancelledError,
  runCancellableTasks
} from "./cancellable-tasks";

describe("cancellable task sequences", () => {
  it("stops before dispatching the next task after cancellation", async () => {
    let cancelled = false;
    const calls: number[] = [];
    await expect(runCancellableTasks(
      [1, 2, 3],
      async (value) => {
        calls.push(value);
        cancelled = true;
        return value * 2;
      },
      () => cancelled
    )).rejects.toBeInstanceOf(TaskCancelledError);
    expect(calls).toEqual([1]);
  });

  it("returns every result when the task remains active", async () => {
    await expect(runCancellableTasks(
      [1, 2],
      async (value) => value * 2,
      () => false
    )).resolves.toEqual([2, 4]);
  });
});
