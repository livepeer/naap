// @naap/database - Unified database client export
// This package provides a single Prisma client instance for all services
//
// Features:
// - Singleton pattern to prevent connection exhaustion
// - Production-ready configuration with connection pooling
// - Comprehensive health checks for all PostgreSQL schemas
// - Transaction helpers for complex operations
// - Vercel/Serverless compatible

import { PrismaClient as GeneratedPrismaClient, Prisma } from './generated/client/index.js';

// Re-export all types from generated client
export * from './generated/client/index.js';

// Re-export catalog constants
export { BILLING_PROVIDERS } from './billing-providers';

// Shared developer-api utilities
export { DevApiProjectResolutionError, resolveDevApiProjectId } from './dev-api/resolveDevApiProject';
export { parseApiKey, deriveKeyLookupId, getKeyPrefix, hashApiKey } from './dev-api/key-utils';
export { encryptToken, decryptToken } from './dev-api/token-encryption';

// Type for transaction client
export type TransactionClient = Omit<
  GeneratedPrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// Singleton pattern for Prisma client
const globalForPrisma = globalThis as unknown as {
  prisma: GeneratedPrismaClient | undefined;
};

/**
 * Resolve the database connection URL.
 *
 * Vercel Storage (Neon) sets env vars with POSTGRES_* prefixes.
 * Local development uses DATABASE_URL.  We check all known names
 * so the same code works everywhere without extra config.
 *
 * Priority:
 *   1. DATABASE_URL          – explicit override / local dev
 *   2. POSTGRES_PRISMA_URL   – Vercel Storage (includes connect_timeout)
 *   3. POSTGRES_URL          – Vercel Storage pooled URL
 */
function getConnectionUrl(): string {
  const baseUrl =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL ||
    '';

  if (!baseUrl) {
    console.warn(
      '[database] No database URL found. Checked: DATABASE_URL=%s, POSTGRES_PRISMA_URL=%s, POSTGRES_URL=%s',
      process.env.DATABASE_URL ? 'SET' : 'EMPTY',
      process.env.POSTGRES_PRISMA_URL ? 'SET' : 'EMPTY',
      process.env.POSTGRES_URL ? 'SET' : 'EMPTY',
    );
    return '';
  }

  // Log which env var was resolved (mask the value for security)
  const source = process.env.DATABASE_URL
    ? 'DATABASE_URL'
    : process.env.POSTGRES_PRISMA_URL
    ? 'POSTGRES_PRISMA_URL'
    : 'POSTGRES_URL';
  console.log(`[database] Using ${source} (${baseUrl.substring(0, 30)}...)`);

  // If URL already has query params, don't modify
  if (baseUrl.includes('?')) {
    return baseUrl;
  }

  // Add connection pool settings for production
  if (process.env.NODE_ENV === 'production') {
    const poolParams = new URLSearchParams({
      connection_limit: process.env.DATABASE_POOL_SIZE || '10',
      pool_timeout: process.env.DATABASE_POOL_TIMEOUT || '30',
    });
    return `${baseUrl}?${poolParams.toString()}`;
  }

  return baseUrl;
}

// Create singleton instance with production configuration
export const prisma =
  globalForPrisma.prisma ??
  new GeneratedPrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
    datasources: {
      db: {
        url: getConnectionUrl(),
      },
    },
  });

// Only cache in non-production to support hot reload
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Export the client class for type usage
export { GeneratedPrismaClient as PrismaClient };

/**
 * Disconnect the Prisma client from the database.
 * Call during graceful shutdown.
 */
export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Connect the Prisma client to the database explicitly.
 * Usually not needed — Prisma connects lazily on first query.
 */
export async function connect(): Promise<void> {
  await prisma.$connect();
}

/**
 * Warm up the connection pool (call during app startup).
 * Executes a lightweight query to establish connections.
 */
export async function warmupConnections(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

// Schema accessibility check results
export interface SchemaAccessResult {
  schema: string;
  accessible: boolean;
  error?: string;
}

/**
 * Comprehensive health check that verifies database connectivity and optionally all schemas.
 * @param options - Optional config; checkAllSchemas verifies plugin schemas exist
 * @returns Health status, latency, and optional schema access results
 */
export async function healthCheck(options?: { checkAllSchemas?: boolean }): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs: number;
  database: boolean;
  schemas?: SchemaAccessResult[];
  error?: string;
}> {
  const start = Date.now();
  const result: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    latencyMs: number;
    database: boolean;
    schemas?: SchemaAccessResult[];
    error?: string;
  } = {
    status: 'unhealthy',
    latencyMs: 0,
    database: false,
  };

  try {
    // Basic connectivity check
    await prisma.$queryRaw`SELECT 1`;
    result.database = true;

    // Optionally check all schemas
    if (options?.checkAllSchemas) {
      const schemas = [
        { name: 'public', query: 'SELECT 1 FROM public."User" LIMIT 0' },
        { name: 'plugin_community', query: 'SELECT 1 FROM plugin_community."CommunityProfile" LIMIT 0' },
        { name: 'plugin_wallet', query: 'SELECT 1 FROM plugin_wallet."WalletConnection" LIMIT 0' },
        { name: 'plugin_dashboard', query: 'SELECT 1 FROM plugin_dashboard."Dashboard" LIMIT 0' },
        { name: 'plugin_daydream', query: 'SELECT 1 FROM plugin_daydream.daydream_settings LIMIT 0' },
        { name: 'plugin_gateway', query: 'SELECT 1 FROM plugin_gateway."Gateway" LIMIT 0' },
      ];

      result.schemas = [];
      let allAccessible = true;

      for (const schema of schemas) {
        try {
          await prisma.$queryRawUnsafe(schema.query);
          result.schemas.push({ schema: schema.name, accessible: true });
        } catch (err) {
          allAccessible = false;
          result.schemas.push({
            schema: schema.name,
            accessible: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }

      result.status = allAccessible ? 'healthy' : 'degraded';
    } else {
      result.status = 'healthy';
    }
  } catch (error) {
    result.status = 'unhealthy';
    result.error = error instanceof Error ? error.message : 'Unknown error';
  }

  result.latencyMs = Date.now() - start;
  return result;
}

/**
 * Execute a function within a database transaction.
 * @param fn - Async function receiving the transaction client
 * @param options - Optional maxWait, timeout, isolationLevel
 * @returns The value returned by fn
 */
export async function withTransaction<T>(
  fn: (tx: TransactionClient) => Promise<T>,
  options?: {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: Prisma.TransactionIsolationLevel;
  }
): Promise<T> {
  return prisma.$transaction(fn, {
    maxWait: options?.maxWait ?? 5000,
    timeout: options?.timeout ?? 10000,
    isolationLevel: options?.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
  });
}

/**
 * Retry an async operation on transient Prisma errors (connection, transaction).
 * @param fn - Async function to execute
 * @param options - Optional maxRetries, retryDelay, retryOn predicate
 * @returns The value returned by fn after successful execution
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: {
    maxRetries?: number;
    retryDelay?: number;
    retryOn?: (error: unknown) => boolean;
  }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const retryDelay = options?.retryDelay ?? 100;
  const retryOn = options?.retryOn ?? ((error: unknown) => {
    // Retry on connection/transaction errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return ['P2024', 'P2028', 'P2034'].includes(error.code);
    }
    return false;
  });

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries && retryOn(error)) {
        await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt)));
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

// Default export for convenience
export default prisma;
