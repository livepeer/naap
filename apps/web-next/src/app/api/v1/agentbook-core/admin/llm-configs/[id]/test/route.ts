/**
 * Test an LLM provider config end-to-end (Gemini ping).
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await resolveAgentbookTenant(request);
    const { id } = await params;
    const config = await db.abLLMProviderConfig.findUnique({ where: { id } });
    if (!config) {
      return NextResponse.json({ success: false, error: 'Config not found' }, { status: 404 });
    }

    if (config.provider !== 'gemini') {
      return NextResponse.json({
        success: true,
        data: { model: 'test', response: 'Provider test not implemented yet', latencyMs: 0 },
      });
    }

    const model = config.modelFast || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;
    const start = Date.now();
    const apiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Say "AgentBook LLM connection successful!" in one sentence.' }] }],
        generationConfig: { maxOutputTokens: 50 },
      }),
    });
    const latencyMs = Date.now() - start;

    if (!apiRes.ok) {
      const error = await apiRes.text();
      return NextResponse.json({
        success: false,
        error: `API error: ${error.slice(0, 200)}`,
      });
    }

    const data = (await apiRes.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const response = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return NextResponse.json({ success: true, data: { model, response, latencyMs } });
  } catch (err) {
    console.error('[agentbook-core/admin/llm-configs/:id/test] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
