/**
 * CPA collaboration notes — list + create.
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
    const notes = await db.abCPANote.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return NextResponse.json({ success: true, data: notes });
  } catch (err) {
    console.error('[agentbook-core/cpa/notes GET] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

interface CreateNoteBody {
  content?: string;
  attachedTo?: string;
  attachedType?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as CreateNoteBody;
    const { content, attachedTo, attachedType } = body;
    if (!content) {
      return NextResponse.json({ success: false, error: 'content is required' }, { status: 400 });
    }
    const note = await db.abCPANote.create({
      data: { tenantId, authorId: tenantId, content, attachedTo, attachedType },
    });
    return NextResponse.json({ success: true, data: note }, { status: 201 });
  } catch (err) {
    console.error('[agentbook-core/cpa/notes POST] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
