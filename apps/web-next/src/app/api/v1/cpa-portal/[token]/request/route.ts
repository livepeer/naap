/**
 * POST /cpa-portal/[token]/request — CPA-side: file a follow-up
 * request on a specific entity (or general question).
 *
 * Auth: token. The token's accessId becomes the AbAccountantRequest's
 * accessId so the row can be linked back to the inviting CPA.
 *
 * This is the ONE write that happens from a token-gated endpoint —
 * the CPA shouldn't be able to mutate the tenant's books, but they
 * MUST be able to file a request (otherwise the whole "ping the
 * owner" flow doesn't work). The write is scoped to a brand-new
 * AbAccountantRequest row; no existing tenant data is mutated.
 *
 * Side effect: a Telegram nudge to the tenant owner so they see the
 * request without having to log into the dashboard.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAccessByToken } from '@/lib/agentbook-cpa-token';
import { sendCpaRequestNudge } from '@/lib/agentbook-cpa-notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface RouteParams {
  params: Promise<{ token: string }>;
}

interface CreateRequestBody {
  entityType?: string;
  entityId?: string | null;
  message?: string;
}

const VALID_ENTITY_TYPES = new Set([
  'AbExpense',
  'AbInvoice',
  'AbMileageEntry',
  'general',
]);

export async function POST(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { token } = await params;
    const access = await resolveAccessByToken(token);
    if (!access) {
      return NextResponse.json(
        { success: false, error: 'invalid or expired token' },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as CreateRequestBody;
    const message = (body.message || '').trim();
    if (!message) {
      return NextResponse.json(
        { success: false, error: 'message required' },
        { status: 400 },
      );
    }
    const entityType = body.entityType && VALID_ENTITY_TYPES.has(body.entityType)
      ? body.entityType
      : 'general';
    const entityId = entityType === 'general' ? null : body.entityId || null;

    // Optional: validate entityId actually exists in the tenant's data
    // so we don't store dangling references. If the row doesn't belong
    // to the tenant, fall back to 'general' rather than rejecting —
    // CPAs occasionally drop in legacy ids and we'd rather log the
    // question than hard-fail.
    let validatedEntityId = entityId;
    if (entityType === 'AbExpense' && entityId) {
      const exists = await db.abExpense.findFirst({
        where: { id: entityId, tenantId: access.tenantId },
        select: { id: true },
      });
      if (!exists) validatedEntityId = null;
    } else if (entityType === 'AbInvoice' && entityId) {
      const exists = await db.abInvoice.findFirst({
        where: { id: entityId, tenantId: access.tenantId },
        select: { id: true },
      });
      if (!exists) validatedEntityId = null;
    } else if (entityType === 'AbMileageEntry' && entityId) {
      const exists = await db.abMileageEntry.findFirst({
        where: { id: entityId, tenantId: access.tenantId },
        select: { id: true },
      });
      if (!exists) validatedEntityId = null;
    }

    const row = await db.abAccountantRequest.create({
      data: {
        tenantId: access.tenantId,
        accessId: access.id,
        entityType,
        entityId: validatedEntityId,
        message: message.slice(0, 4000), // hard cap to keep rows compact
      },
    });

    // Best-effort Telegram nudge. Failures don't poison the response —
    // the request is already in the DB and the digest will catch it.
    void sendCpaRequestNudge(access.tenantId, {
      requestId: row.id,
      cpaEmail: access.email,
      message: row.message,
      entityType: row.entityType,
      entityId: row.entityId,
    }).catch((err) => {
      console.warn('[cpa-portal/request] Telegram nudge failed:', err);
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          id: row.id,
          entityType: row.entityType,
          entityId: row.entityId,
          message: row.message,
          status: row.status,
          createdAt: row.createdAt,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[cpa-portal/request POST] failed:', err);
    return NextResponse.json(
      { success: false, error: 'internal error' },
      { status: 500 },
    );
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { success: false, error: 'method not allowed' },
    { status: 405 },
  );
}
