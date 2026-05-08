/**
 * Home-office config — GET (auto-create on first access) + PUT (upsert) (PR 15).
 *
 * One row per tenant. Stores the office:total square-footage ratio for
 * the actual-expense method and a flag for the US simplified method
 * ($5/sqft up to 300 sqft, IRS Pub 587). The bot's quarterly prompt
 * reads these values to compute the deductible portion. Tenant-scoped
 * (resolved via `resolveAgentbookTenant`) and sanitised on the 500 path
 * so we never leak Prisma internals.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { computeRatio } from '@/lib/agentbook-home-office';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function sanitizeError(err: unknown, label: string): string {
  console.error(`[agentbook-core/home-office/config ${label}]`, err);
  return 'Failed to load home-office config.';
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    let cfg = await db.abHomeOfficeConfig.findUnique({ where: { tenantId } });
    if (!cfg) {
      cfg = await db.abHomeOfficeConfig.create({
        data: { tenantId, useUsSimplified: false },
      });
    }
    return NextResponse.json({ success: true, data: cfg });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: sanitizeError(err, 'GET') },
      { status: 500 },
    );
  }
}

interface UpdateConfigBody {
  totalSqft?: number | null;
  officeSqft?: number | null;
  useUsSimplified?: boolean;
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as UpdateConfigBody;

    // Validate sqft inputs — must be non-negative integers when set.
    const total = body.totalSqft;
    const office = body.officeSqft;
    if (total !== undefined && total !== null) {
      if (typeof total !== 'number' || !isFinite(total) || total < 0 || total !== Math.floor(total)) {
        return NextResponse.json(
          { success: false, error: 'totalSqft must be a non-negative integer' },
          { status: 400 },
        );
      }
    }
    if (office !== undefined && office !== null) {
      if (typeof office !== 'number' || !isFinite(office) || office < 0 || office !== Math.floor(office)) {
        return NextResponse.json(
          { success: false, error: 'officeSqft must be a non-negative integer' },
          { status: 400 },
        );
      }
    }
    if (
      typeof total === 'number' && typeof office === 'number' &&
      total > 0 && office > total
    ) {
      return NextResponse.json(
        { success: false, error: 'officeSqft cannot exceed totalSqft' },
        { status: 400 },
      );
    }

    // Pre-compute the ratio so consumers (cron / bot intent) can read
    // it without importing the helper. We always recompute on write so
    // it stays in sync with the underlying sqft fields.
    const computedRatio = computeRatio(total ?? undefined, office ?? undefined);

    const update: Record<string, unknown> = {};
    if (total !== undefined) update.totalSqft = total;
    if (office !== undefined) update.officeSqft = office;
    if (body.useUsSimplified !== undefined) update.useUsSimplified = !!body.useUsSimplified;
    update.ratio = computedRatio || null;

    const cfg = await db.abHomeOfficeConfig.upsert({
      where: { tenantId },
      update,
      create: {
        tenantId,
        totalSqft: total ?? null,
        officeSqft: office ?? null,
        ratio: computedRatio || null,
        useUsSimplified: !!body.useUsSimplified,
      },
    });
    return NextResponse.json({ success: true, data: cfg });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: sanitizeError(err, 'PUT') },
      { status: 500 },
    );
  }
}
