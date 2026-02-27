import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import { db } from './db/client';
import {
  requireToken,
  generateApiToken,
  hashToken,
  verifyGitHubWebhook,
} from './middleware/auth';
import {
  getRedis,
  closeRedis,
  strictRateLimit as authRateLimiter,
  standardRateLimit as apiRateLimiter,
  getCacheStats,
} from '@naap/cache';

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : process.env.TRUST_PROXY || false);
const PORT = process.env.PORT || 4000;

// Initialize Redis connection (will fallback to memory if unavailable)
const redis = getRedis();
if (redis) {
  console.log('[base-svc] Redis caching enabled');
} else {
  console.log('[base-svc] Using in-memory caching (Redis not configured)');
}

// ============================================
// CSRF Protection
// ============================================

import { validateCsrfToken } from './services/csrf';
import { verifyPublish } from './services/publishVerification';

// CSRF validation middleware for state-changing requests
function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // Skip CSRF for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Skip CSRF for OAuth callbacks, webhooks, review, and example-publish endpoints (they have their own auth)
  if (req.path.includes('/callback/') || req.path.includes('/webhook') || req.path.includes('/reviews') || req.path.includes('/examples/')) {
    return next();
  }

  // Get session token from Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    // No auth header means this is a public endpoint like login/register
    return next();
  }

  const token = authHeader.substring(7);
  
  // Skip CSRF for API tokens (they have their own auth via requireToken middleware)
  // API tokens start with 'naap_', session tokens are JWTs
  if (token.startsWith('naap_')) {
    return next();
  }

  const csrfToken = req.headers['x-csrf-token'] as string;

  // Validate CSRF token for session tokens
  if (!validateCsrfToken(token, csrfToken)) {
    return res.status(403).json({ 
      error: 'Invalid or missing CSRF token',
      code: 'CSRF_INVALID'
    });
  }

  next();
}

// Middleware
app.use(cors());
app.use(compression({
  level: 6,
  threshold: 1024, // Only compress responses > 1KB
  filter: (req, res) => {
    // Don't compress if client doesn't want it
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));
app.use(express.json());

// Apply CSRF protection globally (after parsing, before routes)
app.use('/api/v1', csrfProtection);

// Apply rate limiting to auth endpoints
app.use('/api/v1/auth/login', authRateLimiter);
app.use('/api/v1/auth/register', authRateLimiter);
app.use('/api/v1/auth/forgot-password', authRateLimiter);
app.use('/api/v1/auth/reset-password', authRateLimiter);

// Health check endpoint (mounted at root, not /api/v1)
app.get('/healthz', async (_req, res) => {
  let dbStatus: string;
  try {
    await db.$queryRaw`SELECT 1`;
    dbStatus = 'healthy';
  } catch {
    dbStatus = 'unhealthy';
  }

  const cacheStats = getCacheStats();

  res.json({
    status: dbStatus === 'healthy' ? 'healthy' : 'degraded',
    service: 'base-svc',
    version: '0.0.1',
    timestamp: new Date().toISOString(),
    database: { status: dbStatus },
    cache: {
      backend: cacheStats.backend,
      redisConnected: cacheStats.redisConnected,
      memoryEntries: cacheStats.memorySize,
    }
  });
});

// ============================================
// Authentication API (Email/Password + OAuth)
// ============================================

import { createAuthRoutes } from './routes/auth';
import { createGetUserIdFromRequest } from './utils/getUserId';

// Auth routes are mounted after lifecycleService is created (see below).
// We use a late-binding pattern: register a placeholder that is replaced
// once all dependencies are available.

let _authService: ReturnType<typeof import('./services/auth').createAuthService>;

// getUserIdFromRequest is used across many route sections.
// Bind it lazily so it picks up authService once initialized.
let getUserIdFromRequest: (req: import('express').Request) => Promise<string | null>;

function _initAuthRoutes() {
  const { router, authService } = createAuthRoutes({ db, lifecycleService });
  _authService = authService;
  getUserIdFromRequest = createGetUserIdFromRequest(
    (token) => authService.validateSession(token)
  );
  app.use('/api/v1', router);
}
// Defer call until lifecycleService is available (see Plugin Lifecycle section)


// ============================================
// Registry Routes (Marketplace, Reviews, Publishers, Publish)
// ============================================

import { createBaseRoutes } from './routes/base';
import { createTenantRoutes } from './routes/tenant';
import { createRegistryRoutes } from './routes/registry';
import { createTokensWebhooksRoutes } from './routes/tokens-webhooks';

// These will be initialized after services are created (_initRegistryRoutes)
let _registryInitialized = false;

function _initRegistryRoutes() {
  if (_registryInitialized) return;

  const registryRoutes = createRegistryRoutes({
    db, getUserIdFromRequest, lifecycleService,
    authService: _authService,
    requireToken, generateApiToken, verifyPublish,
  });
  app.use('/api/v1', registryRoutes);

  const tokensWebhooksRoutes = createTokensWebhooksRoutes({
    db, lifecycleService, getUserIdFromRequest,
    generateApiToken, hashToken, requireToken, verifyGitHubWebhook,
  });
  app.use('/api/v1', tokensWebhooksRoutes);

  _registryInitialized = true;
}

// ============================================
// Service Initialization
// ============================================

import { createLifecycleService } from './services/lifecycle';
import { createSecretVaultService } from './services/secrets';
import { createRBACService } from './services/rbac';
import { getDelegationService } from './services/delegation';
import { createTenantService } from './services/tenant';
import { createDeploymentService } from './services/deployment';
import { createTenantMiddleware, forwardTenantHeaders } from './middleware/tenantContext';

const lifecycleService = createLifecycleService(db);
const secretVaultService = createSecretVaultService(db);
const rbacService = createRBACService(db);
const delegationService = getDelegationService(db);
const tenantService = createTenantService(db);
const deploymentService = createDeploymentService(db);
const tenantMiddleware = createTenantMiddleware(db);

// Initialize auth routes now that lifecycleService is available
_initAuthRoutes();

// Initialize registry and tokens/webhooks routes (depend on _authService + services)
_initRegistryRoutes();

// ============================================
// Base Routes (CSP, Legacy Auth, Features, Jobs, Stats, Plugins, Preferences, Debug)
// ============================================

const baseRoutes = createBaseRoutes({ db, requireToken, getCacheStats });
app.use('/api/v1', baseRoutes);

// ============================================
// Tenant Routes (Multi-Tenant Installations, Deployments)
// ============================================

const tenantRoutes = createTenantRoutes({
  db, tenantService, deploymentService, rbacService, lifecycleService,
  getUserIdFromRequest, csrfProtection, tenantMiddleware, forwardTenantHeaders,
});
app.use('/api/v1', tenantRoutes);

// ============================================
// Lifecycle Routes (Installation, Integration, Lifecycle Events)
// ============================================

import { createLifecycleRoutes } from './routes/lifecycle';

const lifecycleRoutes = createLifecycleRoutes({ db, lifecycleService, secretVaultService });
app.use('/api/v1', lifecycleRoutes);

// ============================================
// Secrets Routes (Vault + Key Mappings)
// ============================================

import { createSecretsRoutes } from './routes/secrets';

const secretsRoutes = createSecretsRoutes({ secretVaultService, lifecycleService });
app.use('/api/v1', secretsRoutes);

// ============================================
// RBAC Routes (Roles, Permissions, Admin, Plugin Admin)
// ============================================

import { createRbacRoutes } from './routes/rbac';

const rbacRoutes = createRbacRoutes({
  rbacService, delegationService, lifecycleService, getUserIdFromRequest,
});
app.use('/api/v1', rbacRoutes);

// ============================================
// Metadata Routes (Plugin Config, Metrics, Health, Validation, Versions)
// ============================================

import { publishMetrics } from './services/publishMetrics';
import { artifactHealth } from './services/artifactHealth';
import { manifestValidator } from './services/manifestValidator';
import { versionManager } from './services/versionManager';
import { createMetadataRoutes } from './routes/metadata';

const metadataRoutes = createMetadataRoutes({
  db, publishMetrics, artifactHealth, manifestValidator, versionManager,
});
app.use('/api/v1', metadataRoutes);

// Initialize service registry and register services
// const serviceRegistry = getServiceRegistry();

// Register Kafka consumer service (only if Kafka is configured)
// Disabled for now - uncomment when Kafka is needed
// if (process.env.KAFKA_BROKERS || process.env.KAFKA_ENABLED !== 'false') {
//   const kafkaConsumer = new KafkaConsumerService();
//   serviceRegistry.register(kafkaConsumer);
// }
const serviceRegistry = { startAll: async () => {} };


// ============================================
// Team/Organization Routes
// ============================================

import { createTeamRoutes } from './routes/team';

const teamRoutes = createTeamRoutes(db);
app.use('/api/v1', teamRoutes);

// ============================================
// Admin Routes (Phase 1.5: Tenant Management)
// ============================================

import { createAdminTenantRoutes } from './routes/admin/tenants';

const adminTenantRoutes = createAdminTenantRoutes(db);
app.use('/api/v1/admin', adminTenantRoutes);

// ============================================
// WebSocket Server
// ============================================

import { createServer } from 'http';
import { createWebSocketService } from './services/websocket';

const httpServer = createServer(app);
const wsService = createWebSocketService(db);

// Export for use in other modules (e.g., to broadcast events)
export { wsService };

// Graceful shutdown
async function shutdown() {
  console.log('Shutting down gracefully...');

  // Stop WebSocket service
  wsService.shutdown();

  // Close Redis connection
  try {
    await closeRedis();
    console.log('Redis connection closed');
  } catch (err) {
    console.error('Error closing Redis:', err);
  }

  // Close database connection
  try {
    await db.$disconnect();
    console.log('Database connection closed');
  } catch (err) {
    console.error('Error closing database:', err);
  }

  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
httpServer.listen(PORT, async () => {
  console.log(`🚀 base-svc running on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/healthz`);
  console.log(`   API: http://localhost:${PORT}/api/v1/base/`);
  console.log(`   WebSocket: ws://localhost:${PORT}/ws`);
  
  // Initialize WebSocket server
  wsService.initialize(httpServer, '/ws');
  
  // Test database connection
  try {
    await db.$connect();
    console.log(`   Database: Connected`);
  } catch (error) {
    console.error(`   Database: Connection failed - ${error}`);
  }

  // Start registered services
  try {
    await serviceRegistry.startAll();
    console.log(`   Services: All services started`);
  } catch (error) {
    console.error(`   Services: Failed to start some services - ${error}`);
  }

  // Fix existing packages with 'draft' status that are actually published (one-time migration)
  try {
    const result = await db.pluginPackage.updateMany({
      where: { publishStatus: 'draft' },
      data: { publishStatus: 'published' },
    });
    if (result.count > 0) {
      console.log(`   Migration: Updated ${result.count} packages from 'draft' to 'published'`);
    }
  } catch (error) {
    console.warn(`   Migration: Could not update package statuses - ${error}`);
  }
});
