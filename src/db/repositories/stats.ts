import Database from 'better-sqlite3';
import { DailyStats } from '../../types/database.js';

export class StatsRepository {
  private todayStatsCache: { statsMap: Map<number, DailyStats>; date: string; timestamp: number } | null = null;
  private cacheExpiryMs: number = 0;
  private refreshIntervalId: NodeJS.Timeout | null = null;

  constructor(private db: Database.Database) {}

  private getTodayDate(): string {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  }

  // Cache lifecycle methods
  startCacheRefresh(cacheExpirySeconds: number): void {
    this.cacheExpiryMs = cacheExpirySeconds * 1000;
    this.refreshTodayStatsCache();
    this.refreshIntervalId = setInterval(() => {
      this.refreshTodayStatsCache();
    }, Math.max(cacheExpirySeconds * 1000, 60000)); // Minimum 60 seconds
  }

  stopCacheRefresh(): void {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
    }
  }

  private refreshTodayStatsCache(): void {
    const today = this.getTodayDate();
    const stmt = this.db.prepare(`
      SELECT * FROM daily_stats WHERE date = ?
    `);
    const todayStats = stmt.all(today) as DailyStats[];
    const statsMap = new Map<number, DailyStats>();
    todayStats.forEach(stat => statsMap.set(stat.key_id, stat));
    this.todayStatsCache = { statsMap, date: today, timestamp: Date.now() };
  }

  // Cache read methods
  getCachedTodayStats(): Map<number, DailyStats> {
    const today = this.getTodayDate();
    
    // Check if cache exists and is valid
    if (!this.todayStatsCache ||
        (Date.now() - this.todayStatsCache.timestamp) > this.cacheExpiryMs ||
        this.todayStatsCache.date !== today) {
      this.refreshTodayStatsCache();
    }
    
    // Return a copy to prevent external mutation
    return new Map(this.todayStatsCache!.statsMap);
  }

  getCacheStatus(): { cached: boolean; ageMs: number; statsCount: number } {
    if (!this.todayStatsCache) {
      return { cached: false, ageMs: 0, statsCount: 0 };
    }
    return {
      cached: true,
      ageMs: Date.now() - this.todayStatsCache.timestamp,
      statsCount: this.todayStatsCache.statsMap.size
    };
  }

  findTodayByKeyId(keyId: number): DailyStats | undefined {
    const today = this.getTodayDate();
    const stmt = this.db.prepare(`
      SELECT * FROM daily_stats 
      WHERE key_id = ? AND date = ?
    `);
    return stmt.get(keyId, today) as DailyStats | undefined;
  }

  findAllToday(): DailyStats[] {
    const today = this.getTodayDate();
    const stmt = this.db.prepare(`
      SELECT * FROM daily_stats WHERE date = ?
    `);
    return stmt.all(today) as DailyStats[];
  }

  findByKeyIdAndDate(keyId: number, date: string): DailyStats | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM daily_stats 
      WHERE key_id = ? AND date = ?
    `);
    return stmt.get(keyId, date) as DailyStats | undefined;
  }

  createOrGetToday(keyId: number): DailyStats {
    const today = this.getTodayDate();
    
    // Try to find existing
    let stats = this.findTodayByKeyId(keyId);
    if (stats) {
      return stats;
    }
    
    // Create new
    const stmt = this.db.prepare(`
      INSERT INTO daily_stats (key_id, date, call_count, throttle_count)
      VALUES (?, ?, 0, 0)
    `);
    
    const result = stmt.run(keyId, today);
    return this.findTodayByKeyId(keyId)!;
  }

  private getCacheEntry(keyId: number): DailyStats | undefined {
    if (this.todayStatsCache && this.todayStatsCache.date === this.getTodayDate()) {
      return this.todayStatsCache.statsMap.get(keyId);
    }
    return undefined;
  }

  incrementCallCount(keyId: number, clientSubnet: string): void {
    const stats = this.createOrGetToday(keyId);
    
    const stmt = this.db.prepare(`
      UPDATE daily_stats
      SET call_count = call_count + 1,
          last_client_subnet = ?
      WHERE id = ?
      RETURNING call_count
    `);
    const result = stmt.get(clientSubnet, stats.id) as { call_count: number };

    // Predictive cache update
    const cached = this.getCacheEntry(keyId);
    if (cached) {
      cached.call_count = result.call_count;
      cached.last_client_subnet = clientSubnet;
    }
  }

  incrementThrottleCount(keyId: number): void {
    const stats = this.createOrGetToday(keyId);
    
    const stmt = this.db.prepare(`
      UPDATE daily_stats
      SET throttle_count = throttle_count + 1
      WHERE id = ?
      RETURNING throttle_count
    `);
    const result = stmt.get(stats.id) as { throttle_count: number };

    // Predictive cache update
    const cached = this.getCacheEntry(keyId);
    if (cached) {
      cached.throttle_count = result.throttle_count;
    }
  }

  deleteOldStats(daysToKeep: number = 30): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoff = cutoffDate.toISOString().split('T')[0];
    
    const stmt = this.db.prepare(`
      DELETE FROM daily_stats WHERE date < ?
    `);
    const result = stmt.run(cutoff);
    return result.changes;
  }
}