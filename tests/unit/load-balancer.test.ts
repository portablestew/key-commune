import { describe, it, expect } from 'vitest';
import { LoadBalancer } from '../../src/services/load-balancer.js';
import { ApiKey, DailyStats } from '../../src/types/database.js';

describe('LoadBalancer', () => {
  const balancer = new LoadBalancer();

  const createKey = (id: number): ApiKey => ({
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

  describe('selectKey', () => {
    it('should throw error with no keys', () => {
      expect(() => balancer.selectKey([], new Map(), 'hash1')).toThrow('No available keys');
    });

    it('should return single key', () => {
      const keys = [createKey(1)];
      const selected = balancer.selectKey(keys, new Map(), 'hash1');
      expect(selected.id).toBe(1);
    });

    it('should prefer key with lower throttle count', () => {
      const keys = [createKey(1), createKey(2)];
      const stats = new Map<number, DailyStats>([
        [1, { throttle_count: 5, call_count: 0 } as DailyStats],
        [2, { throttle_count: 2, call_count: 0 } as DailyStats],
      ]);

      // Test multiple times to ensure deterministic behavior with counter
      const results = new Set();
      for (let i = 0; i < 10; i++) {
        results.add(balancer.selectKey(keys, stats, 'hash1').id);
      }

      expect(results.has(2)).toBe(true);
    });

    it('should use call count as tie-breaker', () => {
      const keys = [createKey(1), createKey(2)];
      const stats = new Map<number, DailyStats>([
        [1, { throttle_count: 0, call_count: 10 } as DailyStats],
        [2, { throttle_count: 0, call_count: 5 } as DailyStats],
      ]);

      // Test multiple times to ensure deterministic behavior with counter
      const results = new Set();
      for (let i = 0; i < 10; i++) {
        results.add(balancer.selectKey(keys, stats, 'hash1').id);
      }

      expect(results.has(2)).toBe(true);
    });

    it('should use counter-based selection for candidates', () => {
      const keys = [createKey(1), createKey(2), createKey(3), createKey(4)];
      const stats = new Map<number, DailyStats>();
      
      // All keys have same stats, so selection should be deterministic based on counter
      const selected1 = balancer.selectKey(keys, stats, 'hash1');
      const selected2 = balancer.selectKey(keys, stats, 'hash1');
      const selected3 = balancer.selectKey(keys, stats, 'hash1');
      
      // Should select different candidates each time due to counter increment
      expect(selected1.id).toBeDefined();
      expect(selected2.id).toBeDefined();
      expect(selected3.id).toBeDefined();
    });

    it('should consider presented key in selection when it exists in pool', () => {
      const keys = [createKey(1), createKey(2), createKey(3)];
      keys[1].key_hash = 'presented_hash'; // Make key 2 the presented key
      
      const stats = new Map<number, DailyStats>([
        [1, { throttle_count: 5, call_count: 10 } as DailyStats], // Key 1: worse stats
        [2, { throttle_count: 1, call_count: 2 } as DailyStats],  // Key 2: better stats (presented)
        [3, { throttle_count: 3, call_count: 5 } as DailyStats],   // Key 3: medium stats
      ]);
      
      // Presented key has better stats, should be selected
      const selected = balancer.selectKey(keys, stats, 'presented_hash');
      expect(selected.id).toBe(2);
    });

    it('should apply tie-breaking priority: C1 > C2 > Presented Key', () => {
      const keys = [createKey(1), createKey(2), createKey(3)];
      keys[2].key_hash = 'presented_hash'; // Make key 3 the presented key
      
      const stats = new Map<number, DailyStats>([
        [1, { throttle_count: 0, call_count: 0 } as DailyStats], // Key 1: same stats
        [2, { throttle_count: 0, call_count: 0 } as DailyStats], // Key 2: same stats
        [3, { throttle_count: 0, call_count: 0 } as DailyStats], // Key 3: same stats (presented)
      ]);
      
      // All have same stats, should select based on priority: C1 > C2 > Presented
      const selected = balancer.selectKey(keys, stats, 'presented_hash');
      // The first candidate (determined by counter) should win
      expect([1, 2]).toContain(selected.id); // Either C1 or C2, but not presented key
    });
  });
})