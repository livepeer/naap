import * as jose from 'jose';

export interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  grant_types_supported?: string[];
  code_challenge_methods_supported?: string[];
}

const discoveryCache = new Map<string, { doc: OidcDiscoveryDocument; expiresAt: number }>();
const jwksCache = new Map<string, { jwks: jose.JSONWebKeySet; expiresAt: number }>();

const CACHE_TTL_MS = 3600 * 1000; // 1 hour

export async function fetchDiscoveryDocument(
  discoveryUrl: string
): Promise<OidcDiscoveryDocument> {
  const cached = discoveryCache.get(discoveryUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.doc;
  }

  const response = await fetch(discoveryUrl, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch OIDC discovery document: ${response.status}`);
  }

  const doc = (await response.json()) as OidcDiscoveryDocument;

  discoveryCache.set(discoveryUrl, {
    doc,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return doc;
}

export async function fetchJWKS(jwksUri: string): Promise<jose.JSONWebKeySet> {
  const cached = jwksCache.get(jwksUri);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.jwks;
  }

  const response = await fetch(jwksUri, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS: ${response.status}`);
  }

  const jwks = (await response.json()) as jose.JSONWebKeySet;

  jwksCache.set(jwksUri, {
    jwks,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return jwks;
}

export function clearDiscoveryCache(): void {
  discoveryCache.clear();
  jwksCache.clear();
}
