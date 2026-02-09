/**
 * My Dashboard Plugin - Backend Server
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { dashboardRoutes } from './routes/dashboards.js';
import { embedRoutes } from './routes/embed.js';
import { preferencesRoutes } from './routes/preferences.js';
import { configRoutes } from './routes/config.js';
import {
  getRedis,
  closeRedis,
  standardRateLimit,
  getCacheStats,
} from '@naap/cache';

dotenv.config();

const pluginConfig = JSON.parse(
  readFileSync(new URL('../../plugin.json', import.meta.url), 'utf8')
);
const app = express();
const PORT = process.env.PORT || pluginConfig.backend?.devPort || 4009;

// Initialize Redis (will fallback to memory if unavailable)
const redis = getRedis();
if (redis) {
  console.log('[my-dashboard-svc] Redis caching enabled');
} else {
  console.log('[my-dashboard-svc] Using in-memory caching (Redis not configured)');
}

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allow iframe embedding
}));
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);

    // Allow localhost origins for development (shell on 3000, plugin-server on 3100)
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3100',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3100',
    ];

    // Add custom CORS_ORIGIN if specified
    if (process.env.CORS_ORIGIN) {
      allowedOrigins.push(process.env.CORS_ORIGIN);
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all in development
    }
  },
  credentials: true,
}));
app.use(compression({
  level: 6,
  threshold: 1024,
}));
app.use(express.json());
app.use(morgan('combined'));

// Rate limiting (Redis-backed with memory fallback)
app.use(standardRateLimit);

// Health check
app.get('/healthz', (req, res) => {
  const cacheStats = getCacheStats();
  res.json({
    status: 'ok',
    plugin: 'my-dashboard',
    version: '1.0.0',
    cache: {
      backend: cacheStats.backend,
      redisConnected: cacheStats.redisConnected,
    }
  });
});

// API Routes
const apiPrefix = '/api/v1/my-dashboard';
app.use(apiPrefix, dashboardRoutes);
app.use(apiPrefix, embedRoutes);
app.use(apiPrefix, preferencesRoutes);
app.use(apiPrefix, configRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
  });
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  });
});

const server = app.listen(PORT, () => {
  console.log(`🚀 My Dashboard backend running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/healthz`);
  console.log(`   API: http://localhost:${PORT}${apiPrefix}`);
});

// Graceful shutdown
async function shutdown() {
  console.log('Shutting down gracefully...');

  server.close(async () => {
    console.log('HTTP server closed');

    try {
      await closeRedis();
      console.log('Redis connection closed');
    } catch (err) {
      console.error('Error closing Redis:', err);
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

export default app;
