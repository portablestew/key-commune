import { describe, it, expect } from 'vitest';
import {
  AUTH_HEADERS,
  HOP_BY_HOP_HEADERS,
  UPSTREAM_STRIP_HEADERS,
  DOWNSTREAM_STRIP_HEADERS,
  createUpstreamHeaders,
  filterDownstreamHeaders,
} from '../../src/services/header-utils.js';

describe('header-utils constants', () => {
  it('includes expected auth headers', () => {
    const values = Array.from(AUTH_HEADERS.values());
    const lower = values.map((h) => h.toLowerCase());
    expect(lower).toContain('authorization');
    expect(lower).toContain('x-api-key');
    expect(lower).toContain('api-key');
    expect(lower).toContain('apikey');
    expect(lower).toContain('proxy-authorization');
  });

  it('includes standard hop-by-hop headers', () => {
    const values = Array.from(HOP_BY_HOP_HEADERS.values());
    const lower = values.map((h) => h.toLowerCase());
    expect(lower).toContain('connection');
    expect(lower).toContain('keep-alive');
    expect(lower).toContain('proxy-authenticate');
    expect(lower).toContain('te');
    expect(lower).toContain('trailer');
    expect(lower).toContain('transfer-encoding');
    expect(lower).toContain('upgrade');
  });

  it('builds UPSTREAM_STRIP_HEADERS as expected', () => {
    const values = Array.from(UPSTREAM_STRIP_HEADERS.values());
    const lower = values.map((h) => h.toLowerCase());
    // includes hop-by-hop
    expect(lower).toContain('connection');
    expect(lower).toContain('keep-alive');
    // plus host and content-encoding
    expect(lower).toContain('host');
    expect(lower).toContain('content-encoding');
  });

  it('builds DOWNSTREAM_STRIP_HEADERS as expected', () => {
    const values = Array.from(DOWNSTREAM_STRIP_HEADERS.values());
    const lower = values.map((h) => h.toLowerCase());
    // includes hop-by-hop
    expect(lower).toContain('connection');
    expect(lower).toContain('keep-alive');
    // plus content-encoding
    expect(lower).toContain('content-encoding');
  });
});

describe('createUpstreamHeaders', () => {
  it('normalizes string arrays to comma-separated strings', () => {
    const headers = createUpstreamHeaders({
      'X-Custom': ['a', 'b', 'c'],
    });

    expect(headers['X-Custom']).toBe('a, b, c');
  });

  it('strips hop-by-hop headers case-insensitively', () => {
    const headers = createUpstreamHeaders({
      Connection: 'keep-alive',
      'Keep-Alive': 'timeout=5',
      'Transfer-Encoding': 'chunked',
      'X-Other': 'ok',
    });

    const keys = Object.keys(headers).map((k) => k.toLowerCase());
    expect(keys).not.toContain('connection');
    expect(keys).not.toContain('keep-alive');
    expect(keys).not.toContain('transfer-encoding');
    expect(headers['X-Other']).toBe('ok');
  });

  it('strips host header', () => {
    const headers = createUpstreamHeaders({
      Host: 'example.com',
      'X-Test': '1',
    });

    const keys = Object.keys(headers).map((k) => k.toLowerCase());
    expect(keys).not.toContain('host');
    expect(headers['X-Test']).toBe('1');
  });

  it('strips all known auth headers case-insensitively when authOverride is provided', () => {
    const headers = createUpstreamHeaders(
      {
        Authorization: 'Bearer secret',
        'x-api-key': 'abc',
        'API-KEY': 'xyz',
        apikey: 'zzz',
        'Proxy-Authorization': 'Basic aaa',
        'X-Other': 'ok',
      },
      {
        headerName: 'X-New-Auth',
        headerValue: 'Bearer new-secret',
      }
    );

    const keys = Object.keys(headers).map((k) => k.toLowerCase());
    expect(keys).not.toContain('authorization');
    expect(keys).not.toContain('x-api-key');
    expect(keys).not.toContain('api-key');
    expect(keys).not.toContain('apikey');
    expect(keys).not.toContain('proxy-authorization');
    expect(keys).toContain('x-new-auth');
    expect(headers['X-Other']).toBe('ok');
    expect(headers['X-New-Auth']).toBe('Bearer new-secret');
  });

  it('preserves auth headers when no authOverride is provided', () => {
    const headers = createUpstreamHeaders({
      Authorization: 'Bearer secret',
      'x-api-key': 'abc',
      'X-Other': 'ok',
    });

    const keys = Object.keys(headers).map((k) => k.toLowerCase());
    expect(keys).toContain('authorization');
    expect(keys).toContain('x-api-key');
    expect(keys).toContain('x-other');
    expect(headers['Authorization']).toBe('Bearer secret');
    expect(headers['x-api-key']).toBe('abc');
    expect(headers['X-Other']).toBe('ok');
  });

  it('applies authOverride header when specified', () => {
    const headers = createUpstreamHeaders(
      {
        'X-Existing': '1',
        Authorization: 'Bearer should-be-stripped',
      },
      {
        headerName: 'X-Auth',
        headerValue: 'Bearer new',
      }
    );

    expect(headers['X-Existing']).toBe('1');
    const keys = Object.keys(headers);
    expect(keys).toContain('X-Auth');
    expect(headers['X-Auth']).toBe('Bearer new');
    expect(
      Object.keys(headers).map((k) => k.toLowerCase())
    ).not.toContain('authorization');
  });

  it('preserves original casing for non-stripped headers', () => {
    const headers = createUpstreamHeaders({
      'Content-Type': 'application/json',
      'User-Agent': 'test-agent',
    });

    expect(Object.prototype.hasOwnProperty.call(headers, 'Content-Type')).toBe(
      true
    );
    expect(Object.prototype.hasOwnProperty.call(headers, 'User-Agent')).toBe(
      true
    );
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['User-Agent']).toBe('test-agent');
  });

  it('handles undefined values gracefully', () => {
    const headers = createUpstreamHeaders({
      'X-Null': undefined,
      'X-Defined': 'value',
    });

    expect(headers['X-Defined']).toBe('value');
    expect(headers['X-Null']).toBeUndefined();
    expect(Object.keys(headers)).toEqual(['X-Defined']);
  });

  it('handles mixed-case header names for stripping correctly when authOverride provided', () => {
    const headers = createUpstreamHeaders(
      {
        cOnNeCtIoN: 'keep-alive',
        'X-API-Key': 'secret',
        'X-Keep': 'ok',
      },
      {
        headerName: 'Authorization',
        headerValue: 'Bearer new',
      }
    );

    const keys = Object.keys(headers).map((k) => k.toLowerCase());
    expect(keys).not.toContain('connection');
    expect(keys).not.toContain('x-api-key');
    expect(keys).toContain('authorization');
    expect(headers['X-Keep']).toBe('ok');
    expect(headers['Authorization']).toBe('Bearer new');
  });
});

describe('filterDownstreamHeaders', () => {
  it('strips hop-by-hop headers case-insensitively', () => {
    const source = new Headers();
    source.set('Connection', 'keep-alive');
    source.set('Keep-Alive', 'timeout=5');
    source.set('Transfer-Encoding', 'chunked');
    source.set('X-Ok', '1');

    const filtered = filterDownstreamHeaders(source);
    const keys = Object.keys(filtered).map((k) => k.toLowerCase());

    expect(keys).not.toContain('connection');
    expect(keys).not.toContain('keep-alive');
    expect(keys).not.toContain('transfer-encoding');

    // check via lower-cased lookup since filterDownstreamHeaders stores keys as provided by Headers iteration (lowercase in undici/node-fetch/node)
    expect(filtered['x-ok'] ?? filtered['X-Ok']).toBe('1');
  });

  it('strips content-encoding header', () => {
    const source = new Headers();
    source.set('Content-Encoding', 'gzip');
    source.set('Content-Type', 'application/json');

    const filtered = filterDownstreamHeaders(source);
    const keys = Object.keys(filtered).map((k) => k.toLowerCase());

    expect(keys).not.toContain('content-encoding');
    expect(filtered['content-type'] ?? filtered['Content-Type']).toBe('application/json');
  });

  it('preserves cache and etag headers', () => {
    const source = new Headers();
    source.set('Content-Type', 'application/json');
    source.set('Cache-Control', 'max-age=60');
    source.set('ETag', 'W/"123"');

    const filtered = filterDownstreamHeaders(source);

    expect(filtered['content-type'] ?? filtered['Content-Type']).toBe('application/json');
    expect(filtered['cache-control'] ?? filtered['Cache-Control']).toBe('max-age=60');
    expect(filtered['etag'] ?? filtered['ETag']).toBe('W/"123"');
  });

  it('preserves CORS headers', () => {
    const source = new Headers();
    source.set('Access-Control-Allow-Origin', '*');
    source.set('Access-Control-Allow-Headers', '*');
    source.set('Access-Control-Allow-Methods', 'GET,POST');

    const filtered = filterDownstreamHeaders(source);

    expect(filtered['access-control-allow-origin'] ?? filtered['Access-Control-Allow-Origin']).toBe('*');
    expect(filtered['access-control-allow-headers'] ?? filtered['Access-Control-Allow-Headers']).toBe('*');
    expect(filtered['access-control-allow-methods'] ?? filtered['Access-Control-Allow-Methods']).toBe('GET,POST');
  });

  it('handles mixed-case header names correctly', () => {
    const source = new Headers();
    source.set('CoNtEnT-EnCoDiNg', 'gzip');
    source.set('X-Test', 'ok');

    const filtered = filterDownstreamHeaders(source);
    const keys = Object.keys(filtered).map((k) => k.toLowerCase());

    expect(keys).not.toContain('content-encoding');
    expect(filtered['x-test'] ?? filtered['X-Test']).toBe('ok');
  });
});