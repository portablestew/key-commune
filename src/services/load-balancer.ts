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
  private requestCounter = 0;

  /**
   * Select the best key from available pool using counter-based selection with presented key consideration
   *
   * Algorithm:
   * 1. Increment request counter
   * 2. Select two candidates using counter-based modulo selection
   * 3. Find presented key in available keys (if exists)
   * 4. Compare candidates and presented key based on stats
   * 5. Tie-breaking priority: Candidate 1 > Candidate 2 > Presented Key
   *
   * @param availableKeys Array of available (non-blocked) API keys
   * @param statsMap Map of key_id to today's stats
   * @param presentedKeyHash Hash of the key presented by the caller
   * @returns Selected API key for this request
   */
  selectKey(
    availableKeys: ApiKey[],
    statsMap: Map<number, DailyStats>,
    presentedKeyHash: string
  ): ApiKey {
    if (availableKeys.length === 0) {
      throw new Error('No available keys to select from');
    }

    if (availableKeys.length === 1) {
      return availableKeys[0];
    }

    // Select two candidates using counter-based modulo selection
    // Increment counter twice for proper distribution when testing two keys
    const index1 = this.requestCounter % availableKeys.length;
    this.requestCounter++;
    const index2 = this.requestCounter % availableKeys.length;
    this.requestCounter++;
    
    const key1 = availableKeys[index1];
    const key2 = availableKeys[index2];

    // Find presented key in available keys (if exists)
    const presentedKeyIndex = availableKeys.findIndex(key => key.key_hash === presentedKeyHash);
    const presentedKey = presentedKeyIndex !== -1 ? availableKeys[presentedKeyIndex] : null;

    // Get stats for all candidates (default to 0 if no stats exist)
    const stats1 = statsMap.get(key1.id) || {
      throttle_count: 0,
      call_count: 0,
    } as DailyStats;
    
    const stats2 = statsMap.get(key2.id) || {
      throttle_count: 0,
      call_count: 0,
    } as DailyStats;

    // Compare candidates first
    let winner = this.compareKeys(key1, stats1, key2, stats2);
    
    // If we have a presented key, compare it with the current winner
    if (presentedKey) {
      const presentedStats = statsMap.get(presentedKey.id) || {
        throttle_count: 0,
        call_count: 0,
      } as DailyStats;
      
      // Get stats for current winner
      const winnerStats = statsMap.get(winner.id) || {
        throttle_count: 0,
        call_count: 0,
      } as DailyStats;
      
      // Compare winner with presented key
      winner = this.compareKeys(winner, winnerStats, presentedKey, presentedStats);
    }
    
    return winner;
  }

  /**
   * Compare two keys based on stats with priority rules
   *
   * @param key1 First key to compare
   * @param stats1 Stats for first key
   * @param key2 Second key to compare
   * @param stats2 Stats for second key
   * @returns The winning key
   */
  private compareKeys(
    key1: ApiKey,
    stats1: DailyStats,
    key2: ApiKey,
    stats2: DailyStats
  ): ApiKey {
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

    // Both metrics are equal, apply tie-breaking priority
    // Key1 wins as it's the first candidate
    return key1;
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