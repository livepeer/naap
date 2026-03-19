/**
 * My Wallet Plugin - Backend Server
 * Production-ready with error handling, validation, and audit logging
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import { readFileSync } from 'node:fs';
import { prisma } from './db/client.js';
import {
  getRedis,
  closeRedis,
  standardRateLimit,
  getCacheStats,
} from '@naap/cache';

const pluginConfig = JSON.parse(
  readFileSync(new URL('../../plugin.json', import.meta.url), 'utf8')
);
const app = express();
const PORT = process.env.PORT || pluginConfig.backend?.devPort || 4008;

// Initialize Redis (will fallback to memory if unavailable)
const redis = getRedis();
if (redis) {
  console.log('[my-wallet-svc] Redis caching enabled');
} else {
  console.log('[my-wallet-svc] Using in-memory caching (Redis not configured)');
}

// Parse CORS origins from environment variable, with localhost defaults for development
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://localhost:3008', 'http://localhost:4000'];

// Middleware
app.use(cors({
  origin: CORS_ORIGINS,
  credentials: true,
}));
app.use(compression({
  level: 6,
  threshold: 1024,
}));
app.use(express.json({ limit: '1mb' }));

// Rate limiting middleware (Redis-backed with memory fallback)
app.use(standardRateLimit);

/** Sanitize a value for safe log output (prevents log injection) */
function sanitizeForLog(value: unknown): string {
  return String(value).replace(/[\n\r\t\x00-\x1f\x7f-\x9f]/g, '');
}

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${sanitizeForLog(req.method)} ${sanitizeForLog(req.path)}`);
  next();
});

// Health check
app.get('/healthz', (req, res) => {
  const cacheStats = getCacheStats();
  res.json({
    status: 'ok',
    service: 'my-wallet',
    timestamp: new Date().toISOString(),
    cache: {
      backend: cacheStats.backend,
      redisConnected: cacheStats.redisConnected,
    }
  });
});

// ============================================
// Route modules
// ============================================

import connectionsRoutes from './routes/connections.js';
import transactionsRoutes from './routes/transactions.js';
import stakingRoutes from './routes/staking.js';
import settingsRoutes from './routes/settings.js';
import syncRoutes from './routes/sync.js';

import yieldRoutes from './routes/yield.js';
import pricesRoutes from './routes/prices.js';
import alertsRoutes from './routes/alerts.js';
import compareRoutes from './routes/compare.js';
import benchmarksRoutes from './routes/benchmarks.js';
import exportRoutes from './routes/export.js';
import walletAddressesRoutes from './routes/walletAddresses.js';
import portfolioRoutes from './routes/portfolio.js';
import unbondingLocksRoutes from './routes/unbondingLocks.js';
import protocolRoutes from './routes/protocol.js';

// Phase 3 routes
import gasAccountingRoutes from './routes/gasAccounting.js';
import rewardConsistencyRoutes from './routes/rewardConsistency.js';
import pnlRoutes from './routes/pnl.js';
import watchlistRoutes from './routes/watchlist.js';
import simulatorRoutes from './routes/simulator.js';
import riskScoreRoutes from './routes/riskScore.js';
import autoClaimRoutes from './routes/autoClaim.js';
import governanceRoutes from './routes/governance.js';
import networkHistoryRoutes from './routes/networkHistory.js';
import aiRecommendRoutes from './routes/aiRecommend.js';
import stakingHistoryRoutes from './routes/stakingHistory.js';
import snapshotsRoutes from './routes/snapshots.js';

// Phase 4 routes — analytics, network overview, performance
import orchestratorAnalyticsRoutes from './routes/orchestratorAnalytics.js';
import networkOverviewRoutes from './routes/networkOverview.js';
import orchestratorPerformanceRoutes from './routes/orchestratorPerformance.js';

app.use(connectionsRoutes);
app.use(transactionsRoutes);
app.use(stakingRoutes);
app.use(settingsRoutes);
app.use(syncRoutes);
app.use(yieldRoutes);
app.use(pricesRoutes);
app.use(alertsRoutes);
app.use(compareRoutes);
app.use(benchmarksRoutes);
app.use(exportRoutes);
app.use(walletAddressesRoutes);
app.use(portfolioRoutes);
app.use(unbondingLocksRoutes);
app.use(protocolRoutes);
app.use(gasAccountingRoutes);
app.use(rewardConsistencyRoutes);
app.use(pnlRoutes);
app.use(watchlistRoutes);
app.use(simulatorRoutes);
app.use(riskScoreRoutes);
app.use(autoClaimRoutes);
app.use(governanceRoutes);
app.use(networkHistoryRoutes);
app.use(aiRecommendRoutes);
app.use(stakingHistoryRoutes);
app.use(snapshotsRoutes);
app.use(orchestratorAnalyticsRoutes);
app.use(networkOverviewRoutes);
app.use(orchestratorPerformanceRoutes);

// ============================================
// Error Handler
// ============================================

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================
// Start Server
// ============================================

import { startScheduler, stopScheduler } from './jobs/scheduler.js';

if (process.env.VERCEL !== '1') {
  const server = app.listen(PORT, () => {
    console.log(`My Wallet backend running on http://localhost:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/healthz`);
    console.log(`   API: http://localhost:${PORT}/api/v1/wallet/*`);

    // Start cron jobs in Express mode (not on Vercel — timers die between invocations)
    if (process.env.DISABLE_CRON !== 'true') {
      startScheduler();
    }
  });

  // Graceful shutdown
  async function shutdown() {
    console.log('Shutting down gracefully...');
    stopScheduler();

    server.close(async () => {
      console.log('HTTP server closed');

      try {
        await closeRedis();
        console.log('Redis connection closed');
      } catch (err) {
        console.error('Error closing Redis:', err);
      }

      try {
        await prisma.$disconnect();
        console.log('Database connection closed');
      } catch (err) {
        console.error('Error closing database:', err);
      }

      process.exit(0);
    });

    // Force close after 30s
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

export default app;
