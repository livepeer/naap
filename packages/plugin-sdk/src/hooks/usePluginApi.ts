/**
 * usePluginApi Hook
 *
 * Simplified API client hook for plugin-to-backend communication.
 * Automatically handles URL resolution, authentication, and error handling.
 *
 * @example
 * ```tsx
 * function MyWalletComponent() {
 *   const api = usePluginApi('my-wallet');
 *
 *   const fetchBalance = async () => {
 *     const { data } = await api.get<{ balance: number }>('/api/v1/wallet/balance');
 *     console.log(data.balance);
 *   };
 * }
 * ```
 */

import { useMemo } from 'react';
import { useShell } from './useShell.js';
import {
  createApiClient,
  getPluginBackendUrl,
  type ApiResponse,
} from '../utils/api.js';
import { getCsrfToken, generateCorrelationId } from '../utils/backend-url.js';
import { HEADER_CSRF_TOKEN, HEADER_CORRELATION, HEADER_PLUGIN_NAME } from '@naap/types';

/**
 * Options for usePluginApi hook
 */
export interface UsePluginApiOptions {
  /**
   * API path suffix appended to base URL (e.g., '/api/v1/wallet')
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
 * Plugin API client with automatic authentication
 */
export interface PluginApiClient {
  /** Make a GET request */
  get<T>(path: string, headers?: Record<string, string>): Promise<ApiResponse<T>>;

  /** Make a POST request */
  post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResponse<T>>;

  /** Make a PUT request */
  put<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResponse<T>>;

  /** Make a PATCH request */
  patch<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResponse<T>>;

  /** Make a DELETE request */
  delete<T>(path: string, headers?: Record<string, string>): Promise<ApiResponse<T>>;

  /** Get the resolved base URL */
  getBaseUrl(): string;
}

/**
 * Hook for plugin-to-backend API communication.
 *
 * Automatically resolves the backend URL using:
 * 1. Shell context config (e.g., `myWalletApiUrl`)
 * 2. Environment variables (e.g., `VITE_MY_WALLET_API_URL`)
 * 3. Development defaults (e.g., `http://localhost:4008`)
 *
 * Also handles:
 * - Authentication token injection
 * - CSRF token injection
 * - Request correlation IDs
 *
 * @param pluginName - The plugin name (e.g., 'my-wallet', 'daydream-video')
 * @param options - Optional configuration
 * @returns A configured API client
 *
 * @example
 * ```tsx
 * // Basic usage
 * function DaydreamVideo() {
 *   const api = usePluginApi('daydream-video');
 *
 *   const createJob = async (prompt: string) => {
 *     const { data } = await api.post<Job>('/api/v1/daydream/jobs', { prompt });
 *     return data;
 *   };
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With options
 * function CommunityForum() {
 *   const api = usePluginApi('community', {
 *     apiPath: '/api/v1/community',
 *     timeout: 60000,
 *   });
 *
 *   const fetchPosts = async () => {
 *     const { data } = await api.get<Post[]>('/posts');
 *     return data;
 *   };
 * }
 * ```
 */
export function usePluginApi(
  pluginName: string,
  options: UsePluginApiOptions = {}
): PluginApiClient {
  const shell = useShell();
  const {
    apiPath,
    timeout,
    includeCsrf = true,
    includeCorrelationId = true,
  } = options;

  const client = useMemo(() => {
    // Resolve backend URL using the new unified function
    const baseUrl = getPluginBackendUrl(pluginName, { apiPath });

    // Create the underlying API client
    const baseClient = createApiClient({
      baseUrl,
      pluginName,
      timeout,
    });

    // Get auth token from shell
    const getToken = async (): Promise<string> => {
      try {
        return await shell.auth.getToken();
      } catch (error) {
        console.warn(`[${pluginName}] Failed to get auth token:`, error);
        return '';
      }
    };

    // Build enhanced headers
    const getEnhancedHeaders = async (
      customHeaders?: Record<string, string>
    ): Promise<Record<string, string>> => {
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

      // Add correlation ID
      if (includeCorrelationId) {
        headers[HEADER_CORRELATION] = generateCorrelationId();
      }

      // Add plugin name
      headers[HEADER_PLUGIN_NAME] = pluginName;

      return headers;
    };

    // Return enhanced client
    const pluginClient: PluginApiClient = {
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
    };

    return pluginClient;
  }, [shell, pluginName, apiPath, timeout, includeCsrf, includeCorrelationId]);

  return client;
}
