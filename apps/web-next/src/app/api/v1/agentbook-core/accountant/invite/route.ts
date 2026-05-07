/**
 * POST /agentbook-core/accountant/invite — issue a 90-day magic-link
 * token for a CPA / bookkeeper to access the tenant's read-only portal.
 *
 * Request:  { email: string, role?: 'cpa' | 'bookkeeper' | 'viewer' }
 * Response: { inviteUrl, accessToken, expiresAt, accessId }
 *
 * The link itself is `<APP_URL>/cpa/<token>`. We do NOT send the email
 * here — that wiring lives in the comms plugin and is out of scope for
 * PR 11. The owner is expected to copy/paste the URL until the comms
 * plugin lands. Audit log records the invite.
 *
 * If a non-expired token already exists for this email + tenant, we
 * return it as-is (idempotent re-invite — avoids creating dangling
 * tokens when the owner double-taps the button).
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { generateAccessToken } from '@/lib/agentbook-cpa-token';
import { audit } from '@/lib/agentbook-audit';
import { inferActor, inferSource } from '@/lib/agentbook-audit-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface InviteBody {
  email?: string;
  role?: string;
  invitedBy?: string;
}

const VALID_ROLES = new Set(['cpa', 'bookkeeper', 'viewer']);
const TTL_DAYS = 90;

function buildInviteUrl(token: string, request: NextRequest): string {
  // Prefer an explicit APP_URL env (set in prod), fall back to the
  // request's origin so dev / preview deploys work without config.
  const base =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    request.nextUrl.origin;
  return `${base.replace(/\/$/, '')}/cpa/${token}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as InviteBody;

    const email = (body.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { success: false, error: 'valid email required' },
        { status: 400 },
      );
    }
    const role = body.role && VALID_ROLES.has(body.role) ? body.role : 'cpa';

    // Idempotency: re-issuing for the same email returns the existing
    // active row instead of stacking. Catches the "owner taps Invite
    // twice" UX without orphan rows or surprise revocations.
    const existing = await db.abTenantAccess.findFirst({
      where: {
        tenantId,
        email,
        role,
        accessToken: { not: null },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (existing && existing.accessToken) {
      return NextResponse.json({
        success: true,
        data: {
          accessId: existing.id,
          accessToken: existing.accessToken,
          inviteUrl: buildInviteUrl(existing.accessToken, request),
          expiresAt: existing.expiresAt,
          reused: true,
        },
      });
    }

    const token = generateAccessToken();
    const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);

    // userId is required + (tenantId,userId) is unique. We synthesize a
    // CPA-scoped pseudo-user-id from the token so each invitation row
    // is uniquely keyed and joins cleanly when we add real CPA accounts.
    const userId = `cpa-${token.slice(0, 12)}`;
    const created = await db.abTenantAccess.create({
      data: {
        tenantId,
        userId,
        email,
        role,
        accessToken: token,
        expiresAt,
        invitedBy: body.invitedBy || null,
      },
    });

    await audit({
      tenantId,
      actor: await inferActor(request),
      source: inferSource(request),
      action: 'cpa.invite',
      entityType: 'AbTenantAccess',
      entityId: created.id,
      after: {
        id: created.id,
        email,
        role,
        expiresAt,
        // accessToken is sensitive: the audit redactor will strip it.
        accessToken: token,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        accessId: created.id,
        accessToken: token,
        inviteUrl: buildInviteUrl(token, request),
        expiresAt,
        reused: false,
      },
    });
  } catch (err) {
    console.error('[agentbook-core/accountant/invite] failed:', err);
    return NextResponse.json(
      { success: false, error: 'internal error' },
      { status: 500 },
    );
  }
}
