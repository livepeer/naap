/**
 * GET /agentbook-core/accountant/list — list every CPA / bookkeeper /
 * viewer row for the current tenant.
 *
 * Returns active (token still valid) and inactive (revoked / expired)
 * rows so the owner's settings page can show "active CPAs" and "past
 * invitations" sections side-by-side. Sensitive fields (accessToken
 * itself) are NEVER returned — the owner's UI doesn't need the raw
 * token because the inviteUrl was already shown at /invite time.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);

    const rows = await db.abTenantAccess.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      // Explicit select — never leak accessToken to a list endpoint.
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        invitedBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const now = Date.now();
    const data = rows.map((r) => ({
      ...r,
      active: r.expiresAt ? r.expiresAt.getTime() > now : true,
    }));

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('[agentbook-core/accountant/list] failed:', err);
    return NextResponse.json(
      { success: false, error: 'internal error' },
      { status: 500 },
    );
  }
}
