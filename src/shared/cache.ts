export class LruCache<T> {
  private readonly values = new Map<string, T>();

  constructor(private readonly maxSize = 160) {}

  get(key: string): T | undefined {
    const value = this.values.get(key);
    if (value === undefined) return undefined;
    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }

  set(key: string, value: T): void {
    this.values.delete(key);
    this.values.set(key, value);
    while (this.values.size > this.maxSize) {
      const oldest = this.values.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.values.delete(oldest);
    }
  }

  clear(): void {
    this.values.clear();
  }
}
