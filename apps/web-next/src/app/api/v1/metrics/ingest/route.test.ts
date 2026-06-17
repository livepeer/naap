/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from './route';

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a),
}));

const create = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    providerUsageRecord: { create: (...a: unknown[]) => create(...a) },
  },
}));

const TOKEN = 'test-ingest-token';

function req(body: unknown, init?: { auth?: string }): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init?.auth !== undefined) headers.authorization = init.auth;
  return new NextRequest('https://naap.test/api/v1/metrics/ingest', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const validPayload = {
  providerSlug: 'pymthouse',
  accountId: 'acct_1',
  appId: 'app_sb',
  window: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T00:00:00.000Z' },
  sessions: 1,
  tickets: 10,
  feeWei: '1000',
  networkFeeUsdMicros: '5000',
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NAAP_METRICS_INGEST_TOKEN = TOKEN;
});
afterEach(() => {
  delete process.env.NAAP_METRICS_INGEST_TOKEN;
});

describe('usage_ingest flag OFF → no-op', () => {
  it('returns 404 and never authenticates or writes', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const res = await POST(req(validPayload, { auth: `Bearer ${TOKEN}` }));
    expect(res.status).toBe(404);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('usage_ingest flag ON', () => {
  beforeEach(() => isFeatureEnabled.mockResolvedValue(true));

  it('rejects a missing/invalid token with 401', async () => {
    const res = await POST(req(validPayload, { auth: 'Bearer wrong' }));
    expect(res.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects when no ingest token is configured', async () => {
    delete process.env.NAAP_METRICS_INGEST_TOKEN;
    const res = await POST(req(validPayload, { auth: 'Bearer anything' }));
    expect(res.status).toBe(401);
  });

  it('accepts a valid neutral payload and stores it', async () => {
    create.mockResolvedValue({ id: 'rec-1' });
    const res = await POST(req(validPayload, { auth: `Bearer ${TOKEN}` }));
    expect(res.status).toBe(200);
    const arg = create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.providerSlug).toBe('pymthouse');
    expect(arg.data.appId).toBe('app_sb');
    expect(arg.data.windowFrom).toBeInstanceOf(Date);
  });

  it('rejects a payload leaking provider-internal fields with 400', async () => {
    const leaky = { ...validPayload, openmeter_subscription_id: '01J...' };
    const res = await POST(req(leaky, { auth: `Bearer ${TOKEN}` }));
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
    const json = await res.json();
    expect(json.error.details.leaked).toContain('openmeter_subscription_id');
  });

  it('rejects an invalid shape with a validation error', async () => {
    const bad = { providerSlug: 'pymthouse' }; // missing accountId + window
    const res = await POST(req(bad, { auth: `Bearer ${TOKEN}` }));
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});
