import * as fs from 'fs';
import * as path from 'path';
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
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
import { CacheableResponseCache } from './services/cacheable-response.js';

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
    http2: false, // Explicitly disable HTTP/2 to use standard IncomingMessage type
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

  // Add path normalization hook to handle double slashes
  server.addHook('preHandler', (request, reply, done) => {
    // Normalize double slashes in path (e.g., //models -> /models)
    if (request.raw.url && request.raw.url.startsWith('//')) {
      // Replace all leading slashes with single slash
      request.raw.url = request.raw.url.replace(/^\/+/, '/');
    }
    done();
  });

  // Set error handler
  server.setErrorHandler(errorHandler);

  // Initialize database
  const db = getDatabase(config.database.path);
  runMigrations(db);

  // Initialize repositories
  const keysRepo = new KeysRepository(db, config.encryption_key!);
  const statsRepo = new StatsRepository(db);

  // Initialize repository caches
  keysRepo.startCacheRefresh(config.stats.cache_expiry_seconds);
  statsRepo.startCacheRefresh(config.stats.cache_expiry_seconds);

  // Initialize services
  const loadBalancer = new LoadBalancer();
  const keyManager = new KeyManager(keysRepo, statsRepo, config.blocking, config.database.max_keys);
  const keyValidator = new KeyValidator();
  const proxyService = new ProxyService();
  const cacheableResponseCache = new CacheableResponseCache(100);

  // Initialize and start stats cleanup service
  const statsCleanupService = new StatsCleanupService(statsRepo, config);
  statsCleanupService.start();

  // Index page route
  server.get('/', async (request, reply) => {
    const keysCacheStatus = keysRepo.getCacheStatus();
    const keysCacheStatusText = keysCacheStatus.cached
      ? `Fresh (${(keysCacheStatus.ageMs / 1000).toFixed(1)}s old)`
      : 'Not initialized';

    const provider = config.providers.find(p => p.name === config.server.provider);

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
    <div class="stat-item">🌐 Provider: <a href="${provider?.base_url}" target="_blank"><strong>${config.server.provider}</strong></a></div>
    <div class="stat-item">📊 Available Keys: <strong>${keysCacheStatus.keyCount}</strong></div>
    <div class="stat-item">💾 Cache: <strong>${keysCacheStatusText}</strong></div>
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
    // Get cached data from repositories
    const availableKeys = keysRepo.getCachedAvailableKeys();
    const statsMap = statsRepo.getCachedTodayStats();
    const keysCacheStatus = keysRepo.getCacheStatus();
    const statsCacheStatus = statsRepo.getCacheStatus();
    
    let status: string;
    if (!keysCacheStatus.cached) {
      status = 'initializing';
    } else if (keysCacheStatus.keyCount === 0) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }
    
    // Calculate aggregates from cached data
    const totalKeys = availableKeys.length;
    const blockedKeys = availableKeys.filter(key =>
      key.blocked_until && key.blocked_until > Math.floor(Date.now() / 1000)
    ).length;
    
    const totalCalls = Array.from(statsMap.values()).reduce(
      (sum, stat) => sum + stat.call_count, 0
    );
    const totalThrottles = Array.from(statsMap.values()).reduce(
      (sum, stat) => sum + stat.throttle_count, 0
    );

    const healthData = {
      status,
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor((Date.now() - serverStartTime) / 1000),
      pool: {
        available_keys: keysCacheStatus.keyCount,
        keys_cache_status: keysCacheStatus.cached ? 'cached' : 'not_cached',
        keys_cache_age_ms: keysCacheStatus.ageMs,
        stats_cache_status: statsCacheStatus.cached ? 'cached' : 'not_cached',
        stats_cache_age_ms: statsCacheStatus.ageMs,
        stats: {
          total_keys: totalKeys,
          blocked_keys: blockedKeys,
          total_calls_today: totalCalls,
          total_throttles_today: totalThrottles
        }
      }
    };

    reply.type('application/json');
    return healthData;
  });

  // Helper functions for request handling
  async function handleCacheableRequest(
    request: any,
    reply: any,
    provider: any,
    cacheablePath: any
  ): Promise<void> {
    request.log.info({ path: request.url }, 'Cacheable GET path detected');
    
    // Check cache first
    const cached = cacheableResponseCache.get(request);
    if (cached) {
      request.log.info({ path: request.url }, 'Cache hit');
      reply.status(cached.statusCode);
      Object.entries(cached.headers).forEach(([key, value]) => {
        reply.header(key, value);
      });
      return reply.send(cached.body);
    }
    
    // Cache miss - proxy request with whatever auth they provided
    request.log.info({ path: request.url }, 'Cache miss - proxying request');
    
    const url = new URL(request.url.replace(/^\//, './'), provider.base_url).toString();
    // Filter headers to only string values
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') {
        headers[key] = value;
      } else if (Array.isArray(value)) {
        headers[key] = value.join(', ');
      }
    }
    
    // Remove hop-by-hop headers and content-encoding (body is decompressed)
    delete headers['host'];
    delete headers['connection'];
    delete headers['keep-alive'];
    delete headers['transfer-encoding'];
    delete headers['content-encoding'];
    
    // Make request with timeout
    const timeoutMs = provider.timeout_ms || 60000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const response = await fetch(url, {
        method: request.method,
        headers,
        body: request.body ? JSON.stringify(request.body) : undefined,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      // Read response
      const responseBody = await response.text();
      let parsedBody: any;
      try {
        parsedBody = JSON.parse(responseBody);
      } catch {
        parsedBody = responseBody;
      }
      
      // Extract response headers
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value: string, key: string) => {
        if (!['connection', 'keep-alive', 'transfer-encoding', 'content-encoding'].includes(key.toLowerCase())) {
          responseHeaders[key] = value;
        }
      });
      
      const proxyResponse = {
        statusCode: response.status,
        headers: responseHeaders,
        body: parsedBody,
      };
      
      // Cache if successful
      if (proxyResponse.statusCode === 200) {
        cacheableResponseCache.set(request, proxyResponse.statusCode, proxyResponse.headers, proxyResponse.body, cacheablePath.ttl_seconds);
      }
      
      // Send response
      reply.status(proxyResponse.statusCode);
      Object.entries(proxyResponse.headers).forEach(([key, value]) => {
        reply.header(key, value);
      });
      return reply.send(proxyResponse.body);
      
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        return sendError(reply, 504, 'Gateway Timeout', `Request timed out after ${timeoutMs}ms`);
      }
      return sendError(reply, 502, 'Bad Gateway', error.message);
    }
  }

  async function handleAuthenticatedRequest(
    request: any,
    reply: any,
    provider: any
  ): Promise<void> {
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
      const availableKeys = keysRepo.getCachedAvailableKeys();
      const statsMap = statsRepo.getCachedTodayStats();
      
      if (availableKeys.length === 0) {
        return sendError(reply, 503, 'Service Unavailable', 'No available API keys in the pool');
      }

      // Select best key
      selectedKey = loadBalancer.selectKey(availableKeys, statsMap, authInfo.presentedKeyHash);
      request.log.info({ selectedKeyId: selectedKey.id }, 'Load balanced key selected');
    }

    // Update load balancing stats
    if (selectedKey.id !== -1) {
      statsRepo.incrementCallCount(selectedKey.id, clientSubnet);
    }

    // Forward request to provider
    const proxyRequest = {
      method: request.method,
      path: request.url.replace(/^\//, './'),
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
  }

  // Main proxy route - handle all requests
  server.all('/*', async (request, reply) => {
    try {
      // Get configured provider
      const provider = config.providers.find(p => p.name === config.server.provider);
      if (!provider) {
        return sendError(reply, 404, 'Not Found', 'No provider configured');
      }
      
      // CHECK: Is this a cacheable path AND a GET request?
      if (provider.cacheable_paths && request.method === 'GET') {
        const cacheablePath = provider.cacheable_paths.find((path: any) =>
          new RegExp(path.path).test(request.url.split('?')[0])
        );
        
        if (cacheablePath) {
          // CACHEABLE PATH FLOW - Simple proxy + cache (GET only)
          return handleCacheableRequest(request, reply, provider, cacheablePath);
        }
      }
      
      // REGULAR AUTHENTICATED FLOW
      return handleAuthenticatedRequest(request, reply, provider);
      
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