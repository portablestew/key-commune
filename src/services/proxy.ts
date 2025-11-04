import { ProviderConfig } from '../types/config.js';
import { ApiKey } from '../types/database.js';

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
    const url = `${provider.base_url}${request.path}`;
    
    // Prepare headers
    const headers: Record<string, string> = { ...request.headers };
    
    // Remove hop-by-hop headers
    delete headers['host'];
    delete headers['connection'];
    delete headers['keep-alive'];
    delete headers['transfer-encoding'];
    delete headers['authorization'];
    
    // Set the API key in the provider's auth header
    headers[provider.auth_header] = `Bearer ${apiKey}`;
    
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
      
      // Extract response headers
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value: string, key: string) => {
        // Skip hop-by-hop headers
        if (!['connection', 'keep-alive', 'transfer-encoding'].includes(key.toLowerCase())) {
          responseHeaders[key] = value;
        }
      });
      
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

  /**
   * Match request URL to provider
   */
  matchProvider(providers: ProviderConfig[], path: string): ProviderConfig | null {
    for (const provider of providers) {
      for (const pattern of provider.url_patterns) {
        if (this.matchPattern(pattern, path)) {
          return provider;
        }
      }
    }
    return null;
  }

  /**
   * Match URL pattern using regex
   */
  private matchPattern(pattern: string, path: string): boolean {
    try {
      const regex = new RegExp(pattern);
      return regex.test(path);
    } catch (error) {
      // Invalid regex pattern, return false
      return false;
    }
  }
}