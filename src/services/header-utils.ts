import { IncomingHttpHeaders } from 'http';

export const AUTH_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'api-key',
  'apikey',
  'proxy-authorization',
]);

export const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

// Headers to strip when sending to upstream provider:
// - hop-by-hop headers (per HTTP/1.1 spec)
// - host (upstream host determined by URL)
// - content-encoding (we operate on decoded bodies)
export const UPSTREAM_STRIP_HEADERS = new Set<string>([
  ...HOP_BY_HOP_HEADERS,
  'host',
  'content-encoding',
]);

// Headers to strip when sending back downstream:
// - hop-by-hop headers
// - content-encoding (body is already decompressed / normalized)
export const DOWNSTREAM_STRIP_HEADERS = new Set<string>([
  ...HOP_BY_HOP_HEADERS,
  'content-encoding',
]);

export interface AuthOverride {
  headerName: string;
  headerValue: string;
}

/**
 * Normalize a header value from raw request headers to a string.
 * - string[] becomes comma+space separated string
 * - undefined is treated as undefined and omitted by caller
 */
function normalizeHeaderValue(
  value: string | string[] | undefined
): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join(', ');
  return undefined;
}

/**
 * Create a sanitized set of headers for upstream requests.
 *
 * Behavior:
 * - Starts from raw headers object (Fastify / Node style)
 * - Normalizes all values to strings
 * - Strips:
 *   - UPSTREAM_STRIP_HEADERS (case-insensitive)
 *   - All known AUTH_HEADERS (case-insensitive)
 * - Applies optional authOverride at the end
 * - Preserves original casing of non-stripped headers from input
 */
export function createUpstreamHeaders(
  rawHeaders: Record<string, string | string[] | undefined>,
  authOverride?: AuthOverride
): Record<string, string> {
  const result: Record<string, string> = {};
  const stripAuth = Boolean(authOverride);

  for (const [name, rawValue] of Object.entries(rawHeaders)) {
    const lower = name.toLowerCase();

    // Skip if in upstream strip list
    if (UPSTREAM_STRIP_HEADERS.has(lower)) continue;

    // Skip any known auth header only when overriding auth
    if (stripAuth && AUTH_HEADERS.has(lower)) continue;

    const normalized = normalizeHeaderValue(rawValue);
    if (normalized === undefined) continue;

    result[name] = normalized;
  }

  if (authOverride && authOverride.headerName && authOverride.headerValue !== undefined) {
    result[authOverride.headerName] = authOverride.headerValue;
  }

  return result;
}

/**
 * Filter headers from an upstream provider response to send to downstream client.
 *
 * Behavior:
 * - Starts from Fetch API Headers object
 * - Strips:
 *   - DOWNSTREAM_STRIP_HEADERS (case-insensitive)
 * - Preserves:
 *   - All other headers, including CORS and caching headers
 * - Preserves original header casing based on Headers iteration
 */
export function filterDownstreamHeaders(
  responseHeaders: Headers
): Record<string, string> {
  const result: Record<string, string> = {};

  responseHeaders.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (DOWNSTREAM_STRIP_HEADERS.has(lower)) {
      return;
    }
    result[name] = value;
  });

  return result;
}