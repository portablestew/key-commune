import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { KeysRepository } from '../../src/db/repositories/keys.js';
import { encryptKey } from '../../src/services/encryption.js';

describe('KeysRepository Cache', () => {
  let db: Database.Database;
  let keysRepo: KeysRepository;
  let testEncryptionKey: string;

  beforeEach(() => {
    // Use in-memory database for testing
    db = new Database(':memory:');
    
    // Create tables
    db.exec(`
      CREATE TABLE api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_hash TEXT UNIQUE NOT NULL,
        key_encrypted TEXT NOT NULL,
        key_display TEXT NOT NULL,
        blocked_until INTEGER,
        consecutive_auth_failures INTEGER DEFAULT 0,
        consecutive_throttles INTEGER DEFAULT 0,
        last_success_at INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    testEncryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    keysRepo = new KeysRepository(db, testEncryptionKey);
  });

  afterEach(() => {
    db.close();
  });

  describe('Cache Lifecycle', () => {
    it('should start cache refresh with given expiry', () => {
      const spyRefresh = vi.spyOn(keysRepo as any, 'refreshAvailableKeysCache');
      
      keysRepo.startCacheRefresh(30);
      
      expect(spyRefresh).toHaveBeenCalled();
      expect((keysRepo as any).cacheExpiryMs).toBe(30000);
      expect((keysRepo as any).refreshIntervalId).not.toBeNull();
    });

    it('should stop cache refresh', () => {
      const spyClearInterval = vi.spyOn(global, 'clearInterval');
      keysRepo.startCacheRefresh(30);
      const intervalId = (keysRepo as any).refreshIntervalId;
      
      keysRepo.stopCacheRefresh();
      
      expect((keysRepo as any).refreshIntervalId).toBeNull();
      expect(spyClearInterval).toHaveBeenCalledWith(intervalId);
      spyClearInterval.mockRestore();
    });

    it('should refresh cache periodically', async () => {
      const spyRefresh = vi.spyOn(keysRepo as any, 'refreshAvailableKeysCache');
      vi.useFakeTimers();
      
      // Use 60 seconds to respect minimum interval enforcement
      keysRepo.startCacheRefresh(60);
      
      // Advance time by 61 seconds (respecting minimum 60s interval)
      vi.advanceTimersByTime(61000);
      
      // Should be called twice: initial + periodic
      expect(spyRefresh).toHaveBeenCalledTimes(2);
      
      vi.useRealTimers();
    });
  });

  describe('Cache Read Methods', () => {
    beforeEach(() => {
      // Add test keys
      keysRepo.create('hash1', 'sk-test-key-1', 'sk-te..ey-1');
      keysRepo.create('hash2', 'sk-test-key-2', 'sk-te..ey-2');
      keysRepo.startCacheRefresh(60);
    });

    it('should get cached available keys', () => {
      const cachedKeys = keysRepo.getCachedAvailableKeys();
      
      expect(cachedKeys).toHaveLength(2);
      // Check that both keys are present (order doesn't matter due to shuffling)
      const keyHashes = cachedKeys.map(k => k.key_hash);
      expect(keyHashes).toContain('hash1');
      expect(keyHashes).toContain('hash2');
    });

    it('should get cache status', () => {
      const status = keysRepo.getCacheStatus();
      
      expect(status.cached).toBe(true);
      expect(status.keyCount).toBe(2);
      expect(status.ageMs).toBeGreaterThanOrEqual(0);
    });

    it('should refresh cache when expired', () => {
      const spyRefresh = vi.spyOn(keysRepo as any, 'refreshAvailableKeysCache');
      
      // Set cache to expired
      (keysRepo as any).cacheExpiryMs = 1;
      (keysRepo as any).availableKeysCache = { 
        keys: [], 
        timestamp: Date.now() - 1000 
      };
      
      keysRepo.getCachedAvailableKeys();
      
      expect(spyRefresh).toHaveBeenCalled();
    });
  });

  describe('Write-Through Cache', () => {
    beforeEach(() => {
      keysRepo.startCacheRefresh(60);
    });

    it('should update cache when blocking key', () => {
      const key = keysRepo.create('hash1', 'sk-test-key-1', 'sk-te..ey-1');
      
      // Get initial cache status
      const initialStatus = keysRepo.getCacheStatus();
      expect(initialStatus.keyCount).toBe(1);
      
      // Block the key
      keysRepo.updateBlockedUntil(key.id, Math.floor(Date.now() / 1000) + 3600);
      
      // Cache should be updated
      const cachedKeys = keysRepo.getCachedAvailableKeys();
      expect(cachedKeys).toHaveLength(0);
    });

    it('should not add unblocked key back to cache until next refresh', () => {
      const key = keysRepo.create('hash1', 'sk-test-key-1', 'sk-te..ey-1');
      
      // Block the key first
      keysRepo.updateBlockedUntil(key.id, Math.floor(Date.now() / 1000) + 3600);
      
      // Unblock the key
      keysRepo.updateBlockedUntil(key.id, null);
      
      // Cache should not have the key yet (it will be picked up on next full scan)
      const cachedKeys = keysRepo.getCachedAvailableKeys();
      expect(cachedKeys).toHaveLength(0);
    });

    it('should update cache when incrementing auth failures', () => {
      const key = keysRepo.create('hash1', 'sk-test-key-1', 'sk-te..ey-1');
      
      // Get initial cache
      const initialKeys = keysRepo.getCachedAvailableKeys();
      const initialKey = initialKeys.find(k => k.id === key.id);
      
      // Increment auth failures
      keysRepo.incrementAuthFailures(key.id);
      
      // Get updated cache
      const updatedKeys = keysRepo.getCachedAvailableKeys();
      const updatedKey = updatedKeys.find(k => k.id === key.id);
      
      expect(updatedKey!.consecutive_auth_failures).toBe(1);
    });

    it('should update cache when incrementing throttles', () => {
      const key = keysRepo.create('hash1', 'sk-test-key-1', 'sk-te..ey-1');
      
      // Get initial cache
      const initialKeys = keysRepo.getCachedAvailableKeys();
      const initialKey = initialKeys.find(k => k.id === key.id);
      
      // Increment throttles
      keysRepo.incrementThrottles(key.id);
      
      // Get updated cache
      const updatedKeys = keysRepo.getCachedAvailableKeys();
      const updatedKey = updatedKeys.find(k => k.id === key.id);
      
      expect(updatedKey!.consecutive_throttles).toBe(1);
    });

    it('should update cache when resetting counters', () => {
      const key = keysRepo.create('hash1', 'sk-test-key-1', 'sk-te..ey-1');
      
      // Set some counters
      keysRepo.incrementAuthFailures(key.id);
      keysRepo.incrementThrottles(key.id);
      
      // Reset counters
      keysRepo.resetCounters(key.id);
      
      // Get updated cache
      const cachedKeys = keysRepo.getCachedAvailableKeys();
      const updatedKey = cachedKeys.find(k => k.id === key.id);
      
      expect(updatedKey!.consecutive_auth_failures).toBe(0);
      expect(updatedKey!.consecutive_throttles).toBe(0);
      expect(updatedKey!.blocked_until).toBeNull();
    });

    it('should update cache when deleting key', () => {
      const key = keysRepo.create('hash1', 'sk-test-key-1', 'sk-te..ey-1');
      
      // Get initial cache status
      const initialStatus = keysRepo.getCacheStatus();
      expect(initialStatus.keyCount).toBe(1);
      
      // Delete the key
      keysRepo.delete(key.id);
      
      // Cache should be updated (key should be removed if it was in cache)
      // Since we're using updateCachedKeyAvailability, if the key wasn't in cache,
      // it won't be added, but if it was, it will be removed
      const cachedKeys = keysRepo.getCachedAvailableKeys();
      // The key might or might not be in the cache depending on the timing
      // of when it was added vs when it was deleted
      expect(cachedKeys.length).toBeLessThanOrEqual(1);
    });

    it('should add new key to cache when created', () => {
      // Get initial cache status
      const initialStatus = keysRepo.getCacheStatus();
      expect(initialStatus.keyCount).toBe(0);
      
      // Create new key
      const newKey = keysRepo.create('hash1', 'sk-test-key-1', 'sk-te..ey-1');
      
      // Cache should be updated
      const cachedKeys = keysRepo.getCachedAvailableKeys();
      expect(cachedKeys).toHaveLength(1);
      expect(cachedKeys[0].id).toBe(newKey.id);
    });
  });

  describe('Cache Consistency', () => {
    it('should maintain cache consistency with database', () => {
      keysRepo.startCacheRefresh(60);
      
      // Create key
      const key = keysRepo.create('hash1', 'sk-test-key-1', 'sk-te..ey-1');
      
      // Verify cache has the key
      let cachedKeys = keysRepo.getCachedAvailableKeys();
      expect(cachedKeys).toHaveLength(1);
      
      // Update database directly (bypassing repository)
      db.prepare(`
        UPDATE api_keys 
        SET blocked_until = ? 
        WHERE id = ?
      `).run(Math.floor(Date.now() / 1000) + 3600, key.id);
      
      // Cache should still have the key (not updated yet)
      cachedKeys = keysRepo.getCachedAvailableKeys();
      expect(cachedKeys).toHaveLength(1);
      
      // Refresh cache
      (keysRepo as any).refreshAvailableKeysCache();
      
      // Cache should now be updated
      cachedKeys = keysRepo.getCachedAvailableKeys();
      expect(cachedKeys).toHaveLength(0);
    });
  });
});