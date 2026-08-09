/**
 * MCP OAuth Scenario A login bridge (Storyboard → NaaP `/login?mcp_oauth=1`).
 *
 * After Google/GitHub (or password) sign-in, NaaP redirects back to Storyboard's
 * broker callback with the NaaP user id. Redirect URIs must be allow-listed
 * (derived from MCP_OAUTH_REDIRECT_ALLOWLIST and/or MCP_INTERNAL_MINT_ALLOWLIST
 * origins + `/api/mcp/oauth/callback`). Absent allow-list config, the bridge
 * is inert.
 *
 * Cookie signing uses Web Crypto so this module is safe to import from Edge
 * middleware (same pattern as pymthouse-device-initiate).
 */

export const NAAP_MCP_OAUTH_PENDING_COOKIE = 'naap_mcp_oauth_pending';

const PENDING_TTL_MS = 10 * 60 * 1000;
const IDENTITY_CODE_TTL_MS = 5 * 60 * 1000;
const CALLBACK_PATH = '/api/mcp/oauth/callback';

export interface McpOauthPending {
  state: string;
  redirectUri: string;
  exp: number;
}

export interface McpOauthIdentityPayload {
  externalUserId: string;
  email?: string;
  exp: number;
  nonce: string;
}

function cookieSecret(): string | null {
  const secret =
    process.env.MCP_OAUTH_BRIDGE_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    process.env.MCP_INTERNAL_MINT_SECRET?.trim() ||
    null;
  return secret && secret.length > 0 ? secret : null;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(binary, 'binary').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array | null {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  try {
    const binary =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('binary');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function importHmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  );
}

async function signPayload(serializedPayload: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret, ['sign']);
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(serializedPayload),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verifyPayload(
  serializedPayload: string,
  providedSignatureBytes: Uint8Array,
  secret: string,
): Promise<boolean> {
  const key = await importHmacKey(secret, ['verify']);
  return crypto.subtle.verify(
    'HMAC',
    key,
    new Uint8Array(providedSignatureBytes),
    new TextEncoder().encode(serializedPayload),
  );
}

function randomNonceHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Build the set of exact redirect_uri values permitted for the MCP bridge. */
export function mcpOauthRedirectAllowlist(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> {
  const out = new Set<string>();
  const explicit = env.MCP_OAUTH_REDIRECT_ALLOWLIST?.trim();
  if (explicit) {
    for (const part of explicit.split(',')) {
      const u = part.trim();
      if (u) out.add(u);
    }
  }
  const mintOrigins = env.MCP_INTERNAL_MINT_ALLOWLIST?.trim();
  if (mintOrigins) {
    for (const part of mintOrigins.split(',')) {
      const origin = part.trim().replace(/\/+$/, '');
      if (!origin) continue;
      try {
        const base = new URL(origin);
        out.add(new URL(CALLBACK_PATH, base.origin).toString());
      } catch {
        /* skip malformed */
      }
    }
  }
  return out;
}

export function isAllowedMcpOauthRedirectUri(
  redirectUri: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const allow = mcpOauthRedirectAllowlist(env);
  if (allow.size === 0) return false;
  try {
    const u = new URL(redirectUri);
    if (u.username || u.password || u.hash) return false;
    return allow.has(u.toString());
  } catch {
    return false;
  }
}

export async function encodeMcpOauthPendingCookie(
  pending: Omit<McpOauthPending, 'exp'>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const secret = cookieSecret();
  if (!secret) {
    throw new Error('mcp_oauth_bridge_secret_missing');
  }
  if (!isAllowedMcpOauthRedirectUri(pending.redirectUri, env)) {
    throw new Error('mcp_oauth_redirect_not_allowed');
  }
  if (!pending.state || pending.state.length > 512) {
    throw new Error('mcp_oauth_state_invalid');
  }
  const body: McpOauthPending = {
    state: pending.state,
    redirectUri: pending.redirectUri,
    exp: Date.now() + PENDING_TTL_MS,
  };
  const serializedPayload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(body)));
  const signature = await signPayload(serializedPayload, secret);
  return `${serializedPayload}.${signature}`;
}

export async function tryParseMcpOauthPendingCookie(
  raw: string | undefined,
): Promise<McpOauthPending | null> {
  if (!raw || raw.length > 8192) return null;
  const secret = cookieSecret();
  if (!secret) return null;
  const sep = raw.lastIndexOf('.');
  if (sep <= 0) return null;
  const serializedPayload = raw.slice(0, sep);
  const providedSignature = raw.slice(sep + 1);
  const providedBytes = base64UrlToBytes(providedSignature);
  if (!providedBytes) return null;
  const valid = await verifyPayload(serializedPayload, providedBytes, secret);
  if (!valid) return null;
  try {
    const payloadBytes = base64UrlToBytes(serializedPayload);
    if (!payloadBytes) return null;
    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as McpOauthPending;
    if (!parsed?.state || !parsed?.redirectUri || typeof parsed.exp !== 'number') return null;
    if (Date.now() > parsed.exp) return null;
    if (!isAllowedMcpOauthRedirectUri(parsed.redirectUri)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function mintMcpOauthIdentityCode(
  identity: Omit<McpOauthIdentityPayload, 'exp' | 'nonce'>,
): Promise<string> {
  const secret = cookieSecret();
  if (!secret) {
    throw new Error('mcp_oauth_bridge_secret_missing');
  }
  const body: McpOauthIdentityPayload = {
    externalUserId: identity.externalUserId,
    email: identity.email,
    exp: Date.now() + IDENTITY_CODE_TTL_MS,
    nonce: randomNonceHex(),
  };
  const serializedPayload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(body)));
  const signature = await signPayload(serializedPayload, secret);
  return `mcp_id_${serializedPayload}.${signature}`;
}

export async function consumeMcpOauthIdentityCode(
  code: string,
): Promise<{ externalUserId: string; email?: string } | null> {
  if (!code.startsWith('mcp_id_')) return null;
  const secret = cookieSecret();
  if (!secret) return null;
  const raw = code.slice('mcp_id_'.length);
  const sep = raw.lastIndexOf('.');
  if (sep <= 0) return null;
  const serializedPayload = raw.slice(0, sep);
  const providedSignature = raw.slice(sep + 1);
  const providedBytes = base64UrlToBytes(providedSignature);
  if (!providedBytes) return null;
  const valid = await verifyPayload(serializedPayload, providedBytes, secret);
  if (!valid) return null;
  try {
    const payloadBytes = base64UrlToBytes(serializedPayload);
    if (!payloadBytes) return null;
    const parsed = JSON.parse(
      new TextDecoder().decode(payloadBytes),
    ) as McpOauthIdentityPayload;
    if (!parsed?.externalUserId || typeof parsed.exp !== 'number') return null;
    if (Date.now() > parsed.exp) return null;
    return {
      externalUserId: String(parsed.externalUserId),
      email: parsed.email ? String(parsed.email) : undefined,
    };
  } catch {
    return null;
  }
}

/** Build the Storyboard callback URL with identity (never includes mint secrets). */
export async function buildMcpOauthCallbackUrl(opts: {
  pending: McpOauthPending;
  externalUserId: string;
  email?: string | null;
}): Promise<string> {
  const dest = new URL(opts.pending.redirectUri);
  dest.searchParams.set('state', opts.pending.state);
  dest.searchParams.set('external_user_id', opts.externalUserId);
  if (opts.email) dest.searchParams.set('email', opts.email);
  const code = await mintMcpOauthIdentityCode({
    externalUserId: opts.externalUserId,
    email: opts.email ?? undefined,
  });
  dest.searchParams.set('code', code);
  return dest.toString();
}
