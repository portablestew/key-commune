import { KeysRepository } from '../db/repositories/keys.js';
import { StatsRepository } from '../db/repositories/stats.js';
import { BlockingConfig } from '../types/config.js';
import { ApiKey } from '../types/database.js';
import { LRUCache } from 'lru-cache';

export interface ResponseHandlerResult {
  action: 'success' | 'blocked' | 'deleted' | 'proxied';
  message: string;
}

/**
 * Manages API key lifecycle based on response codes
 * Implements the state machine from SPEC.md
 */
export class KeyManager {
  private presentedKeyLastRequest: LRUCache<string, number>;

  constructor(
    private keysRepo: KeysRepository,
    private statsRepo: StatsRepository,
    private config: BlockingConfig,
    private maxKeys: number
  ) {
    // Initialize LRU cache with max size matching database max_keys
    // Add TTL-based cleanup as secondary safety measure (2x the rate limit window)
    this.presentedKeyLastRequest = new LRUCache<string, number>({
      max: this.maxKeys,
      ttl: this.config.presented_key_rate_limit_seconds * 1000 * 2,
      updateAgeOnGet: true,
      updateAgeOnHas: false
    });
  }

  /**
   * Check if a presented key is rate limited
   * Returns whether the request is allowed and optionally a reason
   */
  checkPresentedKeyRateLimit(presentedKeyHash: string): { allowed: boolean; reason?: string } {
    const now = Date.now();
    const lastRequest = this.presentedKeyLastRequest.get(presentedKeyHash);

    if (lastRequest) {
      const elapsedSeconds = (now - lastRequest) / 1000;
      
      if (elapsedSeconds < this.config.presented_key_rate_limit_seconds) {
        const waitSeconds = Math.ceil(this.config.presented_key_rate_limit_seconds - elapsedSeconds);
        return {
          allowed: false,
          reason: `Rate limit exceeded. Wait ${waitSeconds} second(s) before retrying`,
        };
      }
    }

    // Update last request time
    this.presentedKeyLastRequest.set(presentedKeyHash, now);

    return { allowed: true };
  }

  /**
   * Handle successful response (2xx)
   * Reset all counters and unblock the key
   * If key doesn't exist (id === -1), create it first
   */
  handleSuccess(key: ApiKey): ResponseHandlerResult {
    let keyId = key.id;
    
    // If this is a new key (id === -1), create it in the database
    if (keyId === -1) {
      // Check if we've reached the max_keys limit
      const currentCount = this.keysRepo.count();
      if (currentCount >= this.maxKeys) {
        return {
          action: 'proxied',
          message: `Max keys limit reached (${this.maxKeys}) - key not added to pool`,
        };
      }
      
      // Use existing key_display from the ApiKey object
      const newKey = this.keysRepo.create(key.key_hash, key.key, key.key_display);
      keyId = newKey.id;
    }
    
    this.keysRepo.resetCounters(keyId);
    
    return {
      action: 'success',
      message: keyId !== key.id
        ? 'New key created and added to pool - all counters cleared'
        : 'Key reset - all counters cleared and unblocked',
    };
  }

  /**
   * Handle authentication failure (401)
   * Block for 1440 minutes (24 hours)
   * Increment auth failures counter
   * Delete at 3 strikes
   */
  handleAuthFailure(key: ApiKey): ResponseHandlerResult {
    // Don't handle auth failures for non-existent keys (id === -1)
    if (key.id === -1) {
      return {
        action: 'proxied',
        message: 'Auth failure for untracked key - no action taken',
      };
    }
    
    const authFailures = this.keysRepo.incrementAuthFailures(key.id);
    
    if (authFailures >= this.config.auth_failure_delete_threshold) {
      this.keysRepo.delete(key.id);
      return {
        action: 'deleted',
        message: `Key deleted - ${this.config.auth_failure_delete_threshold} consecutive auth failures`,
      };
    }
    
    // Block for configured minutes (default: 1440 = 24 hours)
    const blockedUntil = Math.floor(Date.now() / 1000) + (this.config.auth_failure_block_minutes * 60);
    this.keysRepo.updateBlockedUntil(key.id, blockedUntil);
    
    return {
      action: 'blocked',
      message: `Key blocked for ${this.config.auth_failure_block_minutes} minutes - auth failure ${authFailures}/${this.config.auth_failure_delete_threshold}`,
    };
  }

  /**
   * Handle rate limit (429)
   * Block with exponential backoff: 2^(n-1) minutes
   * Increment throttle counter
   * Delete at 10 strikes in 24 hours
   */
  handleThrottle(key: ApiKey): ResponseHandlerResult {
    // Don't handle throttles for non-existent keys (id === -1)
    if (key.id === -1) {
      return {
        action: 'proxied',
        message: 'Throttle for untracked key - no action taken',
      };
    }
    
    const throttles = this.keysRepo.incrementThrottles(key.id);
    this.statsRepo.incrementThrottleCount(key.id);
    
    if (throttles >= this.config.throttle_delete_threshold) {
      this.keysRepo.delete(key.id);
      return {
        action: 'deleted',
        message: `Key deleted - ${this.config.throttle_delete_threshold} consecutive throttles`,
      };
    }
    
    // Exponential backoff: 2^(n-1) * base_minutes
    const backoffMinutes = Math.pow(2, throttles - 1) * this.config.throttle_backoff_base_minutes;
    const blockedUntil = Math.floor(Date.now() / 1000) + (backoffMinutes * 60);
    this.keysRepo.updateBlockedUntil(key.id, blockedUntil);
    
    return {
      action: 'blocked',
      message: `Key blocked for ${backoffMinutes} minutes - throttle ${throttles}/${this.config.throttle_delete_threshold}`,
    };
  }

  /**
   * Handle response based on status code
   * Main entry point for response handling
   */
  handleResponse(key: ApiKey, statusCode: number): ResponseHandlerResult {
    if (statusCode >= 200 && statusCode < 300) {
      return this.handleSuccess(key);
    } else if (statusCode === 401) {
      return this.handleAuthFailure(key);
    } else if (statusCode === 429) {
      return this.handleThrottle(key);
    }
    
    // Other status codes - no special handling
    return {
      action: 'proxied',
      message: `Status ${statusCode} - no special handling`,
    };
  }

  /**
   * Check if a key is currently blocked
   */
  isKeyBlocked(keyId: number): boolean {
    const key = this.keysRepo.findById(keyId);
    if (!key) return true;
    
    if (!key.blocked_until) return false;
    
    const now = Math.floor(Date.now() / 1000);
    return key.blocked_until > now;
  }

  /**
   * Get subnet from IP address (x.x.x.0/24 format)
   */
  getSubnet(ipAddress: string): string {
    const parts = ipAddress.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
    }
    return ipAddress; // IPv6 or invalid - return as-is
  }
}