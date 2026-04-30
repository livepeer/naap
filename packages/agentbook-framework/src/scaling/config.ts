/**
 * Horizontal Scaling Configuration
 * All AgentBook components are stateless and scale via Vercel Functions.
 */

export interface ScalingConfig {
  maxConcurrentTenants: number;
  connectionPoolSize: number;
  llmConcurrency: number;
  cronBatchSize: number;
  webhookTimeout: number;
  maxRequestSize: number;
}

export const PRODUCTION_CONFIG: ScalingConfig = {
  maxConcurrentTenants: 1000,
  connectionPoolSize: 10,        // PgBouncer pool per serverless function
  llmConcurrency: 5,             // concurrent LLM calls per function instance
  cronBatchSize: 50,             // tenants processed per cron invocation
  webhookTimeout: 25000,         // ms (under Vercel's 30s limit)
  maxRequestSize: 4 * 1024 * 1024, // 4MB
};

export const DEVELOPMENT_CONFIG: ScalingConfig = {
  maxConcurrentTenants: 100,
  connectionPoolSize: 5,
  llmConcurrency: 2,
  cronBatchSize: 10,
  webhookTimeout: 30000,
  maxRequestSize: 10 * 1024 * 1024,
};

export function getScalingConfig(): ScalingConfig {
  return process.env.NODE_ENV === 'production' ? PRODUCTION_CONFIG : DEVELOPMENT_CONFIG;
}

/**
 * Connection pooling notes for Vercel + Neon:
 * - DATABASE_URL uses PgBouncer (?pgbouncer=true&connection_limit=10)
 * - DATABASE_URL_UNPOOLED for migrations only
 * - Each serverless function gets its own connection pool
 * - Neon autoscales compute based on load
 * - Prisma connection management is handled by PrismaClient singleton
 */
