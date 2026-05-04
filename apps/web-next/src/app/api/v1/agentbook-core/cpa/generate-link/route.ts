/**
 * Generate a 30-day CPA access token for a tenant.
 */

import 'server-only';
import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface GenerateLinkBody {
  email?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as GenerateLinkBody;
    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await db.abTenantAccess.create({
      data: {
        tenantId,
        userId: `cpa-${token.slice(0, 8)}`,
        email: body.email || 'cpa@example.com',
        role: 'cpa',
        accessToken: token,
        expiresAt,
      },
    });

    return NextResponse.json({ success: true, data: { token, expiresAt } });
  } catch (err) {
    console.error('[agentbook-core/cpa/generate-link] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
