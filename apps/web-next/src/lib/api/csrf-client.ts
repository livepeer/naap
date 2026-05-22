/**
 * CSRF Token Utilities — client-safe module
 * Uses Web Crypto API (no Node.js imports) so this can be bundled
 * for both server and browser environments.
 */

const CSRF_TOKEN_LIFETIME = 60 * 60 * 1000; // 1 hour

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

function generateClientCsrfToken(): string {
  const buf = new Uint8Array(32);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

export async function getCsrfToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  try {
    const response = await fetch('/api/v1/auth/csrf', {
      method: 'GET',
      credentials: 'include',
    });

    if (response.ok) {
      const data = await response.json();
      cachedToken = data.token || data.data?.token;
      tokenExpiry = Date.now() + CSRF_TOKEN_LIFETIME;
      return cachedToken!;
    }
  } catch (error) {
    console.warn('Failed to fetch CSRF token:', error);
  }

  cachedToken = generateClientCsrfToken();
  tokenExpiry = Date.now() + CSRF_TOKEN_LIFETIME;
  return cachedToken;
}

export function clearCsrfToken(): void {
  cachedToken = null;
  tokenExpiry = 0;
}

export async function withCsrf(
  headers: HeadersInit = {}
): Promise<HeadersInit> {
  const token = await getCsrfToken();
  return {
    ...headers,
    'X-CSRF-Token': token,
  };
}

export async function csrfFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const csrfHeaders = await withCsrf(options.headers || {});
  
  return fetch(url, {
    ...options,
    headers: csrfHeaders,
    credentials: 'include',
  });
}
