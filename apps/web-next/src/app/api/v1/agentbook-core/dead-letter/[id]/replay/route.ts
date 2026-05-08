/**
 * Admin endpoint: manually replay a single dead-letter row (PR 23).
 *
 * Tenant-scoped — the admin can only replay their own rows + globally
 * orphaned rows whose tenant resolution failed at webhook time.
 *
 * Replays go back through the local Telegram webhook, which means
 * idempotency is preserved by the existing `tg_update:<id>` keys —
 * if the original partially succeeded, the replay short-circuits.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { replayDeadLetter } from '@/lib/agentbook-dead-letter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

function inferWebhookUrl(request: NextRequest): string {
  if (process.env.AGENTBOOK_TELEGRAM_WEBHOOK_URL) {
    return process.env.AGENTBOOK_TELEGRAM_WEBHOOK_URL;
  }
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}/api/v1/agentbook/telegram/webhook`;
}

export async function POST(request: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });
    }

    // Authorization: only allow replay if the row belongs to this
    // tenant or is unscoped (tenantId IS NULL — tenant resolution
    // failed at webhook time).
    const row = await db.abWebhookDeadLetter.findFirst({
      where: {
        id,
        OR: [{ tenantId }, { tenantId: null }],
      },
    });
    if (!row) {
      return NextResponse.json(
        { success: false, error: 'not found' },
        { status: 404 },
      );
    }

    const result = await replayDeadLetter(id, {
      webhookUrl: inferWebhookUrl(request),
    });

    return NextResponse.json({ success: result.ok, data: result });
  } catch (err) {
    console.error('[agentbook-core/dead-letter/[id]/replay POST] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
