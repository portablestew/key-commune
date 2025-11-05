import { ApiKey, DailyStats } from '../types/database.js';
import { AppConfig } from '../types/config.js';
import { KeysRepository } from '../db/repositories/keys.js';
import { StatsRepository } from '../db/repositories/stats.js';

export interface CacheEntry {
  availableKeys: ApiKey[];
  statsMap: Map<number, DailyStats>;
  timestamp: number;
}

/**
 * Unified cache for load balancer data
 * Fetches and caches available keys and today's stats together
 * Ensures consistency between the two datasets
 */
export class LoadBalancerCache {
  private cache: CacheEntry | null = null;
  private readonly cacheExpiryMs: number;

  constructor(
    private keysRepo: KeysRepository,
    private statsRepo: StatsRepository,
    private config: AppConfig
  ) {
    this.cacheExpiryMs = config.stats.cache_expiry_seconds * 1000;
  }

  /**
   * Get cached available keys and stats
   * Fetches fresh data if cache is expired or empty
   */
  async getCachedLoadBalancerData(): Promise<CacheEntry> {
    const now = Date.now();
    
    // Return cached data if still valid
    if (this.cache && (now - this.cache.timestamp) < this.cacheExpiryMs) {
      return this.cache;
    }

    // Fetch fresh data from both repositories
    await this.refreshCache();
    return this.cache!;
  }

  /**
   * Force refresh cache (useful for testing or when key state changes)
   */
  async refreshCache(): Promise<void> {
    const now = Date.now();
    
    // Fetch available keys and shuffle them
    const availableKeys = this.keysRepo.findAvailable();
    this.shuffleArray(availableKeys);
    
    // Fetch today's stats
    const todayStats = this.statsRepo.findAllToday();
    const statsMap = new Map();
    todayStats.forEach(stat => statsMap.set(stat.key_id, stat));
    
    // Update cache
    this.cache = {
      availableKeys,
      statsMap,
      timestamp: now
    };
  }

  /**
   * Invalidate cache (call when keys are modified)
   */
  invalidateCache(): void {
    this.cache = null;
  }

  /**
   * Fisher-Yates shuffle algorithm to randomize array in-place
   */
  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  /**
   * Get cache status for monitoring
   */
  getCacheStatus(): { cached: boolean; ageMs: number; keyCount: number; statsCount: number } {
    if (!this.cache) {
      return { cached: false, ageMs: 0, keyCount: 0, statsCount: 0 };
    }

    return {
      cached: true,
      ageMs: Date.now() - this.cache.timestamp,
      keyCount: this.cache.availableKeys.length,
      statsCount: this.cache.statsMap.size
    };
  }
}