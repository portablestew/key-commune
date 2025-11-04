import Database from 'better-sqlite3';
import { DailyStats } from '../../types/database.js';

export class StatsRepository {
  constructor(private db: Database.Database) {}

  private getTodayDate(): string {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
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

  incrementCallCount(keyId: number, clientSubnet: string): void {
    const stats = this.createOrGetToday(keyId);
    
    const stmt = this.db.prepare(`
      UPDATE daily_stats 
      SET call_count = call_count + 1,
          last_client_subnet = ?
      WHERE id = ?
    `);
    stmt.run(clientSubnet, stats.id);
  }

  incrementThrottleCount(keyId: number): void {
    const stats = this.createOrGetToday(keyId);
    
    const stmt = this.db.prepare(`
      UPDATE daily_stats 
      SET throttle_count = throttle_count + 1
      WHERE id = ?
    `);
    stmt.run(stats.id);
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