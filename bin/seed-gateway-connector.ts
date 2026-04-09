/**
 * Build-Time Gateway Connector Seed
 *
 * Seeds the clickhouse-query connector (ServiceConnector + ConnectorEndpoint)
 * and stores upstream ClickHouse credentials in SecretVault.
 *
 * Designed to run during Vercel build (after prisma db push) — no running
 * app or base-svc required. Uses Prisma directly for all DB operations and
 * inline AES-256-GCM encryption for secrets.
 *
 * Idempotent — safe to run on every build.
 *
 * Required env vars:
 *   DATABASE_URL            - Postgres connection string
 *   ENCRYPTION_KEY          - AES key for SecretVault (required on Vercel)
 *   CLICKHOUSE_QUERY_USERNAME - ClickHouse username
 *   CLICKHOUSE_QUERY_PASSWORD - ClickHouse password
 *
 * Usage:
 *   npx tsx bin/seed-gateway-connector.ts
 */

import { PrismaClient } from '../packages/database/src/generated/client/index.js';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SYSTEM_OWNER_ID = '00000000-0000-0000-0000-000000000001';

// ── Encryption (mirrors apps/web-next/src/lib/gateway/encryption.ts) ──

const KDF_SALT = Buffer.from('naap-gateway-kdf-v1', 'utf8');
const DEV_FALLBACK_KEY = 'naap-local-dev-gateway-encryption-key-32ch';

function getEncryptionKey(): string {
  if (process.env.ENCRYPTION_KEY) return process.env.ENCRYPTION_KEY;
  if (process.env.VERCEL) {
    throw new Error('ENCRYPTION_KEY is required on Vercel');
  }
  return DEV_FALLBACK_KEY;
}

function encrypt(text: string): { encryptedValue: string; iv: string } {
  const derivedKey = crypto.scryptSync(getEncryptionKey(), KDF_SALT, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return {
    encryptedValue: encrypted + ':' + authTag.toString('hex'),
    iv: iv.toString('hex'),
  };
}

// ── Main ──

async function main() {
  const templatePath = path.resolve(__dirname, '../plugins/service-gateway/connectors/clickhouse-query.json');
  if (!fs.existsSync(templatePath)) {
    console.log('[seed-gw] clickhouse-query.json template not found — skipping');
    return;
  }

  const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
  const conn = template.connector;
  const slug = conn.slug as string;

  const chUser = process.env.CLICKHOUSE_QUERY_USERNAME;
  const chPass = process.env.CLICKHOUSE_QUERY_PASSWORD;

  if (!chUser || !chPass) {
    console.log('[seed-gw] CLICKHOUSE_QUERY_USERNAME / CLICKHOUSE_QUERY_PASSWORD not set — skipping connector seed');
    return;
  }

  console.log(`[seed-gw] Seeding gateway connector: ${slug}`);

  const prisma = new PrismaClient();

  try {
    // Find any existing user for ownership, or fall back to system owner ID
    let ownerUserId = SYSTEM_OWNER_ID;
    const existingUser = await prisma.user.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (existingUser) {
      ownerUserId = existingUser.id;
      console.log(`[seed-gw] Using existing user: ${ownerUserId}`);
    } else {
      console.log(`[seed-gw] No users found — using system owner ID`);
    }

    // Upsert ServiceConnector
    let allowedHosts: string[] = conn.allowedHosts || [];
    if (allowedHosts.length === 0) {
      try { allowedHosts = [new URL(conn.upstreamBaseUrl).hostname]; } catch { /* ignore */ }
    }

    let connector = await prisma.serviceConnector.findFirst({
      where: { slug, visibility: 'public' },
    });

    if (connector) {
      console.log(`[seed-gw] Connector exists: ${connector.id}`);
    } else {
      connector = await prisma.serviceConnector.create({
        data: {
          ownerUserId,
          createdBy: ownerUserId,
          slug,
          displayName: conn.displayName,
          description: conn.description || template.description,
          category: template.category,
          visibility: 'public',
          upstreamBaseUrl: conn.upstreamBaseUrl,
          allowedHosts,
          defaultTimeout: conn.defaultTimeout ?? 30000,
          healthCheckPath: conn.healthCheckPath ?? null,
          authType: conn.authType,
          authConfig: conn.authConfig || {},
          secretRefs: conn.secretRefs,
          streamingEnabled: conn.streamingEnabled ?? false,
          responseWrapper: conn.responseWrapper ?? true,
          tags: conn.tags || [],
          status: 'published',
          publishedAt: new Date(),
        },
      });
      console.log(`[seed-gw] Created connector: ${connector.id}`);
    }

    // Publish if still draft
    if (connector.status !== 'published') {
      await prisma.serviceConnector.update({
        where: { id: connector.id },
        data: { status: 'published', publishedAt: new Date() },
      });
      console.log('[seed-gw] Published connector');
    }

    const connectorId = connector.id;
    const actualOwnerId = connector.ownerUserId || ownerUserId;

    // Upsert ConnectorEndpoints
    const existingEps = await prisma.connectorEndpoint.findMany({
      where: { connectorId },
      select: { path: true, method: true },
    });
    const existingSet = new Set(existingEps.map((e) => `${e.method}:${e.path}`));

    for (const ep of template.endpoints) {
      if (existingSet.has(`${ep.method}:${ep.path}`)) continue;
      await prisma.connectorEndpoint.create({
        data: {
          connectorId,
          name: ep.name,
          description: ep.description,
          method: ep.method,
          path: ep.path,
          upstreamPath: ep.upstreamPath,
          upstreamContentType: ep.upstreamContentType ?? 'application/json',
          bodyTransform: ep.bodyTransform ?? 'passthrough',
          upstreamStaticBody: ep.upstreamStaticBody ?? null,
          rateLimit: ep.rateLimit,
          timeout: ep.timeout,
          cacheTtl: ep.cacheTtl,
          retries: ep.retries ?? 0,
          bodyBlacklist: ep.bodyBlacklist ?? [],
          bodyPattern: ep.bodyPattern ?? null,
        },
      });
      console.log(`[seed-gw] Endpoint: ${ep.method} ${ep.path}`);
    }

    // Store ClickHouse secrets in SecretVault
    const scopeId = `personal:${actualOwnerId}`;
    const secretPairs: [string, string][] = [
      ['username', chUser],
      ['password', chPass],
    ];

    for (const [ref, value] of secretPairs) {
      const key = `gw:${scopeId}:${slug}:${ref}`;
      const { encryptedValue, iv } = encrypt(value);
      await prisma.secretVault.upsert({
        where: { key },
        update: { encryptedValue, iv, updatedAt: new Date() },
        create: {
          key,
          encryptedValue,
          iv,
          scope: scopeId,
          createdBy: 'system',
        },
      });
      console.log(`[seed-gw] Secret "${ref}": stored (key=${key.slice(0, 30)}...)`);
    }

    // Ensure a GatewayPlan exists
    const planName = `${slug}-standard`;
    const existingPlan = await prisma.gatewayPlan.findFirst({
      where: { ownerUserId: actualOwnerId, name: planName },
    });
    if (!existingPlan) {
      await prisma.gatewayPlan.create({
        data: {
          ownerUserId: actualOwnerId,
          name: planName,
          displayName: `${conn.displayName} Standard`,
          rateLimit: 60,
          dailyQuota: 1000,
        },
      });
      console.log(`[seed-gw] Plan created: ${planName}`);
    }

    console.log(`[seed-gw] Done — ${slug} connector is ready`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[seed-gw] Failed:', err.message || err);
  process.exit(1);
});
