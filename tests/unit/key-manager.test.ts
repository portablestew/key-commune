import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { KeyManager } from '../../src/services/key-manager.js';
import { KeysRepository } from '../../src/db/repositories/keys.js';
import { StatsRepository } from '../../src/db/repositories/stats.js';
import { runMigrations } from '../../src/db/migrations.js';
import { BlockingConfig } from '../../src/types/config.js';

describe('KeyManager', () => {
  let db: Database.Database;
  let keysRepo: KeysRepository;
  let statsRepo: StatsRepository;
  let keyManager: KeyManager;
  let config: BlockingConfig;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    // Use a test encryption key (64 hex chars = 32 bytes)
    const testEncryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    keysRepo = new KeysRepository(db, testEncryptionKey);
    statsRepo = new StatsRepository(db);
    
    // Default config matching SPEC.md
    config = {
      presented_key_rate_limit_seconds: 1,
      auth_failure_block_minutes: 1440,
      auth_failure_delete_threshold: 3,
      throttle_backoff_base_minutes: 1,
      throttle_delete_threshold: 10,
      throttle_delete_timespan_minutes: 1440,
    };
    
    keyManager = new KeyManager(keysRepo, statsRepo, config, 1000);
  });

  describe('handleSuccess', () => {
    it('should reset all counters', () => {
      const key = keysRepo.create('hash1', 'sk-test-key-1', 'display1');
      
      const result = keyManager.handleSuccess(key);
      
      expect(result.action).toBe('success');
      const updated = keysRepo.findById(key.id);
      expect(updated?.consecutive_auth_failures).toBe(0);
      expect(updated?.consecutive_throttles).toBe(0);
      expect(updated?.blocked_until).toBeNull();
    });

    it('should create new key when it does not exist', () => {
      const newKey = {
        id: -1,
        key: 'sk-new-key-test',
        key_hash: 'newhash1',
        key_display: 'sk-new-k...',
        blocked_until: null,
        consecutive_auth_failures: 0,
        consecutive_throttles: 0,
        last_success_at: null,
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
      };
      
      const result = keyManager.handleSuccess(newKey);
      
      expect(result.action).toBe('success');
      expect(result.message).toContain('New key created');
      const created = keysRepo.findByHash('newhash1');
      expect(created).toBeDefined();
      expect(created?.key_hash).toBe('newhash1');
    });

    it('should enforce max_keys limit when creating new key', () => {
      // Create a KeyManager with max_keys = 2
      const limitedKeyManager = new KeyManager(keysRepo, statsRepo, config, 2);
      
      // Create 2 existing keys
      keysRepo.create('hash1', 'sk-test-key-1', 'display1');
      keysRepo.create('hash2', 'sk-test-key-2', 'display2');
      
      // Try to create a 3rd key (should be rejected)
      const newKey = {
        id: -1,
        key: 'sk-new-key-test',
        key_hash: 'newhash3',
        key_display: 'sk-new-k...',
        blocked_until: null,
        consecutive_auth_failures: 0,
        consecutive_throttles: 0,
        last_success_at: null,
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
      };
      
      const result = limitedKeyManager.handleSuccess(newKey);
      
      expect(result.action).toBe('proxied');
      expect(result.message).toContain('Max keys limit reached');
      expect(result.message).toContain('(2)');
      
      // Verify key was not created
      const notCreated = keysRepo.findByHash('newhash3');
      expect(notCreated).toBeUndefined();
      
      // Verify count is still 2
      expect(keysRepo.count()).toBe(2);
    });

    it('should allow creating key when under max_keys limit', () => {
      // Create a KeyManager with max_keys = 3
      const limitedKeyManager = new KeyManager(keysRepo, statsRepo, config, 3);
      
      // Create 2 existing keys
      keysRepo.create('hash1', 'sk-test-key-1', 'display1');
      keysRepo.create('hash2', 'sk-test-key-2', 'display2');
      
      // Try to create a 3rd key (should succeed)
      const newKey = {
        id: -1,
        key: 'sk-new-key-test',
        key_hash: 'newhash3',
        key_display: 'sk-new-k...',
        blocked_until: null,
        consecutive_auth_failures: 0,
        consecutive_throttles: 0,
        last_success_at: null,
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
      };
      
      const result = limitedKeyManager.handleSuccess(newKey);
      
      expect(result.action).toBe('success');
      expect(result.message).toContain('New key created');
      
      // Verify key was created
      const created = keysRepo.findByHash('newhash3');
      expect(created).toBeDefined();
      
      // Verify count is now 3
      expect(keysRepo.count()).toBe(3);
    });
  });

  describe('handleAuthFailure', () => {
    it('should block key for 1440 minutes', () => {
      const key = keysRepo.create('hash1', 'sk-test-key-1', 'display1');
      
      const result = keyManager.handleAuthFailure(key);
      
      expect(result.action).toBe('blocked');
      const updated = keysRepo.findById(key.id);
      expect(updated?.consecutive_auth_failures).toBe(1);
      expect(updated?.blocked_until).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('should delete key after 3 failures', () => {
      let key = keysRepo.create('hash1', 'sk-test-key-1', 'display1');
      
      keyManager.handleAuthFailure(key);
      key = keysRepo.findById(key.id)!;
      keyManager.handleAuthFailure(key);
      key = keysRepo.findById(key.id)!;
      const result = keyManager.handleAuthFailure(key);
      
      expect(result.action).toBe('deleted');
      expect(keysRepo.findById(key.id)).toBeUndefined();
    });
  });

  describe('handleThrottle', () => {
    it('should use exponential backoff', () => {
      let key = keysRepo.create('hash1', 'sk-test-key-1', 'display1');
      
      // First throttle: 2^0 = 1 minute
      keyManager.handleThrottle(key);
      const updated1 = keysRepo.findById(key.id);
      expect(updated1?.consecutive_throttles).toBe(1);
      
      // Second throttle: 2^1 = 2 minutes
      key = keysRepo.findById(key.id)!;
      keyManager.handleThrottle(key);
      const updated2 = keysRepo.findById(key.id);
      expect(updated2?.consecutive_throttles).toBe(2);
    });

    it('should delete key after 10 throttles', () => {
      let key = keysRepo.create('hash1', 'sk-test-key-1', 'display1');
      
      for (let i = 0; i < 9; i++) {
        keyManager.handleThrottle(key);
        key = keysRepo.findById(key.id)!;
      }
      
      const result = keyManager.handleThrottle(key);
      expect(result.action).toBe('deleted');
      expect(keysRepo.findById(key.id)).toBeUndefined();
    });
  });

  describe('getSubnet', () => {
    it('should extract IPv4 subnet', () => {
      const subnet = keyManager.getSubnet('192.168.1.100');
      expect(subnet).toBe('192.168.1.0/24');
    });

    it('should handle IPv6 as-is', () => {
      const ipv6 = '2001:0db8:85a3::8a2e:0370:7334';
      const subnet = keyManager.getSubnet(ipv6);
      expect(subnet).toBe(ipv6);
    });
  });
})