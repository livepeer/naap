/**
 * Admin LLM provider configs — list + create.
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
    await resolveAgentbookTenant(request);
    const configs = await db.abLLMProviderConfig.findMany({ orderBy: { createdAt: 'asc' } });
    return NextResponse.json({ success: true, data: configs });
  } catch (err) {
    console.error('[agentbook-core/admin/llm-configs GET] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

interface CreateBody {
  name?: string;
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  modelFast?: string;
  modelStandard?: string;
  modelPremium?: string;
  modelVision?: string;
  isDefault?: boolean;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as CreateBody;
    const { name, provider, apiKey, baseUrl, modelFast, modelStandard, modelPremium, modelVision, isDefault } = body;
    if (!name || !provider || !apiKey) {
      return NextResponse.json(
        { success: false, error: 'name, provider, apiKey are required' },
        { status: 400 },
      );
    }

    if (isDefault) {
      await db.abLLMProviderConfig.updateMany({ data: { isDefault: false } });
    }

    const config = await db.abLLMProviderConfig.create({
      data: {
        name,
        provider,
        apiKey,
        baseUrl,
        modelFast,
        modelStandard,
        modelPremium,
        modelVision,
        isDefault: isDefault || false,
      },
    });
    return NextResponse.json({ success: true, data: config }, { status: 201 });
  } catch (err) {
    console.error('[agentbook-core/admin/llm-configs POST] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
