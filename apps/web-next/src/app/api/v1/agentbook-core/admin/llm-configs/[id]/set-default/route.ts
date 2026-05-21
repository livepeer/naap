/**
 * Mark one LLM provider config as default; unsets all others first.
 *
 * Gated by requireAdmin.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { requireAdmin } from '@/lib/admin-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireAdmin(request);
  if ('response' in guard) return guard.response;

  try {
    const { id } = await params;
    await db.abLLMProviderConfig.updateMany({ data: { isDefault: false } });
    await db.abLLMProviderConfig.update({ where: { id }, data: { isDefault: true } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[agentbook-core/admin/llm-configs/:id/set-default] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
