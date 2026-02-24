/**
 * Seed Script: Livepeer Leaderboard Gateway
 *
 * Run after `start.sh --all` to:
 *   1. Authenticate as admin dev user
 *   2. Create a "livepeer-leaderboard" connector in the service gateway
 *   3. Create 3 endpoints (pipelines, aggregated stats, raw stats)
 *   4. Publish the connector
 *   5. Create a gateway plan and API key for testing
 *   6. Register the leaderboard example plugin in WorkflowPlugin
 *   7. Print gateway URLs and test API key
 *
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   npx tsx bin/seed-leaderboard-gateway.ts
 */

import { PrismaClient } from '../packages/database/src/generated/client/index.js';

const SHELL_URL = process.env.SHELL_URL || 'http://localhost:3000';
const AUTH_EMAIL = process.env.AUTH_EMAIL || 'admin@livepeer.org';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'livepeer';

// ── Types ────────────────────────────────────────────────────────────────────

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface Connector {
  id: string;
  slug: string;
  displayName: string;
  status: string;
}

interface Endpoint {
  id: string;
  connectorId: string;
  name: string;
  method: string;
  path: string;
}

interface GatewayPlan {
  id: string;
  name: string;
  displayName: string;
}

interface GatewayApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  rawKey: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function apiCall<T>(
  method: string,
  path: string,
  token: string,
  teamId: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
  const url = `${SHELL_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-team-id': teamId,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json() as ApiResponse<T>;

  if (!res.ok && res.status !== 409) {
    throw new Error(
      `${method} ${path} failed (${res.status}): ${JSON.stringify(json)}`,
    );
  }

  return json;
}

function step(n: number, msg: string) {
  console.log(`\n[${'='.repeat(60)}]`);
  console.log(`  Step ${n}: ${msg}`);
  console.log(`[${'='.repeat(60)}]`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 Livepeer Leaderboard Gateway — Seed Script\n');

  // ── Step 1: Authenticate ──────────────────────────────────────────────────

  step(1, 'Authenticating as dev user');

  const loginRes = await fetch(`${SHELL_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: AUTH_EMAIL, password: AUTH_PASSWORD }),
  });

  if (!loginRes.ok) {
    throw new Error(
      `Login failed (${loginRes.status}). Is start.sh --all running?`,
    );
  }

  const loginData = (await loginRes.json()) as ApiResponse<{
    token: string;
    user: { id: string; displayName: string };
  }>;
  const token = loginData.data.token;
  const userId = loginData.data.user.id;
  console.log(
    `  ✅ Authenticated as ${loginData.data.user.displayName} (${AUTH_EMAIL})`,
  );

  // ── Step 2: Resolve team ID ───────────────────────────────────────────────

  step(2, 'Resolving "Livepeer Development" team');

  const prisma = new PrismaClient();
  let teamId: string;

  try {
    const team = await prisma.team.findFirst({
      where: { slug: 'livepeer-dev' },
    });
    if (!team) {
      throw new Error(
        'Team "livepeer-dev" not found. Run start.sh --all first to seed the database.',
      );
    }
    teamId = team.id;
    console.log(`  ✅ Team: ${team.name} (${teamId})`);
  } catch (err) {
    await prisma.$disconnect();
    throw err;
  }

  // ── Step 3: Create connector ──────────────────────────────────────────────

  step(3, 'Creating "livepeer-leaderboard" connector');

  let connectorId: string;

  const connectorBody = {
    slug: 'livepeer-leaderboard',
    displayName: 'Livepeer AI Leaderboard',
    description:
      'Orchestrator performance leaderboard for Livepeer AI pipelines (text-to-image, LLM, live-video-to-video, upscale)',
    upstreamBaseUrl: 'https://leaderboard-api.livepeer.cloud',
    allowedHosts: ['leaderboard-api.livepeer.cloud'],
    defaultTimeout: 15000,
    healthCheckPath: '/api/pipelines',
    authType: 'none' as const,
    responseWrapper: true,
    streamingEnabled: false,
    tags: ['livepeer', 'ai', 'leaderboard', 'orchestrator'],
  };

  try {
    const res = await apiCall<Connector>(
      'POST',
      '/api/v1/gw/admin/connectors',
      token,
      teamId,
      connectorBody,
    );
    connectorId = res.data.id;
    console.log(`  ✅ Created connector: ${connectorId}`);
  } catch (err) {
    // 409 = slug already exists — look it up
    const existing = await prisma.serviceConnector.findFirst({
      where: { teamId, slug: 'livepeer-leaderboard' },
    });
    if (existing) {
      connectorId = existing.id;
      console.log(`  ⏭️  Connector already exists: ${connectorId}`);
    } else {
      throw err;
    }
  }

  // ── Step 4: Create endpoints ──────────────────────────────────────────────

  step(4, 'Creating connector endpoints');

  const endpoints = [
    {
      name: 'list-pipelines',
      description:
        'List all AI pipelines with their models and supported regions',
      method: 'GET',
      path: '/pipelines',
      upstreamPath: '/api/pipelines',
      rateLimit: 200,
      timeout: 5000,
      cacheTtl: 300,
    },
    {
      name: 'aggregated-stats',
      description:
        'Get aggregated performance scores by pipeline and model',
      method: 'GET',
      path: '/stats',
      upstreamPath: '/api/aggregated_stats',
      rateLimit: 100,
      timeout: 10000,
      cacheTtl: 60,
    },
    {
      name: 'raw-stats',
      description:
        'Get raw per-run stats for a specific orchestrator',
      method: 'GET',
      path: '/stats/raw',
      upstreamPath: '/api/raw_stats',
      rateLimit: 50,
      timeout: 15000,
      cacheTtl: 30,
    },
  ];

  for (const ep of endpoints) {
    const epRes = await fetch(
      `${SHELL_URL}/api/v1/gw/admin/connectors/${connectorId}/endpoints`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'x-team-id': teamId,
        },
        body: JSON.stringify(ep),
      },
    );

    if (epRes.ok) {
      console.log(`  ✅ Endpoint: ${ep.method} ${ep.path} → ${ep.upstreamPath}`);
    } else if (epRes.status === 409) {
      console.log(`  ⏭️  Endpoint already exists: ${ep.method} ${ep.path}`);
    } else {
      const body = await epRes.text();
      throw new Error(
        `Create endpoint ${ep.method} ${ep.path} failed (${epRes.status}): ${body}`,
      );
    }
  }

  // ── Step 5: Publish connector ─────────────────────────────────────────────

  step(5, 'Publishing connector');

  const publishRes = await fetch(
    `${SHELL_URL}/api/v1/gw/admin/connectors/${connectorId}/publish`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-team-id': teamId,
      },
    },
  );

  if (publishRes.ok) {
    const publishData = (await publishRes.json()) as ApiResponse<Connector>;
    console.log(`  ✅ Connector published (status: ${publishData.data.status})`);
  } else if (publishRes.status === 400 || publishRes.status === 409) {
    console.log('  ⏭️  Connector already published');
  } else {
    const body = await publishRes.text();
    throw new Error(`Publish connector failed (${publishRes.status}): ${body}`);
  }

  // ── Step 6: Create gateway plan ───────────────────────────────────────────

  step(6, 'Creating gateway plan');

  let planId: string | undefined;

  const planRes = await fetch(`${SHELL_URL}/api/v1/gw/admin/plans`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-team-id': teamId,
    },
    body: JSON.stringify({
      name: 'leaderboard-standard',
      displayName: 'Leaderboard Standard',
      rateLimit: 100,
      dailyQuota: 5000,
    }),
  });

  if (planRes.ok) {
    const planData = (await planRes.json()) as ApiResponse<GatewayPlan>;
    planId = planData.data.id;
    console.log(`  ✅ Plan created: ${planData.data.displayName} (${planId})`);
  } else if (planRes.status === 409) {
    const existing = await prisma.gatewayPlan.findFirst({
      where: { teamId, name: 'leaderboard-standard' },
    });
    planId = existing?.id;
    console.log(`  ⏭️  Plan already exists: ${planId}`);
  } else {
    const body = await planRes.text();
    throw new Error(`Create plan failed (${planRes.status}): ${body}`);
  }

  // ── Step 7: Create API key ────────────────────────────────────────────────

  step(7, 'Creating test API key');

  const existingKey = await prisma.gatewayApiKey.findFirst({
    where: { teamId, name: 'leaderboard-test-key', status: 'active' },
  });

  let rawKey: string | undefined;

  if (existingKey) {
    console.log(
      `  ⏭️  API key already exists: ${existingKey.keyPrefix}... (raw key not available — was shown on creation)`,
    );
  } else {
    const res = await apiCall<GatewayApiKey>(
      'POST',
      '/api/v1/gw/admin/keys',
      token,
      teamId,
      {
        name: 'leaderboard-test-key',
        connectorId,
        planId,
      },
    );
    rawKey = res.data.rawKey;
    console.log(`  ✅ API key created: ${res.data.keyPrefix}...`);
  }

  // ── Step 8: Register leaderboard plugin ───────────────────────────────────

  step(8, 'Registering leaderboard plugin (WorkflowPlugin + Marketplace + Installs)');

  const BUNDLE_URL = '/cdn/plugins/leaderboard/1.0.0/leaderboard.js';

  // 8a. WorkflowPlugin (makes the shell discover it)
  await prisma.workflowPlugin.upsert({
    where: { name: 'leaderboard' },
    update: {
      displayName: 'AI Leaderboard',
      version: '1.0.0',
      routes: ['/leaderboard', '/leaderboard/*'],
      enabled: true,
      icon: 'Trophy',
      bundleUrl: BUNDLE_URL,
    },
    create: {
      name: 'leaderboard',
      displayName: 'AI Leaderboard',
      version: '1.0.0',
      remoteUrl: BUNDLE_URL,
      bundleUrl: BUNDLE_URL,
      globalName: 'NaapPluginLeaderboard',
      deploymentType: 'cdn',
      routes: ['/leaderboard', '/leaderboard/*'],
      enabled: true,
      order: 99,
      icon: 'Trophy',
      metadata: {
        category: 'example',
        description:
          'Livepeer AI orchestrator performance leaderboard — consumes the Service Gateway',
      },
    },
  });
  console.log('  ✅ WorkflowPlugin: leaderboard → /leaderboard');

  // 8b. PluginPackage (marketplace listing)
  const pkg = await prisma.pluginPackage.upsert({
    where: { name: 'leaderboard' },
    update: {
      displayName: 'AI Leaderboard',
      description: 'Livepeer AI orchestrator performance leaderboard — consumes the Service Gateway',
      category: 'example',
      publishStatus: 'published',
    },
    create: {
      name: 'leaderboard',
      displayName: 'AI Leaderboard',
      description: 'Livepeer AI orchestrator performance leaderboard — consumes the Service Gateway',
      category: 'example',
      author: 'NAAP Examples',
      authorEmail: 'examples@naap.dev',
      license: 'MIT',
      keywords: ['leaderboard', 'livepeer', 'ai', 'orchestrator', 'performance'],
      icon: 'Trophy',
      isCore: false,
      publishStatus: 'published',
    },
  });
  console.log(`  ✅ PluginPackage: ${pkg.id}`);

  // 8c. PluginVersion
  const ver = await prisma.pluginVersion.upsert({
    where: { packageId_version: { packageId: pkg.id, version: '1.0.0' } },
    update: {
      frontendUrl: BUNDLE_URL,
      manifest: {
        name: 'leaderboard',
        displayName: 'AI Leaderboard',
        version: '1.0.0',
        description: 'Livepeer AI orchestrator performance leaderboard',
        category: 'example',
        icon: 'Trophy',
      },
    },
    create: {
      packageId: pkg.id,
      version: '1.0.0',
      frontendUrl: BUNDLE_URL,
      manifest: {
        name: 'leaderboard',
        displayName: 'AI Leaderboard',
        version: '1.0.0',
        description: 'Livepeer AI orchestrator performance leaderboard',
        category: 'example',
        icon: 'Trophy',
      },
    },
  });
  console.log(`  ✅ PluginVersion: ${ver.id}`);

  // 8d. PluginDeployment
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
  console.log(`  ✅ PluginDeployment: ${deployment.id}`);

  // 8e. TenantPluginInstall for all users
  const allUsers = await prisma.user.findMany({ select: { id: true } });
  let installCount = 0;
  for (const user of allUsers) {
    const existing = await prisma.tenantPluginInstall.findUnique({
      where: {
        userId_deploymentId: { userId: user.id, deploymentId: deployment.id },
      },
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

  // 8f. UserPluginPreference for all users
  for (const user of allUsers) {
    await prisma.userPluginPreference.upsert({
      where: {
        userId_pluginName: { userId: user.id, pluginName: 'leaderboard' },
      },
      update: { enabled: true },
      create: {
        userId: user.id,
        pluginName: 'leaderboard',
        enabled: true,
        pinned: false,
        order: 99,
      },
    });
  }

  // Update activeInstalls count
  const activeCount = await prisma.tenantPluginInstall.count({
    where: { deploymentId: deployment.id, status: 'active' },
  });
  await prisma.pluginDeployment.update({
    where: { id: deployment.id },
    data: { activeInstalls: activeCount },
  });

  console.log(`  ✅ Installed for ${installCount} new users (${activeCount} total active)`);

  await prisma.$disconnect();

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('\n' + '═'.repeat(62));
  console.log('  🎉 Livepeer Leaderboard Gateway — Setup Complete');
  console.log('═'.repeat(62));
  console.log();
  console.log('  Gateway Proxy URLs (authenticated via JWT or API key):');
  console.log();
  console.log(
    `    GET ${SHELL_URL}/api/v1/gw/livepeer-leaderboard/pipelines`,
  );
  console.log(
    `    GET ${SHELL_URL}/api/v1/gw/livepeer-leaderboard/stats?pipeline=text-to-image&model=black-forest-labs/FLUX.1-dev`,
  );
  console.log(
    `    GET ${SHELL_URL}/api/v1/gw/livepeer-leaderboard/stats/raw?pipeline=text-to-image&model=black-forest-labs/FLUX.1-dev&orchestrator=0x...`,
  );
  console.log();

  if (rawKey) {
    console.log(`  Test API Key (save this — shown only once):`);
    console.log(`    ${rawKey}`);
    console.log();
    console.log('  Quick test:');
    console.log(
      `    curl -H "Authorization: Bearer ${rawKey}" \\`,
    );
    console.log(
      `         ${SHELL_URL}/api/v1/gw/livepeer-leaderboard/pipelines`,
    );
  } else {
    console.log(
      '  API key was created in a previous run (raw key not available).',
    );
    console.log(
      '  Use JWT auth or create a new key via the Service Gateway UI.',
    );
  }

  console.log();
  console.log(
    '  Leaderboard plugin: navigate to /leaderboard in the NaaP UI',
  );
  console.log();
}

main().catch((err) => {
  console.error('\n❌ Seed failed:', err.message || err);
  process.exit(1);
});
