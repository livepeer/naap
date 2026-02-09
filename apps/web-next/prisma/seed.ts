/**
 * Comprehensive Seed script for web-next database
 * Ported from base-svc seed to ensure feature parity.
 *
 * Execution context:
 *   - LOCAL DEVELOPMENT ONLY: `npx prisma db seed` or `start.sh` first run.
 *   - On Vercel, WorkflowPlugin records are managed by bin/sync-plugin-registry.ts
 *     (called during vercel-build.sh). This seed is NOT run on Vercel.
 *
 * Plugin discovery logic is delegated to the shared utility at
 * packages/database/src/plugin-discovery.ts — the single source of truth.
 *
 * Creates:
 * - System roles (4)
 * - Plugin admin roles (10)
 * - Test users with roles (12+)
 * - Feature flags (4)
 * - Workflow plugins (auto-discovered from plugins/{name}/plugin.json)
 * - Marketplace packages (10+)
 * - Plugin deployments
 * - Tenant installations
 * - Test team
 */

import { PrismaClient } from '@naap/database';
import * as crypto from 'crypto';
import * as path from 'path';

const prisma = new PrismaClient();

// Password hashing (same as auth service)
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

async function main() {
  console.log('🌱 Seeding web-next database (comprehensive)...\n');

  // ============================================
  // 1. Feature Flags
  // ============================================
  console.log('📌 Creating feature flags...');
  
  const featureFlags = [
    {
      key: 'enableMockData',
      enabled: true,
      description: 'Enable mock data for development',
    },
    {
      key: 'enableCDNPlugins',
      enabled: true,
      description: 'Enable CDN/UMD plugin loading',
    },
    {
      key: 'enableAuth',
      enabled: true,
      description: 'Enable authentication',
    },
    {
      key: 'enableNotifications',
      enabled: true,
      description: 'Enable notifications',
    },
  ];

  for (const flag of featureFlags) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      update: flag,
      create: flag,
    });
  }
  console.log(`   ✅ Created ${featureFlags.length} feature flags`);

  // ============================================
  // 2. System Roles
  // ============================================
  console.log('🔐 Creating system roles...');

  const systemRoles = [
    {
      name: 'system:root',
      displayName: 'System Root',
      description: 'Unrestricted access (database-only assignment)',
      permissions: [{ resource: '*', action: '*' }],
      canAssign: ['*'],
      inherits: [],
      scope: 'system',
      isSystem: true,
    },
    {
      name: 'system:admin',
      displayName: 'Platform Administrator',
      description: 'Manages users, plugins, and marketplace',
      permissions: [
        { resource: 'user', action: '*' },
        { resource: 'role', action: '*' },
        { resource: 'plugin', action: '*' },
        { resource: 'marketplace', action: '*' },
        { resource: 'audit', action: 'read' },
      ],
      canAssign: ['system:admin', 'system:operator', 'system:viewer'],
      inherits: ['system:operator'],
      scope: 'system',
      isSystem: true,
    },
    {
      name: 'system:operator',
      displayName: 'Platform Operator',
      description: 'Infrastructure operations, no role management',
      permissions: [
        { resource: 'gateway', action: '*' },
        { resource: 'orchestrator', action: '*' },
        { resource: 'plugin', action: 'read' },
      ],
      canAssign: [],
      inherits: ['system:viewer'],
      scope: 'system',
      isSystem: true,
    },
    {
      name: 'system:viewer',
      displayName: 'Viewer',
      description: 'Read-only access',
      permissions: [{ resource: '*', action: 'read' }],
      canAssign: [],
      inherits: [],
      scope: 'system',
      isSystem: true,
    },
  ];

  for (const role of systemRoles) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: {
        displayName: role.displayName,
        description: role.description,
        permissions: role.permissions,
        canAssign: role.canAssign,
        inherits: role.inherits,
      },
      create: {
        name: role.name,
        displayName: role.displayName,
        description: role.description,
        permissions: role.permissions,
        canAssign: role.canAssign,
        inherits: role.inherits,
        scope: role.scope,
        isSystem: role.isSystem,
      },
    });
  }
  console.log(`   ✅ Created ${systemRoles.length} system roles`);

  // ============================================
  // 3. Plugin Admin Roles
  // ============================================
  console.log('🔌 Creating plugin admin roles...');

  const pluginAdminRoles = [
    { pluginName: 'gateway-manager', roleName: 'gateway-manager:admin', displayName: 'Gateway Manager Administrator' },
    { pluginName: 'orchestrator-manager', roleName: 'orchestrator-manager:admin', displayName: 'Orchestrator Manager Administrator' },
    { pluginName: 'capacity-planner', roleName: 'capacity-planner:admin', displayName: 'Capacity Planner Administrator' },
    { pluginName: 'network-analytics', roleName: 'network-analytics:admin', displayName: 'Network Analytics Administrator' },
    { pluginName: 'marketplace', roleName: 'marketplace:admin', displayName: 'Marketplace Administrator' },
    { pluginName: 'community', roleName: 'community:admin', displayName: 'Community Hub Administrator' },
    { pluginName: 'developer-api', roleName: 'developer-api:admin', displayName: 'Developer API Administrator' },
    { pluginName: 'my-wallet', roleName: 'my-wallet:admin', displayName: 'Wallet Administrator' },
    { pluginName: 'my-dashboard', roleName: 'my-dashboard:admin', displayName: 'Dashboard Administrator' },
    { pluginName: 'plugin-publisher', roleName: 'plugin-publisher:admin', displayName: 'Plugin Publisher Administrator' },
    { pluginName: 'daydream-video', roleName: 'daydream-video:admin', displayName: 'Daydream Video Administrator' },
  ];

  for (const pluginRole of pluginAdminRoles) {
    await prisma.role.upsert({
      where: { name: pluginRole.roleName },
      update: {},
      create: {
        name: pluginRole.roleName,
        displayName: pluginRole.displayName,
        description: `Full access to ${pluginRole.pluginName} plugin`,
        permissions: [{ resource: `${pluginRole.pluginName}:*`, action: '*' }],
        canAssign: [`${pluginRole.pluginName}:*`],
        inherits: [],
        scope: 'plugin',
        pluginName: pluginRole.pluginName,
      },
    });
  }
  console.log(`   ✅ Created ${pluginAdminRoles.length} plugin admin roles`);

  // ============================================
  // 4. Test Users with Roles
  // ============================================
  console.log('👥 Creating test users...');

  const passwordHash = hashPassword('livepeer');

  const testUsers = [
    { email: 'admin@livepeer.org', displayName: 'System Admin', roles: ['system:admin'] },
    { email: 'gateway@livepeer.org', displayName: 'Gateway Admin', roles: ['gateway-manager:admin'] },
    { email: 'orchestrator@livepeer.org', displayName: 'Orchestrator Admin', roles: ['orchestrator-manager:admin'] },
    { email: 'capacity@livepeer.org', displayName: 'Capacity Admin', roles: ['capacity-planner:admin'] },
    { email: 'analytics@livepeer.org', displayName: 'Analytics Admin', roles: ['network-analytics:admin'] },
    { email: 'marketplace@livepeer.org', displayName: 'Marketplace Admin', roles: ['marketplace:admin'] },
    { email: 'community@livepeer.org', displayName: 'Community Admin', roles: ['community:admin'] },
    { email: 'developer@livepeer.org', displayName: 'Developer Admin', roles: ['developer-api:admin'] },
    { email: 'wallet@livepeer.org', displayName: 'Wallet Admin', roles: ['my-wallet:admin'] },
    { email: 'dashboard@livepeer.org', displayName: 'Dashboard Admin', roles: ['my-dashboard:admin'] },
    { email: 'publisher@livepeer.org', displayName: 'Publisher Admin', roles: ['plugin-publisher:admin'] },
    { email: 'viewer@livepeer.org', displayName: 'Viewer User', roles: ['system:viewer'] },
  ];

  const createdUsers: { id: string; email: string }[] = [];

  for (const userData of testUsers) {
    const user = await prisma.user.upsert({
      where: { email: userData.email },
      update: {
        displayName: userData.displayName,
        passwordHash,
      },
      create: {
        email: userData.email,
        passwordHash,
        displayName: userData.displayName,
        emailVerified: new Date(),
        config: {
          create: {
            theme: 'dark',
            debugEnabled: true,
          },
        },
      },
    });

    createdUsers.push({ id: user.id, email: user.email! });

    // Assign roles
    for (const roleName of userData.roles) {
      const role = await prisma.role.findUnique({ where: { name: roleName } });
      if (role) {
        await prisma.userRole.upsert({
          where: {
            userId_roleId: { userId: user.id, roleId: role.id },
          },
          update: {},
          create: {
            userId: user.id,
            roleId: role.id,
            grantedBy: 'system',
          },
        });
      }
    }
  }
  console.log(`   ✅ Created ${testUsers.length} test users with roles`);

  // ============================================
  // 5. Legacy Wallet Test User (backward compat)
  // ============================================
  console.log('🔗 Creating legacy wallet test user...');

  const legacyUser = await prisma.user.upsert({
    where: { address: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F' },
    update: {},
    create: {
      address: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
      displayName: 'Livepeer Operator',
      config: {
        create: {
          theme: 'dark',
          preferences: {
            notifications: true,
            emailUpdates: false,
          },
        },
      },
    },
  });

  // Assign system:admin to legacy user
  const adminRole = await prisma.role.findUnique({ where: { name: 'system:admin' } });
  if (adminRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: legacyUser.id, roleId: adminRole.id } },
      update: {},
      create: {
        userId: legacyUser.id,
        roleId: adminRole.id,
        grantedBy: 'system',
      },
    });
  }
  console.log(`   ✅ Created legacy wallet user: ${legacyUser.address}`);

  // ============================================
  // 6. Test Team
  // ============================================
  console.log('👥 Creating test team...');

  const firstAdmin = createdUsers.find(u => u.email === 'admin@livepeer.org');
  if (firstAdmin) {
    const testTeam = await prisma.team.upsert({
      where: { slug: 'livepeer-dev' },
      update: {},
      create: {
        name: 'Livepeer Development',
        slug: 'livepeer-dev',
        description: 'Development team for Livepeer Network',
        ownerId: firstAdmin.id,
      },
    });

    // Add owner as team member
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: testTeam.id, userId: firstAdmin.id } },
      update: {},
      create: {
        teamId: testTeam.id,
        userId: firstAdmin.id,
        role: 'owner',
      },
    });
    console.log(`   ✅ Created test team: ${testTeam.name}`);
  }

  // ============================================
  // 7. Workflow Plugins (12 total)
  // ============================================
  console.log('🔌 Creating workflow plugins...');

  // ---------------------------------------------------------------------------
  // Dynamic plugin discovery — delegates to shared utility
  // (packages/database/src/plugin-discovery.ts)
  // This is the single source of truth for plugin discovery logic.
  // ---------------------------------------------------------------------------

  // Import shared discovery utilities
  const { discoverPlugins, toWorkflowPluginData, getBundleUrl, toCamelCase } = await import(
    '../../../packages/database/src/plugin-discovery.js'
  );

  const PLUGIN_CDN_URL = process.env.PLUGIN_CDN_URL || '/cdn/plugins';

  // Resolve monorepo root (seed.ts is at apps/web-next/prisma/seed.ts)
  const MONOREPO_ROOT = path.resolve(__dirname, '../../..');
  const discovered = discoverPlugins(MONOREPO_ROOT);

  console.log(`   📦 Discovered ${discovered.length} plugins from plugin.json files`);

  // Build WorkflowPlugin records using shared utility
  const defaultPlugins = discovered.map((p: any) => toWorkflowPluginData(p, PLUGIN_CDN_URL));

  // Build a lookup from camelCase name -> discovered plugin for use by marketplace section
  const discoveredByName = new Map(discovered.map((p: any) => [p.name, p]));

  /** Get the CDN bundle URL for a plugin by its camelCase name */
  const getPluginUrl = (camelName: string) => {
    const p = discoveredByName.get(camelName);
    if (p) return getBundleUrl(PLUGIN_CDN_URL, p.dirName, p.version);
    // Fallback: derive kebab-case from camelCase
    const kebab = camelName.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    return getBundleUrl(PLUGIN_CDN_URL, kebab, '1.0.0');
  };

  for (const plugin of defaultPlugins) {
    await prisma.workflowPlugin.upsert({
      where: { name: plugin.name },
      update: plugin,
      create: plugin,
    });
  }
  console.log(`   ✅ Created ${defaultPlugins.length} workflow plugins`);

  // ============================================
  // 8. Marketplace Plugin Packages
  // ============================================
  console.log('🏪 Creating marketplace plugin packages...');

  const marketplacePlugins = [
    {
      name: 'marketplace',
      displayName: 'Plugin Marketplace',
      description: 'Discover, install, and manage plugins to extend your NAAP experience.',
      category: 'platform',
      author: 'NAAP Team',
      authorEmail: 'team@naap.io',
      repository: 'https://github.com/naap/plugins/tree/main/marketplace',
      license: 'MIT',
      keywords: ['marketplace', 'plugins', 'extensions', 'install'],
      icon: 'ShoppingBag',
      version: '1.0.0',
      frontendUrl: getPluginUrl('marketplace'),
      isCore: true,
    },
    {
      name: 'gatewayManager',
      displayName: 'Gateway Manager',
      description: 'Manage and monitor your AI gateway infrastructure with real-time metrics.',
      category: 'monitoring',
      author: 'NAAP Team',
      authorEmail: 'team@naap.io',
      repository: 'https://github.com/naap/plugins/tree/main/gateway-manager',
      license: 'MIT',
      keywords: ['gateway', 'monitoring', 'infrastructure', 'metrics', 'ai'],
      icon: 'Radio',
      version: '1.0.0',
      frontendUrl: getPluginUrl('gatewayManager'),
    },
    {
      name: 'orchestratorManager',
      displayName: 'Orchestrator Manager',
      description: 'Manage and monitor orchestrators on the Livepeer network.',
      category: 'monitoring',
      author: 'NAAP Team',
      authorEmail: 'team@naap.io',
      repository: 'https://github.com/naap/plugins/tree/main/orchestrator-manager',
      license: 'MIT',
      keywords: ['orchestrator', 'monitoring', 'infrastructure', 'livepeer'],
      icon: 'Cpu',
      version: '1.0.0',
      frontendUrl: getPluginUrl('orchestratorManager'),
    },
    {
      name: 'capacityPlanner',
      displayName: 'Capacity Planner',
      description: 'Plan and manage capacity across your Livepeer infrastructure.',
      category: 'monitoring',
      author: 'NAAP Team',
      authorEmail: 'team@naap.io',
      repository: 'https://github.com/naap/plugins/tree/main/capacity-planner',
      license: 'MIT',
      keywords: ['capacity', 'planning', 'resources', 'forecasting'],
      icon: 'Zap',
      version: '1.0.0',
      frontendUrl: getPluginUrl('capacityPlanner'),
    },
    {
      name: 'networkAnalytics',
      displayName: 'Network Analytics',
      description: 'Comprehensive analytics dashboard for the Livepeer network.',
      category: 'analytics',
      author: 'NAAP Team',
      authorEmail: 'team@naap.io',
      repository: 'https://github.com/naap/plugins/tree/main/network-analytics',
      license: 'MIT',
      keywords: ['analytics', 'charts', 'metrics', 'leaderboard', 'network'],
      icon: 'BarChart3',
      version: '1.0.0',
      frontendUrl: getPluginUrl('networkAnalytics'),
    },
    {
      name: 'community',
      displayName: 'Community Hub',
      description: 'Community forum and discussion platform for Livepeer operators.',
      category: 'social',
      author: 'NAAP Team',
      authorEmail: 'team@naap.io',
      repository: 'https://github.com/naap/plugins/tree/main/community',
      license: 'MIT',
      keywords: ['community', 'forum', 'discussion', 'social'],
      icon: 'Users',
      version: '1.0.0',  // Matches built bundle
      frontendUrl: getPluginUrl('community'),
    },
    {
      name: 'developerApi',
      displayName: 'Developer API Manager',
      description: 'Manage API keys, access AI models, and configure gateway connections.',
      category: 'developer',
      author: 'NAAP Team',
      authorEmail: 'team@naap.io',
      repository: 'https://github.com/naap/plugins/tree/main/developer-api',
      license: 'MIT',
      keywords: ['api', 'developer', 'keys', 'integration', 'ai'],
      icon: 'Code',
      version: '1.0.0',
      frontendUrl: getPluginUrl('developerApi'),
    },
    {
      name: 'myWallet',
      displayName: 'My Wallet',
      description: 'MetaMask wallet integration for staking LPT and managing transactions.',
      category: 'finance',
      author: 'NAAP Team',
      authorEmail: 'team@naap.io',
      repository: 'https://github.com/naap/plugins/tree/main/my-wallet',
      license: 'MIT',
      keywords: ['wallet', 'metamask', 'web3', 'staking', 'ethereum', 'livepeer'],
      icon: 'Wallet',
      version: '1.0.0',
      frontendUrl: getPluginUrl('myWallet'),
    },
    {
      name: 'myDashboard',
      displayName: 'My Dashboard',
      description: 'Embed Metabase dashboards with interactive analytics.',
      category: 'analytics',
      author: 'NAAP Team',
      authorEmail: 'team@naap.io',
      repository: 'https://github.com/naap/plugins/tree/main/my-dashboard',
      license: 'MIT',
      keywords: ['dashboard', 'metabase', 'analytics', 'embed', 'visualization'],
      icon: 'LayoutDashboard',
      version: '1.0.0',
      frontendUrl: getPluginUrl('myDashboard'),
    },
    {
      name: 'pluginPublisher',
      displayName: 'Plugin Publisher',
      description: 'Publish, validate, and manage your plugins in the NAAP marketplace.',
      category: 'developer',
      author: 'NAAP Team',
      authorEmail: 'team@naap.io',
      repository: 'https://github.com/naap/plugins/tree/main/plugin-publisher',
      license: 'MIT',
      keywords: ['publisher', 'marketplace', 'upload', 'validate', 'deploy'],
      icon: 'Upload',
      version: '1.0.0',
      frontendUrl: getPluginUrl('pluginPublisher'),
    },
    {
      name: 'daydreamVideo',
      displayName: 'Daydream AI Video',
      description: 'Real-time AI video transformation using StreamDiffusion.',
      category: 'media',
      author: 'NAAP Team',
      authorEmail: 'team@naap.io',
      repository: 'https://github.com/naap/plugins/tree/main/daydream-video',
      license: 'MIT',
      keywords: ['ai', 'video', 'streaming', 'diffusion', 'realtime'],
      icon: 'Video',
      version: '1.0.0',  // Matches built bundle
      frontendUrl: getPluginUrl('daydreamVideo'),
    },
  ];

  const deploymentIds: { packageId: string; deploymentId: string }[] = [];

  for (const plugin of marketplacePlugins) {
    // Create or update the package - always set publishStatus to 'published'
    const pkg = await prisma.pluginPackage.upsert({
      where: { name: plugin.name },
      update: {
        displayName: plugin.displayName,
        description: plugin.description,
        category: plugin.category,
        author: plugin.author,
        authorEmail: plugin.authorEmail,
        repository: plugin.repository,
        license: plugin.license,
        keywords: plugin.keywords,
        icon: plugin.icon,
        isCore: plugin.isCore || false,
        publishStatus: 'published', // Always ensure published
      },
      create: {
        name: plugin.name,
        displayName: plugin.displayName,
        description: plugin.description,
        category: plugin.category,
        author: plugin.author,
        authorEmail: plugin.authorEmail,
        repository: plugin.repository,
        license: plugin.license,
        keywords: plugin.keywords,
        icon: plugin.icon,
        isCore: plugin.isCore || false,
        publishStatus: 'published',
      },
    });

    // Create the version
    const version = await prisma.pluginVersion.upsert({
      where: {
        packageId_version: {
          packageId: pkg.id,
          version: plugin.version,
        },
      },
      update: {
        frontendUrl: plugin.frontendUrl,
        manifest: {
          name: plugin.name,
          displayName: plugin.displayName,
          version: plugin.version,
          description: plugin.description,
          category: plugin.category,
          icon: plugin.icon,
        },
      },
      create: {
        packageId: pkg.id,
        version: plugin.version,
        frontendUrl: plugin.frontendUrl,
        manifest: {
          name: plugin.name,
          displayName: plugin.displayName,
          version: plugin.version,
          description: plugin.description,
          category: plugin.category,
          icon: plugin.icon,
        },
      },
    });

    // Create deployment
    const deployment = await prisma.pluginDeployment.upsert({
      where: { packageId: pkg.id },
      update: {
        versionId: version.id,
        status: 'running',
        frontendUrl: plugin.frontendUrl,
        deployedAt: new Date(),
        healthStatus: 'healthy',
      },
      create: {
        packageId: pkg.id,
        versionId: version.id,
        status: 'running',
        frontendUrl: plugin.frontendUrl,
        deployedAt: new Date(),
        healthStatus: 'healthy',
        activeInstalls: 0,
      },
    });

    deploymentIds.push({ packageId: pkg.id, deploymentId: deployment.id });
  }
  console.log(`   ✅ Created ${marketplacePlugins.length} marketplace packages with deployments`);

  // ============================================
  // 9. Tenant Plugin Installations
  // ============================================
  console.log('📦 Creating tenant plugin installations...');

  const allUsers = await prisma.user.findMany({ select: { id: true } });
  let tenantInstallCount = 0;

  for (const user of allUsers) {
    for (const { deploymentId } of deploymentIds) {
      const existing = await prisma.tenantPluginInstall.findUnique({
        where: {
          userId_deploymentId: {
            userId: user.id,
            deploymentId: deploymentId,
          },
        },
      });

      if (!existing) {
        await prisma.tenantPluginInstall.create({
          data: {
            userId: user.id,
            deploymentId: deploymentId,
            status: 'active',
            enabled: true,
            order: 0,
            installedAt: new Date(),
          },
        });
        tenantInstallCount++;
      }
    }
  }

  // Update activeInstalls counts
  for (const { deploymentId } of deploymentIds) {
    const count = await prisma.tenantPluginInstall.count({
      where: { deploymentId: deploymentId, status: 'active' },
    });
    await prisma.pluginDeployment.update({
      where: { id: deploymentId },
      data: { activeInstalls: count },
    });
  }
  console.log(`   ✅ Created ${tenantInstallCount} tenant plugin installations`);

  // ============================================
  // 10. User Plugin Preferences (Core Plugins for All Users)
  // ============================================
  console.log('⭐ Creating user plugin preferences for core plugins...');

  // Core plugins that should be visible to all users
  const corePluginNames = ['marketplace', 'pluginPublisher'];
  
  const allUsersForPrefs = await prisma.user.findMany({ select: { id: true } });
  let prefCount = 0;

  for (const user of allUsersForPrefs) {
    for (const pluginName of corePluginNames) {
      const existing = await prisma.userPluginPreference.findUnique({
        where: { userId_pluginName: { userId: user.id, pluginName } },
      });

      if (!existing) {
        await prisma.userPluginPreference.create({
          data: {
            userId: user.id,
            pluginName,
            enabled: true,
            pinned: pluginName === 'marketplace', // Pin marketplace by default
            order: pluginName === 'marketplace' ? 0 : 100,
          },
        });
        prefCount++;
      }
    }
  }
  console.log(`   ✅ Created ${prefCount} user plugin preferences for core plugins`);

  // ============================================
  // 11. Historical Stats (Observability)
  // ============================================
  console.log('📊 Creating historical stats...');

  const stats = [
    { service: 'gateway-manager', metric: 'active_gateways', value: 48 },
    { service: 'orchestrator-manager', metric: 'active_orchestrators', value: 156 },
    { service: 'network-analytics', metric: 'total_jobs', value: 1245 },
    { service: 'network-analytics', metric: 'success_rate', value: 99.4 },
  ];

  for (const stat of stats) {
    await prisma.historicalStat.create({
      data: {
        ...stat,
        timestamp: new Date(),
        metadata: {
          source: 'seed',
        },
      },
    });
  }
  console.log(`   ✅ Created ${stats.length} historical stats`);

  // ============================================
  // 11. Job Feeds (Recent Activity)
  // ============================================
  console.log('📡 Creating job feeds...');

  const jobFeeds = Array.from({ length: 20 }, (_, i) => ({
    gatewayId: `gw-${(i % 5) + 1}`,
    gatewayAddress: `0x${Math.random().toString(16).substr(2, 40)}`,
    jobId: `job-${i + 1}`,
    jobType: ['text-to-image', 'llm', 'upscale', 'image-to-video'][i % 4],
    status: ['processing', 'completed', 'completed', 'failed'][i % 4],
    latencyMs: Math.floor(Math.random() * 2000) + 100,
    priceWei: (Math.floor(Math.random() * 1000000) + 100000).toString(),
    timestamp: new Date(Date.now() - i * 60000),
    metadata: {
      pipeline: 'default',
    },
  }));

  for (const feed of jobFeeds) {
    await prisma.jobFeed.create({
      data: feed,
    });
  }
  console.log(`   ✅ Created ${jobFeeds.length} job feeds`);

  // ============================================
  // Summary
  // ============================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Seeding completed successfully!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n📋 Test Credentials:');
  console.log('   All users use password: livepeer');
  console.log('');
  console.log('   👤 System Admin:');
  console.log('      Email:    admin@livepeer.org');
  console.log('      Password: livepeer');
  console.log('      Role:     system:admin');
  console.log('');
  console.log('   👤 Plugin Admins (same password):');
  console.log('      gateway@livepeer.org     - gateway-manager:admin');
  console.log('      orchestrator@livepeer.org - orchestrator-manager:admin');
  console.log('      capacity@livepeer.org    - capacity-planner:admin');
  console.log('      analytics@livepeer.org   - network-analytics:admin');
  console.log('      marketplace@livepeer.org - marketplace:admin');
  console.log('      community@livepeer.org   - community:admin');
  console.log('      developer@livepeer.org   - developer-api:admin');
  console.log('      wallet@livepeer.org      - my-wallet:admin');
  console.log('      dashboard@livepeer.org   - my-dashboard:admin');
  console.log('      publisher@livepeer.org   - plugin-publisher:admin');
  console.log('');
  console.log('   👤 Viewer:');
  console.log('      Email:    viewer@livepeer.org');
  console.log('      Password: livepeer');
  console.log('      Role:     system:viewer');
  console.log('');
  console.log('   🔗 Legacy Wallet User:');
  console.log('      Address: 0x71C7656EC7ab88b098defB751B7401B5f6d8976F');
  console.log('      Role:    system:admin');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
