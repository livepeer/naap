/**
 * Seed Script: Public Connectors (Daydream, Livepeer Studio, Gemini)
 *
 * Run after `start.sh --all` to:
 *   1. Authenticate as admin dev user
 *   2. Create 3 public connectors with endpoints, plans, and API keys
 *   3. Optionally provision upstream API keys via environment variables
 *
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   npx tsx bin/seed-public-connectors.ts
 *
 * Optional env vars for upstream secrets:
 *   DAYDREAM_API_KEY=dd_xxx
 *   LIVEPEER_STUDIO_API_KEY=lp_xxx
 *   GEMINI_API_KEY=AIza_xxx
 */

import { PrismaClient } from '../packages/database/src/generated/client/index.js';

const SHELL_URL = process.env.SHELL_URL || 'http://localhost:3000';
const BASE_SVC_URL = process.env.BASE_SVC_URL || 'http://localhost:4000';
const AUTH_EMAIL = process.env.AUTH_EMAIL || 'admin@livepeer.org';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'livepeer';

interface ConnectorDef {
  slug: string;
  displayName: string;
  description: string;
  upstreamBaseUrl: string;
  allowedHosts: string[];
  defaultTimeout: number;
  authType: string;
  authConfig: Record<string, unknown>;
  secretRefs: string[];
  streamingEnabled: boolean;
  responseWrapper?: boolean;
  tags: string[];
  envKey: string;
  endpoints: EndpointDef[];
}

interface EndpointDef {
  name: string;
  description: string;
  method: string;
  path: string;
  upstreamPath: string;
  rateLimit?: number;
  timeout?: number;
  cacheTtl?: number;
  bodyTransform?: string;
  upstreamContentType?: string;
}

// ── Connector Definitions ──────────────────────────────────────────────────

const CONNECTORS: ConnectorDef[] = [
  {
    slug: 'daydream',
    displayName: 'Daydream API',
    description: 'Daydream.live streaming API — create and manage AI-powered live streams',
    upstreamBaseUrl: 'https://api.daydream.live',
    allowedHosts: ['api.daydream.live'],
    defaultTimeout: 30000,
    authType: 'bearer',
    authConfig: { tokenRef: 'token' },
    secretRefs: ['token'],
    streamingEnabled: true,
    tags: ['daydream', 'streaming', 'ai', 'live'],
    envKey: 'DAYDREAM_API_KEY',
    endpoints: [
      { name: 'create-stream', description: 'Create a new live stream', method: 'POST', path: '/streams', upstreamPath: '/v1/streams', rateLimit: 20, timeout: 10000 },
      { name: 'get-stream', description: 'Get stream details', method: 'GET', path: '/streams/:id', upstreamPath: '/v1/streams/:id', rateLimit: 100, timeout: 5000, cacheTtl: 30 },
      { name: 'update-stream', description: 'Update stream parameters', method: 'PATCH', path: '/streams/:id', upstreamPath: '/v1/streams/:id', rateLimit: 50, timeout: 10000 },
      { name: 'update-prompt', description: 'Update stream AI prompt', method: 'PUT', path: '/streams/:id/prompt', upstreamPath: '/v1/streams/:id/prompt', rateLimit: 30, timeout: 10000 },
      { name: 'delete-stream', description: 'Delete a stream', method: 'DELETE', path: '/streams/:id', upstreamPath: '/v1/streams/:id', rateLimit: 20, timeout: 5000 },
      { name: 'list-models', description: 'List available AI models', method: 'GET', path: '/models', upstreamPath: '/v1/models', rateLimit: 100, timeout: 5000, cacheTtl: 300 },
    ],
  },
  {
    slug: 'livepeer-studio',
    displayName: 'Livepeer Studio API',
    description: 'Livepeer Studio — video streaming, transcoding, and AI generation APIs',
    upstreamBaseUrl: 'https://livepeer.studio/api',
    allowedHosts: ['livepeer.studio'],
    defaultTimeout: 30000,
    authType: 'bearer',
    authConfig: { tokenRef: 'token' },
    secretRefs: ['token'],
    streamingEnabled: false,
    tags: ['livepeer', 'studio', 'video', 'streaming', 'ai'],
    envKey: 'LIVEPEER_STUDIO_API_KEY',
    endpoints: [
      { name: 'list-streams', description: 'List all streams', method: 'GET', path: '/streams', upstreamPath: '/stream', rateLimit: 100, timeout: 10000, cacheTtl: 30 },
      { name: 'create-stream', description: 'Create a new stream', method: 'POST', path: '/streams', upstreamPath: '/stream', rateLimit: 20, timeout: 10000 },
      { name: 'get-stream', description: 'Get stream by ID', method: 'GET', path: '/streams/:id', upstreamPath: '/stream/:id', rateLimit: 200, timeout: 5000, cacheTtl: 15 },
      { name: 'delete-stream', description: 'Delete a stream', method: 'DELETE', path: '/streams/:id', upstreamPath: '/stream/:id', rateLimit: 20, timeout: 5000 },
      { name: 'list-assets', description: 'List all assets', method: 'GET', path: '/assets', upstreamPath: '/asset', rateLimit: 100, timeout: 10000, cacheTtl: 30 },
      { name: 'upload-asset-url', description: 'Upload asset from URL', method: 'POST', path: '/assets/upload/url', upstreamPath: '/asset/upload/url', rateLimit: 10, timeout: 30000 },
      { name: 'get-asset', description: 'Get asset by ID', method: 'GET', path: '/assets/:id', upstreamPath: '/asset/:id', rateLimit: 200, timeout: 5000, cacheTtl: 15 },
      { name: 'text-to-image', description: 'Generate image from text prompt', method: 'POST', path: '/generate/text-to-image', upstreamPath: '/generate/text-to-image', rateLimit: 10, timeout: 60000 },
      { name: 'image-to-video', description: 'Generate video from image', method: 'POST', path: '/generate/image-to-video', upstreamPath: '/generate/image-to-video', rateLimit: 5, timeout: 60000 },
    ],
  },
  {
    slug: 'gemini',
    displayName: 'Google Gemini API',
    description: 'Google Gemini generative AI — chat, embeddings, and model listing',
    upstreamBaseUrl: 'https://generativelanguage.googleapis.com',
    allowedHosts: ['generativelanguage.googleapis.com'],
    defaultTimeout: 60000,
    authType: 'query',
    authConfig: { paramName: 'key', secretRef: 'token' },
    secretRefs: ['token'],
    streamingEnabled: true,
    tags: ['google', 'gemini', 'ai', 'llm', 'generative'],
    envKey: 'GEMINI_API_KEY',
    endpoints: [
      { name: 'list-models', description: 'List available Gemini models', method: 'GET', path: '/models', upstreamPath: '/v1beta/models', rateLimit: 100, timeout: 5000, cacheTtl: 300 },
      { name: 'generate-content', description: 'Generate content with Gemini', method: 'POST', path: '/chat', upstreamPath: '/v1beta/models/gemini-2.0-flash:generateContent', rateLimit: 30, timeout: 30000 },
      { name: 'embed-content', description: 'Generate text embeddings', method: 'POST', path: '/embeddings', upstreamPath: '/v1beta/models/text-embedding-004:embedContent', rateLimit: 50, timeout: 15000 },
      { name: 'stream-chat', description: 'Stream chat response (SSE)', method: 'POST', path: '/stream-chat', upstreamPath: '/v1beta/models/gemini-2.0-flash:streamGenerateContent', rateLimit: 20, timeout: 60000 },
    ],
  },
  {
    slug: 'storj-s3',
    displayName: 'Storj S3 Object Storage',
    description: 'Storj decentralized S3-compatible object storage — buckets, objects, multipart uploads',
    upstreamBaseUrl: 'https://gateway.storjshare.io',
    allowedHosts: ['gateway.storjshare.io'],
    defaultTimeout: 30000,
    authType: 'aws-s3',
    authConfig: { accessKeyRef: 'access_key', secretKeyRef: 'secret_key', region: 'us-1', service: 's3', signPayload: false, pathStyle: true },
    secretRefs: ['access_key', 'secret_key'],
    streamingEnabled: false,
    responseWrapper: false,
    tags: ['storj', 's3', 'object-storage', 'decentralized'],
    envKey: 'STORJ_ACCESS_KEY',
    endpoints: [
      { name: 'list-buckets', description: 'List all buckets', method: 'GET', path: '/', upstreamPath: '/', rateLimit: 100, timeout: 10000, bodyTransform: 'passthrough', upstreamContentType: '' },
      { name: 'create-bucket', description: 'Create a bucket', method: 'PUT', path: '/:bucket', upstreamPath: '/:bucket', rateLimit: 10, timeout: 10000, bodyTransform: 'binary', upstreamContentType: '' },
      { name: 'delete-bucket', description: 'Delete a bucket', method: 'DELETE', path: '/:bucket', upstreamPath: '/:bucket', rateLimit: 10, timeout: 10000, bodyTransform: 'passthrough', upstreamContentType: '' },
      { name: 'head-bucket', description: 'Check bucket existence', method: 'HEAD', path: '/:bucket', upstreamPath: '/:bucket', rateLimit: 200, timeout: 5000, bodyTransform: 'passthrough', upstreamContentType: '' },
      { name: 'list-objects', description: 'List objects in a bucket', method: 'GET', path: '/:bucket', upstreamPath: '/:bucket', rateLimit: 100, timeout: 15000, bodyTransform: 'passthrough', upstreamContentType: '' },
      { name: 'put-object', description: 'Upload object / upload part', method: 'PUT', path: '/:bucket/:key*', upstreamPath: '/:bucket/:key*', rateLimit: 50, timeout: 60000, bodyTransform: 'binary', upstreamContentType: '' },
      { name: 'get-object', description: 'Download an object', method: 'GET', path: '/:bucket/:key*', upstreamPath: '/:bucket/:key*', rateLimit: 200, timeout: 30000, bodyTransform: 'passthrough', upstreamContentType: '' },
      { name: 'delete-object', description: 'Delete an object or abort multipart upload', method: 'DELETE', path: '/:bucket/:key*', upstreamPath: '/:bucket/:key*', rateLimit: 50, timeout: 10000, bodyTransform: 'passthrough', upstreamContentType: '' },
      { name: 'head-object', description: 'Get object metadata', method: 'HEAD', path: '/:bucket/:key*', upstreamPath: '/:bucket/:key*', rateLimit: 200, timeout: 5000, bodyTransform: 'passthrough', upstreamContentType: '' },
      { name: 'post-object', description: 'Create/complete multipart upload', method: 'POST', path: '/:bucket/:key*', upstreamPath: '/:bucket/:key*', rateLimit: 30, timeout: 30000, bodyTransform: 'binary', upstreamContentType: '' },
      { name: 'post-bucket', description: 'Batch delete objects', method: 'POST', path: '/:bucket', upstreamPath: '/:bucket', rateLimit: 20, timeout: 30000, bodyTransform: 'binary', upstreamContentType: '' },
    ],
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────

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

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n  Public Connectors — Seed Script\n');

  // Step 1: Authenticate
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

  // Step 2: Initialize DB
  step(2, 'Initializing database client');
  const prisma = new PrismaClient();

  // Step 3: Create connectors
  let connectorIndex = 0;
  for (const def of CONNECTORS) {
    connectorIndex++;
    step(2 + connectorIndex, `Creating connector: ${def.displayName}`);

    let connector = await prisma.serviceConnector.findFirst({
      where: { slug: def.slug, visibility: 'public' },
    });

    if (connector) {
      console.log(`  Connector already exists: ${connector.id}`);
    } else {
      connector = await prisma.serviceConnector.create({
        data: {
          ownerUserId: userId,
          createdBy: userId,
          slug: def.slug,
          displayName: def.displayName,
          description: def.description,
          visibility: 'public',
          upstreamBaseUrl: def.upstreamBaseUrl,
          allowedHosts: def.allowedHosts,
          defaultTimeout: def.defaultTimeout,
          authType: def.authType,
          authConfig: def.authConfig,
          secretRefs: def.secretRefs,
          streamingEnabled: def.streamingEnabled,
          responseWrapper: def.responseWrapper ?? true,
          tags: def.tags,
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
    const planName = `${def.slug}-standard`;
    let plan = await prisma.gatewayPlan.findFirst({
      where: { ownerUserId: userId, name: planName },
    });
    if (!plan) {
      plan = await prisma.gatewayPlan.create({
        data: {
          ownerUserId: userId,
          name: planName,
          displayName: `${def.displayName} Standard`,
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
      where: { ownerUserId: userId, name: `${def.slug}-test-key`, status: 'active' },
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
          name: `${def.slug}-test-key`,
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
    const envValue = process.env[def.envKey];
    if (envValue) {
      for (const ref of def.secretRefs) {
        const ok = await storeUpstreamSecret(scopeId, def.slug, ref, envValue, token);
        console.log(`  Secret "${ref}": ${ok ? 'stored' : 'FAILED to store'}`);
      }
    } else {
      console.log(`  Secret: ${def.envKey} not set — configure via Settings tab UI`);
    }
  }

  await prisma.$disconnect();

  // Summary
  console.log('\n' + '='.repeat(62));
  console.log('  Public Connectors — Seed Complete');
  console.log('='.repeat(62));
  console.log();
  for (const def of CONNECTORS) {
    console.log(`  ${def.displayName} (/${def.slug})`);
    for (const ep of def.endpoints) {
      console.log(`    ${ep.method.padEnd(6)} ${SHELL_URL}/api/v1/gw/${def.slug}${ep.path}`);
    }
    console.log();
  }
  console.log('  To configure upstream API keys, use the Settings tab in the Service Gateway UI.');
  console.log();
}

main().catch((err) => {
  console.error('\n  Seed failed:', err.message || err);
  process.exit(1);
});
