/**
 * GET /api/health
 * Database connectivity health check with env var diagnostics.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic'; // never cache

export async function GET() {
  const envStatus = {
    DATABASE_URL: process.env.DATABASE_URL ? `SET (${process.env.DATABASE_URL.substring(0, 40)}...)` : 'EMPTY',
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED ? 'SET' : 'EMPTY',
    POSTGRES_PRISMA_URL: process.env.POSTGRES_PRISMA_URL ? `SET (${process.env.POSTGRES_PRISMA_URL.substring(0, 40)}...)` : 'EMPTY',
    POSTGRES_URL: process.env.POSTGRES_URL ? `SET (${process.env.POSTGRES_URL.substring(0, 40)}...)` : 'EMPTY',
    POSTGRES_URL_NON_POOLING: process.env.POSTGRES_URL_NON_POOLING ? 'SET' : 'EMPTY',
    NODE_ENV: process.env.NODE_ENV || 'undefined',
    VERCEL: process.env.VERCEL || 'undefined',
    VERCEL_ENV: process.env.VERCEL_ENV || 'undefined',
  };

  let dbStatus: { connected: boolean; latencyMs?: number; error?: string };

  try {
    // Dynamic import to avoid module-level init issues
    const { prisma } = await import('@naap/database');
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = { connected: true, latencyMs: Date.now() - start };
  } catch (err) {
    const e = err as Error & { code?: string };
    dbStatus = {
      connected: false,
      error: `${e.name}: ${e.message} [code=${e.code || 'none'}]`,
    };
  }

  return NextResponse.json({
    status: dbStatus.connected ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    env: envStatus,
    database: dbStatus,
  }, { status: dbStatus.connected ? 200 : 503 });
}
