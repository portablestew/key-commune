import { FastifyRequest } from 'fastify';

interface CacheEntry {
  statusCode: number;
  headers: Record<string, string>;
  body: any;
  expiresAt: number;
}

export class CacheableResponseCache {
  private cache: Map<string, CacheEntry>;
  private maxEntries: number;

  constructor(maxEntries = 100) {
    this.cache = new Map();
    this.maxEntries = maxEntries;
  }

  private generateCacheKey(request: FastifyRequest): string {
    return `${request.method}:${request.url}`;
  }

  get(request: FastifyRequest): CacheEntry | undefined {
    const key = this.generateCacheKey(request);
    const entry = this.cache.get(key);

    if (entry && entry.expiresAt > Date.now()) {
      // Move to end of Map to mark as recently used
      this.cache.delete(key);
      this.cache.set(key, entry);
      return entry;
    }

    if (entry) {
      this.cache.delete(key); // Remove expired entry
    }
    return undefined;
  }

  set(request: FastifyRequest, statusCode: number, headers: Record<string, string>, body: any, ttlSeconds: number): void {
    const key = this.generateCacheKey(request);

    // Enforce LRU eviction
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      statusCode,
      headers,
      body,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}