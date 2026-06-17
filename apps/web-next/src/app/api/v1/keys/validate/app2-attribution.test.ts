/** @vitest-environment node */

/**
 * APP-2 guardrail (E9) — a second registered app attributes + gates distinctly.
 *
 * Drives the real NAAP-C front door (POST /api/v1/keys/validate) with the SAME
 * native key but two different registered apps (Storyboard and APP-2, the
 * standalone CLI). Proves:
 *   - usage attributes to each app's own appId (distinct), and
 *   - capabilities are gated per app's grant (APP-2 only gets what it's granted),
 * all provider-agnostic and with no Storyboard-specific code in the path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from './route';
import { generateNativeApiKey } from '@/lib/dev-api/native-key';
import { hashApiKey } from '@naap/database';

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a),
}));
vi.mock('@/lib/api/rate-limit', () => ({ enforceRateLimit: vi.fn(() => null) }));

const getBillingProviderAdapter = vi.fn();
vi.mock('@/lib/billing/registry', () => ({
  getBillingProviderAdapter: (...a: unknown[]) => getBillingProviderAdapter(...a),
}));

const prisma = vi.hoisted(() => ({
  devApiKey: { findUnique: vi.fn(), update: vi.fn() },
  team: { findUnique: vi.fn() },
  application: { findFirst: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma }));

const { rawKey } = generateNativeApiKey();
const keyHash = hashApiKey(rawKey);

// Provider plan enables BOTH capabilities; per-app gating must narrow them.
function adapter(slug = 'pymthouse') {
  return {
    slug,
    isConfigured: vi.fn(() => true),
    mintSignerSession: vi.fn(async () => ({ accessToken: 'tok', tokenType: 'Bearer', expiresIn: 3600 })),
    validate: vi.fn(async () => ({
      valid: true,
      capabilities: ['text-to-image:sdxl', 'text-to-video:ltx'],
      quota: null,
    })),
  };
}

const STORYBOARD_APP = {
  id: 'app-storyboard', slug: 'storyboard', type: 'app', teamId: 'team-1', ownerUserId: null,
  allowedScopes: ['gateway', 'llm'], allowedCapabilities: ['*'], status: 'active',
};
const APP2 = {
  id: 'app-naap-cli', slug: 'naap-sample-cli', type: 'cli', teamId: 'team-1', ownerUserId: null,
  allowedScopes: ['gateway'], allowedCapabilities: ['text-to-image:sdxl'], status: 'active',
};

function req(appId: string): NextRequest {
  return new NextRequest('http://localhost/api/v1/keys/validate', {
    method: 'POST',
    headers: { authorization: `Bearer ${rawKey}`, 'x-app-id': appId },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockResolvedValue(true); // front door + app_registry ON
  prisma.devApiKey.findUnique.mockResolvedValue({
    id: 'key-1', userId: 'user-1', keyHash, status: 'ACTIVE', seatId: 'seat-1', teamId: 'team-1',
  });
  prisma.team.findUnique.mockResolvedValue({
    id: 'team-1', billingAccountProviderSlug: 'pymthouse', billingAccountId: 'acct_1',
  });
  prisma.devApiKey.update.mockResolvedValue({});
  getBillingProviderAdapter.mockReturnValue(adapter());
});

describe('APP-2 vs Storyboard — distinct attribution + gating (E9)', () => {
  it('attributes to Storyboard and passes caps through (wildcard grant)', async () => {
    prisma.application.findFirst.mockResolvedValue(STORYBOARD_APP);
    const res = await POST(req('storyboard'));
    expect(res.status).toBe(200);
    const d = (await res.json()).data;
    expect(d.app.id).toBe('storyboard');
    expect(d.capabilities).toEqual(['text-to-image:sdxl', 'text-to-video:ltx']);
  });

  it('attributes to APP-2 distinctly and gates caps to its grant', async () => {
    prisma.application.findFirst.mockResolvedValue(APP2);
    const res = await POST(req('naap-sample-cli'));
    expect(res.status).toBe(200);
    const d = (await res.json()).data;
    expect(d.app.id).toBe('naap-sample-cli');
    expect(d.app.id).not.toBe('storyboard');
    // text-to-video filtered out; only the granted capability remains.
    expect(d.capabilities).toEqual(['text-to-image:sdxl']);
  });

  it('works unchanged when the team is backed by the stub provider (E8)', async () => {
    prisma.team.findUnique.mockResolvedValue({
      id: 'team-1', billingAccountProviderSlug: 'stub', billingAccountId: 'acct_stub_1',
    });
    getBillingProviderAdapter.mockReturnValue(adapter('stub'));
    prisma.application.findFirst.mockResolvedValue(APP2);
    const res = await POST(req('naap-sample-cli'));
    expect(res.status).toBe(200);
    const d = (await res.json()).data;
    expect(d.billingAccount.providerSlug).toBe('stub');
    expect(d.app.id).toBe('naap-sample-cli');
    expect(d.capabilities).toEqual(['text-to-image:sdxl']);
  });
});
