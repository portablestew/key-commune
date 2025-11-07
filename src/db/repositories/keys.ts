import Database from 'better-sqlite3';
import { ApiKey, DbApiKey, dbKeyToApiKey } from '../../types/database.js';
import { encryptKey, decryptKey } from '../../services/encryption.js';

export class KeysRepository {
  private availableKeysCache: { keys: ApiKey[]; timestamp: number } | null = null;
  private cacheExpiryMs: number = 0;
  private refreshIntervalId: NodeJS.Timeout | null = null;

  constructor(
    private db: Database.Database,
    private encryptionKey: string
  ) {}

  create(keyHash: string, rawKey: string, keyDisplay: string): ApiKey {
    const keyEncrypted = encryptKey(rawKey, this.encryptionKey);
    const stmt = this.db.prepare(`
      INSERT INTO api_keys (key_hash, key_encrypted, key_display)
      VALUES (?, ?, ?)
    `);
    
    const result = stmt.run(keyHash, keyEncrypted, keyDisplay);
    const newKey = this.findById(result.lastInsertRowid as number)!;
    
    // Add to cache if available
    if (this.availableKeysCache &&
        (newKey.blocked_until === null || newKey.blocked_until <= Math.floor(Date.now() / 1000))) {
      this.availableKeysCache.keys.push(newKey);
      this.shuffleArray(this.availableKeysCache.keys);
    }
    
    return newKey;
  }

  findById(id: number): ApiKey | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM api_keys WHERE id = ?
    `);
    const dbKey = stmt.get(id) as DbApiKey | undefined;
    if (!dbKey) return undefined;
    
    const decryptedKey = decryptKey(dbKey.key_encrypted, this.encryptionKey);
    return dbKeyToApiKey(dbKey, decryptedKey);
  }

  findByHash(keyHash: string): ApiKey | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM api_keys WHERE key_hash = ?
    `);
    const dbKey = stmt.get(keyHash) as DbApiKey | undefined;
    if (!dbKey) return undefined;
    
    const decryptedKey = decryptKey(dbKey.key_encrypted, this.encryptionKey);
    return dbKeyToApiKey(dbKey, decryptedKey);
  }

  // Cache lifecycle methods
  startCacheRefresh(cacheExpirySeconds: number): void {
    this.cacheExpiryMs = cacheExpirySeconds * 1000;
    this.refreshAvailableKeysCache();
    this.refreshIntervalId = setInterval(() => {
      this.refreshAvailableKeysCache();
    }, Math.max(cacheExpirySeconds * 1000, 60000)); // Minimum 60 seconds
  }

  stopCacheRefresh(): void {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
    }
  }

  private refreshAvailableKeysCache(): void {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      SELECT * FROM api_keys
      WHERE blocked_until IS NULL OR blocked_until <= ?
    `);
    const dbKeys = stmt.all(now) as DbApiKey[];
    const availableKeys = dbKeys.map(dbKey => {
      const decryptedKey = decryptKey(dbKey.key_encrypted, this.encryptionKey);
      return dbKeyToApiKey(dbKey, decryptedKey);
    });
    this.shuffleArray(availableKeys);
    this.availableKeysCache = { keys: availableKeys, timestamp: Date.now() };
  }

  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  // Cache read methods
  getCachedAvailableKeys(): ApiKey[] {
    if (!this.availableKeysCache || (Date.now() - this.availableKeysCache.timestamp) > this.cacheExpiryMs) {
      this.refreshAvailableKeysCache();
    }
    return [...this.availableKeysCache!.keys]; // Return copy
  }

  getCacheStatus(): { cached: boolean; ageMs: number; keyCount: number } {
    if (!this.availableKeysCache) {
      return { cached: false, ageMs: 0, keyCount: 0 };
    }
    return {
      cached: true,
      ageMs: Date.now() - this.availableKeysCache.timestamp,
      keyCount: this.availableKeysCache.keys.length
    };
  }

  // Cache helper to get cached key entry for predictive updates
  private getCachedKeyEntry(id: number): ApiKey | undefined {
    if (!this.availableKeysCache) {
      return undefined;
    }

    const index = this.availableKeysCache.keys.findIndex(k => k.id === id);
    return index !== -1 ? this.availableKeysCache.keys[index] : undefined;
  }

  findAvailable(): ApiKey[] {
    return this.getCachedAvailableKeys();
  }

  findAll(): ApiKey[] {
    const stmt = this.db.prepare(`SELECT * FROM api_keys`);
    const dbKeys = stmt.all() as DbApiKey[];
    return dbKeys.map(dbKey => {
      const decryptedKey = decryptKey(dbKey.key_encrypted, this.encryptionKey);
      return dbKeyToApiKey(dbKey, decryptedKey);
    });
  }

  count(): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM api_keys`);
    const result = stmt.get() as { count: number };
    return result.count;
  }

  updateBlockedUntil(id: number, blockedUntil: number | null): void {
    const stmt = this.db.prepare(`
      UPDATE api_keys SET blocked_until = ? WHERE id = ?
    `);
    stmt.run(blockedUntil, id);
    
    // Predictive cache update
    const cachedKey = this.getCachedKeyEntry(id);
    if (cachedKey) {
      const now = Math.floor(Date.now() / 1000);
      const isAvailable = blockedUntil === null || blockedUntil <= now;
      
      if (!isAvailable) {
        // Key became unavailable - remove from cache
        this.availableKeysCache!.keys = this.availableKeysCache!.keys.filter(k => k.id !== id);
      } else {
        // Update blocked_until field
        cachedKey.blocked_until = blockedUntil;
      }
    }
  }

  incrementAuthFailures(id: number): number {
    const stmt = this.db.prepare(`
      UPDATE api_keys
      SET consecutive_auth_failures = consecutive_auth_failures + 1
      WHERE id = ?
      RETURNING consecutive_auth_failures
    `);
    const result = stmt.get(id) as { consecutive_auth_failures: number };
    
    // Predictive cache update
    const cachedKey = this.getCachedKeyEntry(id);
    if (cachedKey) {
      cachedKey.consecutive_auth_failures = result.consecutive_auth_failures;
    }
    
    return result.consecutive_auth_failures;
  }

  incrementThrottles(id: number): number {
    const stmt = this.db.prepare(`
      UPDATE api_keys
      SET consecutive_throttles = consecutive_throttles + 1
      WHERE id = ?
      RETURNING consecutive_throttles
    `);
    const result = stmt.get(id) as { consecutive_throttles: number };
    
    // Predictive cache update
    const cachedKey = this.getCachedKeyEntry(id);
    if (cachedKey) {
      cachedKey.consecutive_throttles = result.consecutive_throttles;
    }
    
    return result.consecutive_throttles;
  }

  resetCounters(id: number): void {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      UPDATE api_keys
      SET consecutive_auth_failures = 0,
          consecutive_throttles = 0,
          blocked_until = NULL,
          last_success_at = ?
      WHERE id = ?
    `);
    stmt.run(now, id);
    
    // Predictive cache update
    const cachedKey = this.getCachedKeyEntry(id);
    if (cachedKey) {
      cachedKey.consecutive_auth_failures = 0;
      cachedKey.consecutive_throttles = 0;
      cachedKey.blocked_until = null;
    }
  }

  delete(id: number): void {
    const stmt = this.db.prepare(`DELETE FROM api_keys WHERE id = ?`);
    stmt.run(id);
    
    // Predictive cache update - remove from cache
    if (this.availableKeysCache) {
      this.availableKeysCache.keys = this.availableKeysCache.keys.filter(k => k.id !== id);
    }
  }
}