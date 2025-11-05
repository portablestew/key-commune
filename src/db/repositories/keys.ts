import Database from 'better-sqlite3';
import { ApiKey, DbApiKey, dbKeyToApiKey } from '../../types/database.js';
import { encryptKey, decryptKey } from '../../services/encryption.js';

export class KeysRepository {
  private onKeyChangeCallbacks: Array<() => void> = [];

  constructor(
    private db: Database.Database,
    private encryptionKey: string
  ) {}

  create(keyHash: string, rawKey: string, keyDisplay: string): ApiKey {
    const keyEncrypted = encryptKey(rawKey, this.encryptionKey);
    const stmt = this.db.prepare(`
      INSERT INTO api_keys (key_hash, key_encrypted, key_display)
      VALUES (?, ?, ?)
    `);
    
    const result = stmt.run(keyHash, keyEncrypted, keyDisplay);
    return this.findById(result.lastInsertRowid as number)!;
  }

  findById(id: number): ApiKey | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM api_keys WHERE id = ?
    `);
    const dbKey = stmt.get(id) as DbApiKey | undefined;
    if (!dbKey) return undefined;
    
    const decryptedKey = decryptKey(dbKey.key_encrypted, this.encryptionKey);
    return dbKeyToApiKey(dbKey, decryptedKey);
  }

  findByHash(keyHash: string): ApiKey | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM api_keys WHERE key_hash = ?
    `);
    const dbKey = stmt.get(keyHash) as DbApiKey | undefined;
    if (!dbKey) return undefined;
    
    const decryptedKey = decryptKey(dbKey.key_encrypted, this.encryptionKey);
    return dbKeyToApiKey(dbKey, decryptedKey);
  }

  findAvailable(): ApiKey[] {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      SELECT * FROM api_keys
      WHERE blocked_until IS NULL OR blocked_until <= ?
    `);
    const dbKeys = stmt.all(now) as DbApiKey[];
    return dbKeys.map(dbKey => {
      const decryptedKey = decryptKey(dbKey.key_encrypted, this.encryptionKey);
      return dbKeyToApiKey(dbKey, decryptedKey);
    });
  }

  findAll(): ApiKey[] {
    const stmt = this.db.prepare(`SELECT * FROM api_keys`);
    const dbKeys = stmt.all() as DbApiKey[];
    return dbKeys.map(dbKey => {
      const decryptedKey = decryptKey(dbKey.key_encrypted, this.encryptionKey);
      return dbKeyToApiKey(dbKey, decryptedKey);
    });
  }

  count(): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM api_keys`);
    const result = stmt.get() as { count: number };
    return result.count;
  }

  updateBlockedUntil(id: number, blockedUntil: number | null): void {
    const stmt = this.db.prepare(`
      UPDATE api_keys SET blocked_until = ? WHERE id = ?
    `);
    stmt.run(blockedUntil, id);
    
    // Notify cache when key blocking state changes
    this.onKeyChangeCallbacks.forEach(callback => callback());
  }

  incrementAuthFailures(id: number): number {
    const stmt = this.db.prepare(`
      UPDATE api_keys
      SET consecutive_auth_failures = consecutive_auth_failures + 1
      WHERE id = ?
    `);
    stmt.run(id);
    
    // Notify cache when auth failures change
    this.onKeyChangeCallbacks.forEach(callback => callback());
    
    const key = this.findById(id);
    return key!.consecutive_auth_failures;
  }

  incrementThrottles(id: number): number {
    const stmt = this.db.prepare(`
      UPDATE api_keys
      SET consecutive_throttles = consecutive_throttles + 1
      WHERE id = ?
    `);
    stmt.run(id);
    
    // Notify cache when throttles change
    this.onKeyChangeCallbacks.forEach(callback => callback());
    
    const key = this.findById(id);
    return key!.consecutive_throttles;
  }

  resetCounters(id: number): void {
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(`
      UPDATE api_keys
      SET consecutive_auth_failures = 0,
          consecutive_throttles = 0,
          blocked_until = NULL,
          last_success_at = ?
      WHERE id = ?
    `);
    stmt.run(now, id);
    
    // Notify cache when counters are reset
    this.onKeyChangeCallbacks.forEach(callback => callback());
  }

  delete(id: number): void {
    const stmt = this.db.prepare(`DELETE FROM api_keys WHERE id = ?`);
    stmt.run(id);
    
    // Notify cache when key is deleted
    this.onKeyChangeCallbacks.forEach(callback => callback());
  }

  deleteByHash(keyHash: string): void {
    const stmt = this.db.prepare(`DELETE FROM api_keys WHERE key_hash = ?`);
    stmt.run(keyHash);
    
    // Notify cache when key is deleted
    this.onKeyChangeCallbacks.forEach(callback => callback());
  }

  /**
   * Register a callback to be called when keys change
   */
  onKeyChange(callback: () => void): void {
    this.onKeyChangeCallbacks.push(callback);
  }

  /**
   * Remove a callback
   */
  removeKeyChangeCallback(callback: () => void): void {
    const index = this.onKeyChangeCallbacks.indexOf(callback);
    if (index > -1) {
      this.onKeyChangeCallbacks.splice(index, 1);
    }
  }
}