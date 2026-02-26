/**
 * Seed Script: Storj S3 Object Storage Connector
 *
 * Creates the Storj public connector with 11 S3 CRUD + multipart endpoints.
 * Uses the generic buildS3Endpoints helper so future S3-compatible providers
 * (R2, B2, Spaces, MinIO, AWS S3) just call the same function.
 *
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   npx tsx bin/seed-storj-connector.ts
 *
 * Optional env vars:
 *   STORJ_ACCESS_KEY=jxx3zp4gjhf2ogxtd5xado7mm3lq
 *   STORJ_SECRET_KEY=<your_secret_key>
 */

import { PrismaClient } from '../packages/database/src/generated/client/index.js';
import { encrypt } from '../apps/web-next/src/lib/gateway/encryption.js';

const SHELL_URL = process.env.SHELL_URL || 'http://localhost:3000';
const AUTH_EMAIL = process.env.AUTH_EMAIL || 'admin@livepeer.org';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'livepeer';

interface S3EndpointDef {
  name: string;
  description: string;
  method: string;
  path: string;
  upstreamPath: string;
  bodyTransform: string;
  upstreamContentType: string;
  rateLimit: number;
  timeout: number;
}

/**
 * Build the standard 11 S3 CRUD + multipart endpoints.
 * Reusable for any S3-compatible provider.
 */
function buildS3Endpoints(opts?: { rateMultiplier?: number }): S3EndpointDef[] {
  const m = opts?.rateMultiplier ?? 1.0;
  const rate = (base: number) => Math.round(base * m);

  return [
    { name: 'list-buckets', description: 'List all buckets', method: 'GET', path: '/', upstreamPath: '/', bodyTransform: 'passthrough', upstreamContentType: '', rateLimit: rate(100), timeout: 10000 },
    { name: 'create-bucket', description: 'Create a bucket', method: 'PUT', path: '/:bucket', upstreamPath: '/:bucket', bodyTransform: 'binary', upstreamContentType: '', rateLimit: rate(10), timeout: 10000 },
    { name: 'delete-bucket', description: 'Delete a bucket', method: 'DELETE', path: '/:bucket', upstreamPath: '/:bucket', bodyTransform: 'passthrough', upstreamContentType: '', rateLimit: rate(10), timeout: 10000 },
    { name: 'head-bucket', description: 'Check bucket existence', method: 'HEAD', path: '/:bucket', upstreamPath: '/:bucket', bodyTransform: 'passthrough', upstreamContentType: '', rateLimit: rate(200), timeout: 5000 },
    { name: 'list-objects', description: 'List objects in a bucket', method: 'GET', path: '/:bucket', upstreamPath: '/:bucket', bodyTransform: 'passthrough', upstreamContentType: '', rateLimit: rate(100), timeout: 15000 },
    { name: 'put-object', description: 'Upload object / upload part', method: 'PUT', path: '/:bucket/:key*', upstreamPath: '/:bucket/:key*', bodyTransform: 'binary', upstreamContentType: '', rateLimit: rate(50), timeout: 60000 },
    { name: 'get-object', description: 'Download an object', method: 'GET', path: '/:bucket/:key*', upstreamPath: '/:bucket/:key*', bodyTransform: 'passthrough', upstreamContentType: '', rateLimit: rate(200), timeout: 30000 },
    { name: 'delete-object', description: 'Delete an object or abort multipart upload', method: 'DELETE', path: '/:bucket/:key*', upstreamPath: '/:bucket/:key*', bodyTransform: 'passthrough', upstreamContentType: '', rateLimit: rate(50), timeout: 10000 },
    { name: 'head-object', description: 'Get object metadata', method: 'HEAD', path: '/:bucket/:key*', upstreamPath: '/:bucket/:key*', bodyTransform: 'passthrough', upstreamContentType: '', rateLimit: rate(200), timeout: 5000 },
    { name: 'post-object', description: 'Create/complete multipart upload', method: 'POST', path: '/:bucket/:key*', upstreamPath: '/:bucket/:key*', bodyTransform: 'binary', upstreamContentType: '', rateLimit: rate(30), timeout: 30000 },
    { name: 'post-bucket', description: 'Batch delete objects', method: 'POST', path: '/:bucket', upstreamPath: '/:bucket', bodyTransform: 'binary', upstreamContentType: '', rateLimit: rate(20), timeout: 30000 },
  ];
}

function step(n: number, msg: string) {
  console.log(`\n[${'='.repeat(60)}]`);
  console.log(`  Step ${n}: ${msg}`);
  console.log(`[${'='.repeat(60)}]`);
}

async function main() {
  console.log('\n  Storj S3 Connector — Seed Script\n');

  // Step 1: Authenticate
  step(1, 'Authenticating as admin user');
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
  const userId = loginData.data.user.id;
  console.log(`  Authenticated as ${loginData.data.user.displayName}`);

  // Step 2: DB client
  step(2, 'Initializing database client');
  const prisma = new PrismaClient();

  // Step 3: Create Storj connector
  step(3, 'Creating Storj S3 connector');

  const slug = 'storj-s3';
  let connector = await prisma.serviceConnector.findFirst({
    where: { slug, visibility: 'public' },
  });

  if (connector) {
    console.log(`  Connector already exists: ${connector.id}`);
  } else {
    connector = await prisma.serviceConnector.create({
      data: {
        ownerUserId: userId,
        createdBy: userId,
        slug,
        displayName: 'Storj S3 Object Storage',
        description: 'Storj decentralized S3-compatible object storage — buckets, objects, multipart uploads',
        visibility: 'public',
        upstreamBaseUrl: 'https://gateway.storjshare.io',
        allowedHosts: ['gateway.storjshare.io'],
        defaultTimeout: 30000,
        authType: 'aws-s3',
        authConfig: {
          accessKeyRef: 'access_key',
          secretKeyRef: 'secret_key',
          region: 'us-1',
          service: 's3',
          signPayload: false,
          pathStyle: true,
        },
        secretRefs: ['access_key', 'secret_key'],
        responseWrapper: false,
        streamingEnabled: false,
        tags: ['storj', 's3', 'object-storage', 'decentralized'],
        status: 'draft',
      },
    });
    console.log(`  Created connector: ${connector.id}`);
  }

  const connectorId = connector.id;

  // Step 4: Create endpoints
  step(4, 'Creating S3 endpoints');

  const endpoints = buildS3Endpoints();
  const existingEps = await prisma.connectorEndpoint.findMany({
    where: { connectorId },
    select: { path: true, method: true },
  });
  const existingSet = new Set(existingEps.map(e => `${e.method}:${e.path}`));

  for (const ep of endpoints) {
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
        upstreamContentType: ep.upstreamContentType,
        bodyTransform: ep.bodyTransform,
        rateLimit: ep.rateLimit,
        timeout: ep.timeout,
      },
    });
    console.log(`  Created: ${ep.method.padEnd(6)} ${ep.path} -> ${ep.upstreamPath}`);
  }

  // Step 5: Publish
  step(5, 'Publishing connector');
  if (connector.status !== 'published') {
    await prisma.serviceConnector.update({
      where: { id: connectorId },
      data: { status: 'published', publishedAt: new Date() },
    });
    console.log('  Published');
  } else {
    console.log('  Already published');
  }

  // Step 6: Gateway plan
  step(6, 'Creating gateway plan');
  const planName = 'storj-s3-standard';
  let plan = await prisma.gatewayPlan.findFirst({
    where: { ownerUserId: userId, name: planName },
  });
  if (!plan) {
    plan = await prisma.gatewayPlan.create({
      data: {
        ownerUserId: userId,
        name: planName,
        displayName: 'Storj S3 Standard',
        rateLimit: 100,
        dailyQuota: 10000,
      },
    });
    console.log(`  Plan created: ${plan.id}`);
  } else {
    console.log(`  Plan exists: ${plan.id}`);
  }

  // Step 7: API key
  step(7, 'Creating gateway API key');
  const existingKey = await prisma.gatewayApiKey.findFirst({
    where: { ownerUserId: userId, name: 'storj-s3-test-key', status: 'active' },
  });
  let apiKeyRaw: string | null = null;
  if (!existingKey) {
    const crypto = await import('crypto');
    apiKeyRaw = `gk_${crypto.randomBytes(24).toString('hex')}`;
    const hash = crypto.createHash('sha256').update(apiKeyRaw).digest('hex');

    await prisma.gatewayApiKey.create({
      data: {
        ownerUserId: userId,
        createdBy: userId,
        connectorId,
        planId: plan.id,
        name: 'storj-s3-test-key',
        keyHash: hash,
        keyPrefix: apiKeyRaw.slice(0, 8),
        status: 'active',
      },
    });
    console.log(`  API key: ${apiKeyRaw.slice(0, 8)}... (full: ${apiKeyRaw})`);
  } else {
    console.log(`  API key exists: ${existingKey.keyPrefix}...`);
  }

  // Step 8: Store access key secret
  step(8, 'Storing upstream secrets');
  const accessKey = process.env.STORJ_ACCESS_KEY || 'jxx3zp4gjhf2ogxtd5xado7mm3lq';
  const secretKey = process.env.STORJ_SECRET_KEY;

  const scopeId = `personal:${userId}`;

  // Store access key
  const accessSecretKey = `gw:${scopeId}:access_key`;
  const accessEncrypted = encrypt(accessKey);
  await prisma.secretVault.upsert({
    where: { key: accessSecretKey },
    create: {
      key: accessSecretKey,
      scope: scopeId,
      encryptedValue: accessEncrypted.encryptedValue,
      iv: accessEncrypted.iv,
    },
    update: {
      encryptedValue: accessEncrypted.encryptedValue,
      iv: accessEncrypted.iv,
    },
  });
  console.log(`  Access key stored: ${accessKey.slice(0, 8)}...`);

  if (secretKey) {
    const secretSecretKey = `gw:${scopeId}:secret_key`;
    const secretEncrypted = encrypt(secretKey);
    await prisma.secretVault.upsert({
      where: { key: secretSecretKey },
      create: {
        key: secretSecretKey,
        scope: scopeId,
        encryptedValue: secretEncrypted.encryptedValue,
        iv: secretEncrypted.iv,
      },
      update: {
        encryptedValue: secretEncrypted.encryptedValue,
        iv: secretEncrypted.iv,
      },
    });
    console.log(`  Secret key stored`);
  } else {
    console.log(`  Secret key not set — provide STORJ_SECRET_KEY or configure via Settings UI`);
  }

  await prisma.$disconnect();

  // Summary
  console.log('\n' + '='.repeat(62));
  console.log('  Storj S3 Connector — Seed Complete');
  console.log('='.repeat(62));
  console.log();
  console.log(`  Connector: storj-s3`);
  console.log(`  Base URL:  https://gateway.storjshare.io`);
  console.log(`  Auth:      AWS Sig V4 (region: us-1, service: s3)`);
  console.log();
  for (const ep of endpoints) {
    console.log(`  ${ep.method.padEnd(6)} ${SHELL_URL}/api/v1/gw/storj-s3${ep.path}`);
  }
  if (apiKeyRaw) {
    console.log(`\n  Test API Key: ${apiKeyRaw}`);
  }
  console.log(`\n  Configure the secret key via Settings UI or STORJ_SECRET_KEY env var.`);
  console.log();
}

main().catch((err) => {
  console.error('\n  Seed failed:', err.message || err);
  process.exit(1);
});
