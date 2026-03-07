/**
 * Deployment Manager — Authenticated Provider Fetch
 *
 * Makes direct HTTP calls to provider APIs (RunPod, fal.ai, etc.) with
 * credentials retrieved from SecretVault. No dependency on service-gateway.
 */

import { getSecret } from './secrets';
import type { ProviderApiConfig } from './types';

let _currentUserId: string | null = null;

export function setCurrentUserId(userId: string | null): void {
  _currentUserId = userId;
}

export function getCurrentUserId(): string | null {
  return _currentUserId;
}

export async function authenticatedProviderFetch(
  providerSlug: string,
  apiConfig: ProviderApiConfig,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers = new Headers({
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  });

  if (apiConfig.authType !== 'none' && _currentUserId) {
    const secretName = apiConfig.secretNames[0];
    const secretValue = await getSecret(_currentUserId, providerSlug, secretName);
    if (secretValue && apiConfig.authHeaderTemplate) {
      const headerName = apiConfig.authHeaderName || 'Authorization';
      const headerValue = apiConfig.authHeaderTemplate.replace('{{secret}}', secretValue);
      headers.set(headerName, headerValue);
    }
  }

  const url = `${apiConfig.upstreamBaseUrl}${path}`;
  return fetch(url, { ...options, headers });
}
