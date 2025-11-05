import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { LoadBalancerCache } from '../../src/services/load-balancer-cache.js';
import { KeysRepository } from '../../src/db/repositories/keys.js';
import { StatsRepository } from '../../src/db/repositories/stats.js';
import { runMigrations } from '../../src/db/migrations.js';
import { ApiKey, DailyStats } from '../../src/types/database.js';

describe('LoadBalancerCache', () => {
  let db: Database.Database;
  let keysRepo: KeysRepository;
  let statsRepo: StatsRepository;
  let cache: LoadBalancerCache;
  let testEncryptionKey: string;

  const createTestApiKey = (id: number): ApiKey => ({
    id,
    key_hash: `hash${id}`,
    key: `sk-test-key-${id}`,
    key_display: `key${id}`,
    blocked_until: null,
    consecutive_auth_failures: 0,
    consecutive_throttles: 0,
    last_success_at: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  });

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    
    // Use a test encryption key (64 hex chars = 32 bytes)
    testEncryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    keysRepo = new KeysRepository(db, testEncryptionKey);
    statsRepo = new StatsRepository(db);

    // Create cache with 1 second expiry for testing
    cache = new LoadBalancerCache(keysRepo, statsRepo, {
      server: { port: 3000, host: 'localhost' },
      database: { path: ':memory:', max_keys: 1000 },
      blocking: {
        presented_key_rate_limit_seconds: 60,
        auth_failure_block_minutes: 30,
        auth_failure_delete_threshold: 5,
        throttle_backoff_base_minutes: 5,
        throttle_delete_threshold: 10,
        throttle_delete_timespan_minutes: 60,
      },
      logging: {
        level: 'info',
        key_display: { prefix_length: 4, suffix_length: 4 },
      },
      stats: {
        retention_days: 30,
        cleanup_interval_minutes: 60,
        auto_cleanup: true,
        cache_expiry_seconds: 1, // 1 second for testing
      },
      providers: [],
    });
  });

  describe('getCachedLoadBalancerData', () => {
    it('should fetch fresh data on first call', async () => {
      // Create test keys
      const key1 = keysRepo.create('hash1', 'sk-test-key-1', 'key1');
      const key2 = keysRepo.create('hash2', 'sk-test-key-2', 'key2');

      // Create test stats
      statsRepo.incrementCallCount(key1.id, '192.168.1.0/24');
      statsRepo.incrementCallCount(key2.id, '192.168.2.0/24');

      const result = await cache.getCachedLoadBalancerData();

      expect(result.availableKeys).toHaveLength(2);
      // Keys are now shuffled, so just check both are present
      expect(result.availableKeys.map(k => k.id)).toContain(key1.id);
      expect(result.availableKeys.map(k => k.id)).toContain(key2.id);
      expect(result.statsMap.size).toBe(2);
      expect(result.statsMap.has(key1.id)).toBe(true);
      expect(result.statsMap.has(key2.id)).toBe(true);
    });

    it('should return cached data when cache is still valid', async () => {
      // Create test key
      const key1 = keysRepo.create('hash1', 'sk-test-key-1', 'key1');
      statsRepo.incrementCallCount(key1.id, '192.168.1.0/24');

      // First call should fetch data
      const result1 = await cache.getCachedLoadBalancerData();
      expect(result1.availableKeys).toHaveLength(1);

      // Verify cache is working by checking timestamp hasn't changed significantly
      const timestamp1 = result1.timestamp;
      
      // Small delay
      await new Promise(resolve => setTimeout(resolve, 50));

      // Second call should use same cache
      const result2 = await cache.getCachedLoadBalancerData();
      expect(result2.timestamp).toBe(timestamp1);
      expect(result1).toBe(result2); // Same object reference
    });

    it('should refresh cache when expired', async () => {
      // Create test key
      const key1 = keysRepo.create('hash1', 'sk-test-key-1', 'key1');
      statsRepo.incrementCallCount(key1.id, '192.168.1.0/24');

      // First call
      const result1 = await cache.getCachedLoadBalancerData();
      expect(result1.availableKeys).toHaveLength(1);

      // Wait for cache to expire (1 second + buffer)
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Add another key while cache is expired
      const key2 = keysRepo.create('hash2', 'sk-test-key-2', 'key2');
      statsRepo.incrementCallCount(key2.id, '192.168.2.0/24');

      // Should fetch fresh data
      const result2 = await cache.getCachedLoadBalancerData();
      expect(result2.availableKeys).toHaveLength(2);
      expect(result2.availableKeys.map(k => k.id)).toContain(key2.id);
      expect(result2.timestamp).not.toBe(result1.timestamp);
    });
  });

  describe('refreshCache', () => {
    it('should force refresh cache data', async () => {
      // Create initial test key
      const key1 = keysRepo.create('hash1', 'sk-test-key-1', 'key1');
      statsRepo.incrementCallCount(key1.id, '192.168.1.0/24');

      // Initial data
      const result1 = await cache.getCachedLoadBalancerData();
      expect(result1.availableKeys).toHaveLength(1);

      // Add another key
      const key2 = keysRepo.create('hash2', 'sk-test-key-2', 'key2');
      statsRepo.incrementCallCount(key2.id, '192.168.2.0/24');

      // Force refresh
      await cache.refreshCache();

      const result2 = await cache.getCachedLoadBalancerData();
      expect(result2.availableKeys).toHaveLength(2);
      expect(result2.availableKeys.find(k => k.id === key2.id)).toBeDefined();
    });
  });

  describe('invalidateCache', () => {
    it('should clear the cache', async () => {
      // Create test key
      const key1 = keysRepo.create('hash1', 'sk-test-key-1', 'key1');
      statsRepo.incrementCallCount(key1.id, '192.168.1.0/24');

      // Populate cache
      const result1 = await cache.getCachedLoadBalancerData();
      expect(result1.availableKeys).toHaveLength(1);

      // Invalidate cache
      cache.invalidateCache();

      // Add another key
      const key2 = keysRepo.create('hash2', 'sk-test-key-2', 'key2');
      statsRepo.incrementCallCount(key2.id, '192.168.2.0/24');

      // Next call should fetch fresh data
      const result2 = await cache.getCachedLoadBalancerData();
      expect(result2.availableKeys).toHaveLength(2);
      expect(result2.availableKeys.find(k => k.id === key2.id)).toBeDefined();
    });
  });

  describe('getCacheStatus', () => {
    it('should return no cache status when cache is empty', () => {
      const status = cache.getCacheStatus();
      expect(status.cached).toBe(false);
      expect(status.ageMs).toBe(0);
      expect(status.keyCount).toBe(0);
      expect(status.statsCount).toBe(0);
    });

    it('should return cache status when data is cached', async () => {
      // Create test data
      const key1 = keysRepo.create('hash1', 'sk-test-key-1', 'key1');
      const key2 = keysRepo.create('hash2', 'sk-test-key-2', 'key2');
      statsRepo.incrementCallCount(key1.id, '192.168.1.0/24');
      statsRepo.incrementCallCount(key2.id, '192.168.2.0/24');

      await cache.getCachedLoadBalancerData();

      const status = cache.getCacheStatus();
      expect(status.cached).toBe(true);
      expect(status.keyCount).toBe(2);
      expect(status.statsCount).toBe(2);
      expect(status.ageMs).toBeGreaterThanOrEqual(0);
      expect(status.ageMs).toBeLessThan(1000); // Should be very fresh
    });

    it('should track cache age correctly', async () => {
      // Create test data
      const key1 = keysRepo.create('hash1', 'sk-test-key-1', 'key1');
      statsRepo.incrementCallCount(key1.id, '192.168.1.0/24');

      await cache.getCachedLoadBalancerData();

      // Wait 2 seconds
      await new Promise(resolve => setTimeout(resolve, 2000));

      const status = cache.getCacheStatus();
      expect(status.ageMs).toBeGreaterThanOrEqual(2000);
    });
  });

  describe('Cache consistency', () => {
    it('should maintain consistency between keys and stats', async () => {
      // Create keys but not all will have stats
      const key1 = keysRepo.create('hash1', 'sk-test-key-1', 'key1');
      const key2 = keysRepo.create('hash2', 'sk-test-key-2', 'key2');
      const key3 = keysRepo.create('hash3', 'sk-test-key-3', 'key3');

      // Create stats only for some keys
      statsRepo.incrementCallCount(key1.id, '192.168.1.0/24');
      statsRepo.incrementCallCount(key3.id, '192.168.3.0/24');

      const result = await cache.getCachedLoadBalancerData();

      expect(result.availableKeys).toHaveLength(3);
      expect(result.statsMap.size).toBe(2); // Only 2 stats created
      expect(result.statsMap.has(key1.id)).toBe(true);
      expect(result.statsMap.has(key2.id)).toBe(false); // No stats for key2
      expect(result.statsMap.has(key3.id)).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty database gracefully', async () => {
      const result = await cache.getCachedLoadBalancerData();
      
      expect(result.availableKeys).toHaveLength(0);
      expect(result.statsMap.size).toBe(0);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should handle keys with null blocked_until', async () => {
      const key1 = keysRepo.create('hash1', 'sk-test-key-1', 'key1');
      // blocked_until is null by default
      
      const result = await cache.getCachedLoadBalancerData();
      
      expect(result.availableKeys).toHaveLength(1);
      expect(result.availableKeys[0].blocked_until).toBeNull();
    });

    it('should not include blocked keys in available keys', async () => {
      const key1 = keysRepo.create('hash1', 'sk-test-key-1', 'key1');
      const key2 = keysRepo.create('hash2', 'sk-test-key-2', 'key2');
      
      // Block key1 by setting blocked_until to future time
      const futureTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour in future
      keysRepo.updateBlockedUntil(key1.id, futureTime);
      
      const result = await cache.getCachedLoadBalancerData();
      
      expect(result.availableKeys).toHaveLength(1);
      expect(result.availableKeys[0].id).toBe(key2.id);
    });
  describe('Shuffle behavior', () => {
    it('should shuffle available keys on refresh', async () => {
      // Create multiple keys
      for (let i = 1; i <= 4; i++) {
        keysRepo.create(`hash${i}`, `sk-test-key-${i}`, `key${i}`);
      }

      // First cache fetch
      const result1 = await cache.getCachedLoadBalancerData();
      const order1 = result1.availableKeys.map(k => k.id);

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Second cache fetch (should get shuffled order)
      const result2 = await cache.getCachedLoadBalancerData();
      const order2 = result2.availableKeys.map(k => k.id);

      // Both should contain all keys
      expect(order1).toHaveLength(4);
      expect(order2).toHaveLength(4);
      expect(order1.sort()).toEqual(order2.sort());

      // Verify shuffle is working by testing multiple times and checking
      // that at least some iterations produce different orders
      let hasDifferentOrder = false;
      const iterations = 10;
      
      for (let i = 0; i < iterations; i++) {
        cache.invalidateCache();
        await new Promise(resolve => setTimeout(resolve, 10));
        
        const result = await cache.getCachedLoadBalancerData();
        const order = result.availableKeys.map(k => k.id);
        
        if (order.join(',') !== order1.join(',')) {
          hasDifferentOrder = true;
          break;
        }
      }
      
      // With high probability, at least one shuffle should produce different order
      expect(hasDifferentOrder).toBe(true);
    });

    it('should maintain same shuffled order within cache lifetime', async () => {
      // Create test keys
      const key1 = keysRepo.create('hash1', 'sk-test-key-1', 'key1');
      const key2 = keysRepo.create('hash2', 'sk-test-key-2', 'key2');
      const key3 = keysRepo.create('hash3', 'sk-test-key-3', 'key3');

      // First call to populate cache
      const result1 = await cache.getCachedLoadBalancerData();
      const order1 = result1.availableKeys.map(k => k.id);

      // Second call should return same order (from cache)
      const result2 = await cache.getCachedLoadBalancerData();
      const order2 = result2.availableKeys.map(k => k.id);

      // Should be identical order
      expect(order1).toEqual(order2);
    });

    it('should shuffle keys with different seed each refresh', async () => {
      // Create test keys
      for (let i = 1; i <= 5; i++) {
        keysRepo.create(`hash${i}`, `sk-test-key-${i}`, `key${i}`);
      }

      // Force multiple refreshes and collect orders
      const orders: string[] = [];
      for (let i = 0; i < 5; i++) {
        // Invalidate cache to force fresh fetch
        cache.invalidateCache();

        // Wait for invalidation to complete
        await new Promise(resolve => setTimeout(resolve, 10));

        const result = await cache.getCachedLoadBalancerData();
        orders.push(result.availableKeys.map(k => k.id).join(','));

        // Wait a bit to ensure different random seed
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // All orders should have same keys
      for (const orderString of orders) {
        expect(orderString.split(',').map(Number).sort()).toEqual([1, 2, 3, 4, 5]);
      }

      // Count unique orders
      const uniqueOrders = new Set(orders);
      
      // With high probability, we should get different shuffle orders
      // (Probability of all 5 being identical is very low with Fisher-Yates)
      expect(uniqueOrders.size).toBeGreaterThan(1);
    });
  });
  });
});