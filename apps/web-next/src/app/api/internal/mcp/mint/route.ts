/**
 * Internal Storyboard → NaaP mint route (MCP OAuth Scenario A / PR-09).
 *
 * Mints a pymthouse composite for a NaaP-identified user by reusing NaaP's
 * existing M2M env via `createPymthouseApiKey` (no second copy of M2M on
 * Storyboard). Absent shared-secret / allow-list config ⇒ 404 (do not
 * advertise the route). Bills only the hard-coded test app (RS-2).
 */

import { timingSafeEqual } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { createPymthouseApiKey } from '@/lib/pymthouse-keys-bff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** RS-2 — only this pymthouse test app may be billed by MCP OAuth mint. */
export const MCP_BILLING_TEST_APP_ID = 'app_98575870d7ae33589a3f0660';

type MintBody = {
  externalUserId?: unknown;
  email?: unknown;
  label?: unknown;
};

function readConfig(): { secret: string; allowlist: Set<string> } | null {
  const secret = process.env.MCP_INTERNAL_MINT_SECRET?.trim();
  const rawAllow = process.env.MCP_INTERNAL_MINT_ALLOWLIST?.trim();
  if (!secret || !rawAllow) return null;
  const allowlist = new Set(
    rawAllow
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (allowlist.size === 0) return null;
  return { secret, allowlist };
}

function secretsEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function extractBearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1]?.trim() || null;
}

function callerOrigin(request: NextRequest): string | null {
  const origin = request.headers.get('origin')?.trim();
  if (origin) return origin;
  // Server-to-server callers may omit Origin; accept an explicit caller header.
  const explicit = request.headers.get('x-mcp-caller-origin')?.trim();
  return explicit || null;
}

function assertTestAppConfigured(): NextResponse | null {
  const configured = process.env.PYMTHOUSE_PUBLIC_CLIENT_ID?.trim();
  if (!configured || configured !== MCP_BILLING_TEST_APP_ID) {
    // Fail closed — never mint against a live customer app.
    return NextResponse.json(
      { error: 'billing_app_mismatch', error_description: 'Mint is restricted to the test billing app.' },
      { status: 503 },
    );
  }
  return null;
}

/**
 * POST /api/internal/mcp/mint
 * Body: { externalUserId: string, email?: string, label?: string }
 * Auth: Authorization: Bearer <MCP_INTERNAL_MINT_SECRET>
 * Caller: Origin or X-Mcp-Caller-Origin must be in MCP_INTERNAL_MINT_ALLOWLIST
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const config = readConfig();
  if (!config) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const bearer = extractBearer(request);
  if (!bearer || !secretsEqual(bearer, config.secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const origin = callerOrigin(request);
  if (!origin || !config.allowlist.has(origin)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const appGuard = assertTestAppConfigured();
  if (appGuard) return appGuard;

  let body: MintBody;
  try {
    body = (await request.json()) as MintBody;
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'JSON body required' },
      { status: 400 },
    );
  }

  const externalUserId =
    typeof body.externalUserId === 'string' ? body.externalUserId.trim() : '';
  if (!externalUserId || externalUserId.length > 256) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'externalUserId required' },
      { status: 400 },
    );
  }

  const email = typeof body.email === 'string' ? body.email.trim() : undefined;
  const label = typeof body.label === 'string' ? body.label.trim() : 'mcp-oauth';

  try {
    const { apiKey } = await createPymthouseApiKey({
      externalUserId,
      email: email || null,
      label: label || 'mcp-oauth',
    });
    // Composite returned only over this authenticated internal channel (AP-5).
    // Never log apiKey.
    return NextResponse.json({ apiKey }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: 'mint_failed', error_description: 'Unable to mint credential' },
      { status: 502 },
    );
  }
}
