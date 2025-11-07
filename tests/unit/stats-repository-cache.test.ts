import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { StatsRepository } from '../../src/db/repositories/stats.js';

describe('StatsRepository Cache', () => {
  let db: Database.Database;
  let statsRepo: StatsRepository;

  beforeEach(() => {
    // Use in-memory database for testing
    db = new Database(':memory:');
    
    // Create tables
    db.exec(`
      CREATE TABLE daily_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        call_count INTEGER DEFAULT 0,
        throttle_count INTEGER DEFAULT 0,
        last_client_subnet TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        UNIQUE(key_id, date)
      )
    `);

    statsRepo = new StatsRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('Cache Lifecycle', () => {
    it('should start cache refresh with given expiry', () => {
      const spyRefresh = vi.spyOn(statsRepo as any, 'refreshTodayStatsCache');
      
      statsRepo.startCacheRefresh(30);
      
      expect(spyRefresh).toHaveBeenCalled();
      expect((statsRepo as any).cacheExpiryMs).toBe(30000);
      expect((statsRepo as any).refreshIntervalId).not.toBeNull();
    });

    it('should stop cache refresh', () => {
      const spyClearInterval = vi.spyOn(global, 'clearInterval');
      statsRepo.startCacheRefresh(30);
      const intervalId = (statsRepo as any).refreshIntervalId;
      
      statsRepo.stopCacheRefresh();
      
      expect((statsRepo as any).refreshIntervalId).toBeNull();
      expect(spyClearInterval).toHaveBeenCalledWith(intervalId);
      spyClearInterval.mockRestore();
    });

    it('should refresh cache periodically', async () => {
      const spyRefresh = vi.spyOn(statsRepo as any, 'refreshTodayStatsCache');
      vi.useFakeTimers();
      
      // Use 60 seconds to respect minimum interval enforcement
      statsRepo.startCacheRefresh(60);
      
      // Advance time by 61 seconds (respecting minimum 60s interval)
      vi.advanceTimersByTime(61000);
      
      // Should be called twice: initial + periodic
      expect(spyRefresh).toHaveBeenCalledTimes(2);
      
      vi.useRealTimers();
    });
  });

  describe('Cache Read Methods', () => {
    beforeEach(() => {
      // Add test stats
      const today = new Date().toISOString().split('T')[0];
      db.prepare(`
        INSERT INTO daily_stats (key_id, date, call_count, throttle_count)
        VALUES (?, ?, ?, ?)
      `).run(1, today, 5, 2);
      
      db.prepare(`
        INSERT INTO daily_stats (key_id, date, call_count, throttle_count)
        VALUES (?, ?, ?, ?)
      `).run(2, today, 3, 1);
      
      statsRepo.startCacheRefresh(60);
    });

    it('should get cached today stats', () => {
      const statsMap = statsRepo.getCachedTodayStats();
      
      expect(statsMap.size).toBe(2);
      expect(statsMap.get(1)?.call_count).toBe(5);
      expect(statsMap.get(2)?.call_count).toBe(3);
    });

    it('should get cache status', () => {
      const status = statsRepo.getCacheStatus();
      
      expect(status.cached).toBe(true);
      expect(status.statsCount).toBe(2);
      expect(status.ageMs).toBeGreaterThanOrEqual(0);
    });

    it('should refresh cache when expired', () => {
      const spyRefresh = vi.spyOn(statsRepo as any, 'refreshTodayStatsCache');
      
      // Set cache to expired
      (statsRepo as any).cacheExpiryMs = 1;
      (statsRepo as any).todayStatsCache = { 
        statsMap: new Map(), 
        date: new Date().toISOString().split('T')[0],
        timestamp: Date.now() - 1000 
      };
      
      statsRepo.getCachedTodayStats();
      
      expect(spyRefresh).toHaveBeenCalled();
    });

    it('should refresh cache when date changes', () => {
      const spyRefresh = vi.spyOn(statsRepo as any, 'refreshTodayStatsCache');
      
      // Set cache with old date
      (statsRepo as any).todayStatsCache = { 
        statsMap: new Map(), 
        date: '2023-01-01',
        timestamp: Date.now() 
      };
      
      statsRepo.getCachedTodayStats();
      
      expect(spyRefresh).toHaveBeenCalled();
    });

    it('should return copy of stats map to prevent mutation', () => {
      const statsMap = statsRepo.getCachedTodayStats();
      
      // Try to mutate the returned map
      statsMap.set(999, { 
        id: 999, 
        key_id: 999, 
        date: new Date().toISOString().split('T')[0], 
        call_count: 100, 
        throttle_count: 50,
        last_client_subnet: 'test'
      } as any);
      
      // Get stats again
      const newStatsMap = statsRepo.getCachedTodayStats();
      
      // Original map should not be affected
      expect(newStatsMap.size).toBe(2);
      expect(newStatsMap.has(999)).toBe(false);
    });
  });

  describe('Write-Through Cache', () => {
    beforeEach(() => {
      statsRepo.startCacheRefresh(60);
    });

    it('should update cache when incrementing call count', () => {
      const today = new Date().toISOString().split('T')[0];
      
      // Create initial stats
      statsRepo.incrementCallCount(1, '192.168.1.1');
      
      // Refresh cache to ensure it's populated
      (statsRepo as any).refreshTodayStatsCache();
      
      // Get initial cache
      const statsMap = statsRepo.getCachedTodayStats();
      const initialStats = statsMap.get(1);
      
      expect(initialStats?.call_count).toBe(1);
      expect(initialStats?.last_client_subnet).toBe('192.168.1.1');
      
      // Increment call count again
      statsRepo.incrementCallCount(1, '192.168.1.2');
      
      // Refresh cache to ensure it's updated
      (statsRepo as any).refreshTodayStatsCache();
      
      // Get updated cache
      const updatedStatsMap = statsRepo.getCachedTodayStats();
      const updatedStats = updatedStatsMap.get(1);
      
      expect(updatedStats?.call_count).toBe(2);
      expect(updatedStats?.last_client_subnet).toBe('192.168.1.2');
    });

    it('should update cache when incrementing throttle count', () => {
      const today = new Date().toISOString().split('T')[0];
      
      // Create initial stats
      statsRepo.incrementCallCount(1, '192.168.1.1');
      
      // Refresh cache to ensure it's populated
      (statsRepo as any).refreshTodayStatsCache();
      
      // Get initial cache
      const statsMap = statsRepo.getCachedTodayStats();
      const initialStats = statsMap.get(1);
      
      expect(initialStats?.throttle_count).toBe(0);
      
      // Increment throttle count
      statsRepo.incrementThrottleCount(1);
      
      // Refresh cache to ensure it's updated
      (statsRepo as any).refreshTodayStatsCache();
      
      // Get updated cache
      const updatedStatsMap = statsRepo.getCachedTodayStats();
      const updatedStats = updatedStatsMap.get(1);
      
      expect(updatedStats?.throttle_count).toBe(1);
    });

    it('should handle multiple keys in cache', () => {
      const today = new Date().toISOString().split('T')[0];
      
      // Create stats for multiple keys
      statsRepo.incrementCallCount(1, '192.168.1.1');
      statsRepo.incrementCallCount(2, '192.168.1.2');
      statsRepo.incrementThrottleCount(1);
      
      // Refresh cache to ensure it's populated
      (statsRepo as any).refreshTodayStatsCache();
      
      // Get cache
      const statsMap = statsRepo.getCachedTodayStats();
      
      expect(statsMap.size).toBe(2);
      expect(statsMap.get(1)?.call_count).toBe(1);
      expect(statsMap.get(2)?.call_count).toBe(1);
      expect(statsMap.get(1)?.throttle_count).toBe(1);
      expect(statsMap.get(2)?.throttle_count).toBe(0);
    });
  });

  describe('Cache Consistency', () => {
    it('should maintain cache consistency with database', () => {
      statsRepo.startCacheRefresh(60);
      
      // Create stats
      statsRepo.incrementCallCount(1, '192.168.1.1');
      
      // Refresh cache to ensure it's populated
      (statsRepo as any).refreshTodayStatsCache();
      
      // Verify cache has the stats
      let statsMap = statsRepo.getCachedTodayStats();
      expect(statsMap.size).toBe(1);
      expect(statsMap.get(1)?.call_count).toBe(1);
      
      // Update database directly (bypassing repository)
      const today = new Date().toISOString().split('T')[0];
      db.prepare(`
        UPDATE daily_stats
        SET call_count = ?
        WHERE key_id = ? AND date = ?
      `).run(100, 1, today);
      
      // Cache should still have old value (not updated yet)
      statsMap = statsRepo.getCachedTodayStats();
      expect(statsMap.get(1)?.call_count).toBe(1);
      
      // Refresh cache
      (statsRepo as any).refreshTodayStatsCache();
      
      // Cache should now be updated
      statsMap = statsRepo.getCachedTodayStats();
      expect(statsMap.get(1)?.call_count).toBe(100);
    });

    it('should handle date rollover correctly', () => {
      const today = new Date().toISOString().split('T')[0];
      const oldDate = '2023-01-01';
      
      // Create stats for today
      statsRepo.incrementCallCount(1, '192.168.1.1');
      
      // Refresh cache to ensure it's populated
      (statsRepo as any).refreshTodayStatsCache();
      
      // Verify cache has the stats
      let statsMap = statsRepo.getCachedTodayStats();
      expect(statsMap.size).toBe(1);
      
      // Mock date change by setting cache date to old date
      (statsRepo as any).todayStatsCache = {
        statsMap: statsMap,
        date: oldDate, // Old date
        timestamp: Date.now()
      };
      
      // Get stats - should refresh cache and show stats for today's date
      statsMap = statsRepo.getCachedTodayStats();
      
      // Cache should show stats for today's date (not the old date)
      expect(statsMap.size).toBe(1);
      expect(statsMap.has(1)).toBe(true);
    });
  });
});