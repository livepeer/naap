/**
 * useApiClient Hook
 * 
 * Provides a ready-to-use API client with automatic:
 * - Backend URL resolution
 * - Authentication token injection
 * - CSRF token handling
 * - Request correlation IDs
 * - Error handling
 * 
 * This eliminates the need for plugins to manually handle auth headers and URL configuration.
 */

import { useMemo } from 'react';
import { useShell } from './useShell.js';
import { createApiClient, type ApiClient } from '../utils/api.js';
import { getServiceOrigin, getPluginBackendUrl } from '../config/ports.js';
import { getCsrfToken, generateCorrelationId } from '../utils/headers.js';
import { HEADER_CSRF_TOKEN, HEADER_CORRELATION, HEADER_PLUGIN_NAME } from '@naap/types';

/**
 * Options for useApiClient hook
 */
export interface UseApiClientOptions {
  /**
   * Plugin name to resolve backend URL for.
   * If not provided, uses the shell's API client.
   */
  pluginName?: string;

  /**
   * Base URL override. If provided, skips automatic URL resolution.
   */
  baseUrl?: string;

  /**
   * API path suffix (e.g., '/api/v1/custom-path')
   * Only used when pluginName is provided.
   */
  apiPath?: string;

  /**
   * Request timeout in milliseconds (default: 30000)
   */
  timeout?: number;

  /**
   * Whether to include CSRF token in requests (default: true)
   */
  includeCsrf?: boolean;

  /**
   * Whether to include correlation ID in requests (default: true)
   */
  includeCorrelationId?: boolean;
}

/**
 * Enhanced API client with automatic header injection
 */
export interface EnhancedApiClient extends ApiClient {
  /** Get the base URL being used */
  getBaseUrl(): string;
  
  /** Get the current auth token */
  getAuthToken(): Promise<string | null>;
}

/**
 * Hook to get a configured API client for plugin backend communication.
 * 
 * Automatically handles:
 * - Backend URL resolution (development vs production)
 * - Authentication token injection
 * - CSRF token injection
 * - Request correlation IDs for tracing
 * 
 * @param options - Configuration options
 * @returns An API client ready to use
 * 
 * @example
 * ```typescript
 * // Basic usage - auto-resolves URL for current plugin
 * function MyComponent() {
 *   const api = useApiClient({ pluginName: 'my-wallet' });
 *   
 *   const fetchBalance = async () => {
 *     const response = await api.get<{balance: number}>('/balance');
 *     console.log(response.data.balance);
 *   };
 * }
 * ```
 * 
 * @example
 * ```typescript
 * // With custom base URL
 * function MyComponent() {
 *   const api = useApiClient({
 *     baseUrl: 'https://api.example.com',
 *     pluginName: 'my-plugin'
 *   });
 *   
 *   const response = await api.post('/data', { value: 123 });
 * }
 * ```
 * 
 * @example
 * ```typescript
 * // Using shell's API client (for base service)
 * function MyComponent() {
 *   const api = useApiClient(); // No plugin name = shell API
 *   
 *   const plugins = await api.get('/api/v1/base/plugins');
 * }
 * ```
 */
export function useApiClient(options: UseApiClientOptions = {}): EnhancedApiClient {
  const shell = useShell();
  const {
    pluginName,
    baseUrl: customBaseUrl,
    apiPath,
    timeout,
    includeCsrf = true,
    includeCorrelationId = true,
  } = options;

  // Memoize the API client to avoid recreating on every render
  const client = useMemo(() => {
    // Determine the base URL
    let baseUrl: string;
    
    if (customBaseUrl) {
      // Use custom URL if provided
      baseUrl = customBaseUrl;
    } else if (pluginName) {
      // Auto-resolve plugin backend URL using canonical functions:
      // - With apiPath: use getPluginBackendUrl (returns prefix like /api/v1/wallet)
      // - Without apiPath: use getServiceOrigin (returns origin only, e.g. '' or http://localhost:4008)
      if (apiPath) {
        baseUrl = getPluginBackendUrl(pluginName, { apiPath });
      } else {
        baseUrl = getServiceOrigin(pluginName);
      }
    } else {
      // Use shell's base service origin
      baseUrl = getServiceOrigin('base');
    }

    // Create the base client
    const getToken = async (): Promise<string> => {
      try {
        return await shell.auth.getToken();
      } catch (error) {
        console.warn('Failed to get auth token:', error);
        return '';
      }
    };

    // Create wrapper with enhanced headers
    const baseClient = createApiClient({
      baseUrl,
      pluginName,
      timeout,
    });

    // Enhanced client with automatic header injection
    const enhancedClient: EnhancedApiClient = {
      async get<T>(path: string, headers?: Record<string, string>) {
        const enhancedHeaders = await getEnhancedHeaders(headers);
        return baseClient.get<T>(path, enhancedHeaders);
      },

      async post<T>(path: string, body?: unknown, headers?: Record<string, string>) {
        const enhancedHeaders = await getEnhancedHeaders(headers);
        return baseClient.post<T>(path, body, enhancedHeaders);
      },

      async put<T>(path: string, body?: unknown, headers?: Record<string, string>) {
        const enhancedHeaders = await getEnhancedHeaders(headers);
        return baseClient.put<T>(path, body, enhancedHeaders);
      },

      async patch<T>(path: string, body?: unknown, headers?: Record<string, string>) {
        const enhancedHeaders = await getEnhancedHeaders(headers);
        return baseClient.patch<T>(path, body, enhancedHeaders);
      },

      async delete<T>(path: string, headers?: Record<string, string>) {
        const enhancedHeaders = await getEnhancedHeaders(headers);
        return baseClient.delete<T>(path, enhancedHeaders);
      },

      getBaseUrl() {
        return baseUrl;
      },

      async getAuthToken() {
        return getToken();
      },
    };

    // Helper to enhance headers with auth, CSRF, and correlation ID
    async function getEnhancedHeaders(
      customHeaders?: Record<string, string>
    ): Promise<Record<string, string>> {
      const headers: Record<string, string> = { ...customHeaders };

      // Add auth token
      const token = await getToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // Add CSRF token
      if (includeCsrf) {
        const csrfToken = getCsrfToken();
        if (csrfToken) {
          headers[HEADER_CSRF_TOKEN] = csrfToken;
        }
      }

      // Add correlation ID for request tracing
      if (includeCorrelationId) {
        headers[HEADER_CORRELATION] = generateCorrelationId();
      }

      // Add plugin name if provided
      if (pluginName) {
        headers[HEADER_PLUGIN_NAME] = pluginName;
      }

      return headers;
    }

    return enhancedClient;
  }, [shell, pluginName, customBaseUrl, apiPath, timeout, includeCsrf, includeCorrelationId]);

  return client;
}

/**
 * Hook to get auth headers for manual fetch calls (non-React contexts).
 * 
 * Use this when you need to make fetch calls outside of React components,
 * or when you need the headers separately.
 * 
 * @returns Object with headers including Authorization, CSRF, and Correlation ID
 * 
 * @example
 * ```typescript
 * function MyService() {
 *   const getHeaders = useAuthHeaders();
 *   
 *   async function fetchData() {
 *     const headers = await getHeaders();
 *     const response = await fetch('/api/data', { headers });
 *   }
 * }
 * ```
 */
export function useAuthHeaders(): () => Promise<Record<string, string>> {
  const shell = useShell();

  return async () => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add auth token
    try {
      const token = await shell.auth.getToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    } catch (error) {
      console.warn('Failed to get auth token:', error);
    }

    // Add CSRF token
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers[HEADER_CSRF_TOKEN] = csrfToken;
    }

    // Add correlation ID
    headers[HEADER_CORRELATION] = generateCorrelationId();

    return headers;
  };
}
