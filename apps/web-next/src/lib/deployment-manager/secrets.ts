/**
 * Deployment Manager — Secret Storage
 *
 * Stores provider API keys in the platform's SecretVault with a `dm:` prefix,
 * completely independent of the service-gateway. Uses the shared AES-256-GCM
 * encryption module for at-rest encryption.
 *
 * Key format: dm:{userId}:{providerSlug}:{secretName}
 */

import { prisma } from '@/lib/db';
import { encrypt, decrypt } from '@/lib/gateway/encryption';

const SECRET_CACHE = new Map<string, { value: string; expiresAt: number }>();
const CACHE_TTL_MS = 300_000;

function secretKey(userId: string, providerSlug: string, name: string): string {
  return `dm:${userId}:${providerSlug}:${name}`;
}

export async function storeSecret(
  userId: string,
  providerSlug: string,
  name: string,
  value: string,
): Promise<boolean> {
  const key = secretKey(userId, providerSlug, name);
  try {
    const { encryptedValue, iv } = encrypt(value);
    await prisma.secretVault.upsert({
      where: { key },
      update: { encryptedValue, iv, updatedAt: new Date() },
      create: {
        key,
        encryptedValue,
        iv,
        scope: `dm:${userId}`,
        createdBy: userId,
      },
    });
    SECRET_CACHE.delete(key);
    return true;
  } catch (err) {
    console.error(`[dm] Failed to store secret "${name}" for ${providerSlug}:`, err);
    return false;
  }
}

export async function getSecret(
  userId: string,
  providerSlug: string,
  name: string,
): Promise<string> {
  const key = secretKey(userId, providerSlug, name);

  const cached = SECRET_CACHE.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const record = await prisma.secretVault.findUnique({
      where: { key },
      select: { encryptedValue: true, iv: true },
    });

    if (record?.encryptedValue && record.iv) {
      const value = decrypt(record.encryptedValue, record.iv);
      SECRET_CACHE.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      return value;
    }
  } catch (err) {
    console.error(`[dm] Failed to read secret "${name}" for ${providerSlug}:`, err);
  }

  return '';
}

export async function hasSecret(
  userId: string,
  providerSlug: string,
  name: string,
): Promise<{ name: string; configured: boolean; maskedValue?: string }> {
  const key = secretKey(userId, providerSlug, name);
  try {
    const record = await prisma.secretVault.findUnique({
      where: { key },
      select: { encryptedValue: true },
    });
    const configured = !!(record?.encryptedValue);
    return {
      name,
      configured,
      maskedValue: configured ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : undefined,
    };
  } catch {
    return { name, configured: false };
  }
}

export async function deleteSecret(
  userId: string,
  providerSlug: string,
  name: string,
): Promise<boolean> {
  const key = secretKey(userId, providerSlug, name);
  try {
    await prisma.secretVault.delete({ where: { key } });
    SECRET_CACHE.delete(key);
    return true;
  } catch {
    SECRET_CACHE.delete(key);
    return false;
  }
}
