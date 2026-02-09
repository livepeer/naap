/**
 * Shared Authentication Utilities for NAAP Plugins
 *
 * Provides consistent auth token and CSRF token handling across all plugins.
 * These utilities match the shell's storage keys and can retrieve tokens from
 * both the shell context (UMD/CDN mode) and localStorage (standalone).
 */

// Storage key constants (must match shell's STORAGE_KEYS)
export const AUTH_TOKEN_KEY = 'naap_auth_token';
export const CSRF_TOKEN_KEY = 'naap_csrf_token';

/**
 * Shell context interface for type-safe access
 */
interface ShellContext {
  authToken?: string;
  auth?: {
    getToken?: () => string | Promise<string>;
    isAuthenticated?: () => boolean;
  };
  config?: {
    apiBaseUrl?: string;
    [key: string]: unknown;
  };
}

/**
 * Get the shell context from the global window object.
 * Returns null if not available (e.g., running standalone).
 */
export function getShellContext(): ShellContext | null {
  if (typeof window === 'undefined') return null;

  const ctx = (window as unknown as { __SHELL_CONTEXT__?: ShellContext }).__SHELL_CONTEXT__;
  return ctx || null;
}

/**
 * Get the auth token from shell context or localStorage.
 *
 * Priority:
 * 1. Shell context direct token (UMD/CDN mode)
 * 2. localStorage (fallback - shell stores token here)
 *
 * @returns The auth token or null if not available
 */
export function getAuthToken(): string | null {
  if (typeof window !== 'undefined') {
    // Try shell context first (set by mount.tsx when loaded via UMD/CDN)
    const shellContext = getShellContext();

    // Direct authToken property (iframe mode)
    if (shellContext?.authToken) {
      return shellContext.authToken;
    }

    // Shell context auth service stores token in localStorage,
    // so we fall through to localStorage as fallback
  }

  // Read from localStorage (works for both standalone and CDN-loaded modes)
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

/**
 * Get the CSRF token from sessionStorage.
 * The shell stores CSRF tokens in sessionStorage for security.
 *
 * @returns The CSRF token or null if not available
 */
export function getCsrfToken(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage.getItem(CSRF_TOKEN_KEY);
}

/**
 * Build request headers with auth and CSRF tokens.
 * Use this for authenticated API requests.
 *
 * @param includeContentType - Whether to include Content-Type: application/json (default: true)
 * @returns Headers object with Authorization and X-CSRF-Token if available
 */
export function authHeaders(includeContentType = true): Record<string, string> {
  const token = getAuthToken();
  const csrfToken = getCsrfToken();

  return {
    ...(includeContentType ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
  };
}

/**
 * Check if the user is currently authenticated.
 * This is a quick check based on token presence.
 *
 * @returns true if an auth token is available
 */
export function isAuthenticated(): boolean {
  return getAuthToken() !== null;
}
