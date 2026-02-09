// @naap/database - Database seed script
// This script populates the database with development/test data
//
// SAFETY: This script will NOT run in production to prevent data loss
// To run in development: npx tsx prisma/seed.ts
// To force in staging: SEED_CONFIRM=yes npx tsx prisma/seed.ts

import { PrismaClient } from '../src/generated/client';

const prisma = new PrismaClient();

// Safety check to prevent accidental production seeding
function checkEnvironment(): void {
  const env = process.env.NODE_ENV || 'development';

  // Never allow in production
  if (env === 'production') {
    console.error('❌ FATAL: Cannot run seed script in production environment!');
    console.error('   This would destroy all existing data.');
    console.error('   If you need to seed a new production database, use SEED_CONFIRM=yes with NODE_ENV=staging');
    process.exit(1);
  }

  // Require confirmation for non-development environments
  if (env !== 'development' && process.env.SEED_CONFIRM !== 'yes') {
    console.error(`❌ FATAL: Running seed in ${env} environment requires confirmation.`);
    console.error('   Set SEED_CONFIRM=yes environment variable to proceed.');
    console.error('   WARNING: This will delete all existing data!');
    process.exit(1);
  }

  // Warn about destructive operation
  console.log(`⚠️  Environment: ${env}`);
  if (env !== 'development') {
    console.log('⚠️  SEED_CONFIRM=yes detected - proceeding with caution');
  }
}

async function main() {
  // Run safety check first
  checkEnvironment();

  console.log('🌱 Starting database seed...');

  // Clean existing data (in reverse order of dependencies)
  console.log('🧹 Cleaning existing data (this is destructive!)...');
  
  // Plugin data
  await prisma.$executeRaw`TRUNCATE TABLE plugin_community."CommunityUserBadge" CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE plugin_community."CommunityBadge" CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE plugin_community."CommunityReputationLog" CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE plugin_community."CommunityPostTag" CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE plugin_community."CommunityTag" CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE plugin_community."CommunityVote" CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE plugin_community."CommunityComment" CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE plugin_community."CommunityPost" CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE plugin_community."CommunityProfile" CASCADE`;
  
  await prisma.$executeRaw`TRUNCATE TABLE plugin_gateway."GatewayConfig" CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE plugin_gateway."GatewayPerformanceMetric" CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE plugin_gateway."GatewayOrchestratorConnection" CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE plugin_gateway."Gateway" CASCADE`;
  
  await prisma.$executeRaw`TRUNCATE TABLE plugin_wallet."WalletSettings" CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE plugin_wallet."WalletOrchestrator" CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE plugin_wallet."WalletStakingState" CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE plugin_wallet."WalletTransactionLog" CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE plugin_wallet."WalletConnection" CASCADE`;
  
  await prisma.$executeRaw`TRUNCATE TABLE plugin_dashboard."DashboardPluginConfig" CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE plugin_dashboard."DashboardUserPreference" CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE plugin_dashboard."Dashboard" CASCADE`;
  
  await prisma.$executeRaw`TRUNCATE TABLE plugin_daydream.daydream_sessions CASCADE`;
  await prisma.$executeRaw`TRUNCATE TABLE plugin_daydream.daydream_settings CASCADE`;

  // Core platform data
  await prisma.userRole.deleteMany();
  await prisma.role.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.teamMemberPluginConfig.deleteMany();
  await prisma.teamMemberPluginAccess.deleteMany();
  await prisma.teamPluginInstall.deleteMany();
  await prisma.tenantPluginConfig.deleteMany();
  await prisma.tenantPluginInstall.deleteMany();
  await prisma.pluginDeployment.deleteMany();
  await prisma.pluginInstallation.deleteMany();
  await prisma.pluginVersion.deleteMany();
  await prisma.pluginPackage.deleteMany();
  await prisma.apiToken.deleteMany();
  await prisma.publisher.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.team.deleteMany();
  await prisma.userPluginPreference.deleteMany();
  await prisma.session.deleteMany();
  await prisma.userConfig.deleteMany();
  await prisma.oAuthAccount.deleteMany();
  await prisma.loginAttempt.deleteMany();
  await prisma.featureFlag.deleteMany();
  await prisma.workflowPlugin.deleteMany();
  await prisma.user.deleteMany();

  console.log('✅ Existing data cleaned');

  // Create test users
  console.log('👤 Creating users...');
  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@naap.dev',
      displayName: 'Admin User',
      address: '0xAdminAddress123456789abcdef',
      emailVerified: new Date(),
      config: {
        create: {
          theme: 'dark',
          preferences: { notifications: true, betaFeatures: true },
          debugEnabled: true,
        },
      },
    },
  });

  const testUser = await prisma.user.create({
    data: {
      email: 'user@naap.dev',
      displayName: 'Test User',
      address: '0xUserAddress987654321fedcba',
      emailVerified: new Date(),
      config: {
        create: {
          theme: 'light',
          preferences: { notifications: true },
        },
      },
    },
  });

  const orchestratorUser = await prisma.user.create({
    data: {
      email: 'orchestrator@naap.dev',
      displayName: 'Orchestrator Operator',
      address: '0xOrchAddress456789abcdef123',
      emailVerified: new Date(),
      config: {
        create: {
          theme: 'dark',
          preferences: { dashboardLayout: 'compact' },
        },
      },
    },
  });

  console.log(`✅ Created ${3} users`);

  // Create roles
  console.log('🔐 Creating roles...');
  const adminRole = await prisma.role.create({
    data: {
      name: 'system:admin',
      displayName: 'System Administrator',
      description: 'Full system access',
      permissions: ['*'],
      scope: 'system',
      isSystem: true,
    },
  });

  const operatorRole = await prisma.role.create({
    data: {
      name: 'gateway:operator',
      displayName: 'Gateway Operator',
      description: 'Can manage gateway nodes',
      permissions: ['gateway:read', 'gateway:write', 'gateway:manage'],
      scope: 'plugin',
      pluginName: 'gateway-manager',
    },
  });

  await prisma.userRole.createMany({
    data: [
      { userId: adminUser.id, roleId: adminRole.id, grantedBy: 'system' },
      { userId: orchestratorUser.id, roleId: operatorRole.id, grantedBy: adminUser.id },
    ],
  });
  console.log('✅ Created roles and assignments');

  // Create teams
  console.log('👥 Creating teams...');
  const devTeam = await prisma.team.create({
    data: {
      name: 'NaaP Development',
      slug: 'naap-dev',
      description: 'Core development team',
      ownerId: adminUser.id,
      members: {
        create: [
          { userId: adminUser.id, role: 'owner' },
          { userId: testUser.id, role: 'member', invitedBy: adminUser.id },
          { userId: orchestratorUser.id, role: 'admin', invitedBy: adminUser.id },
        ],
      },
    },
  });
  console.log('✅ Created teams');

  // Create feature flags
  console.log('🚩 Creating feature flags...');
  await prisma.featureFlag.createMany({
    data: [
      { key: 'ai-video-enabled', enabled: true, description: 'Enable Daydream AI Video generation' },
      { key: 'community-beta', enabled: true, description: 'Community features beta access' },
      { key: 'advanced-staking', enabled: false, description: 'Advanced staking features' },
      { key: 'multi-chain', enabled: false, description: 'Multi-chain wallet support' },
    ],
  });
  console.log('✅ Created feature flags');

  // Create workflow plugins
  console.log('🔌 Creating workflow plugins...');
  await prisma.workflowPlugin.createMany({
    data: [
      {
        name: 'my-wallet',
        displayName: 'My Wallet',
        version: '1.0.0',
        remoteUrl: '',
        routes: ['/wallet', '/wallet/*'],
        enabled: true,
        order: 1,
        icon: 'wallet',
      },
      {
        name: 'gateway-manager',
        displayName: 'Gateway Manager',
        version: '1.0.0',
        remoteUrl: '',
        routes: ['/gateways', '/gateways/*'],
        enabled: true,
        order: 2,
        icon: 'server',
      },
      {
        name: 'community',
        displayName: 'Community',
        version: '1.0.0',
        remoteUrl: '',
        routes: ['/community', '/community/*'],
        enabled: true,
        order: 3,
        icon: 'users',
      },
      {
        name: 'my-dashboard',
        displayName: 'My Dashboard',
        version: '1.0.0',
        remoteUrl: '',
        routes: ['/dashboard', '/dashboard/*'],
        enabled: true,
        order: 4,
        icon: 'chart',
      },
      {
        name: 'daydream-video',
        displayName: 'Daydream Video',
        version: '1.0.0',
        remoteUrl: '',
        routes: ['/daydream', '/daydream/*'],
        enabled: true,
        order: 5,
        icon: 'video',
      },
    ],
  });
  console.log('✅ Created workflow plugins');

  // Create publisher and plugin packages
  console.log('📦 Creating plugin packages...');
  const naapPublisher = await prisma.publisher.create({
    data: {
      name: 'naap-official',
      displayName: 'NaaP Official',
      githubOrg: 'naap-official',
      email: 'plugins@naap.dev',
      verified: true,
    },
  });

  const walletPackage = await prisma.pluginPackage.create({
    data: {
      name: 'my-wallet',
      displayName: 'My Wallet',
      description: 'Livepeer staking and wallet management',
      category: 'finance',
      publisherId: naapPublisher.id,
      publishStatus: 'published',
      isCore: true,
      versions: {
        create: {
          version: '1.0.0',
          manifest: {
            name: 'my-wallet',
            version: '1.0.0',
            permissions: ['wallet:read', 'wallet:write'],
          },
          frontendUrl: '',
        },
      },
    },
  });
  console.log('✅ Created plugin packages');

  // Create community profiles
  console.log('💬 Creating community profiles...');
  const adminProfile = await prisma.communityProfile.create({
    data: {
      userId: adminUser.id,
      bio: 'Platform administrator and developer',
      reputation: 1000,
      level: 10,
    },
  });

  const userProfile = await prisma.communityProfile.create({
    data: {
      userId: testUser.id,
      bio: 'Active community member',
      reputation: 150,
      level: 3,
    },
  });
  console.log('✅ Created community profiles');

  // Create community badges
  console.log('🏆 Creating community badges...');
  const badges = await prisma.communityBadge.createMany({
    data: [
      { name: 'Early Adopter', slug: 'early-adopter', description: 'Joined during beta', icon: '🌟', criteria: 'Join during beta period', points: 50 },
      { name: 'First Post', slug: 'first-post', description: 'Created first post', icon: '✍️', criteria: 'Create your first post', points: 10 },
      { name: 'Helper', slug: 'helper', description: 'Answered 10 questions', icon: '🤝', criteria: 'Have 10 accepted answers', threshold: 10, points: 100 },
      { name: 'Staker', slug: 'staker', description: 'Staked LPT', icon: '💎', criteria: 'Stake LPT tokens', points: 25 },
    ],
  });
  console.log('✅ Created community badges');

  // Create community tags
  console.log('🏷️ Creating community tags...');
  await prisma.communityTag.createMany({
    data: [
      { name: 'Staking', slug: 'staking', description: 'LPT staking questions', color: '#22c55e' },
      { name: 'Transcoding', slug: 'transcoding', description: 'Video transcoding topics', color: '#3b82f6' },
      { name: 'AI', slug: 'ai', description: 'AI pipeline discussions', color: '#8b5cf6' },
      { name: 'Gateway', slug: 'gateway', description: 'Gateway operation', color: '#f59e0b' },
      { name: 'Bug', slug: 'bug', description: 'Bug reports', color: '#ef4444' },
    ],
  });
  console.log('✅ Created community tags');

  // Create gateway test data
  console.log('🌐 Creating gateway data...');
  const gateway1 = await prisma.gateway.create({
    data: {
      address: '0xGateway1Address',
      operatorName: 'NaaP Gateway 1',
      serviceUri: 'https://gateway1.naap.dev',
      region: 'us-east-1',
      status: 'online',
      uptime: 99.9,
      latencyP50: 45,
      latencyP99: 120,
      jobsPerMinute: 150,
      deposit: '10000000000000000000000',
      reserve: '5000000000000000000000',
      supportedPipelines: ['transcoding', 'ai-video'],
      connectedOrchestrators: 25,
      version: '0.7.5',
      configurations: {
        create: {
          slaConfig: { minUptime: 99.0, maxLatencyP50: 100 },
          pricingConfig: { basePricePerPixel: '0.000001' },
        },
      },
    },
  });

  const gateway2 = await prisma.gateway.create({
    data: {
      address: '0xGateway2Address',
      operatorName: 'NaaP Gateway 2',
      serviceUri: 'https://gateway2.naap.dev',
      region: 'eu-west-1',
      status: 'online',
      uptime: 99.5,
      latencyP50: 55,
      latencyP99: 150,
      jobsPerMinute: 120,
      deposit: '8000000000000000000000',
      reserve: '4000000000000000000000',
      supportedPipelines: ['transcoding'],
      connectedOrchestrators: 20,
      version: '0.7.5',
    },
  });
  console.log('✅ Created gateway data');

  // Create wallet test data
  console.log('💰 Creating wallet data...');
  await prisma.walletConnection.create({
    data: {
      userId: testUser.id,
      address: testUser.address!,
      chainId: 42161, // Arbitrum One
    },
  });

  await prisma.walletStakingState.create({
    data: {
      address: testUser.address!,
      chainId: 42161,
      stakedAmount: '5000000000000000000000',
      delegatedTo: '0xOrchestrator123',
      pendingRewards: '100000000000000000000',
      pendingFees: '50000000000000000',
    },
  });

  await prisma.walletOrchestrator.createMany({
    data: [
      { address: '0xOrchestrator123', chainId: 42161, name: 'Top Orchestrator', totalStake: '100000000000000000000000', rewardCut: 10, feeShare: 50 },
      { address: '0xOrchestrator456', chainId: 42161, name: 'Reliable Node', totalStake: '50000000000000000000000', rewardCut: 15, feeShare: 40 },
    ],
  });

  await prisma.walletSettings.create({
    data: {
      userId: testUser.id,
      defaultNetwork: 'arbitrum-one',
      autoConnect: true,
      showTestnets: false,
      gasStrategy: 'standard',
    },
  });
  console.log('✅ Created wallet data');

  // Create dashboard test data
  console.log('📊 Creating dashboard data...');
  await prisma.dashboard.createMany({
    data: [
      { metabaseId: 1, name: 'Network Overview', description: 'Overall network health and stats', isDefault: true, order: 1, createdBy: adminUser.id },
      { metabaseId: 2, name: 'Staking Analytics', description: 'Staking trends and rewards', isDefault: false, order: 2, createdBy: adminUser.id },
      { metabaseId: 3, name: 'Gateway Performance', description: 'Gateway metrics and SLAs', isDefault: false, order: 3, createdBy: adminUser.id },
    ],
  });
  console.log('✅ Created dashboard data');

  // Create daydream test data
  console.log('🎬 Creating daydream data...');
  await prisma.daydreamSettings.create({
    data: {
      userId: testUser.id,
      defaultPrompt: 'futuristic city',
      defaultSeed: 42,
      negativePrompt: 'blurry, low quality',
    },
  });
  console.log('✅ Created daydream data');

  // Create audit log entries
  console.log('📝 Creating audit logs...');
  await prisma.auditLog.createMany({
    data: [
      { action: 'user.login', resource: 'user', resourceId: adminUser.id, userId: adminUser.id, status: 'success' },
      { action: 'plugin.install', resource: 'plugin', resourceId: 'my-wallet', userId: adminUser.id, status: 'success', details: { version: '1.0.0' } },
      { action: 'team.create', resource: 'team', resourceId: devTeam.id, userId: adminUser.id, status: 'success' },
    ],
  });
  console.log('✅ Created audit logs');

  console.log('');
  console.log('🎉 Database seeded successfully!');
  console.log('');
  console.log('Test accounts:');
  console.log('  - admin@naap.dev (Admin)');
  console.log('  - user@naap.dev (Regular user)');
  console.log('  - orchestrator@naap.dev (Orchestrator operator)');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
