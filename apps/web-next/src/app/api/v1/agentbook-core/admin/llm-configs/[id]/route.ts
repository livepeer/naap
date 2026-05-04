/**
 * Delete an LLM provider config.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await resolveAgentbookTenant(request);
    const { id } = await params;
    await db.abLLMProviderConfig.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[agentbook-core/admin/llm-configs/:id DELETE] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
