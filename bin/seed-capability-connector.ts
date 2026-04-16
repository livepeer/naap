/**
 * Seed Script: ClickHouse Query Connector for Capability Explorer
 *
 * Ensures the `clickhouse-query` ServiceConnector exists, is published,
 * and has ClickHouse credentials stored in SecretVault. This connector is
 * required by the capability-explorer refresh pipeline to query
 * `semantic.network_capabilities` via the gateway proxy.
 *
 * Idempotent — safe to run on every deploy.
 *
 * Required env vars:
 *   DATABASE_URL           — Prisma connection string
 *   CLICKHOUSE_QUERY_USERNAME  — ClickHouse Basic auth username
 *   CLICKHOUSE_QUERY_PASSWORD  — ClickHouse Basic auth password
 *   ENCRYPTION_KEY         — (optional in dev) AES-256 key for SecretVault
 *
 * Usage:
 *   npx tsx bin/seed-capability-connector.ts
 */

import * as crypto from 'crypto';
import { PrismaClient } from '../packages/database/src/generated/client/index.js';

const CLICKHOUSE_UPSTREAM = 'https://s7kh1yt2go.us-east-2.aws.clickhouse.cloud:8443';
const CONNECTOR_SLUG = 'clickhouse-query';
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
const SCOPE_ID = `personal:${SYSTEM_USER_ID}`;

const PREFIX = '[seed-cap-connector]';

// ── Encryption (mirrors apps/web-next/src/lib/gateway/encryption.ts) ──

const DEV_FALLBACK_KEY = 'naap-local-dev-gateway-encryption-key-32ch';
const KDF_SALT = Buffer.from('naap-gateway-kdf-v1', 'utf8');

function deriveKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'development') {
      return crypto.scryptSync(DEV_FALLBACK_KEY, KDF_SALT, 32);
    }
    throw new Error('ENCRYPTION_KEY is required before seeding connector secrets');
  }
  return crypto.scryptSync(raw, KDF_SALT, 32);
}

function encrypt(text: string): { encryptedValue: string; iv: string } {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return {
    encryptedValue: encrypted + ':' + authTag.toString('hex'),
    iv: iv.toString('hex'),
  };
}

async function storeSecret(
  prisma: PrismaClient,
  connectorSlug: string,
  name: string,
  value: string,
): Promise<void> {
  const key = `gw:${SCOPE_ID}:${connectorSlug}:${name}`;
  const { encryptedValue, iv } = encrypt(value);
  await (prisma as any).secretVault.upsert({
    where: { key },
    update: { encryptedValue, iv, updatedAt: new Date() },
    create: { key, encryptedValue, iv, scope: SCOPE_ID, createdBy: 'system' },
  });
}

// ── Main ──

async function main() {
  const username = process.env.CLICKHOUSE_QUERY_USERNAME;
  const password = process.env.CLICKHOUSE_QUERY_PASSWORD;

  if (!username || !password) {
    console.log(`${PREFIX} CLICKHOUSE_QUERY_USERNAME / PASSWORD not set — skipping connector seed`);
    return;
  }

  console.log(`${PREFIX} Seeding clickhouse-query connector...`);
  const prisma = new PrismaClient();

  try {
    // Ensure system user exists (needed as ownerUserId foreign key)
    const systemUser = await prisma.user.findUnique({ where: { id: SYSTEM_USER_ID } });
    let ownerId = SYSTEM_USER_ID;
    let ownerScope = SCOPE_ID;

    if (!systemUser) {
      throw new Error(
        `System user ${SYSTEM_USER_ID} must exist before seeding shared ClickHouse credentials`,
      );
    }

    // Find or create connector
    let connector = await prisma.serviceConnector.findFirst({
      where: { slug: CONNECTOR_SLUG, visibility: 'public' },
    });

    if (connector) {
      console.log(`${PREFIX} Connector already exists: ${connector.id}`);
    } else {
      connector = await prisma.serviceConnector.create({
        data: {
          ownerUserId: ownerId,
          createdBy: ownerId,
          slug: CONNECTOR_SLUG,
          displayName: 'ClickHouse Query API',
          description: 'ClickHouse HTTP query interface with Basic auth and SELECT-only enforcement',
          category: 'database',
          visibility: 'public',
          upstreamBaseUrl: CLICKHOUSE_UPSTREAM,
          allowedHosts: ['s7kh1yt2go.us-east-2.aws.clickhouse.cloud'],
          defaultTimeout: 30000,
          healthCheckPath: '/ping',
          authType: 'basic',
          authConfig: { usernameRef: 'username', passwordRef: 'password' },
          secretRefs: ['username', 'password'],
          streamingEnabled: false,
          tags: ['clickhouse', 'analytics', 'database'],
          status: 'published',
          publishedAt: new Date(),
        },
      });
      console.log(`${PREFIX} Created connector: ${connector.id}`);
    }

    // Ensure the /query endpoint exists
    const queryEndpoint = await prisma.connectorEndpoint.findFirst({
      where: { connectorId: connector.id, method: 'POST', path: '/query' },
    });

    if (queryEndpoint) {
      console.log(`${PREFIX} Endpoint POST /query already exists`);
    } else {
      await prisma.connectorEndpoint.create({
        data: {
          connectorId: connector.id,
          name: 'query',
          description: 'Execute a SELECT query (dynamic, consumer sends raw SQL)',
          method: 'POST',
          path: '/query',
          upstreamPath: '/',
          upstreamContentType: 'text/plain',
          bodyTransform: 'passthrough',
          bodyBlacklist: ['DROP', 'DELETE', 'INSERT', 'UPDATE', 'ALTER', 'CREATE', 'TRUNCATE'],
          bodyPattern: '^\\s*[Ss][Ee][Ll][Ee][Cc][Tt]\\b',
          timeout: 30000,
        },
      });
      console.log(`${PREFIX} Created endpoint POST /query`);
    }

    // Publish if still draft
    if (connector.status !== 'published') {
      await prisma.serviceConnector.update({
        where: { id: connector.id },
        data: { status: 'published', publishedAt: new Date() },
      });
      console.log(`${PREFIX} Published connector`);
    }

    // Store ClickHouse credentials in SecretVault
    const actualScope = `personal:${connector.ownerUserId}`;
    const scopeForSecrets = actualScope;

    const vaultKey = `gw:${scopeForSecrets}:${CONNECTOR_SLUG}:username`;
    const existingSecret = await (prisma as any).secretVault.findUnique({ where: { key: vaultKey } });

    if (existingSecret) {
      console.log(`${PREFIX} SecretVault credentials already exist — updating`);
    }

    // Always upsert to ensure credentials match current env vars
    const { encryptedValue: encUser, iv: ivUser } = encrypt(username);
    await (prisma as any).secretVault.upsert({
      where: { key: `gw:${scopeForSecrets}:${CONNECTOR_SLUG}:username` },
      update: { encryptedValue: encUser, iv: ivUser, updatedAt: new Date() },
      create: {
        key: `gw:${scopeForSecrets}:${CONNECTOR_SLUG}:username`,
        encryptedValue: encUser,
        iv: ivUser,
        scope: scopeForSecrets,
        createdBy: 'system',
      },
    });

    const { encryptedValue: encPass, iv: ivPass } = encrypt(password);
    await (prisma as any).secretVault.upsert({
      where: { key: `gw:${scopeForSecrets}:${CONNECTOR_SLUG}:password` },
      update: { encryptedValue: encPass, iv: ivPass, updatedAt: new Date() },
      create: {
        key: `gw:${scopeForSecrets}:${CONNECTOR_SLUG}:password`,
        encryptedValue: encPass,
        iv: ivPass,
        scope: scopeForSecrets,
        createdBy: 'system',
      },
    });

    console.log(`${PREFIX} SecretVault credentials stored (scope: ${scopeForSecrets})`);
    console.log(`${PREFIX} Done.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`${PREFIX} Failed:`, err.message || err);
  process.exit(1);
});
