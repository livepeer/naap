/**
 * Service Gateway — Secret Resolution
 *
 * Retrieves encrypted secrets from SecretVault via Prisma and decrypts them
 * for upstream auth injection. Uses the shared encryption module to guarantee
 * the same key across admin writes and proxy reads.
 */

import { prisma } from '@/lib/db';
import { encrypt, decrypt } from './encryption';
import type { ResolvedSecrets } from './types';

const SECRET_CACHE = new Map<string, { value: string; expiresAt: number }>();
const SECRET_CACHE_TTL_MS = 300_000; // 5 minutes

/**
 * Resolve all secrets referenced by a connector.
 *
 * Reads directly from SecretVault via Prisma and decrypts using AES-256-GCM.
 * Secret keys are namespaced per connector slug to prevent collisions when
 * multiple connectors in the same scope share the same secretRef name.
 */
export async function resolveSecrets(
  teamId: string,
  secretRefs: string[],
  _authToken: string | null,
  connectorSlug: string,
): Promise<ResolvedSecrets> {
  if (secretRefs.length === 0) return {};

  const secrets: ResolvedSecrets = {};

  await Promise.all(
    secretRefs.map(async (ref) => {
      const key = `gw:${teamId}:${connectorSlug}:${ref}`;

      const cached = SECRET_CACHE.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        secrets[ref] = cached.value;
        return;
      }

      try {
        const record = await prisma.secretVault.findUnique({
          where: { key },
          select: { encryptedValue: true, iv: true },
        });

        if (record && record.encryptedValue && record.iv) {
          const value = decrypt(record.encryptedValue, record.iv);
          secrets[ref] = value;
          SECRET_CACHE.set(key, { value, expiresAt: Date.now() + SECRET_CACHE_TTL_MS });
        } else {
          secrets[ref] = '';
        }
      } catch (err) {
        console.error(`[gateway] Failed to resolve secret "${ref}":`, err);
        secrets[ref] = '';
        SECRET_CACHE.set(key, { value: '', expiresAt: Date.now() + 30_000 });
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
  _authToken: string,
  connectorSlug: string,
): Promise<boolean> {
  const key = `gw:${teamId}:${connectorSlug}:${name}`;

  try {
    const { encryptedValue, iv } = encrypt(value);
    await prisma.secretVault.upsert({
      where: { key },
      update: { encryptedValue, iv, updatedAt: new Date() },
      create: {
        key,
        encryptedValue,
        iv,
        scope: teamId,
        createdBy: 'system',
      },
    });
    SECRET_CACHE.delete(key);
    return true;
  } catch (err) {
    console.error(`[gateway] Failed to store secret "${name}":`, err);
    return false;
  }
}

/**
 * Delete a secret from SecretVault.
 */
export async function deleteSecret(
  teamId: string,
  name: string,
  _authToken: string,
  connectorSlug: string,
): Promise<boolean> {
  const key = `gw:${teamId}:${connectorSlug}:${name}`;

  try {
    await prisma.secretVault.delete({ where: { key } });
    SECRET_CACHE.delete(key);
    return true;
  } catch {
    SECRET_CACHE.delete(key);
    return false;
  }
}
