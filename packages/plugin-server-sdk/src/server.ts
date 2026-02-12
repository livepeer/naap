/**
 * Plugin Server Factory
 *
 * Creates a standardized Express server for plugin backends with:
 * - CORS, JSON parsing, compression, helmet
 * - Standard /healthz endpoint
 * - Auth middleware (JWT extraction + validation)
 * - Error handling middleware
 * - Graceful shutdown
 * - Request logging + correlation IDs
 * - Optional Prisma connection management
 */

import express, { Router, type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { CORS_ALLOWED_HEADERS } from '@naap/types';
import { createAuthMiddleware, type AuthenticatedRequest } from './middleware/auth';
import { createRequestLogger } from './middleware/logging';
import { createErrorHandler } from './middleware/errorHandler';

export interface PluginServerConfig {
  /** Plugin name (used for logging and health check) */
  name: string;

  /** Port to listen on */
  port?: number;

  /** CORS allowed origins (default: '*' in dev, restricted in prod) */
  corsOrigins?: string | string[];

  /** Whether to require JWT auth on all routes (default: true) */
  requireAuth?: boolean;

  /** Routes that skip auth (e.g., ['/healthz', '/public']) */
  publicRoutes?: string[];

  /** JWT secret for token verification (default: env NEXTAUTH_SECRET) */
  jwtSecret?: string;

  /** Whether to enable compression (default: true) */
  compression?: boolean;

  /** Whether to enable helmet security headers (default: true) */
  helmet?: boolean;

  /** Optional Prisma client for managed connection lifecycle */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma?: { $disconnect: () => Promise<void>; $connect: () => Promise<void>; [key: string]: any };

  /** Custom setup function called before routes are registered */
  setup?: (app: Express) => void | Promise<void>;

  /** Optional Livepeer BYOC auto-registration */
  livepeer?: {
    /** Automatically register this plugin as a BYOC capability */
    registerAsCapability?: boolean;
    /** Pipeline gateway base URL (default: env PIPELINE_GATEWAY_URL or http://localhost:4020/api/v1) */
    pipelineGatewayUrl?: string;
    /** BYOC capability definition */
    capability: {
      name: string;
      description?: string;
      endpoint?: string;
      schema?: { input?: unknown; output?: unknown };
      pricing?: { model: string; unitPrice: number; currency: string };
      healthCheckUrl?: string;
    };
  };
}

export interface PluginServer {
  /** The Express application */
  app: Express;

  /** Router for registering plugin routes (mounted at /api/v1) */
  router: Router;

  /** Start listening on the configured port */
  start: () => Promise<void>;

  /** Graceful shutdown */
  stop: () => Promise<void>;
}

export function createPluginServer(config: PluginServerConfig): PluginServer {
  const {
    name,
    port = parseInt(process.env.PORT || '4000', 10),
    corsOrigins,
    requireAuth = true,
    publicRoutes = ['/healthz'],
    jwtSecret = process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET || 'dev-secret',
    compression: enableCompression = true,
    helmet: enableHelmet = true,
    prisma,
    setup,
    livepeer,
  } = config;

  const app = express();
  const router = Router();
  let server: ReturnType<Express['listen']> | null = null;

  // ─── Base Middleware ────────────────────────────────────────────────

  // CORS - validate origins against allowlist; empty list = deny all (fail closed)
  const configuredOrigins =
    corsOrigins || (process.env.CORS_ALLOWED_ORIGINS || '');
  const originsArray: string[] = (
    Array.isArray(configuredOrigins)
      ? configuredOrigins
      : typeof configuredOrigins === 'string'
        ? configuredOrigins.split(',')
        : []
  )
    .map((o) => String(o).trim())
    .filter(Boolean);
  const allowAllOrigins =
    typeof configuredOrigins === 'string' && configuredOrigins.trim() === '*';
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, etc.)
      if (!origin) return callback(null, true);
      if (allowAllOrigins || originsArray.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: CORS_ALLOWED_HEADERS,
    exposedHeaders: ['X-WHIP-Resource', 'X-Request-ID'],
  }));

  // Security headers
  if (enableHelmet) {
    app.use(helmet({ contentSecurityPolicy: false }));
  }

  // Compression
  if (enableCompression) {
    app.use(compression());
  }

  // JSON body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Request logging with correlation IDs
  app.use(createRequestLogger(name));

  // ─── Health Check ──────────────────────────────────────────────────

  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: name,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // ─── Auth Middleware ───────────────────────────────────────────────

  if (requireAuth) {
    const authMiddleware = createAuthMiddleware({
      secret: jwtSecret,
      publicPaths: publicRoutes,
    });
    app.use(authMiddleware);
  }

  // ─── Plugin Routes ────────────────────────────────────────────────

  app.use('/api/v1', router);

  // ─── Error Handler (must be last) ─────────────────────────────────

  app.use(createErrorHandler(name));

  // ─── Lifecycle ────────────────────────────────────────────────────

  const start = async () => {
    // Run custom setup
    if (setup) {
      await setup(app);
    }

    // Connect Prisma if provided
    if (prisma) {
      await prisma.$connect();
      console.log(`[${name}] Database connected`);
    }

    return new Promise<void>((resolve) => {
      server = app.listen(port, () => {
        console.log(`[${name}] Server listening on port ${port}`);
        if (livepeer?.registerAsCapability) {
          registerLivepeerCapability().catch((err) => {
            console.warn(`[${name}] BYOC registration failed:`, err);
          });
        }
        resolve();
      });
    });
  };

  const stop = async () => {
    console.log(`[${name}] Shutting down gracefully...`);

    if (livepeer?.registerAsCapability) {
      await unregisterLivepeerCapability().catch((err) => {
        console.warn(`[${name}] BYOC unregister failed:`, err);
      });
    }

    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => resolve());
      });
    }

    if (prisma) {
      await prisma.$disconnect();
      console.log(`[${name}] Database disconnected`);
    }

    console.log(`[${name}] Shutdown complete`);
  };

  // Graceful shutdown on SIGTERM/SIGINT
  const shutdownHandler = () => {
    stop().then(() => process.exit(0)).catch(() => process.exit(1));
  };

  process.on('SIGTERM', shutdownHandler);
  process.on('SIGINT', shutdownHandler);

  async function registerLivepeerCapability(): Promise<void> {
    const gatewayBase =
      livepeer?.pipelineGatewayUrl ||
      process.env.PIPELINE_GATEWAY_URL ||
      'http://localhost:4020/api/v1';

    const capability = livepeer?.capability;
    if (!capability?.name) return;

    const endpoint =
      capability.endpoint ||
      process.env.PLUGIN_PUBLIC_URL ||
      process.env.PUBLIC_URL ||
      `http://localhost:${port}/api/v1/${name}`;

    const payload = {
      name: capability.name,
      endpoint,
      registeredBy: name,
      schema: capability.schema,
      pricing: capability.pricing,
      healthCheckUrl: capability.healthCheckUrl || `${endpoint}/healthz`,
    };

    const res = await fetch(`${gatewayBase}/byoc/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`BYOC register failed (${res.status}): ${text}`);
    }
  }

  async function unregisterLivepeerCapability(): Promise<void> {
    const gatewayBase =
      livepeer?.pipelineGatewayUrl ||
      process.env.PIPELINE_GATEWAY_URL ||
      'http://localhost:4020/api/v1';

    const capability = livepeer?.capability;
    if (!capability?.name) return;

    const res = await fetch(`${gatewayBase}/byoc/register/${capability.name}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registeredBy: name }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`BYOC unregister failed (${res.status}): ${text}`);
    }
  }

  return { app, router, start, stop };
}
