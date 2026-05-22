/**
 * GET /api/health
 *
 * Database + email configuration health check. Returns 503 when any
 * production-critical dependency is broken, so platform monitors and
 * deploy gates fail closed instead of silently degrading.
 */

import { NextResponse } from 'next/server';
import { validateEmailConfig } from '@/lib/email';

export const dynamic = 'force-dynamic'; // never cache

interface DbStatus {
  connected: boolean;
  latencyMs?: number;
  error?: string;
}

interface EmailStatus {
  configured: boolean;
  warnings: string[];
  /** When true, an unconfigured/sandbox state should be treated as unhealthy. */
  criticalInThisEnv: boolean;
}

export async function GET() {
  // ── DB check ──────────────────────────────────────────────────────────────
  let dbStatus: DbStatus;
  try {
    const { prisma } = await import('@naap/database');
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = { connected: true, latencyMs: Date.now() - start };
  } catch (err) {
    const e = err as Error & { code?: string };
    console.error('[health] DB check failed:', e.name, e.message, e.code, '\n', e.stack);
    dbStatus = {
      connected: false,
      error: 'Database connection failed',
    };
  }

  // ── Email config check ────────────────────────────────────────────────────
  // Production: missing key or sandbox sender means new signups never receive
  // verification mail. We surface this as 503 so the broken state is loud.
  const isProductionLike =
    process.env.VERCEL_ENV === 'production' || process.env.DEPLOY_ENV === 'production';
  const emailValidation = validateEmailConfig();
  const emailStatus: EmailStatus = {
    configured: emailValidation.configured,
    warnings: emailValidation.warnings,
    criticalInThisEnv: isProductionLike && !emailValidation.configured,
  };

  const allHealthy = dbStatus.connected && !emailStatus.criticalInThisEnv;

  return NextResponse.json(
    {
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      database: dbStatus,
      email: emailStatus,
    },
    { status: allHealthy ? 200 : 503 }
  );
}
