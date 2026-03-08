const API_BASE = '/api/v1/deployment-manager';

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('naap_auth_token');
}

/**
 * Fetch wrapper that adds auth headers and the deployment-manager API base URL.
 * Drop-in replacement for fetch() — just omit the base URL prefix.
 */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

export { API_BASE };
