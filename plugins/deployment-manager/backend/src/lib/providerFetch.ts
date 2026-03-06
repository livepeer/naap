import { secretStore } from './SecretStore.js';
import type { ProviderApiConfig } from '../types/index.js';

export interface AuthContext {
  authorization?: string;
  cookie?: string;
  teamId?: string;
}

let globalAuthContext: AuthContext = {};

export function setAuthContext(ctx: AuthContext): void {
  globalAuthContext = ctx;
}

export function getAuthContext(): AuthContext {
  return globalAuthContext;
}

const AUTH_BASE = process.env.SHELL_URL || 'http://localhost:3000';

let cachedUserId: { token: string; userId: string | null; expiresAt: number } | null = null;

export async function resolveUserId(): Promise<string | null> {
  const ctx = globalAuthContext;
  if (!ctx.authorization) return null;

  if (cachedUserId && cachedUserId.token === ctx.authorization && Date.now() < cachedUserId.expiresAt) {
    return cachedUserId.userId;
  }

  try {
    const res = await fetch(`${AUTH_BASE}/api/v1/auth/me`, {
      headers: { Authorization: ctx.authorization },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const userId = data.data?.user?.id || data.data?.id || data.id || null;
    cachedUserId = { token: ctx.authorization, userId, expiresAt: Date.now() + 30_000 };
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
): Promise<Response> {
  let injector: SecretInjector | undefined;

  if (apiConfig.authType !== 'none') {
    const userId = await resolveUserId();
    if (userId) {
      const secrets = await secretStore.getSecrets(userId, providerSlug);
      const secretValue = secrets[apiConfig.secretNames[0]];
      if (secretValue && apiConfig.authHeaderTemplate) {
        const headerName = apiConfig.authHeaderName || 'Authorization';
        const headerValue = apiConfig.authHeaderTemplate.replace('{{secret}}', secretValue);
        injector = (headers: Headers) => {
          headers.set(headerName, headerValue);
        };
      }
    }
  }

  return providerFetch(apiConfig.upstreamBaseUrl, path, options, injector);
}
