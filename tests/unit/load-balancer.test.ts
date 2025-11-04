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
      expect(() => balancer.selectKey([], new Map())).toThrow('No available keys');
    });

    it('should return single key', () => {
      const keys = [createKey(1)];
      const selected = balancer.selectKey(keys, new Map());
      expect(selected.id).toBe(1);
    });

    it('should prefer key with lower throttle count', () => {
      const keys = [createKey(1), createKey(2)];
      const stats = new Map<number, DailyStats>([
        [1, { throttle_count: 5, call_count: 0 } as DailyStats],
        [2, { throttle_count: 2, call_count: 0 } as DailyStats],
      ]);

      const results = new Set();
      for (let i = 0; i < 10; i++) {
        results.add(balancer.selectKey(keys, stats).id);
      }

      expect(results.has(2)).toBe(true);
    });

    it('should use call count as tie-breaker', () => {
      const keys = [createKey(1), createKey(2)];
      const stats = new Map<number, DailyStats>([
        [1, { throttle_count: 0, call_count: 10 } as DailyStats],
        [2, { throttle_count: 0, call_count: 5 } as DailyStats],
      ]);

      const results = new Set();
      for (let i = 0; i < 10; i++) {
        results.add(balancer.selectKey(keys, stats).id);
      }

      expect(results.has(2)).toBe(true);
    });
  });
})