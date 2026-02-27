/**
 * Seed Script: Public Connectors
 *
 * Reads connector templates from plugins/service-gateway/connectors/*.json
 * and creates them as public connectors with endpoints, plans, and API keys.
 *
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   npx tsx bin/seed-public-connectors.ts
 *
 * Optional env vars for upstream secrets (set any you have):
 *   DAYDREAM_API_KEY, LIVEPEER_STUDIO_API_KEY, GEMINI_API_KEY,
 *   STORJ_ACCESS_KEY, OPENAI_API_KEY, STRIPE_SECRET_KEY,
 *   CONFLUENT_KAFKA_API_KEY, CLICKHOUSE_API_KEY, SUPABASE_ANON_KEY,
 *   TWILIO_AUTH_TOKEN, CLOUDFLARE_API_TOKEN, RESEND_API_KEY,
 *   PINECONE_API_KEY, NEON_API_KEY, UPSTASH_REDIS_TOKEN,
 *   BLOB_READ_WRITE_TOKEN
 */

import { PrismaClient } from '../packages/database/src/generated/client/index.js';
import { loadConnectorTemplates, type ConnectorTemplate } from '../plugins/service-gateway/connectors/loader.js';

const SHELL_URL = process.env.SHELL_URL || 'http://localhost:3000';
const BASE_SVC_URL = process.env.BASE_SVC_URL || 'http://localhost:4000';
const AUTH_EMAIL = process.env.AUTH_EMAIL || 'admin@livepeer.org';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'livepeer';

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function step(n: number, msg: string) {
  console.log(`\n[${'='.repeat(60)}]`);
  console.log(`  Step ${n}: ${msg}`);
  console.log(`[${'='.repeat(60)}]`);
}

async function storeUpstreamSecret(
  scopeId: string,
  connectorSlug: string,
  name: string,
  value: string,
  authToken: string
): Promise<boolean> {
  const key = `gw:${scopeId}:${connectorSlug}:${name}`;
  try {
    const res = await fetch(`${BASE_SVC_URL}/api/secrets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
        'x-internal-service': 'service-gateway',
      },
      body: JSON.stringify({ key, value }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const templates = loadConnectorTemplates();

  console.log('\n  Public Connectors — Seed Script');
  console.log(`  ${templates.length} connectors loaded from JSON templates\n`);

  step(1, 'Authenticating as dev user');
  const loginRes = await fetch(`${SHELL_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: AUTH_EMAIL, password: AUTH_PASSWORD }),
  });

  if (!loginRes.ok) {
    throw new Error(`Login failed (${loginRes.status}). Is start.sh --all running?`);
  }

  const loginData = await loginRes.json() as {
    data: { token: string; user: { id: string; displayName: string } };
  };
  const token = loginData.data.token;
  const userId = loginData.data.user.id;
  const scopeId = `personal:${userId}`;
  console.log(`  Authenticated as ${loginData.data.user.displayName} (${AUTH_EMAIL})`);

  step(2, 'Initializing database client');
  const prisma = new PrismaClient();

  let connectorIndex = 0;
  for (const def of templates) {
    connectorIndex++;
    step(2 + connectorIndex, `[${connectorIndex}/${templates.length}] ${def.name}`);

    const conn = def.connector;
    const slug = conn.slug;

    let connector = await prisma.serviceConnector.findFirst({
      where: { slug, visibility: 'public' },
    });

    if (connector) {
      console.log(`  Connector already exists: ${connector.id}`);
      if (connector.category !== def.category) {
        await prisma.serviceConnector.update({
          where: { id: connector.id },
          data: { category: def.category },
        });
        console.log(`  Updated category: ${def.category}`);
      }
    } else {
      let allowedHosts = conn.allowedHosts || [];
      if (allowedHosts.length === 0) {
        try {
          allowedHosts = [new URL(conn.upstreamBaseUrl).hostname];
        } catch { /* ignore */ }
      }

      connector = await prisma.serviceConnector.create({
        data: {
          ownerUserId: userId,
          createdBy: userId,
          slug,
          displayName: conn.displayName,
          description: conn.description || def.description,
          category: def.category,
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
          status: 'draft',
        },
      });
      console.log(`  Created connector: ${connector.id}`);
    }

    const connectorId = connector.id;

    // Endpoints
    const existingEps = await prisma.connectorEndpoint.findMany({
      where: { connectorId },
      select: { path: true, method: true },
    });
    const existingSet = new Set(existingEps.map(e => `${e.method}:${e.path}`));

    for (const ep of def.endpoints) {
      if (existingSet.has(`${ep.method}:${ep.path}`)) {
        console.log(`  Endpoint exists: ${ep.method} ${ep.path}`);
        continue;
      }
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
          rateLimit: ep.rateLimit,
          timeout: ep.timeout,
          cacheTtl: ep.cacheTtl,
          retries: ep.retries ?? 0,
          bodyBlacklist: ep.bodyBlacklist ?? [],
          bodyPattern: ep.bodyPattern ?? null,
        },
      });
      console.log(`  Endpoint: ${ep.method} ${ep.path} -> ${ep.upstreamPath}`);
    }

    // Publish
    if (connector.status !== 'published') {
      await prisma.serviceConnector.update({
        where: { id: connectorId },
        data: { status: 'published', publishedAt: new Date() },
      });
      console.log('  Published');
    }

    // Plan
    const planName = `${slug}-standard`;
    let plan = await prisma.gatewayPlan.findFirst({
      where: { ownerUserId: userId, name: planName },
    });
    if (!plan) {
      plan = await prisma.gatewayPlan.create({
        data: {
          ownerUserId: userId,
          name: planName,
          displayName: `${conn.displayName} Standard`,
          rateLimit: 60,
          dailyQuota: 1000,
        },
      });
      console.log(`  Plan created: ${plan.id}`);
    } else {
      console.log(`  Plan exists: ${plan.id}`);
    }

    // API Key
    const existingKey = await prisma.gatewayApiKey.findFirst({
      where: { ownerUserId: userId, name: `${slug}-test-key`, status: 'active' },
    });
    if (!existingKey) {
      const crypto = await import('crypto');
      const rawKey = `gk_${crypto.randomBytes(24).toString('hex')}`;
      const hash = crypto.createHash('sha256').update(rawKey).digest('hex');

      await prisma.gatewayApiKey.create({
        data: {
          ownerUserId: userId,
          createdBy: userId,
          connectorId,
          planId: plan.id,
          name: `${slug}-test-key`,
          keyHash: hash,
          keyPrefix: rawKey.slice(0, 8),
          status: 'active',
        },
      });
      console.log(`  API key: ${rawKey.slice(0, 8)}... (full: ${rawKey})`);
    } else {
      console.log(`  API key exists: ${existingKey.keyPrefix}...`);
    }

    // Upstream secret
    if (def.envKey) {
      const envValue = process.env[def.envKey];
      if (envValue) {
        for (const ref of conn.secretRefs) {
          const ok = await storeUpstreamSecret(scopeId, slug, ref, envValue, token);
          console.log(`  Secret "${ref}": ${ok ? 'stored' : 'FAILED to store'}`);
        }
      } else {
        console.log(`  Secret: ${def.envKey} not set — configure via Settings tab UI`);
      }
    }
  }

  await prisma.$disconnect();

  // Summary
  console.log('\n' + '='.repeat(62));
  console.log(`  Public Connectors — Seed Complete (${templates.length} connectors)`);
  console.log('='.repeat(62));

  console.log();
  for (const def of templates) {
    const epCount = def.endpoints.length;
    const auth = def.connector.authType === 'none' ? 'no auth' : def.connector.authType;
    console.log(`  ${def.name} (/${def.connector.slug}) — ${epCount} endpoints, ${auth}`);
  }

  console.log();
  console.log('  To configure upstream API keys, use the Settings tab in the Service Gateway UI.');
  console.log(`  Or set env vars and re-run: npx tsx bin/seed-public-connectors.ts`);
  console.log();
}

main().catch((err) => {
  console.error('\n  Seed failed:', err.message || err);
  process.exit(1);
});
