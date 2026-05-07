/**
 * POST /cpa-portal/[token]/request/[id]/resolve
 *
 * Either side (owner OR CPA holding the same tenant's token) can mark
 * a request resolved. The token's tenantId scopes the lookup so a
 * compromised token from tenant A still can't resolve tenant B's
 * requests.
 *
 * Body: { resolution?: string } — optional free-form note from the
 * owner ("uploaded receipt", "reclassified to Travel", etc.). The
 * resolution is what the CPA sees back in their portal feed.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAccessByToken } from '@/lib/agentbook-cpa-token';
import { audit } from '@/lib/agentbook-audit';
import { inferActor, inferSource } from '@/lib/agentbook-audit-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface RouteParams {
  params: Promise<{ token: string; id: string }>;
}

interface ResolveBody {
  resolution?: string;
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { token, id } = await params;
    const access = await resolveAccessByToken(token);
    if (!access) {
      return NextResponse.json(
        { success: false, error: 'invalid or expired token' },
        { status: 403 },
      );
    }

    // Cross-tenant guard: the request must live on the same tenant
    // the token is scoped to.
    const row = await db.abAccountantRequest.findFirst({
      where: { id, tenantId: access.tenantId },
    });
    if (!row) {
      return NextResponse.json(
        { success: false, error: 'request not found' },
        { status: 404 },
      );
    }
    if (row.status === 'resolved') {
      return NextResponse.json({
        success: true,
        data: { id: row.id, alreadyResolved: true },
      });
    }

    const body = (await request.json().catch(() => ({}))) as ResolveBody;
    const resolution = (body.resolution || '').trim().slice(0, 2000) || null;

    const updated = await db.abAccountantRequest.update({
      where: { id },
      data: { status: 'resolved', resolvedAt: new Date(), resolution },
    });

    await audit({
      tenantId: access.tenantId,
      actor: await inferActor(request),
      source: inferSource(request),
      action: 'cpa.request.resolve',
      entityType: 'AbAccountantRequest',
      entityId: row.id,
      before: { status: row.status, resolution: row.resolution },
      after: { status: updated.status, resolution: updated.resolution },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: updated.id,
        status: updated.status,
        resolvedAt: updated.resolvedAt,
        resolution: updated.resolution,
      },
    });
  } catch (err) {
    console.error('[cpa-portal/request/resolve] failed:', err);
    return NextResponse.json(
      { success: false, error: 'internal error' },
      { status: 500 },
    );
  }
}
