import { AsyncLocalStorage } from 'node:async_hooks';
import { secretStore } from './SecretStore.js';
import type { ProviderApiConfig } from '../types/index.js';

export interface AuthContext {
  authorization?: string;
  cookie?: string;
  teamId?: string;
}

// Request-scoped auth context using AsyncLocalStorage (safe for concurrent requests)
const authStorage = new AsyncLocalStorage<AuthContext>();

export function setAuthContext(ctx: AuthContext): void {
  // For background tasks and tests that don't use runWithAuthContext
  _fallbackAuthContext = ctx;
}

export function runWithAuthContext<T>(ctx: AuthContext, fn: () => T): T {
  return authStorage.run(ctx, fn);
}

export function getAuthContext(): AuthContext {
  return authStorage.getStore() || _fallbackAuthContext;
}

let _fallbackAuthContext: AuthContext = {};

// System-level userId override for background tasks (health monitor, syncStatus)
// that don't have an HTTP request auth context.
let systemUserIdOverride: string | null = null;

export function setSystemUserId(userId: string | null): void {
  systemUserIdOverride = userId;
}

export function getSystemUserId(): string | null {
  return systemUserIdOverride;
}

const AUTH_BASE = process.env.SHELL_URL || 'http://localhost:3000';

const userIdCache = new Map<string, { userId: string | null; expiresAt: number }>();
const MAX_CACHE_ENTRIES = 100;

export async function resolveUserId(): Promise<string | null> {
  const ctx = getAuthContext();
  if (!ctx.authorization) return null;

  const cached = userIdCache.get(ctx.authorization);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.userId;
  }

  try {
    const res = await fetch(`${AUTH_BASE}/api/v1/auth/me`, {
      headers: { Authorization: ctx.authorization },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const userId = data.data?.user?.id || data.data?.id || data.id || null;
    // Evict oldest entries if cache grows too large
    if (userIdCache.size >= MAX_CACHE_ENTRIES) {
      const firstKey = userIdCache.keys().next().value;
      if (firstKey) userIdCache.delete(firstKey);
    }
    userIdCache.set(ctx.authorization, { userId, expiresAt: Date.now() + 30_000 });
    return userId;
  } catch {
    return null;
  }
}

export type SecretInjector = (headers: Headers) => void;

export async function providerFetch(
  upstreamBaseUrl: string,
  path: string,
  options: RequestInit = {},
  secretInjector?: SecretInjector,
): Promise<Response> {
  const headers = new Headers({
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  });

  if (secretInjector) {
    secretInjector(headers);
  }

  const url = `${upstreamBaseUrl}${path}`;
  return fetch(url, {
    ...options,
    headers,
  });
}

export async function authenticatedProviderFetch(
  providerSlug: string,
  apiConfig: ProviderApiConfig,
  path: string,
  options: RequestInit = {},
  overrideUserId?: string,
): Promise<Response> {
  let injector: SecretInjector | undefined;

  if (apiConfig.authType !== 'none') {
    const resolvedId = await resolveUserId();
    const userId = overrideUserId || resolvedId || systemUserIdOverride;
    if (userId) {
      const secrets = await secretStore.getSecrets(userId, providerSlug);
      const secretName = apiConfig.secretNames[0];
      const secretValue = secrets[secretName];
      if (secretValue && apiConfig.authHeaderTemplate) {
        const headerName = apiConfig.authHeaderName || 'Authorization';
        const headerValue = apiConfig.authHeaderTemplate.replace('{{secret}}', secretValue);
        injector = (headers: Headers) => {
          headers.set(headerName, headerValue);
        };
      } else if (!secretValue) {
        console.warn(`[authFetch] No secret "${secretName}" for userId=${userId} provider=${providerSlug} — request will be unauthenticated`);
      }
    } else {
      console.warn(`[authFetch] No userId resolved (resolved=${resolvedId}, override=${overrideUserId}, system=${systemUserIdOverride}) — request to ${providerSlug} will be unauthenticated`);
    }
  }

  return providerFetch(apiConfig.upstreamBaseUrl, path, options, injector);
}
