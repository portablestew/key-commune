import { StatsRepository } from '../db/repositories/stats.js';
import { AppConfig } from '../types/config.js';

export class StatsCleanupService {
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    private statsRepo: StatsRepository,
    private config: AppConfig
  ) {}

  /**
   * Start automatic stats cleanup if enabled in config
   */
  start(): void {
    if (!this.config.stats.auto_cleanup) {
      return;
    }

    const intervalMs = this.config.stats.cleanup_interval_minutes * 60 * 1000;

    // Run cleanup immediately on startup
    this.performCleanup().catch(error => {
      console.error('Initial stats cleanup failed:', error);
    });

    // Set up periodic cleanup
    this.cleanupTimer = setInterval(() => {
      this.performCleanup().catch(error => {
        console.error('Scheduled stats cleanup failed:', error);
      });
    }, intervalMs);

    console.log(`Stats cleanup service started - cleanup every ${this.config.stats.cleanup_interval_minutes} minutes`);
  }

  /**
   * Stop the automatic cleanup timer
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      console.log('Stats cleanup service stopped');
    }
  }

  /**
   * Perform stats cleanup operation
   */
  async performCleanup(): Promise<number> {
    const deletedCount = this.statsRepo.deleteOldStats(this.config.stats.retention_days);
    
    if (deletedCount > 0) {
      console.log(`Stats cleanup completed - deleted ${deletedCount} old statistics records (retention: ${this.config.stats.retention_days} days)`);
    }
    
    return deletedCount;
  }

  /**
   * Get the next scheduled cleanup time (for monitoring/debugging)
   */
  getNextCleanupTime(): Date | null {
    if (!this.cleanupTimer) {
      return null;
    }
    
    const intervalMs = this.config.stats.cleanup_interval_minutes * 60 * 1000;
    const nextTime = new Date(Date.now() + intervalMs);
    return nextTime;
  }
}