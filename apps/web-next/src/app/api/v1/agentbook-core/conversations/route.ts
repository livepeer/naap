/**
 * Recent conversation log — read-only.
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
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '20', 10);
    const conversations = await db.abConversation.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return NextResponse.json({ success: true, data: conversations });
  } catch (err) {
    console.error('[agentbook-core/conversations] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
