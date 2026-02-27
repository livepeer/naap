/**
 * Seed Script: Intelligent Dashboard Plugin
 *
 * Run after `start.sh --all` and `seed-public-connectors.ts` to:
 *   1. Authenticate as admin
 *   2. Ensure the `gemini` and `livepeer-leaderboard` connectors exist and are published
 *   3. Configure the Gemini upstream API key in the SecretVault
 *   4. Register the intelligent-dashboard plugin (WorkflowPlugin, PluginPackage, etc.)
 *   5. Install for all users
 *
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   npx tsx bin/seed-intelligent-dashboard.ts
 */

import { PrismaClient } from '../packages/database/src/generated/client/index.js';

const SHELL_URL = process.env.SHELL_URL || 'http://localhost:3000';
const AUTH_EMAIL = process.env.AUTH_EMAIL || 'admin@livepeer.org';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'livepeer';

const PLUGIN_NAME = 'intelligent-dashboard';
const PLUGIN_VERSION = '1.0.0';
const BUNDLE_URL = `/cdn/plugins/${PLUGIN_NAME}/${PLUGIN_VERSION}/${PLUGIN_NAME}.js`;

function step(n: number, msg: string) {
  console.log(`\n[${'='.repeat(60)}]`);
  console.log(`  Step ${n}: ${msg}`);
  console.log(`[${'='.repeat(60)}]`);
}

async function main() {
  console.log('\n  Intelligent Dashboard Plugin — Seed Script\n');

  const prisma = new PrismaClient();

  // ── Step 1: Authenticate ────────────────────────────────────────────────

  step(1, `Authenticating as ${AUTH_EMAIL}`);

  const loginRes = await fetch(`${SHELL_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: AUTH_EMAIL, password: AUTH_PASSWORD }),
  });

  if (!loginRes.ok) {
    throw new Error(`Login failed (${loginRes.status}). Is start.sh --all running?`);
  }

  const loginData = (await loginRes.json()) as {
    data: { token: string; user: { id: string; displayName: string } };
  };
  const userId = loginData.data.user.id;
  console.log(`  Authenticated as ${loginData.data.user.displayName} (${userId})`);

  // ── Step 2: Verify required connectors ──────────────────────────────────

  step(2, 'Verifying required connectors (gemini + livepeer-leaderboard)');

  const geminiConnector = await prisma.serviceConnector.findFirst({
    where: { slug: 'gemini', visibility: 'public', status: 'published' },
  });
  if (!geminiConnector) {
    throw new Error('Gemini connector not found or not published. Run seed-public-connectors.ts first.');
  }
  console.log(`  Gemini connector: ${geminiConnector.id} (published)`);

  const leaderboardConnector = await prisma.serviceConnector.findFirst({
    where: { slug: 'livepeer-leaderboard', visibility: 'public', status: 'published' },
  });
  if (!leaderboardConnector) {
    throw new Error('Leaderboard connector not found or not published. Run seed-leaderboard-gateway.ts first.');
  }
  console.log(`  Leaderboard connector: ${leaderboardConnector.id} (published)`);

  // ── Step 3: Configure Gemini API key ────────────────────────────────────

  step(3, 'Configuring Gemini upstream API key');

  const GEMINI_KEY = process.env.GEMINI_API_KEY || '***REMOVED***';

  const secretScope = `personal:${userId}`;
  const secretRef = 'token';
  const secretKey = `gw:${secretScope}:gemini:${secretRef}`;

  const existingSecret = await prisma.secretVault.findUnique({
    where: { key: secretKey },
  });

  if (existingSecret) {
    console.log('  Gemini API key already configured in SecretVault');
  } else {
    const { encrypt } = await import('../apps/web-next/src/lib/gateway/encryption.js');
    const { encryptedValue, iv } = encrypt(GEMINI_KEY);

    await prisma.secretVault.create({
      data: {
        key: secretKey,
        encryptedValue,
        iv,
        scope: secretScope,
        createdBy: userId,
      },
    });
    console.log('  Gemini API key stored in SecretVault');
  }

  // ── Step 4: Register WorkflowPlugin ─────────────────────────────────────

  step(4, 'Registering WorkflowPlugin');

  await prisma.workflowPlugin.upsert({
    where: { name: PLUGIN_NAME },
    update: {
      displayName: 'Intelligent Dashboard',
      version: PLUGIN_VERSION,
      routes: ['/intelligent-dashboard', '/intelligent-dashboard/*'],
      enabled: true,
      icon: 'BrainCircuit',
      bundleUrl: BUNDLE_URL,
    },
    create: {
      name: PLUGIN_NAME,
      displayName: 'Intelligent Dashboard',
      version: PLUGIN_VERSION,
      remoteUrl: BUNDLE_URL,
      bundleUrl: BUNDLE_URL,
      globalName: 'NaapPluginIntelligentDashboard',
      deploymentType: 'cdn',
      routes: ['/intelligent-dashboard', '/intelligent-dashboard/*'],
      enabled: true,
      order: 100,
      icon: 'BrainCircuit',
      metadata: {
        category: 'example',
        description: 'AI-powered analytics dashboard using Gemini + Livepeer Leaderboard via Service Gateway',
      },
    },
  });
  console.log(`  WorkflowPlugin: ${PLUGIN_NAME} -> /intelligent-dashboard`);

  // ── Step 5: Marketplace listing ─────────────────────────────────────────

  step(5, 'Creating PluginPackage + PluginVersion + PluginDeployment');

  const pkg = await prisma.pluginPackage.upsert({
    where: { name: PLUGIN_NAME },
    update: {
      displayName: 'Intelligent Dashboard',
      description: 'AI-powered analytics dashboard — ask questions in natural language, get interactive visualizations via Gemini + Livepeer Leaderboard',
      category: 'example',
      publishStatus: 'published',
    },
    create: {
      name: PLUGIN_NAME,
      displayName: 'Intelligent Dashboard',
      description: 'AI-powered analytics dashboard — ask questions in natural language, get interactive visualizations via Gemini + Livepeer Leaderboard',
      category: 'example',
      author: 'NAAP Examples',
      authorEmail: 'examples@naap.dev',
      license: 'MIT',
      keywords: ['ai', 'analytics', 'dashboard', 'gemini', 'leaderboard', 'agent'],
      icon: 'BrainCircuit',
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
        displayName: 'Intelligent Dashboard',
        version: PLUGIN_VERSION,
        description: 'AI-powered analytics dashboard',
        category: 'example',
        icon: 'BrainCircuit',
      },
    },
    create: {
      packageId: pkg.id,
      version: PLUGIN_VERSION,
      frontendUrl: BUNDLE_URL,
      manifest: {
        name: PLUGIN_NAME,
        displayName: 'Intelligent Dashboard',
        version: PLUGIN_VERSION,
        description: 'AI-powered analytics dashboard',
        category: 'example',
        icon: 'BrainCircuit',
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

  // ── Step 6: Install for all users ───────────────────────────────────────

  step(6, 'Installing for all users');

  const allUsers = await prisma.user.findMany({ select: { id: true } });
  let installCount = 0;

  for (const user of allUsers) {
    const existing = await prisma.tenantPluginInstall.findUnique({
      where: { userId_deploymentId: { userId: user.id, deploymentId: deployment.id } },
    });
    if (!existing) {
      await prisma.tenantPluginInstall.create({
        data: {
          userId: user.id,
          deploymentId: deployment.id,
          status: 'active',
          enabled: true,
          order: 0,
          installedAt: new Date(),
        },
      });
      installCount++;
    }
  }

  for (const user of allUsers) {
    await prisma.userPluginPreference.upsert({
      where: { userId_pluginName: { userId: user.id, pluginName: PLUGIN_NAME } },
      update: { enabled: true },
      create: {
        userId: user.id,
        pluginName: PLUGIN_NAME,
        enabled: true,
        pinned: false,
        order: 100,
      },
    });
  }

  const activeCount = await prisma.tenantPluginInstall.count({
    where: { deploymentId: deployment.id, status: 'active' },
  });
  await prisma.pluginDeployment.update({
    where: { id: deployment.id },
    data: { activeInstalls: activeCount },
  });

  console.log(`  Installed for ${installCount} new users (${activeCount} total active)`);

  await prisma.$disconnect();

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log('\n' + '='.repeat(62));
  console.log('  Intelligent Dashboard Plugin — Seed Complete');
  console.log('='.repeat(62));
  console.log();
  console.log(`  Plugin: ${PLUGIN_NAME} v${PLUGIN_VERSION}`);
  console.log(`  Bundle: ${BUNDLE_URL}`);
  console.log(`  Routes: /intelligent-dashboard, /intelligent-dashboard/*`);
  console.log(`  Icon:   BrainCircuit`);
  console.log();
  console.log('  Required connectors:');
  console.log(`    Gemini:      ${geminiConnector.id} (published)`);
  console.log(`    Leaderboard: ${leaderboardConnector.id} (published)`);
  console.log();
  console.log('  Gateway endpoints used by the plugin:');
  console.log(`    POST ${SHELL_URL}/api/v1/gw/gemini/chat`);
  console.log(`    GET  ${SHELL_URL}/api/v1/gw/livepeer-leaderboard/pipelines`);
  console.log(`    GET  ${SHELL_URL}/api/v1/gw/livepeer-leaderboard/stats?pipeline=...&model=...`);
  console.log();
  console.log('  Navigate to /intelligent-dashboard in the NaaP UI to test.');
  console.log();
}

main().catch((err) => {
  console.error('\n  Seed failed:', err.message || err);
  process.exit(1);
});
