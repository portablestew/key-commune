import { ApiKey } from '../types/database.js';
import { DailyStats } from '../types/database.js';

export interface LoadBalancerStats {
  throttleCount: number;
  callCount: number;
}

/**
 * Best-of-two load balancing algorithm
 * Provides O(1) complexity while maintaining good distribution
 */
export class LoadBalancer {
  /**
   * Select the best key from available pool using best-of-two algorithm
   * 
   * Algorithm:
   * 1. Randomly select 2 keys from the pool
   * 2. Compare throttle counts (lower is better)
   * 3. If tied, compare call counts (lower is better)
   * 4. If still tied, randomly select one
   * 
   * @param availableKeys Array of available (non-blocked) API keys
   * @param statsMap Map of key_id to today's stats
   * @returns Selected API key for this request
   */
  selectKey(
    availableKeys: ApiKey[],
    statsMap: Map<number, DailyStats>
  ): ApiKey {
    if (availableKeys.length === 0) {
      throw new Error('No available keys to select from');
    }

    if (availableKeys.length === 1) {
      return availableKeys[0];
    }

    // Randomly select two different keys
    const index1 = Math.floor(Math.random() * availableKeys.length);
    let index2 = Math.floor(Math.random() * availableKeys.length);
    
    // Ensure we pick two different keys
    while (index2 === index1 && availableKeys.length > 1) {
      index2 = Math.floor(Math.random() * availableKeys.length);
    }

    const key1 = availableKeys[index1];
    const key2 = availableKeys[index2];

    // Get stats for both keys (default to 0 if no stats exist)
    const stats1 = statsMap.get(key1.id) || {
      throttle_count: 0,
      call_count: 0,
    } as DailyStats;
    
    const stats2 = statsMap.get(key2.id) || {
      throttle_count: 0,
      call_count: 0,
    } as DailyStats;

    // Compare throttle counts first (lower is better)
    if (stats1.throttle_count < stats2.throttle_count) {
      return key1;
    } else if (stats2.throttle_count < stats1.throttle_count) {
      return key2;
    }

    // Throttle counts are equal, compare call counts (lower is better)
    if (stats1.call_count < stats2.call_count) {
      return key1;
    } else if (stats2.call_count < stats1.call_count) {
      return key2;
    }

    // Both metrics are equal, randomly select
    return Math.random() < 0.5 ? key1 : key2;
  }

  /**
   * Get stats for a specific key
   * Returns zero values if no stats exist
   */
  getKeyStats(keyId: number, statsMap: Map<number, DailyStats>): LoadBalancerStats {
    const stats = statsMap.get(keyId);
    
    return {
      throttleCount: stats?.throttle_count || 0,
      callCount: stats?.call_count || 0,
    };
  }
}