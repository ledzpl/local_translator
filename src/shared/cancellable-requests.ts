export class CancellableRequestRegistry {
  private readonly pending = new Set<string>();
  private readonly cancelled = new Set<string>();

  start(requestId: string): void {
    this.pending.add(requestId);
    this.cancelled.delete(requestId);
  }

  cancel(requestId: string): boolean {
    if (!this.pending.has(requestId)) return false;
    this.cancelled.add(requestId);
    return true;
  }

  isCancelled(requestId: string): boolean {
    return this.cancelled.has(requestId);
  }

  finish(requestId: string): void {
    this.pending.delete(requestId);
    this.cancelled.delete(requestId);
  }
}
