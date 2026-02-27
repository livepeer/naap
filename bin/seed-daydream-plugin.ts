/**
 * Seed Script: Daydream Video Plugin (Gateway-backed)
 *
 * Registers the refactored daydream-video plugin in the marketplace,
 * installs it for developer@livepeer.org, and creates a gateway API key
 * scoped to the daydream connector.
 *
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   npx tsx bin/seed-daydream-plugin.ts
 */

import { createHash, randomBytes } from 'crypto';
import { PrismaClient } from '../packages/database/src/generated/client/index.js';

const SHELL_URL = process.env.SHELL_URL || 'http://localhost:3000';
const DEV_EMAIL = 'developer@livepeer.org';
const DEV_PASSWORD = 'livepeer';

const PLUGIN_NAME = 'daydream-video';
const PLUGIN_VERSION = '1.0.3';
const BUNDLE_URL = `/cdn/plugins/${PLUGIN_NAME}/${PLUGIN_VERSION}/${PLUGIN_NAME}.js`;

function step(n: number, msg: string) {
  console.log(`\n[${'='.repeat(60)}]`);
  console.log(`  Step ${n}: ${msg}`);
  console.log(`[${'='.repeat(60)}]`);
}

async function main() {
  console.log('\n  Daydream Video Plugin — Seed Script\n');

  const prisma = new PrismaClient();

  // ── Step 1: Authenticate as developer user ─────────────────────────────

  step(1, `Authenticating as ${DEV_EMAIL}`);

  const loginRes = await fetch(`${SHELL_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: DEV_EMAIL, password: DEV_PASSWORD }),
  });

  if (!loginRes.ok) {
    throw new Error(`Login failed (${loginRes.status}). Is start.sh --all running?`);
  }

  const loginData = (await loginRes.json()) as {
    data: { token: string; user: { id: string; displayName: string } };
  };
  const userId = loginData.data.user.id;
  console.log(`  Authenticated as ${loginData.data.user.displayName} (${userId})`);

  // ── Step 2: Register WorkflowPlugin ────────────────────────────────────

  step(2, 'Registering WorkflowPlugin');

  await prisma.workflowPlugin.upsert({
    where: { name: PLUGIN_NAME },
    update: {
      displayName: 'Daydream AI Video',
      version: PLUGIN_VERSION,
      routes: ['/daydream', '/daydream/*'],
      enabled: true,
      icon: 'Video',
      bundleUrl: BUNDLE_URL,
    },
    create: {
      name: PLUGIN_NAME,
      displayName: 'Daydream AI Video',
      version: PLUGIN_VERSION,
      remoteUrl: BUNDLE_URL,
      bundleUrl: BUNDLE_URL,
      globalName: 'NaapPluginDaydreamVideo',
      deploymentType: 'cdn',
      routes: ['/daydream', '/daydream/*'],
      enabled: true,
      order: 50,
      icon: 'Video',
      metadata: {
        category: 'media',
        description: 'Real-time AI video transformation via Daydream.live — routes through Service Gateway',
      },
    },
  });
  console.log(`  WorkflowPlugin: ${PLUGIN_NAME} -> /daydream`);

  // ── Step 3: Marketplace listing ────────────────────────────────────────

  step(3, 'Creating PluginPackage + PluginVersion + PluginDeployment');

  const pkg = await prisma.pluginPackage.upsert({
    where: { name: PLUGIN_NAME },
    update: {
      displayName: 'Daydream AI Video',
      description: 'Real-time AI video transformation via Daydream.live — routes through Service Gateway',
      category: 'media',
      publishStatus: 'published',
    },
    create: {
      name: PLUGIN_NAME,
      displayName: 'Daydream AI Video',
      description: 'Real-time AI video transformation via Daydream.live — routes through Service Gateway',
      category: 'media',
      author: 'NAAP Examples',
      authorEmail: 'examples@naap.dev',
      license: 'MIT',
      keywords: ['video', 'ai', 'streaming', 'webrtc', 'daydream'],
      icon: 'Video',
      isCore: false,
      publishStatus: 'published',
    },
  });
  console.log(`  PluginPackage: ${pkg.id}`);

  const ver = await prisma.pluginVersion.upsert({
    where: { packageId_version: { packageId: pkg.id, version: PLUGIN_VERSION } },
    update: {
      frontendUrl: BUNDLE_URL,
      manifest: {
        name: PLUGIN_NAME,
        displayName: 'Daydream AI Video',
        version: PLUGIN_VERSION,
        description: 'Real-time AI video transformation via Daydream.live',
        category: 'media',
        icon: 'Video',
      },
    },
    create: {
      packageId: pkg.id,
      version: PLUGIN_VERSION,
      frontendUrl: BUNDLE_URL,
      manifest: {
        name: PLUGIN_NAME,
        displayName: 'Daydream AI Video',
        version: PLUGIN_VERSION,
        description: 'Real-time AI video transformation via Daydream.live',
        category: 'media',
        icon: 'Video',
      },
    },
  });
  console.log(`  PluginVersion: ${ver.id}`);

  const deployment = await prisma.pluginDeployment.upsert({
    where: { packageId: pkg.id },
    update: {
      versionId: ver.id,
      status: 'running',
      frontendUrl: BUNDLE_URL,
      deployedAt: new Date(),
      healthStatus: 'healthy',
    },
    create: {
      packageId: pkg.id,
      versionId: ver.id,
      status: 'running',
      frontendUrl: BUNDLE_URL,
      deployedAt: new Date(),
      healthStatus: 'healthy',
      activeInstalls: 0,
    },
  });
  console.log(`  PluginDeployment: ${deployment.id}`);

  // ── Step 4: Install for developer user ─────────────────────────────────

  step(4, `Installing for ${DEV_EMAIL}`);

  const existing = await prisma.tenantPluginInstall.findUnique({
    where: { userId_deploymentId: { userId, deploymentId: deployment.id } },
  });
  if (!existing) {
    await prisma.tenantPluginInstall.create({
      data: {
        userId,
        deploymentId: deployment.id,
        status: 'active',
        enabled: true,
        order: 0,
        installedAt: new Date(),
      },
    });
    console.log(`  TenantPluginInstall: created`);
  } else {
    console.log(`  TenantPluginInstall: already exists`);
  }

  await prisma.userPluginPreference.upsert({
    where: { userId_pluginName: { userId, pluginName: PLUGIN_NAME } },
    update: { enabled: true },
    create: {
      userId,
      pluginName: PLUGIN_NAME,
      enabled: true,
      pinned: false,
      order: 50,
    },
  });
  console.log(`  UserPluginPreference: enabled`);

  const activeCount = await prisma.tenantPluginInstall.count({
    where: { deploymentId: deployment.id, status: 'active' },
  });
  await prisma.pluginDeployment.update({
    where: { id: deployment.id },
    data: { activeInstalls: activeCount },
  });

  // ── Step 5: Create Gateway API Key for daydream connector ──────────────

  step(5, 'Creating gateway API key for daydream connector');

  const connector = await prisma.serviceConnector.findFirst({
    where: { slug: 'daydream', visibility: 'public' },
  });
  if (!connector) {
    throw new Error('Daydream connector not found. Run seed-public-connectors.ts first.');
  }
  console.log(`  Connector: ${connector.id} (${connector.displayName})`);

  const planName = 'daydream-dev-plan';
  let plan = await prisma.gatewayPlan.findFirst({
    where: { ownerUserId: userId, name: planName },
  });
  if (!plan) {
    plan = await prisma.gatewayPlan.create({
      data: {
        ownerUserId: userId,
        name: planName,
        displayName: 'Daydream Developer Plan',
        rateLimit: 60,
        dailyQuota: 1000,
      },
    });
    console.log(`  Plan created: ${plan.id}`);
  } else {
    console.log(`  Plan exists: ${plan.id}`);
  }

  const existingKey = await prisma.gatewayApiKey.findFirst({
    where: { connectorId: connector.id, ownerUserId: userId, status: 'active' },
  });

  let rawKey: string | null = null;
  if (existingKey) {
    console.log(`  API key already exists: ${existingKey.keyPrefix}...`);
  } else {
    rawKey = `gk_${randomBytes(24).toString('hex')}`;
    const hash = createHash('sha256').update(rawKey).digest('hex');
    await prisma.gatewayApiKey.create({
      data: {
        ownerUserId: userId,
        createdBy: userId,
        connectorId: connector.id,
        planId: plan.id,
        name: `daydream-dev-key`,
        keyHash: hash,
        keyPrefix: rawKey.slice(0, 8),
        status: 'active',
      },
    });
    console.log(`  API key created: ${rawKey.slice(0, 8)}...`);
  }

  await prisma.$disconnect();

  // ── Summary ────────────────────────────────────────────────────────────

  console.log('\n' + '='.repeat(62));
  console.log('  Daydream Video Plugin — Seed Complete');
  console.log('='.repeat(62));
  console.log();
  console.log(`  Plugin: ${PLUGIN_NAME} v${PLUGIN_VERSION}`);
  console.log(`  Bundle: ${BUNDLE_URL}`);
  console.log(`  Routes: /daydream, /daydream/*`);
  console.log(`  Installed for: ${DEV_EMAIL} (${userId})`);
  console.log();
  console.log('  Gateway endpoints:');
  console.log(`    POST   ${SHELL_URL}/api/v1/gw/daydream/streams`);
  console.log(`    GET    ${SHELL_URL}/api/v1/gw/daydream/streams/:id`);
  console.log(`    PATCH  ${SHELL_URL}/api/v1/gw/daydream/streams/:id`);
  console.log(`    DELETE ${SHELL_URL}/api/v1/gw/daydream/streams/:id`);
  console.log(`    GET    ${SHELL_URL}/api/v1/gw/daydream/models`);
  console.log(`    POST   ${SHELL_URL}/api/v1/gw/daydream-whip (WHIP SDP proxy)`);
  console.log();

  if (rawKey) {
    console.log('  Gateway API Key (save this — shown only once):');
    console.log(`    ${rawKey.slice(0, 11)}${'*'.repeat(rawKey.length - 11)}`);
    console.log();
    console.log('  Quick test:');
    console.log(`    curl -H "Authorization: Bearer <YOUR_API_KEY>" \\`);
    console.log(`         ${SHELL_URL}/api/v1/gw/daydream/models`);
  } else {
    console.log('  API key was created in a previous run (raw key not available).');
    console.log('  Use JWT auth or create a new key via the Service Gateway UI.');
  }

  console.log();
  console.log(`  To test: log in as ${DEV_EMAIL} (password: livepeer)`);
  console.log('  Navigate to /daydream in the NaaP UI');
  console.log();
}

main().catch((err) => {
  console.error('\nSeed failed:', err.message || err);
  process.exit(1);
});
