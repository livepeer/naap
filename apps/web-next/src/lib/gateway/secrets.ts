/**
 * Service Gateway — Secret Resolution
 *
 * Retrieves encrypted secrets from SecretVault for upstream auth injection.
 * Secrets are stored with team-scoped keys: gw:{teamId}:{secretName}
 */

import type { ResolvedSecrets } from './types';

const BASE_SVC_URL = process.env.BASE_SVC_URL || process.env.NEXT_PUBLIC_BASE_SVC_URL || 'http://localhost:4000';

// In-memory secret cache (short TTL — secrets change less frequently)
const SECRET_CACHE = new Map<string, { value: string; expiresAt: number }>();
const SECRET_CACHE_TTL_MS = 300_000; // 5 minutes

/**
 * Resolve all secrets referenced by a connector.
 *
 * @param teamId    - Team ID for scoping
 * @param secretRefs - Array of secret reference names (e.g. ["token", "password"])
 * @param authToken  - Internal auth token for SecretVault API calls
 */
export async function resolveSecrets(
  teamId: string,
  secretRefs: string[],
  authToken: string | null
): Promise<ResolvedSecrets> {
  if (secretRefs.length === 0) return {};

  const secrets: ResolvedSecrets = {};

  await Promise.all(
    secretRefs.map(async (ref) => {
      const key = `gw:${teamId}:${ref}`;

      // Check cache
      const cached = SECRET_CACHE.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        secrets[ref] = cached.value;
        return;
      }

      try {
        const response = await fetch(`${BASE_SVC_URL}/api/secrets/${encodeURIComponent(key)}`, {
          headers: {
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
            'x-internal-service': 'service-gateway',
          },
        });

        if (response.ok) {
          const data = await response.json();
          const value = data.data?.value || data.value || '';
          secrets[ref] = value;
          SECRET_CACHE.set(key, { value, expiresAt: Date.now() + SECRET_CACHE_TTL_MS });
        }
      } catch {
        // Secret not found — leave as empty string
        secrets[ref] = '';
      }
    })
  );

  return secrets;
}

/**
 * Store a secret in SecretVault.
 */
export async function storeSecret(
  teamId: string,
  name: string,
  value: string,
  authToken: string
): Promise<boolean> {
  const key = `gw:${teamId}:${name}`;

  try {
    const response = await fetch(`${BASE_SVC_URL}/api/secrets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
        'x-internal-service': 'service-gateway',
      },
      body: JSON.stringify({ key, value }),
    });

    if (response.ok) {
      // Invalidate cache
      SECRET_CACHE.delete(key);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Delete a secret from SecretVault.
 */
export async function deleteSecret(
  teamId: string,
  name: string,
  authToken: string
): Promise<boolean> {
  const key = `gw:${teamId}:${name}`;

  try {
    const response = await fetch(`${BASE_SVC_URL}/api/secrets/${encodeURIComponent(key)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'x-internal-service': 'service-gateway',
      },
    });

    SECRET_CACHE.delete(key);
    return response.ok;
  } catch {
    return false;
  }
}
