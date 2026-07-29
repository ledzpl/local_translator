import { describe, expect, it } from "vitest";
import { RevisionedCommitter } from "./revisioned-committer";

describe("RevisionedCommitter", () => {
  it("keeps a failed revision dirty and retries it on the next commit", async () => {
    const outcomes = [false, true];
    const committer = new RevisionedCommitter(
      async () => outcomes.shift() ?? true
    );

    committer.markDirty();
    await committer.commit();
    expect(committer.isDirty()).toBe(true);

    await committer.commit();
    expect(committer.isDirty()).toBe(false);
    expect(outcomes).toEqual([]);
  });

  it("reruns the latest committed value after an in-flight save fails", async () => {
    let currentValue = 30;
    let finishFirstSave!: (saved: boolean) => void;
    const firstSave = new Promise<boolean>((resolve) => {
      finishFirstSave = resolve;
    });
    const savedValues: number[] = [];
    let saveCount = 0;
    const committer = new RevisionedCommitter(async () => {
      savedValues.push(currentValue);
      saveCount += 1;
      return saveCount === 1 ? firstSave : true;
    });

    committer.markDirty();
    const initialCommit = committer.commit();
    await Promise.resolve();

    currentValue = 34;
    committer.markDirty();
    const latestCommit = committer.commit();
    finishFirstSave(false);

    await Promise.all([initialCommit, latestCommit]);
    expect(savedValues).toEqual([30, 34]);
    expect(committer.isDirty()).toBe(false);
  });

  it("does not save a newer input until that revision is committed", async () => {
    let currentValue = 30;
    let finishFirstSave!: (saved: boolean) => void;
    const firstSave = new Promise<boolean>((resolve) => {
      finishFirstSave = resolve;
    });
    const savedValues: number[] = [];
    let saveCount = 0;
    const committer = new RevisionedCommitter(async () => {
      savedValues.push(currentValue);
      saveCount += 1;
      return saveCount === 1 ? firstSave : true;
    });

    committer.markDirty();
    const initialCommit = committer.commit();
    await Promise.resolve();
    currentValue = 34;
    committer.markDirty();
    finishFirstSave(true);
    await initialCommit;

    expect(savedValues).toEqual([30]);
    expect(committer.isDirty()).toBe(true);

    await committer.commit();
    expect(savedValues).toEqual([30, 34]);
    expect(committer.isDirty()).toBe(false);
  });
});
