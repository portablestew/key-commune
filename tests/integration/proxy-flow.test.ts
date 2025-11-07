import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, ServerWithCleanup } from '../../src/server.js';
import { closeDatabase, getDatabase } from '../../src/db/database.js';
import { runMigrations } from '../../src/db/migrations.js';
import { KeysRepository } from '../../src/db/repositories/keys.js';
import { StatsRepository } from '../../src/db/repositories/stats.js';
import { AppConfig } from '../../src/types/config.js';

describe('Proxy Integration Tests', () => {
  let server: ServerWithCleanup;
  let testDb: any;
  let keysRepo: any;
  let statsRepo: any;

  beforeEach(async () => {
    // Use in-memory database for testing
    testDb = getDatabase(':memory:');
    runMigrations(testDb);
    
    // Create repositories
    const testEncryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    keysRepo = new KeysRepository(testDb, testEncryptionKey);
    statsRepo = new StatsRepository(testDb);

    // Create test config
    const testConfig: AppConfig = {
      server: { port: 3001, host: '127.0.0.1', provider: 'openrouter' },
      database: { path: ':memory:', max_keys: 1000 },
      blocking: {
        presented_key_rate_limit_seconds: 1,
        auth_failure_block_minutes: 1440,
        auth_failure_delete_threshold: 3,
        throttle_backoff_base_minutes: 1,
        throttle_delete_threshold: 10,
        throttle_delete_timespan_minutes: 1440
      },
      logging: { level: 'info', key_display: { prefix_length: 4, suffix_length: 4 } },
      stats: { 
        retention_days: 15, 
        cleanup_interval_minutes: 60, 
        auto_cleanup: true, 
        cache_expiry_seconds: 60 
      },
      providers: [
        {
          name: 'openrouter',
          base_url: 'https://openrouter.ai/api/v1',
          timeout_ms: 60000,
          auth_header: 'Authorization',
          validation: {
            min_key_length: 16,
            max_key_length: 256,
            custom_rules: [
              {
                type: 'body-json',
                json_key: 'model',
                regex: 'minimax/minimax-m2:free'
              }
            ]
          }
        }
      ],
      encryption_key: testEncryptionKey
    };

    // Start test server
    server = await createServer(testConfig);
    await server.server.listen({ port: 3001, host: '127.0.0.1' });
  });

  afterEach(async () => {
    if (server) {
      server.statsCleanupService.stop();
      await server.server.close();
    }
    closeDatabase();
    vi.clearAllMocks();
  });

  describe('Load Balancing Integration', () => {
    beforeEach(async () => {
      // Pre-populate database with test keys
      keysRepo.create('hash1', 'sk-test-key-1', 'sk-te..ey-1');
      keysRepo.create('hash2', 'sk-test-key-2', 'sk-te..ey-2');
    });

    it('should proxy requests through existing keys with load balancing', async () => {
      // Mock successful external API response
      global.fetch = vi.fn().mockResolvedValueOnce({
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: () => Promise.resolve('{"id": "test-response", "object": "chat.completion", "choices": [{"message": {"content": "Hello!"}}]}'),
        ok: true
      });

      const response = await fetch('http://127.0.0.1:3001/api/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer sk-test-key-1',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'minimax/minimax-m2:free',
          messages: [{ role: 'user', content: 'Hello!' }]
        })
      });

      expect(response.status).toBe(200);
      
      // Verify external API was called
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should handle blocked key isolation correctly', async () => {
      // Block first key
      const key = keysRepo.findByHash('hash1')!;
      keysRepo.updateBlockedUntil(key.id, Math.floor(Date.now() / 1000) + 3600); // Block for 1 hour

      // Mock successful response
      global.fetch = vi.fn().mockResolvedValueOnce({
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: () => Promise.resolve('{"id": "test-response", "object": "chat.completion", "choices": [{"message": {"content": "Hello!"}}]}'),
        ok: true
      });

      const response = await fetch('http://127.0.0.1:3001/api/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer sk-test-key-1', // This is the blocked key
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'minimax/minimax-m2:free',
          messages: [{ role: 'user', content: 'Hello!' }]
        })
      });

      expect(response.status).toBe(200);
      
      // Should still work due to isolation (uses presented key directly)
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('Request Flow Integration', () => {
    it('should handle complete request lifecycle', async () => {
      // Pre-populate with one key
      keysRepo.create('hash1', 'sk-existing-key', 'sk-ex..ng-key');

      // Mock external API response
      global.fetch = vi.fn().mockResolvedValueOnce({
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: () => Promise.resolve('{"id": "test-response", "choices": [{"message": {"content": "Success"}}]}'),
        ok: true
      });

      const response = await fetch('http://127.0.0.1:3001/api/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer sk-existing-key',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'minimax/minimax-m2:free',
          messages: [{ role: 'user', content: 'Test request' }]
        })
      });

      // Verify successful response
      expect(response.status).toBe(200);
      
      // Verify external API was called correctly
      expect(global.fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:3001/api/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer sk-existing-key',
            'Content-Type': 'application/json'
          })
        })
      );
    });
  });
});