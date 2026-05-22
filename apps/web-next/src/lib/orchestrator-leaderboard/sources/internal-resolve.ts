/**
 * Internal connector resolution for cron/server-side refresh.
 *
 * Bypasses the HTTP gateway by resolving the public ServiceConnector directly
 * via Prisma, decrypting its secrets from SecretVault, and returning the
 * upstream URL + auth headers needed to call the external service.
 */

import { prisma } from '@/lib/db';
import { decrypt } from '@/lib/gateway/encryption';

export interface InternalConnectorAuth {
  upstreamBaseUrl: string;
  authType: string;
  headers: Record<string, string>;
}

export async function resolveConnectorAuth(
  slug: string,
): Promise<InternalConnectorAuth | null> {
  const connector = await prisma.serviceConnector.findFirst({
    where: { slug, visibility: 'public', status: 'published' },
    select: {
      id: true,
      ownerUserId: true,
      upstreamBaseUrl: true,
      authType: true,
      secretRefs: true,
    },
  });
  if (!connector) return null;

  const scopeId = `personal:${connector.ownerUserId}`;
  const secrets: Record<string, string> = {};

  for (const ref of connector.secretRefs) {
    const key = `gw:${scopeId}:${slug}:${ref}`;
    try {
      const record = await prisma.secretVault.findUnique({
        where: { key },
        select: { encryptedValue: true, iv: true },
      });
      if (record?.encryptedValue && record.iv) {
        secrets[ref] = decrypt(record.encryptedValue, record.iv);
      }
    } catch (err) {
      console.error(`[internal-resolve] Failed to decrypt secret "${ref}" for ${slug}:`, err);
    }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (connector.authType === 'bearer') {
    const apiKey = secrets['api-key'] || '';
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (connector.authType === 'basic') {
    const user = secrets['username'] || '';
    const pass = secrets['password'] || '';
    if (user || pass) {
      headers['Authorization'] = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
    }
  }

  return {
    upstreamBaseUrl: connector.upstreamBaseUrl,
    authType: connector.authType,
    headers,
  };
}
