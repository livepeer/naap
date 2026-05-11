/**
 * GET /api/health
 * Database connectivity health check.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic'; // never cache

export async function GET() {
  let dbStatus: { connected: boolean; latencyMs?: number; error?: string };

  try {
    const { prisma } = await import('@naap/database');
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = { connected: true, latencyMs: Date.now() - start };
  } catch (err) {
    const e = err as Error & { code?: string };
    console.error('[health] DB check failed:', e.name, e.message, e.code);
    dbStatus = {
      connected: false,
      error: 'Database connection failed',
    };
  }

  return NextResponse.json({
    status: dbStatus.connected ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    database: dbStatus,
  }, { status: dbStatus.connected ? 200 : 503 });
}
