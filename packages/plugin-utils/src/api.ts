/**
 * Shared API Utilities for NAAP Plugins
 *
 * Provides consistent API URL resolution and request handling across plugins.
 * Supports shell context, environment variables, and sensible defaults.
 */

import { authHeaders, getShellContext } from './auth.js';

/**
 * Options for API URL resolution
 */
export interface ApiUrlOptions {
  /** Config key to look for in shell context (e.g., 'daydreamApiUrl') */
  configKey?: string;
  /** Environment variable name to check (e.g., 'NEXT_PUBLIC_DAYDREAM_API_URL') */
  envVar?: string;
  /** Default URL if no other source is available */
  defaultUrl: string;
  /** API path prefix to append (e.g., '/api/v1/daydream') */
  pathPrefix?: string;
}

/**
 * Get an API URL from shell context, environment variables, or defaults.
 *
 * Resolution order:
 * 1. Shell context config (if configKey provided)
 * 2. Environment variable (if envVar provided)
 * 3. Default URL
 *
 * @param options - URL resolution options
 * @returns The resolved API URL
 */
export function getApiUrl(options: ApiUrlOptions): string {
  const { configKey, envVar, defaultUrl, pathPrefix = '' } = options;

  // Try shell context first
  if (configKey) {
    const shellContext = getShellContext();
    const configValue = shellContext?.config?.[configKey];
    if (typeof configValue === 'string' && configValue) {
      return `${configValue}${pathPrefix}`;
    }
  }

  // Try environment variable
  if (envVar) {
    if (typeof process !== 'undefined' && process.env?.[envVar]) {
      return `${process.env[envVar]}${pathPrefix}`;
    }
  }

  // Use default
  return `${defaultUrl}${pathPrefix}`;
}

/**
 * Get the base service URL (base-svc).
 * This is the main backend service for auth, plugins, registry, etc.
 */
export function getBaseSvcUrl(): string {
  return getApiUrl({
    configKey: 'apiBaseUrl',
    envVar: 'NEXT_PUBLIC_API_URL',
    defaultUrl: 'http://localhost:4000',
  });
}

/**
 * API error class for consistent error handling
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Options for API requests
 */
export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  /** Request body (will be JSON stringified) */
  body?: unknown;
  /** Whether to include auth headers (default: true) */
  authenticated?: boolean;
  /** Whether to include Content-Type header (default: true) */
  includeContentType?: boolean;
}

/**
 * Make an API request with consistent error handling and auth.
 *
 * @param url - Full URL or path (if baseUrl provided)
 * @param options - Request options
 * @returns Parsed response data
 */
export async function apiRequest<T>(
  url: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const {
    body,
    authenticated = true,
    includeContentType = true,
    headers: customHeaders,
    ...fetchOptions
  } = options;

  // Build headers
  const headers: Record<string, string> = {
    ...(authenticated ? authHeaders(includeContentType) : {}),
    ...(customHeaders as Record<string, string> || {}),
  };

  // Prepare fetch options
  const finalOptions: RequestInit = {
    ...fetchOptions,
    headers,
  };

  // Add body if provided
  if (body !== undefined) {
    finalOptions.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, finalOptions);
    const data = await response.json();

    // Check for API-level errors
    if (!response.ok || data.success === false) {
      throw new ApiError(
        data.error?.message || data.error || 'API request failed',
        response.status,
        data.error?.code,
        data.error?.details
      );
    }

    // Return data payload (handle both { data: ... } and direct response)
    return data.data !== undefined ? data.data : data;
  } catch (err) {
    // Re-throw ApiError as-is
    if (err instanceof ApiError) {
      throw err;
    }

    // Network errors or JSON parse errors
    throw new ApiError(
      'Network error - backend may be unavailable',
      0,
      'NETWORK_ERROR',
      err
    );
  }
}

/**
 * Create a pre-configured API client for a specific service.
 *
 * @param baseUrl - Base URL for the service
 * @returns Object with get, post, put, patch, delete methods
 */
export function createApiClient(baseUrl: string) {
  const request = <T>(endpoint: string, options: ApiRequestOptions = {}) =>
    apiRequest<T>(`${baseUrl}${endpoint}`, options);

  return {
    get: <T>(endpoint: string, options?: Omit<ApiRequestOptions, 'method'>) =>
      request<T>(endpoint, { ...options, method: 'GET' }),

    post: <T>(endpoint: string, body?: unknown, options?: Omit<ApiRequestOptions, 'method' | 'body'>) =>
      request<T>(endpoint, { ...options, method: 'POST', body }),

    put: <T>(endpoint: string, body?: unknown, options?: Omit<ApiRequestOptions, 'method' | 'body'>) =>
      request<T>(endpoint, { ...options, method: 'PUT', body }),

    patch: <T>(endpoint: string, body?: unknown, options?: Omit<ApiRequestOptions, 'method' | 'body'>) =>
      request<T>(endpoint, { ...options, method: 'PATCH', body }),

    delete: <T>(endpoint: string, options?: Omit<ApiRequestOptions, 'method'>) =>
      request<T>(endpoint, { ...options, method: 'DELETE' }),
  };
}
