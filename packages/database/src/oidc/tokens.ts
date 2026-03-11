import * as jose from 'jose';
import { fetchDiscoveryDocument, fetchJWKS } from './discovery';

export interface IdTokenPayload {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce?: string;
  email?: string;
  name?: string;
  role?: string;
  plan?: string;
  entitlements?: string[];
  [key: string]: unknown;
}

export interface TokenExchangeRequest {
  tokenEndpoint: string;
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
  codeVerifier?: string;
}

export interface TokenExchangeResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
  scope?: string;
}

export async function exchangeCodeForTokens(
  request: TokenExchangeRequest
): Promise<TokenExchangeResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: request.code,
    redirect_uri: request.redirectUri,
    client_id: request.clientId,
  });

  if (request.codeVerifier) {
    body.set('code_verifier', request.codeVerifier);
  }

  if (request.clientSecret) {
    body.set('client_secret', request.clientSecret);
  }

  const response = await fetch(request.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${errorBody}`);
  }

  return response.json() as Promise<TokenExchangeResponse>;
}

export async function validateIdToken(
  idToken: string,
  options: {
    discoveryUrl: string;
    clientId: string;
    nonce?: string;
  }
): Promise<IdTokenPayload> {
  const discovery = await fetchDiscoveryDocument(options.discoveryUrl);
  const jwks = await fetchJWKS(discovery.jwks_uri);
  const keySet = jose.createLocalJWKSet(jwks);

  const { payload } = await jose.jwtVerify(idToken, keySet, {
    issuer: discovery.issuer,
    audience: options.clientId,
  });

  if (options.nonce && payload.nonce !== options.nonce) {
    throw new Error('Invalid nonce in id_token');
  }

  return payload as IdTokenPayload;
}

export async function refreshTokens(request: {
  tokenEndpoint: string;
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}): Promise<TokenExchangeResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: request.refreshToken,
    client_id: request.clientId,
  });

  if (request.clientSecret) {
    body.set('client_secret', request.clientSecret);
  }

  const response = await fetch(request.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${errorBody}`);
  }

  return response.json() as Promise<TokenExchangeResponse>;
}
