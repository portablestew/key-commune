import Database from 'better-sqlite3';

export function runMigrations(db: Database.Database): void {
  // Create api_keys table
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_hash TEXT NOT NULL UNIQUE,
      key_encrypted TEXT NOT NULL,
      key_display TEXT NOT NULL,
      blocked_until INTEGER,
      consecutive_auth_failures INTEGER NOT NULL DEFAULT 0,
      consecutive_throttles INTEGER NOT NULL DEFAULT 0,
      last_success_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  // Create index on key_hash for fast lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash 
    ON api_keys(key_hash);
  `);

  // Create index on blocked_until for filtering available keys
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_api_keys_blocked_until 
    ON api_keys(blocked_until);
  `);

  // Create daily_stats table
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      call_count INTEGER NOT NULL DEFAULT 0,
      throttle_count INTEGER NOT NULL DEFAULT 0,
      last_client_subnet TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (key_id) REFERENCES api_keys(id) ON DELETE CASCADE,
      UNIQUE(key_id, date)
    );
  `);

  // Create index on key_id and date for fast daily lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_daily_stats_key_date 
    ON daily_stats(key_id, date);
  `);

  // Create trigger to update updated_at on api_keys
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_api_keys_timestamp 
    AFTER UPDATE ON api_keys
    BEGIN
      UPDATE api_keys SET updated_at = unixepoch() WHERE id = NEW.id;
    END;
  `);

  // Create trigger to update updated_at on daily_stats
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_daily_stats_timestamp 
    AFTER UPDATE ON daily_stats
    BEGIN
      UPDATE daily_stats SET updated_at = unixepoch() WHERE id = NEW.id;
    END;
  `);

  console.log('Database migrations completed successfully');
}