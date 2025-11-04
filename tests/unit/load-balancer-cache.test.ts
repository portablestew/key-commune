import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LoadBalancerCache } from '../../src/services/load-balancer-cache.js';
import { KeysRepository } from '../../src/db/repositories/keys.js';
import { StatsRepository } from '../../src/db/repositories/stats.js';
import Database from 'better-sqlite3';
import { AppConfig } from '../../src/types/config.js';

describe('LoadBalancerCache', () => {
  let db: Database.Database;
  let keysRepo: KeysRepository;
  let statsRepo: StatsRepository;
  let cache: LoadBalancerCache;
  let config: AppConfig;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');
    
    // Mock config
    config = {
      server: { host: '127.0.0.1', port: 3000 },
      database: { path: ':memory:', max_keys: 1000 },
      blocking: {
        presented_key_rate_limit_seconds: 1,
        auth_failure_block_minutes: 1440,
        auth_failure_delete_threshold: 3,
        throttle_backoff_base_minutes: 1,
        throttle_delete_threshold: 10,
        throttle_delete_timespan_minutes: 1440
      },
      logging: {
        level: 'info',
        key_display: { prefix_length: 4, suffix_length: 4 }
      },
      stats: {
        retention_days: 30,
        cleanup_interval_minutes: 60,
        auto_cleanup: true,
        cache_expiry_seconds: 60
      },
      providers: [],
      encryption_key: 'test-encryption-key'
    };

    // Initialize repositories
    keysRepo = new KeysRepository(db, config.encryption_key!);
    statsRepo = new StatsRepository(db);
    
    // Create cache
    cache = new LoadBalancerCache(keysRepo, statsRepo, config);
  });

  afterEach(() => {
    db.close();
  });

  it('should create cache instance', () => {
    expect(cache).toBeDefined();
  });

  it('should return empty cache initially', async () => {
    const status = cache.getCacheStatus();
    expect(status.cached).toBe(false);
    expect(status.keyCount).toBe(0);
    expect(status.statsCount).toBe(0);
  });

  it('should invalidate cache', async () => {
    // Test cache invalidation
    cache.invalidateCache();
    const status = cache.getCacheStatus();
    expect(status.cached).toBe(false);
  });

  it('should accept custom cache expiry from config', () => {
    const configWithCustomExpiry: AppConfig = {
      ...config,
      stats: {
        ...config.stats,
        cache_expiry_seconds: 300 // 5 minutes
      }
    };
    
    const customCache = new LoadBalancerCache(keysRepo, statsRepo, configWithCustomExpiry);
    expect(customCache).toBeDefined();
  });

  it('should provide cache status with age information', () => {
    const status = cache.getCacheStatus();
    expect(status).toHaveProperty('cached');
    expect(status).toHaveProperty('ageMs');
    expect(status).toHaveProperty('keyCount');
    expect(status).toHaveProperty('statsCount');
    expect(typeof status.ageMs).toBe('number');
    expect(typeof status.keyCount).toBe('number');
    expect(typeof status.statsCount).toBe('number');
  });
});