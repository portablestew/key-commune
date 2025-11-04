// Database entity types based on SPEC.md schema
// These represent data as stored in the database with encrypted keys

export interface DbApiKey {
  id: number;
  key_hash: string;
  key_encrypted: string;
  key_display: string;
  blocked_until: number | null;
  consecutive_auth_failures: number;
  consecutive_throttles: number;
  last_success_at: number | null;
  created_at: number;
  updated_at: number;
}

// In-memory representation with decrypted key
// This is used throughout the application after loading from DB
export interface ApiKey {
  id: number;
  key_hash: string;
  key: string; // Raw, decrypted API key
  key_display: string;
  blocked_until: number | null;
  consecutive_auth_failures: number;
  consecutive_throttles: number;
  last_success_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface DailyStats {
  id: number;
  key_id: number;
  date: string;
  call_count: number;
  throttle_count: number;
  last_client_subnet: string | null;
  created_at: number;
  updated_at: number;
}

// Conversion helpers
export function dbKeyToApiKey(dbKey: DbApiKey, decryptedKey: string): ApiKey {
  return {
    id: dbKey.id,
    key_hash: dbKey.key_hash,
    key: decryptedKey,
    key_display: dbKey.key_display,
    blocked_until: dbKey.blocked_until,
    consecutive_auth_failures: dbKey.consecutive_auth_failures,
    consecutive_throttles: dbKey.consecutive_throttles,
    last_success_at: dbKey.last_success_at,
    created_at: dbKey.created_at,
    updated_at: dbKey.updated_at,
  };
}

export function apiKeyToDbKey(apiKey: ApiKey, encryptedKey: string): DbApiKey {
  return {
    id: apiKey.id,
    key_hash: apiKey.key_hash,
    key_encrypted: encryptedKey,
    key_display: apiKey.key_display,
    blocked_until: apiKey.blocked_until,
    consecutive_auth_failures: apiKey.consecutive_auth_failures,
    consecutive_throttles: apiKey.consecutive_throttles,
    last_success_at: apiKey.last_success_at,
    created_at: apiKey.created_at,
    updated_at: apiKey.updated_at,
  };
}