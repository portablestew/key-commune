import { FastifyRequest, FastifyReply } from 'fastify';
import { hashKey } from '../services/encryption.js';

export interface AuthInfo {
  presentedKeyHash: string;
  presentedKey: string;
  authHeader: string;
}

/**
 * Extract API key from Authorization header
 * Supports: "Bearer <key>", "sk-<key>", or raw key
 */
export function extractAuthKey(request: FastifyRequest): AuthInfo | null {
  const authHeader = request.headers.authorization;
  
  if (!authHeader) {
    return null;
  }

  let key = authHeader;

  // Handle "Bearer <key>" format
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    key = authHeader.substring(7).trim();
  }

  if (!key) {
    return null;
  }

  return {
    presentedKeyHash: hashKey(key),
    presentedKey: key,
    authHeader: authHeader,
  };
}

/**
 * Extract client IP address from request
 */
export function extractClientIP(request: FastifyRequest): string {
  // Check X-Forwarded-For header (proxy/load balancer)
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return ips.split(',')[0].trim();
  }

  // Check X-Real-IP header
  const realIP = request.headers['x-real-ip'];
  if (realIP) {
    return Array.isArray(realIP) ? realIP[0] : realIP;
  }

  // Fallback to socket remote address
  return request.ip || '127.0.0.1';
}