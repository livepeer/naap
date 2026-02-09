/**
 * @naap/plugin-utils
 *
 * Shared utilities for NAAP plugin frontends.
 * Provides consistent auth, CSRF, and API handling across all plugins.
 */

// Auth utilities
export {
  AUTH_TOKEN_KEY,
  CSRF_TOKEN_KEY,
  getShellContext,
  getAuthToken,
  getCsrfToken,
  authHeaders,
  isAuthenticated,
} from './auth.js';

// API utilities
export {
  getApiUrl,
  getBaseSvcUrl,
  ApiError,
  apiRequest,
  createApiClient,
  type ApiUrlOptions,
  type ApiRequestOptions,
} from './api.js';
