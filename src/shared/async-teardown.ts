export class AsyncTeardownBarrier {
  private active: Promise<void> | null = null;

  wait(): Promise<void> {
    return this.active ?? Promise.resolve();
  }

  async run(task: () => Promise<void>): Promise<void> {
    const operation = task();
    this.active = operation;
    try {
      await operation;
    } finally {
      if (this.active === operation) this.active = null;
    }
  }
}
