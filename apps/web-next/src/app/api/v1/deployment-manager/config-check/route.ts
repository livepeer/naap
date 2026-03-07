import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  checks.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
    ? { ok: true }
    : process.env.VERCEL || process.env.NODE_ENV === 'production'
      ? { ok: false, detail: 'ENCRYPTION_KEY is required in production. Credential storage will fail.' }
      : { ok: true, detail: 'Using dev fallback key' };

  checks.DATABASE_URL = (process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL)
    ? { ok: true }
    : { ok: false, detail: 'No DATABASE_URL or POSTGRES_PRISMA_URL configured' };

  try {
    await prisma.secretVault.count();
    checks.SECRET_VAULT_TABLE = { ok: true };
  } catch (e: any) {
    checks.SECRET_VAULT_TABLE = { ok: false, detail: e.message?.slice(0, 200) };
  }

  const allOk = Object.values(checks).every(c => c.ok);

  return NextResponse.json({
    success: allOk,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
    checks,
  }, { status: allOk ? 200 : 500 });
}
