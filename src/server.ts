import * as fs from 'fs';
import * as path from 'path';
import Fastify, { FastifyInstance } from 'fastify';
import { AppConfig } from './types/config.js';
import { ApiKey } from './types/database.js';
import { getDatabase } from './db/database.js';
import { runMigrations } from './db/migrations.js';
import { KeysRepository } from './db/repositories/keys.js';
import { StatsRepository } from './db/repositories/stats.js';
import { LoadBalancer } from './services/load-balancer.js';
import { KeyManager } from './services/key-manager.js';
import { KeyValidator } from './services/key-validator.js';
import { ProxyService } from './services/proxy.js';
import { extractAuthKey, extractClientIP } from './middleware/auth-extractor.js';
import { errorHandler, sendError } from './middleware/error-handler.js';
import { generateDisplayKey } from './services/encryption.js';
import { StatsCleanupService } from './services/stats-cleanup.js';
import { LoadBalancerCache } from './services/load-balancer-cache.js';

/**
 * Server startup result with cleanup service for shutdown handling
 */
export interface ServerWithCleanup {
  server: any;
  statsCleanupService: StatsCleanupService;
}

export async function createServer(config: AppConfig): Promise<ServerWithCleanup> {
  const serverStartTime = Date.now();

  // Initialize Fastify with logging and SSL if enabled
  let fastifyOptions: any = {
    logger: {
      level: 'info',
    },
  };

  // Configure SSL if enabled
  if (config.ssl?.enabled) {
    if (!config.ssl.cert_path || !config.ssl.key_path) {
      throw new Error('SSL is enabled but certificate or key path is missing');
    }

    try {
      const certPath = path.resolve(process.cwd(), config.ssl.cert_path);
      const keyPath = path.resolve(process.cwd(), config.ssl.key_path);
      
      // Read certificate files
      const cert = fs.readFileSync(certPath, 'utf8');
      const key = fs.readFileSync(keyPath, 'utf8');
      
      // Configure HTTPS
      fastifyOptions.https = {
        cert,
        key,
      };
      
      console.log('SSL enabled with certificates:', {
        cert_path: config.ssl.cert_path,
        key_path: config.ssl.key_path,
      });
    } catch (error) {
      throw new Error(`Failed to load SSL certificates: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    console.log('SSL disabled - using HTTP');
  }

  const server = Fastify(fastifyOptions);

  // Set error handler
  server.setErrorHandler(errorHandler);

  // Initialize database
  const db = getDatabase(config.database.path);
  runMigrations(db);

  // Initialize repositories
  const keysRepo = new KeysRepository(db, config.encryption_key!);
  const statsRepo = new StatsRepository(db);

  // Initialize load balancer cache
  const loadBalancerCache = new LoadBalancerCache(keysRepo, statsRepo, config);
  keysRepo.onKeyChange(() => loadBalancerCache.invalidateCache());

  // Pre-populate cache to avoid "degraded" status on startup
  try {
    await loadBalancerCache.refreshCache();
  } catch (error) {
    console.error('Failed to initialize cache:', error);
  }

  // Initialize services
  const loadBalancer = new LoadBalancer();
  const keyManager = new KeyManager(keysRepo, statsRepo, config.blocking, config.database.max_keys);
  const keyValidator = new KeyValidator();
  const proxyService = new ProxyService();

  // Initialize and start stats cleanup service
  const statsCleanupService = new StatsCleanupService(statsRepo, config);
  statsCleanupService.start();

  // Index page route
  server.get('/', async (request, reply) => {
    const cacheStatus = loadBalancerCache.getCacheStatus();
    const cacheStatusText = cacheStatus.cached
      ? `Fresh (${(cacheStatus.ageMs / 1000).toFixed(1)}s old)`
      : 'Not initialized';

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Key Commune</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      max-width: 800px;
      margin: 40px auto;
      padding: 20px;
      line-height: 1.6;
      color: #333;
    }
    h1 { color: #2c3e50; margin-bottom: 10px; }
    .subtitle { color: #7f8c8d; margin-bottom: 30px; }
    .stats {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid #3498db;
    }
    .stat-item { margin: 8px 0; }
    a { color: #3498db; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>🔑 Key Commune</h1>
  <p class="subtitle">A proxy server for sharing a pool of API keys</p>
  
  <p>
    This server automatically manages a shared pool of API keys, providing
    improved availability and financial isolation. Callers join the commune
    by making valid requests, then benefit from load balancing across all keys.
  </p>

  <div class="stats">
    <h2>Pool Status</h2>
    <div class="stat-item">📊 Available Keys: <strong>${cacheStatus.keyCount}</strong></div>
    <div class="stat-item">💾 Cache: <strong>${cacheStatusText}</strong></div>
  </div>

  <h3>Links</h3>
  <ul>
    <li><a href="https://github.com/portablestew/key-commune">GitHub Repository</a> - <a href="https://github.com/portablestew/key-commune?tab=readme-ov-file#free-sample">sample</a></li>
    <li><a href="/health">Health Status (JSON)</a></li>
  </ul>
</body>
</html>`;

    reply.type('text/html');
    return html;
  });

  // Health check route
  server.get('/health', async (request, reply) => {
    const cacheStatus = loadBalancerCache.getCacheStatus();
    
    let status: string;
    if (cacheStatus.keyCount === 0) {
      status = 'degraded';
    } else if (!cacheStatus.cached) {
      status = 'initializing';
    } else {
      status = 'healthy';
    }

    const healthData = {
      status,
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor((Date.now() - serverStartTime) / 1000),
      pool: {
        available_keys: cacheStatus.keyCount,
        cache_status: cacheStatus.cached ? 'cached' : 'not_cached',
        cache_age_ms: cacheStatus.ageMs
      }
    };

    reply.type('application/json');
    return healthData;
  });

  // Main proxy route - handle all requests
  server.all('/*', async (request, reply) => {
    try {
      // Extract auth info
      const authInfo = extractAuthKey(request);
      if (!authInfo) {
        return sendError(reply, 401, 'Unauthorized', 'Missing API key in Authorization header');
      }

      // Check presented key rate limit
      const rateLimitCheck = keyManager.checkPresentedKeyRateLimit(authInfo.presentedKeyHash);
      if (!rateLimitCheck.allowed) {
        return sendError(reply, 429, 'Too Many Requests', rateLimitCheck.reason || 'Rate limit exceeded');
      }

      // Validate key length
      const keyLengthValidation = keyValidator.validateKeyLength(authInfo.presentedKey);
      if (!keyLengthValidation.valid) {
        return sendError(reply, 400, 'Bad Request', keyLengthValidation.reason || 'Invalid key length');
      }

      // Extract client IP and subnet
      const clientIP = extractClientIP(request);
      const clientSubnet = keyManager.getSubnet(clientIP);

      // Get configured provider
      const provider = config.providers.find(p => p.name === config.server.provider);
      if (!provider) {
        return sendError(reply, 404, 'Not Found', 'No provider configured');
      }
      
      // If proxy host header is present, validate it matches the configured provider
      const proxyHost = request.headers['x-forwarded-host'];
      if (proxyHost && typeof proxyHost === 'string') {
        const matchedProvider = proxyService.matchProviderByHost(config.providers, proxyHost);
        
        // If host matches a provider, it must be the configured one
        if (!matchedProvider || matchedProvider.name !== provider.name) {
          return sendError(reply, 400, 'Bad Request', `Proxy host header '${proxyHost}' does not match configured provider '${provider.name}'`);
        }
      }

      // Validate request against provider rules
      const validationResult = keyValidator.validateRequest(
        provider,
        request.body,
        request.url,
        request.query as Record<string, string>
      );
      
      if (!validationResult.valid) {
        return sendError(reply, 400, 'Bad Request', validationResult.reason || 'Validation failed');
      }

      // Check if presented key exists in database
      let existingKey = keysRepo.findByHash(authInfo.presentedKeyHash);
      let selectedKey: ApiKey;

      if (!existingKey) {
        // New key - use presented key directly (no load balancing)
        request.log.info({ keyHash: authInfo.presentedKeyHash }, 'New key detected - using presented key');
        selectedKey = {
          id: -1,
          key: authInfo.presentedKey,
          key_hash: authInfo.presentedKeyHash,
          key_display: generateDisplayKey(authInfo.presentedKey),
          blocked_until: null,
          consecutive_auth_failures: 0,
          consecutive_throttles: 0,
          last_success_at: null,
          created_at: Math.floor(Date.now() / 1000),
          updated_at: Math.floor(Date.now() / 1000),
        };
      } else if (existingKey.blocked_until && existingKey.blocked_until > Math.floor(Date.now() / 1000)) {
        // Key is blocked - use presented key (isolation)
        request.log.info({ keyHash: authInfo.presentedKeyHash }, 'Blocked key - using presented key');
        selectedKey = existingKey;
      } else {
        // Available key - use load balancing with cached data
        const cacheEntry = await loadBalancerCache.getCachedLoadBalancerData();
        
        if (cacheEntry.availableKeys.length === 0) {
          return sendError(reply, 503, 'Service Unavailable', 'No available API keys in the pool');
        }

        // Select best key
        selectedKey = loadBalancer.selectKey(cacheEntry.availableKeys, cacheEntry.statsMap, authInfo.presentedKeyHash);
        request.log.info({ selectedKeyId: selectedKey.id }, 'Load balanced key selected');
      }

      // Update load balancing stats
      if (selectedKey.id !== -1) {
        statsRepo.incrementCallCount(selectedKey.id, clientSubnet);
      }

      // Forward request to provider
      const proxyRequest = {
        method: request.method,
        path: request.url,
        headers: request.headers as Record<string, string>,
        body: request.body,
        query: request.query as Record<string, string>,
      };

      const proxyResponse = await proxyService.forwardRequest(
        provider,
        selectedKey,
        proxyRequest
      );

      // Handle response for key lifecycle management
      const handlerResult = keyManager.handleResponse(selectedKey, proxyResponse.statusCode);
      request.log.info({
        keyId: selectedKey.id,
        statusCode: proxyResponse.statusCode,
        action: handlerResult.action,
        message: handlerResult.message,
      }, 'Key lifecycle updated');

      // Send response back to client
      reply.status(proxyResponse.statusCode);
      Object.entries(proxyResponse.headers).forEach(([key, value]) => {
        reply.header(key, value);
      });
      return reply.send(proxyResponse.body);

    } catch (error: any) {
      request.log.error({ err: error }, 'Proxy error');
      return sendError(reply, 500, 'Internal Server Error', error.message);
    }
  });

  return {
    server,
    statsCleanupService
  };
}