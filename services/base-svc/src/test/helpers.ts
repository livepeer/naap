/**
 * Test Helpers
 *
 * Mock factories and Express app builder for route contract tests.
 * Each route module's tests should use these helpers to create
 * isolated, deterministic test environments.
 */

import express, { Express } from 'express';
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Prisma mock factory
// ---------------------------------------------------------------------------

/**
 * Creates a mock PrismaClient with common model methods stubbed.
 * Individual tests can override specific methods as needed.
 */
export function createMockDb() {
  const mockModel = () => ({
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    upsert: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    count: vi.fn().mockResolvedValue(0),
    groupBy: vi.fn().mockResolvedValue([]),
    aggregate: vi.fn().mockResolvedValue({}),
  });

  return {
    pluginConfig: mockModel(),
    pluginPackage: mockModel(),
    pluginVersion: mockModel(),
    pluginReview: mockModel(),
    pluginInstallation: mockModel(),
    pluginPublisher: mockModel(),
    apiToken: mockModel(),
    session: mockModel(),
    user: mockModel(),
    featureFlag: mockModel(),
    jobFeed: mockModel(),
    historicalStat: mockModel(),
    workflowPlugin: mockModel(),
    userPluginPreference: mockModel(),
    auditLog: mockModel(),
    integrationConfig: mockModel(),
    tenantPluginInstall: mockModel(),
    userRoleAssignment: mockModel(),
    pluginRole: mockModel(),
    userConfig: mockModel(),
    userRole: mockModel(),
    pluginDeployment: mockModel(),
    publisher: mockModel(),
    webhookSecret: mockModel(),
    pluginIntegrationPermission: mockModel(),
    $transaction: vi.fn().mockImplementation((fn: any) => fn({
      pluginReview: mockModel(),
      pluginPackage: mockModel(),
    })),
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
  } as any;
}

// ---------------------------------------------------------------------------
// Service mock factories
// ---------------------------------------------------------------------------

export function createMockLifecycleService() {
  return {
    audit: vi.fn().mockResolvedValue({}),
    recordEvent: vi.fn().mockResolvedValue({}),
    getPluginEvents: vi.fn().mockResolvedValue([]),
    getRecentEvents: vi.fn().mockResolvedValue([]),
    installPlugin: vi.fn().mockResolvedValue({}),
    uninstallPlugin: vi.fn().mockResolvedValue({}),
    upgradePlugin: vi.fn().mockResolvedValue({}),
    enablePlugin: vi.fn().mockResolvedValue({}),
    disablePlugin: vi.fn().mockResolvedValue({}),
    getAuditLogs: vi.fn().mockResolvedValue([]),
    registerPluginRoles: vi.fn().mockResolvedValue(undefined),
    unregisterPluginRoles: vi.fn().mockResolvedValue(undefined),
  };
}

export function createMockPublishMetrics() {
  return {
    getSummary: vi.fn().mockResolvedValue({ total: 0, period: '7d' }),
    getPackageMetrics: vi.fn().mockResolvedValue({ downloads: 0 }),
    recordPublish: vi.fn().mockResolvedValue(undefined),
  };
}

export function createMockArtifactHealth() {
  return {
    getHealthSummary: vi.fn().mockResolvedValue({ healthy: 0, unhealthy: 0 }),
    checkArtifact: vi.fn().mockResolvedValue({ healthy: true, issues: [] }),
    checkAllInstalled: vi.fn().mockResolvedValue([]),
  };
}

export function createMockManifestValidator() {
  return {
    validate: vi.fn().mockReturnValue({ valid: true, errors: [] }),
  };
}

export function createMockVersionManager() {
  return {
    validateVersion: vi.fn().mockReturnValue({ valid: true }),
    checkVersionConflict: vi.fn().mockResolvedValue(null),
    getVersionHistory: vi.fn().mockResolvedValue([]),
    getLatestVersion: vi.fn().mockResolvedValue(null),
    checkForUpgrade: vi.fn().mockResolvedValue({ available: false }),
  };
}

export function createMockSecretVaultService() {
  return {
    storeSecret: vi.fn().mockResolvedValue({}),
    listSecrets: vi.fn().mockResolvedValue([]),
    deleteSecret: vi.fn().mockResolvedValue(true),
    rotateSecret: vi.fn().mockResolvedValue({}),
    getAllKeyMappings: vi.fn().mockResolvedValue([]),
    getPluginKeyMappings: vi.fn().mockResolvedValue([]),
    createKeyMapping: vi.fn().mockResolvedValue({}),
    deleteKeyMapping: vi.fn().mockResolvedValue(true),
  };
}

export function createMockRbacService() {
  return {
    getRoles: vi.fn().mockResolvedValue([]),
    upsertRole: vi.fn().mockResolvedValue({}),
    deleteRole: vi.fn().mockResolvedValue({}),
    assignRoleWithAudit: vi.fn().mockResolvedValue({}),
    revokeRoleWithAudit: vi.fn().mockResolvedValue({}),
    getUserWithRoles: vi.fn().mockResolvedValue(null),
    hasPermission: vi.fn().mockResolvedValue(false),
    getUserPermissions: vi.fn().mockResolvedValue([]),
    getEffectivePermissions: vi.fn().mockResolvedValue([]),
    getAllUsersWithRoles: vi.fn().mockResolvedValue([]),
    hasRole: vi.fn().mockResolvedValue(false),
  };
}

export function createMockDelegationService() {
  return {
    isSystemAdmin: vi.fn().mockResolvedValue(false),
    isPluginAdmin: vi.fn().mockResolvedValue(false),
    getAssignableRoles: vi.fn().mockResolvedValue([]),
    getPluginUsers: vi.fn().mockResolvedValue([]),
    getPluginRoles: vi.fn().mockResolvedValue([]),
  };
}

export function createMockTenantService() {
  return {
    listUserInstallations: vi.fn().mockResolvedValue([]),
    getInstallation: vi.fn().mockResolvedValue(null),
    getInstallationByPlugin: vi.fn().mockResolvedValue(null),
    createInstallation: vi.fn().mockResolvedValue({ install: {}, isFirstInstall: true }),
    uninstall: vi.fn().mockResolvedValue({ success: true, shouldCleanup: false, deploymentId: 'dep-1' }),
    updatePreferences: vi.fn().mockResolvedValue({}),
    getConfig: vi.fn().mockResolvedValue({ settings: {} }),
    updateConfig: vi.fn().mockResolvedValue({}),
    getUsersWithPlugin: vi.fn().mockResolvedValue([]),
  };
}

export function createMockDeploymentService() {
  return {
    getOrCreateDeployment: vi.fn().mockResolvedValue({ deployment: { id: 'dep-1', version: { version: '1.0.0', frontendUrl: null } }, isNew: false }),
    startDeployment: vi.fn().mockResolvedValue(undefined),
    completeDeployment: vi.fn().mockResolvedValue(undefined),
    cleanupDeployment: vi.fn().mockResolvedValue(undefined),
    listDeployments: vi.fn().mockResolvedValue([]),
    getDeploymentByName: vi.fn().mockResolvedValue(null),
    getStats: vi.fn().mockResolvedValue({ total: 0, active: 0 }),
  };
}

// ---------------------------------------------------------------------------
// Express app builder
// ---------------------------------------------------------------------------

/**
 * Creates a minimal Express app with JSON parsing enabled.
 * Mount route modules onto this app for isolated testing.
 */
export function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  return app;
}
