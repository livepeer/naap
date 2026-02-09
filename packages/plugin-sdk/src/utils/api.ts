/**
 * API Client Factory
 * Creates typed API clients for plugins to communicate with shell and integrations
 */

import { HEADER_PLUGIN_NAME } from '@naap/types';

export interface ApiClientOptions {
  baseUrl: string;
  authToken?: string;
  pluginName?: string;
  timeout?: number;
}

export interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  headers: Headers;
}

export interface ApiError {
  message: string;
  status: number;
  code?: string;
  details?: unknown;
}

/**
 * API client interface returned by createApiClient
 */
export interface ApiClient {
  get<T>(path: string, headers?: Record<string, string>): Promise<ApiResponse<T>>;
  post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResponse<T>>;
  put<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResponse<T>>;
  patch<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResponse<T>>;
  delete<T>(path: string, headers?: Record<string, string>): Promise<ApiResponse<T>>;
}

/**
 * Integration client interface returned by createIntegrationClient
 */
export interface IntegrationClient {
  call<T>(integrationType: string, method: string, args: unknown[]): Promise<T>;
}

/**
 * Create an API client for plugin backend.
 * 
 * Provides a typed HTTP client for making authenticated API requests.
 * 
 * @param options - Configuration options for the API client
 * @returns An API client with get, post, put, patch, and delete methods
 * 
 * @example
 * ```typescript
 * const api = createApiClient({
 *   baseUrl: 'http://localhost:4001',
 *   authToken: 'my-token',
 *   pluginName: 'my-plugin',
 * });
 * 
 * const response = await api.get<User[]>('/users');
 * console.log(response.data);
 * ```
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const { baseUrl, authToken, pluginName, timeout = 30000 } = options;

  const defaultHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authToken) {
    defaultHeaders['Authorization'] = `Bearer ${authToken}`;
  }

  if (pluginName) {
    defaultHeaders[HEADER_PLUGIN_NAME] = pluginName;
  }

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    customHeaders?: Record<string, string>
  ): Promise<ApiResponse<T>> {
    const url = `${baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: { ...defaultHeaders, ...customHeaders },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error: ApiError = {
          message: errorData.message || errorData.error || `HTTP ${response.status}`,
          status: response.status,
          code: errorData.code,
          details: errorData,
        };
        throw error;
      }

      const data = await response.json();
      return {
        data: data as T,
        status: response.status,
        headers: response.headers,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      
      if (err instanceof Error && err.name === 'AbortError') {
        throw {
          message: 'Request timeout',
          status: 408,
          code: 'TIMEOUT',
        } as ApiError;
      }
      
      throw err;
    }
  }

  return {
    get<T>(path: string, headers?: Record<string, string>) {
      return request<T>('GET', path, undefined, headers);
    },

    post<T>(path: string, body?: unknown, headers?: Record<string, string>) {
      return request<T>('POST', path, body, headers);
    },

    put<T>(path: string, body?: unknown, headers?: Record<string, string>) {
      return request<T>('PUT', path, body, headers);
    },

    patch<T>(path: string, body?: unknown, headers?: Record<string, string>) {
      return request<T>('PATCH', path, body, headers);
    },

    delete<T>(path: string, headers?: Record<string, string>) {
      return request<T>('DELETE', path, undefined, headers);
    },
  };
}

/**
 * Create an API client for shell base service.
 * 
 * Pre-configured to connect to the shell's base service API.
 * 
 * @param authToken - Optional authentication token
 * @returns An API client configured for the shell base service
 * 
 * @example
 * ```typescript
 * const shellApi = createShellApiClient(authToken);
 * const plugins = await shellApi.get<Plugin[]>('/api/v1/base/plugins');
 * ```
 */
export function createShellApiClient(authToken?: string): ApiClient {
  const baseUrl = typeof window !== 'undefined' 
    ? `${window.location.protocol}//${window.location.hostname}:4000`
    : 'http://localhost:4000';

  return createApiClient({
    baseUrl,
    authToken,
  });
}

/**
 * Create an API client for integration proxy.
 *
 * Provides a simplified interface for calling integration methods
 * (AI, storage, email) through the shell's integration proxy.
 *
 * @param pluginName - Name of the plugin making the request
 * @param authToken - Optional authentication token
 * @returns An integration client with a call method
 *
 * @example
 * ```typescript
 * const integrations = createIntegrationClient('my-plugin', authToken);
 * const result = await integrations.call<string>(
 *   'openai',
 *   'complete',
 *   ['Write a haiku about coding']
 * );
 * ```
 */
export function createIntegrationClient(pluginName: string, authToken?: string): IntegrationClient {
  const baseUrl = typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:4000`
    : 'http://localhost:4000';

  return {
    async call<T>(integrationType: string, method: string, args: unknown[]): Promise<T> {
      const client = createApiClient({
        baseUrl,
        authToken,
        pluginName,
      });

      const response = await client.post<{ result: T }>(`/api/v1/integrations/${integrationType}/call`, {
        method,
        args,
      });

      return response.data.result;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin Backend URL Resolution
// Re-export from centralized config for backwards compatibility
// ─────────────────────────────────────────────────────────────────────────────

import {
  PLUGIN_PORTS,
  getPluginPort,
  getPluginBackendUrl as configGetPluginBackendUrl,
  type PluginBackendUrlOptions,
} from '../config/ports.js';

// Re-export for backwards compatibility
export { PLUGIN_PORTS, getPluginPort, PluginBackendUrlOptions };

/**
 * Get the backend URL for a specific plugin.
 *
 * Resolution order:
 * 1. window.__SHELL_CONTEXT__.config[pluginName + 'ApiUrl']
 * 2. Environment variable: VITE_{PLUGIN_NAME}_API_URL or {PLUGIN_NAME}_BACKEND_URL
 * 3. Development convention: http://localhost:{port}
 *
 * @param pluginName - The plugin name (e.g., 'my-wallet', 'daydream-video')
 * @param options - Optional configuration
 * @returns The resolved backend URL
 *
 * @example
 * ```typescript
 * // Basic usage
 * const url = getPluginBackendUrl('my-wallet');
 * // Returns: http://localhost:4008 (in development)
 *
 * // With API path
 * const apiUrl = getPluginBackendUrl('my-wallet', { apiPath: '/api/v1/wallet' });
 * // Returns: http://localhost:4008/api/v1/wallet
 * ```
 */
export function getPluginBackendUrl(pluginName: string, options?: PluginBackendUrlOptions): string {
  return configGetPluginBackendUrl(pluginName, options);
}

/**
 * Create a pre-configured API client for a plugin backend.
 *
 * This is a convenience function that combines getPluginBackendUrl with createApiClient.
 * For React components, prefer using the usePluginApi() hook instead.
 *
 * @param pluginName - The plugin name
 * @param options - Optional configuration
 * @returns A configured API client
 *
 * @example
 * ```typescript
 * const api = createPluginApiClient('my-wallet', {
 *   apiPath: '/api/v1/wallet',
 *   authToken: 'token-123'
 * });
 *
 * const balance = await api.get<{ balance: number }>('/balance');
 * ```
 */
export function createPluginApiClient(
  pluginName: string,
  options?: PluginBackendUrlOptions & { authToken?: string; timeout?: number }
): ApiClient {
  const { authToken, timeout, ...urlOptions } = options || {};
  const baseUrl = getPluginBackendUrl(pluginName, urlOptions);

  return createApiClient({
    baseUrl,
    authToken,
    pluginName,
    timeout,
  });
}
