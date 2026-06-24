/**
 * Build-Time Gateway Connector Seed
 *
 * Seeds gateway connectors (ClickHouse + Livepeer Subgraph) as public
 * ServiceConnector rows with ConnectorEndpoints and SecretVault entries.
 *
 * Designed to run during Vercel build (after prisma db push) — no running
 * app or base-svc required. Uses Prisma directly for all DB operations and
 * inline AES-256-GCM encryption for secrets.
 *
 * Idempotent — safe to run on every build. Each connector is skipped when
 * its required env vars are missing.
 *
 * Required env vars:
 *   DATABASE_URL              - Postgres connection string
 *   ENCRYPTION_KEY            - AES key for SecretVault (required on Vercel)
 *   CLICKHOUSE_QUERY_USERNAME - ClickHouse username  (for clickhouse-query)
 *   CLICKHOUSE_QUERY_PASSWORD - ClickHouse password  (for clickhouse-query)
 *   SUBGRAPH_API_KEY          - The Graph API key    (for livepeer-subgraph)
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

// ── Connector seeds ──

interface ConnectorSeed {
  slug: string;
  template: string;
  /** Maps secretRef name → env var holding the value. */
  secretMap: Record<string, string>;
  /**
   * Feature flag (FeatureFlag.key) that must be ENABLED for this connector to
   * seed. When the flag row is missing or disabled, the connector is skipped —
   * so a flag defaulting OFF means the connector simply never exists (no-op).
   * Omit to seed unconditionally (matches the pre-NAAP-5 connectors).
   */
  flag?: string;
  /**
   * Optional env var holding the upstream base URL. When set (non-empty) it
   * overrides the template's `upstreamBaseUrl` and re-derives `allowedHosts`,
   * so the upstream host is configurable per environment without code changes.
   * Falls back to `defaultBaseUrl` (then the template value) when unset.
   */
  baseUrlEnv?: string;
  /** Default base URL used when `baseUrlEnv` is unset. */
  defaultBaseUrl?: string;
}

const CONNECTOR_SEEDS: ConnectorSeed[] = [
  {
    slug: 'clickhouse-query',
    template: 'clickhouse-query.json',
    secretMap: {
      username: 'CLICKHOUSE_QUERY_USERNAME',
      password: 'CLICKHOUSE_QUERY_PASSWORD',
    },
  },
  {
    slug: 'livepeer-subgraph',
    template: 'livepeer-subgraph.json',
    secretMap: {
      'api-key': 'SUBGRAPH_API_KEY',
    },
  },
  {
    slug: 'naap-discover',
    template: 'naap-discover.json',
    secretMap: {},
  },
  {
    // NAAP-5: public connector fronting the SDK service. Gated behind the
    // `sdk_connector` flag (default OFF) so it is a no-op until enabled.
    slug: 'sdk',
    template: 'sdk.json',
    secretMap: {},
    flag: 'sdk_connector',
    baseUrlEnv: 'SDK_SERVICE_BASE_URL',
    defaultBaseUrl: 'https://sdk.daydream.monster',
  },
];

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

// ── Feature flag check (build-time, DB-direct) ──

/**
 * Read a feature flag's enabled state directly from the FeatureFlag table.
 * Mirrors `isFeatureEnabled` semantics: a missing row counts as disabled, so a
 * flag defaulting OFF means the gated connector is never seeded.
 */
async function isFlagEnabled(prisma: PrismaClient, key: string): Promise<boolean> {
  try {
    const flag = await prisma.featureFlag.findUnique({
      where: { key },
      select: { enabled: true },
    });
    return Boolean(flag?.enabled);
  } catch {
    // On any lookup error, fail closed (treat as disabled) to preserve no-op.
    return false;
  }
}

// ── Seed one connector ──

async function seedConnector(
  prisma: PrismaClient,
  seed: ConnectorSeed,
  ownerUserId: string,
): Promise<boolean> {
  const templatePath = path.resolve(
    __dirname,
    '../plugins/service-gateway/connectors',
    seed.template,
  );
  if (!fs.existsSync(templatePath)) {
    console.log(`[seed-gw] ${seed.template} not found — skipping ${seed.slug}`);
    return false;
  }

  const secrets: Record<string, string> = {};
  const missingEnvs: string[] = [];
  for (const [ref, envVar] of Object.entries(seed.secretMap)) {
    const val = (process.env[envVar] || '').trim();
    if (!val) {
      missingEnvs.push(envVar);
    } else {
      secrets[ref] = val;
    }
  }
  if (missingEnvs.length > 0) {
    console.log(
      `[seed-gw] ${seed.slug}: env var(s) missing (${missingEnvs.join(', ')}) — skipping`,
    );
    return false;
  }

  const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
  const conn = template.connector;
  const slug = conn.slug as string;

  console.log(`[seed-gw] Seeding connector: ${slug}`);

  // Resolve the upstream base URL from env (if the seed opts in), so the host
  // is configurable per environment. Falls back to the seed default, then the
  // template value. Re-derive allowedHosts from whichever base URL wins.
  if (seed.baseUrlEnv) {
    const envBaseUrl = (process.env[seed.baseUrlEnv] || '').trim();
    const resolvedBaseUrl = envBaseUrl || seed.defaultBaseUrl || conn.upstreamBaseUrl;
    if (resolvedBaseUrl && resolvedBaseUrl !== conn.upstreamBaseUrl) {
      console.log(
        `[seed-gw]   Base URL for ${slug}: ${resolvedBaseUrl}` +
          (envBaseUrl ? ` (from ${seed.baseUrlEnv})` : ' (default)'),
      );
    }
    conn.upstreamBaseUrl = resolvedBaseUrl;
    // Force re-derivation of allowedHosts from the resolved base URL host.
    conn.allowedHosts = [];
  }

  // Upsert ServiceConnector
  let allowedHosts: string[] = conn.allowedHosts || [];
  if (allowedHosts.length === 0) {
    try {
      allowedHosts = [new URL(conn.upstreamBaseUrl).hostname];
    } catch {
      /* ignore */
    }
  }

  let connector = await prisma.serviceConnector.findFirst({
    where: { slug, visibility: 'public' },
  });

  if (connector) {
    console.log(`[seed-gw]   Connector exists: ${connector.id}`);
    // Sync authConfig from template (fixes misconfigured connectors)
    const templateAuthConfig = conn.authConfig || {};
    const currentAuthConfig = (connector.authConfig as Record<string, unknown>) || {};
    if (JSON.stringify(currentAuthConfig) !== JSON.stringify(templateAuthConfig)) {
      await prisma.serviceConnector.update({
        where: { id: connector.id },
        data: { authConfig: templateAuthConfig },
      });
      console.log(`[seed-gw]   Updated authConfig for ${slug}`);
    }
    // Sync authType from template so a re-seed picks up a template change (e.g.
    // the SDK connector moving to "passthrough"). No-op when the DB value already
    // matches the template, so this never alters an unchanged connector.
    if (connector.authType !== conn.authType) {
      await prisma.serviceConnector.update({
        where: { id: connector.id },
        data: { authType: conn.authType },
      });
      console.log(`[seed-gw]   Updated authType for ${slug}: ${connector.authType} → ${conn.authType}`);
    }
    // For env-sourced connectors, keep the upstream base URL + allowedHosts in
    // sync so an env change is picked up on the next deploy (idempotent).
    if (seed.baseUrlEnv) {
      const hostsChanged =
        JSON.stringify([...connector.allowedHosts].sort()) !== JSON.stringify([...allowedHosts].sort());
      if (connector.upstreamBaseUrl !== conn.upstreamBaseUrl || hostsChanged) {
        await prisma.serviceConnector.update({
          where: { id: connector.id },
          data: { upstreamBaseUrl: conn.upstreamBaseUrl, allowedHosts },
        });
        console.log(`[seed-gw]   Updated upstreamBaseUrl/allowedHosts for ${slug}`);
      }
    }
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
    console.log(`[seed-gw]   Created connector: ${connector.id}`);
  }

  if (connector.status !== 'published') {
    await prisma.serviceConnector.update({
      where: { id: connector.id },
      data: { status: 'published', publishedAt: new Date() },
    });
    console.log(`[seed-gw]   Published connector`);
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
    console.log(`[seed-gw]   Endpoint: ${ep.method} ${ep.path}`);
  }

  // Store secrets in SecretVault
  const scopeId = `personal:${actualOwnerId}`;
  for (const [ref, value] of Object.entries(secrets)) {
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
    console.log(`[seed-gw]   Secret "${ref}": stored`);
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
    console.log(`[seed-gw]   Plan created: ${planName}`);
  }

  console.log(`[seed-gw] Done — ${slug} connector is ready`);
  return true;
}

// ── Main ──

async function main() {
  console.log('[seed-gw] Seeding gateway connectors (ClickHouse + Subgraph + Discovery)...');

  const prisma = new PrismaClient();

  try {
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

    let seeded = 0;
    for (const seed of CONNECTOR_SEEDS) {
      // Flag-gated connectors only seed when their FeatureFlag is enabled.
      // Missing row or disabled => skip (a flag defaulting OFF is a no-op).
      if (seed.flag) {
        const enabled = await isFlagEnabled(prisma, seed.flag);
        if (!enabled) {
          console.log(`[seed-gw] ${seed.slug}: flag "${seed.flag}" disabled — skipping`);
          continue;
        }
        console.log(`[seed-gw] ${seed.slug}: flag "${seed.flag}" enabled`);
      }
      const ok = await seedConnector(prisma, seed, ownerUserId);
      if (ok) seeded++;
    }

    console.log(`[seed-gw] Finished — ${seeded}/${CONNECTOR_SEEDS.length} connectors seeded`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[seed-gw] Failed:', err.message || err);
  process.exit(1);
});
