import { ProviderConfig } from '../types/config.js';
import { ApiKey } from '../types/database.js';
import { createUpstreamHeaders, filterDownstreamHeaders } from './header-utils.js';

export interface ProxyRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: any;
  query: Record<string, string>;
}

export interface ProxyResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: any;
}

export class ProxyService {
  /**
   * Forward request to provider with selected API key
   */
  async forwardRequest(
    provider: ProviderConfig,
    selectedKey: ApiKey,
    request: ProxyRequest
  ): Promise<ProxyResponse> {
    // Use the raw API key directly (already decrypted in repository)
    const apiKey = selectedKey.key;
    
    // Build full URL
    const url = new URL(request.path, provider.base_url).toString();
     
    // Prepare sanitized upstream headers with provider auth applied
    const headers = createUpstreamHeaders(request.headers, {
      headerName: provider.auth_header,
      headerValue: `Bearer ${apiKey}`,
    });
    
    // Make request to provider with timeout
    const timeoutMs = provider.timeout_ms || 60000;
    
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const response = await fetch(url, {
        method: request.method,
        headers,
        body: request.body ? JSON.stringify(request.body) : undefined,
        signal: controller.signal,
      });
      
      // Clear timeout since request completed
      clearTimeout(timeoutId);
      
      // Read response body
      const responseBody = await response.text();
      let parsedBody: any;
      
      try {
        parsedBody = JSON.parse(responseBody);
      } catch {
        parsedBody = responseBody;
      }
      
      // Extract response headers using shared helper
      const responseHeaders = filterDownstreamHeaders(response.headers);
      
      return {
        statusCode: response.status,
        headers: responseHeaders,
        body: parsedBody,
      };
    } catch (error: any) {
      // Clear timeout on error
      clearTimeout(timeoutId);
      
      // Handle timeout errors specifically
      if (error.name === 'AbortError') {
        throw new Error(`Proxy request timed out after ${timeoutMs}ms`);
      }
      
      throw new Error(`Proxy request failed: ${error.message}`);
    }
  }

  /**
   * Match provider by host header
   * Matches if the host header matches the provider's base_url hostname
   */
  matchProviderByHost(providers: ProviderConfig[], host: string): ProviderConfig | null {
    // Clean up host (remove port if present)
    const cleanHost = host.split(':')[0].toLowerCase();
    
    for (const provider of providers) {
      try {
        const providerUrl = new URL(provider.base_url);
        const providerHost = providerUrl.hostname.toLowerCase();
        
        // Check if hosts match
        if (cleanHost === providerHost || cleanHost.endsWith(`.${providerHost}`)) {
          return provider;
        }
      } catch {
        // Invalid URL, skip
        continue;
      }
    }
    return null;
  }

}