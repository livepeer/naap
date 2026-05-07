/**
 * POST /agentbook-core/accountant/revoke/[id] — revoke a CPA access row.
 *
 * Clears `accessToken` (so the magic link stops working) and stamps
 * `expiresAt` to "now" (so any cached lookup that already loaded the
 * row TTLs out within seconds). Tenant-scoped: an owner can only
 * revoke rows that belong to their tenant.
 *
 * Idempotent: revoking an already-revoked row returns success but
 * does not double-write or double-audit.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { invalidateTokenCache } from '@/lib/agentbook-cpa-token';
import { audit } from '@/lib/agentbook-audit';
import { inferActor, inferSource } from '@/lib/agentbook-audit-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });
    }

    // Strict tenant scoping — never let a tenant revoke another tenant's row.
    const row = await db.abTenantAccess.findFirst({ where: { id, tenantId } });
    if (!row) {
      return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });
    }

    // Idempotent: already revoked.
    if (!row.accessToken && row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      return NextResponse.json({
        success: true,
        data: { id: row.id, alreadyRevoked: true },
      });
    }

    const updated = await db.abTenantAccess.update({
      where: { id },
      data: {
        accessToken: null,
        expiresAt: new Date(),
      },
    });

    invalidateTokenCache(row.accessToken);

    await audit({
      tenantId,
      actor: await inferActor(request),
      source: inferSource(request),
      action: 'cpa.revoke',
      entityType: 'AbTenantAccess',
      entityId: row.id,
      before: {
        id: row.id,
        email: row.email,
        role: row.role,
        expiresAt: row.expiresAt,
        accessToken: row.accessToken,
      },
      after: {
        id: updated.id,
        email: updated.email,
        role: updated.role,
        expiresAt: updated.expiresAt,
        accessToken: updated.accessToken,
      },
    });

    return NextResponse.json({
      success: true,
      data: { id: updated.id, revokedAt: updated.expiresAt },
    });
  } catch (err) {
    console.error('[agentbook-core/accountant/revoke] failed:', err);
    return NextResponse.json(
      { success: false, error: 'internal error' },
      { status: 500 },
    );
  }
}
