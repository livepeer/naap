/** @vitest-environment node */

/**
 * INT-G — the generalization proof (consolidated branch).
 *
 * A native naap_ key resolves END-TO-END through the front door → seat → team →
 * billingAccountRef → adapter for the full 2×2 matrix:
 *   providers: { stub, pymthouse-mock }   ×   apps: { Storyboard, APP-2 }
 *
 * For every cell it asserts: correct provider resolution (E8), correct per-app
 * attribution + capability gating (E9), the adapter's validate() payload
 * conforms to the C0 validate.schema.json, and NO provider-internal field leaks
 * through the seam. Flags are ON only in this test context. No live secrets —
 * stub + pymthouse mock (C0 shapes, PR #149 subscriptionRef) only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { generateNativeApiKey } from '@/lib/dev-api/native-key';
import { hashApiKey } from '@naap/database';
import { StubAdapter } from '@/lib/billing/stub-adapter';
import {
  findLeakedInternalFields,
  getForbiddenInternalFieldNames,
  validateAgainstBppSchema,
} from '@/lib/billing/bpp/conformance';
import { PymthouseMockAdapter } from './_mocks/pymthouse-mock';

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a) }));
vi.mock('@/lib/api/rate-limit', () => ({ enforceRateLimit: vi.fn(() => null) }));

// Registry dispatch by slug — used by BOTH the native-key resolver
// (mintSignerSession) and the front door (capabilities).
const adapters: Record<string, StubAdapter | PymthouseMockAdapter> = {
  stub: new StubAdapter(),
  pymthouse: new PymthouseMockAdapter(),
};
vi.mock('@/lib/billing/registry', () => ({
  getBillingProviderAdapter: (slug: string) => adapters[slug],
}));

const prisma = vi.hoisted(() => ({
  devApiKey: { findUnique: vi.fn(), update: vi.fn() },
  team: { findUnique: vi.fn() },
  application: { findFirst: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma }));

const { rawKey } = generateNativeApiKey();
const keyHash = hashApiKey(rawKey);

const APPS = {
  storyboard: {
    id: 'app-storyboard', slug: 'storyboard', type: 'app', teamId: 'team-1', ownerUserId: null,
    allowedScopes: ['gateway', 'llm'], allowedCapabilities: ['*'], status: 'active',
  },
  'naap-sample-cli': {
    id: 'app-naap-cli', slug: 'naap-sample-cli', type: 'cli', teamId: 'team-1', ownerUserId: null,
    allowedScopes: ['gateway'], allowedCapabilities: ['text-to-image:sdxl'], status: 'active',
  },
} as const;

// Expected gated capability set per (provider × app).
const EXPECTED: Record<string, Record<string, string[]>> = {
  stub: {
    storyboard: ['text-to-image:sdxl'],
    'naap-sample-cli': ['text-to-image:sdxl'],
  },
  pymthouse: {
    storyboard: ['text-to-image:sdxl', 'text-to-video:ltx', 'tool:byoc-demo'],
    'naap-sample-cli': ['text-to-image:sdxl'],
  },
};

const ACCOUNT_ID: Record<string, string> = { stub: 'acct_stub_1', pymthouse: 'acct_pmth_1' };

function frontDoorReq(appId: string): NextRequest {
  return new NextRequest('http://localhost/api/v1/keys/validate', {
    method: 'POST',
    headers: { authorization: `Bearer ${rawKey}`, 'x-app-id': appId },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockResolvedValue(true); // flags ON only in this test context
  prisma.devApiKey.findUnique.mockResolvedValue({
    id: 'key-1', userId: 'user-1', keyHash, status: 'ACTIVE', seatId: 'seat-1', teamId: 'team-1',
  });
  prisma.devApiKey.update.mockResolvedValue({});
});

describe('INT-G — naap_ key resolves across 2 providers × 2 apps', () => {
  const providers = ['stub', 'pymthouse'] as const;
  const appIds = ['storyboard', 'naap-sample-cli'] as const;
  const matrix: Array<{ provider: string; app: string; pass: boolean; detail: string }> = [];

  for (const provider of providers) {
    for (const appId of appIds) {
      it(`resolves provider=${provider} app=${appId} with correct caps + attribution + schema`, async () => {
        prisma.team.findUnique.mockResolvedValue({
          id: 'team-1', billingAccountProviderSlug: provider, billingAccountId: ACCOUNT_ID[provider],
        });
        prisma.application.findFirst.mockResolvedValue(APPS[appId]);

        const { POST } = await import('@/app/api/v1/keys/validate/route');
        const res = await POST(frontDoorReq(appId));

        let pass = false;
        let detail = '';
        try {
          expect(res.status).toBe(200);
          const body = await res.json();
          const d = body.data;

          // E8 — provider-agnostic resolution.
          expect(d.billingAccount.providerSlug).toBe(provider);
          expect(d.billingAccount.id).toBe(ACCOUNT_ID[provider]);
          // E9 — per-app attribution + capability gating.
          expect(d.app.id).toBe(appId);
          expect([...d.capabilities].sort()).toEqual([...EXPECTED[provider][appId]].sort());
          // signer session present + opaque.
          expect(d.signerSession).toBeTruthy();
          // Seam isolation end-to-end: no provider-internal field leaks.
          expect(findLeakedInternalFields(d, getForbiddenInternalFieldNames())).toEqual([]);
          // Adapter validate() payload conforms to C0 validate.schema.json.
          const v = await adapters[provider].validate(ACCOUNT_ID[provider]);
          expect(validateAgainstBppSchema('validate', v).valid).toBe(true);

          pass = true;
          detail = `caps=[${d.capabilities.join(',')}]`;
        } catch (e) {
          detail = e instanceof Error ? e.message.split('\n')[0] : String(e);
          throw e;
        } finally {
          matrix.push({ provider, app: appId, pass, detail });
        }
      });
    }
  }

  it('captures the full pass/fail matrix (all 4 cells pass)', () => {
    // Printed for the INT-G report.
    // eslint-disable-next-line no-console
    console.log('INT-G matrix:\n' + matrix.map((m) => `  ${m.provider} × ${m.app}: ${m.pass ? 'PASS' : 'FAIL'} ${m.detail}`).join('\n'));
    expect(matrix).toHaveLength(4);
    expect(matrix.every((m) => m.pass)).toBe(true);
  });
});
