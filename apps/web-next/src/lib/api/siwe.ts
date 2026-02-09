/**
 * SIWE (Sign-In With Ethereum) API Client
 * Interfaces with the jwt-issuer service for Web3 authentication
 */

export interface NonceResponse {
  nonce: string;
  domain: string;
}

export interface SIWELoginRequest {
  message: string;
  signature: string;
}

export interface SIWELoginResponse {
  token: string;
  expires_at: string;
  address: string;
}

export interface RemoteSignerToken {
  jwt: string;
  expiresAt: string;
  address: string;
  createdAt?: string;
  scope?: string;
}

/**
 * Get a fresh nonce from the jwt-issuer for SIWE message signing
 */
export async function getSIWENonce(): Promise<NonceResponse> {
  const response = await fetch('/api/v1/auth/siwe/nonce', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to get nonce' }));
    throw new Error(error.error || 'Failed to get nonce from jwt-issuer');
  }

  return response.json();
}

/**
 * Verify SIWE signature and get JWT from jwt-issuer
 */
export async function loginWithSIWE(
  message: string,
  signature: string
): Promise<SIWELoginResponse> {
  const response = await fetch('/api/v1/auth/siwe/login-jwt', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      signature,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Authentication failed' }));
    throw new Error(error.error || 'Failed to verify SIWE signature');
  }

  return response.json();
}

/**
 * Store remote signer token in localStorage for use with go-livepeer
 */
export function storeRemoteSignerToken(token: RemoteSignerToken): void {
  if (typeof window === 'undefined') return;
  
  // Add creation timestamp and decode scope from JWT if not provided
  const enrichedToken = {
    ...token,
    createdAt: token.createdAt || new Date().toISOString(),
    scope: token.scope || 'sign:orchestrator sign:payment sign:byoc',
  };
  
  localStorage.setItem('naap_remote_signer_token', JSON.stringify(enrichedToken));
}

/**
 * Get stored remote signer token
 */
export function getRemoteSignerToken(): RemoteSignerToken | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem('naap_remote_signer_token');
  if (!stored) return null;

  try {
    const token = JSON.parse(stored) as RemoteSignerToken;
    // Check if expired
    if (new Date(token.expiresAt) < new Date()) {
      localStorage.removeItem('naap_remote_signer_token');
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

/**
 * Clear remote signer token
 */
export function clearRemoteSignerToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('naap_remote_signer_token');
}
