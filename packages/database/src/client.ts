/**
 * Database client utilities for @naap/database
 *
 * This module provides backward-compatible factory functions.
 * All clients now use the unified Prisma client from index.ts.
 * The singleton pattern ensures one connection pool shared by all services.
 */

import { prisma, PrismaClient } from './index';
import type { DatabaseConfig, DatabaseHealth } from './types';

/**
 * Returns the unified Prisma client.
 * The `config` parameter is accepted for backward compatibility but
 * the connection string is always taken from DATABASE_URL (unified DB).
 */
export function createDatabaseClient<T extends PrismaClient>(
  _config: DatabaseConfig
): T {
  return prisma as unknown as T;
}

/**
 * Returns the unified Prisma client.
 */
export function getDatabaseClient<T extends PrismaClient>(
  _service: string
): T {
  return prisma as unknown as T;
}

/**
 * Disconnects the unified Prisma client.
 */
export async function disconnectClient(_service: string): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Disconnects the unified Prisma client.
 */
export async function disconnectAll(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Health check for the unified database connection.
 */
export async function checkHealth(
  service: string
): Promise<DatabaseHealth> {
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const latency = Date.now() - start;

    return {
      status: 'healthy',
      service,
      connected: true,
      latency,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      service,
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Health check — same as checkHealth since there's only one connection.
 */
export async function checkAllHealth(): Promise<
  Record<string, DatabaseHealth>
> {
  const result = await checkHealth('unified');
  return { unified: result };
}
