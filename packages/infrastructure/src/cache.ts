/**
 * Small LRU cache plus a content-hash cache with explicit invalidation.
 * Caches store derived data (AST metadata, symbols, analyzer results) keyed
 * by file path + content hash; any file change invalidates its entries.
 */
export class LruCache<Key, Value> {
  private readonly capacity: number;
  private readonly store = new Map<Key, Value>();

  constructor(capacity = 512) {
    this.capacity = Math.max(1, capacity);
  }

  get(key: Key): Value | undefined {
    const value = this.store.get(key);
    if (value === undefined) return undefined;
    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }

  set(key: Key, value: Value): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, value);
    while (this.store.size > this.capacity) {
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      this.store.delete(oldest.value);
    }
  }

  delete(key: Key): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

export interface HashEntry<Value> {
  hash: string;
  value: Value;
}

/** Content-addressed cache: stale entries are impossible when hashes match. */
export class ContentCache<Value> {
  private readonly inner = new LruCache<string, HashEntry<Value>>();

  constructor(capacity = 1024) {
    this.inner = new LruCache<string, HashEntry<Value>>(capacity);
  }

  get(path: string, hash: string): Value | undefined {
    const entry = this.inner.get(path);
    if (!entry || entry.hash !== hash) return undefined;
    return entry.value;
  }

  set(path: string, hash: string, value: Value): void {
    this.inner.set(path, { hash, value });
  }

  invalidate(path: string): void {
    this.inner.delete(path);
  }

  invalidateAll(): void {
    this.inner.clear();
  }
}
