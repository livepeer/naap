/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { MCP_BILLING_TEST_APP_ID, POST } from '@/app/api/internal/mcp/mint/route';

const createPymthouseApiKey = vi.fn();

vi.mock('@/lib/pymthouse-keys-bff', () => ({
  createPymthouseApiKey: (...args: unknown[]) => createPymthouseApiKey(...args),
}));

const SECRET = 'test-mint-shared-secret';
const ALLOWED = 'https://storyboard.daydream.monster';

function req(opts: {
  body?: unknown;
  auth?: string | null;
  origin?: string | null;
  callerOrigin?: string | null;
}): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (opts.auth !== null) {
    headers.set('authorization', opts.auth ?? `Bearer ${SECRET}`);
  }
  if (opts.origin) headers.set('origin', opts.origin);
  if (opts.callerOrigin) headers.set('x-mcp-caller-origin', opts.callerOrigin);
  return new NextRequest('http://localhost/api/internal/mcp/mint', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? { externalUserId: 'user-1', email: 'u@example.com' }),
  });
}

describe('POST /api/internal/mcp/mint', () => {
  const env: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of [
      'MCP_INTERNAL_MINT_SECRET',
      'MCP_INTERNAL_MINT_ALLOWLIST',
      'PYMTHOUSE_PUBLIC_CLIENT_ID',
    ]) {
      env[k] = process.env[k];
    }
    process.env.MCP_INTERNAL_MINT_SECRET = SECRET;
    process.env.MCP_INTERNAL_MINT_ALLOWLIST = ALLOWED;
    process.env.PYMTHOUSE_PUBLIC_CLIENT_ID = MCP_BILLING_TEST_APP_ID;
    vi.clearAllMocks();
    createPymthouseApiKey.mockResolvedValue({
      apiKey: `${MCP_BILLING_TEST_APP_ID}_pmth_deadbeef`,
      row: {
        id: 'k1',
        label: 'mcp-oauth',
        prefix: 'pmth_',
        suffix: 'beef',
        status: 'active',
        createdAt: new Date().toISOString(),
        revokedAt: null,
      },
    });
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('returns 404 when shared-secret config is absent', async () => {
    delete process.env.MCP_INTERNAL_MINT_SECRET;
    const res = await POST(req({ origin: ALLOWED }));
    expect(res.status).toBe(404);
    expect(createPymthouseApiKey).not.toHaveBeenCalled();
  });

  it('returns 404 when allow-list config is absent', async () => {
    delete process.env.MCP_INTERNAL_MINT_ALLOWLIST;
    const res = await POST(req({ origin: ALLOWED }));
    expect(res.status).toBe(404);
  });

  it('rejects unauthenticated callers with 401', async () => {
    const res = await POST(req({ origin: ALLOWED, auth: 'Bearer wrong' }));
    expect(res.status).toBe(401);
    expect(createPymthouseApiKey).not.toHaveBeenCalled();
  });

  it('rejects callers outside the origin allow-list with 403', async () => {
    const res = await POST(req({ origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    expect(createPymthouseApiKey).not.toHaveBeenCalled();
  });

  it('fail-closes with 503 when PYMTHOUSE_PUBLIC_CLIENT_ID is not the test app', async () => {
    process.env.PYMTHOUSE_PUBLIC_CLIENT_ID = 'app_live_customer_do_not_bill';
    const res = await POST(req({ origin: ALLOWED }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('billing_app_mismatch');
    expect(createPymthouseApiKey).not.toHaveBeenCalled();
  });

  it('mints via createPymthouseApiKey and returns only apiKey', async () => {
    const res = await POST(req({ origin: ALLOWED }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['apiKey']);
    expect(body.apiKey).toBe(`${MCP_BILLING_TEST_APP_ID}_pmth_deadbeef`);
    expect(createPymthouseApiKey).toHaveBeenCalledWith({
      externalUserId: 'user-1',
      email: 'u@example.com',
      label: 'mcp-oauth',
    });
  });

  it('accepts X-Mcp-Caller-Origin when Origin is absent (S2S)', async () => {
    const res = await POST(req({ origin: null, callerOrigin: ALLOWED }));
    expect(res.status).toBe(200);
    expect(createPymthouseApiKey).toHaveBeenCalled();
  });

  it('returns 400 when externalUserId is missing', async () => {
    const res = await POST(req({ origin: ALLOWED, body: { email: 'x@y.z' } }));
    expect(res.status).toBe(400);
    expect(createPymthouseApiKey).not.toHaveBeenCalled();
  });

  it('maps mint failures to 502 without leaking details', async () => {
    createPymthouseApiKey.mockRejectedValue(new Error('upstream boom with secret xyz'));
    const res = await POST(req({ origin: ALLOWED }));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toMatch(/xyz|boom/i);
  });
});
