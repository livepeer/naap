/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getBillingProviderAdapter = vi.fn();
vi.mock('@/lib/billing/registry', () => ({
  getBillingProviderAdapter: (...a: unknown[]) => getBillingProviderAdapter(...a),
}));

import {
  NATIVE_KEY_RE,
  generateNativeApiKey,
  isNativeKeyFormat,
  resolveNativeKeyToProviderSession,
  verifyNativeKeyHash,
  type NativeKeyRecord,
} from './native-key';
import type { TeamBillingBinding } from '@/lib/teams/billing-account-ref';
import { hashApiKey } from '@naap/database';

function fakeAdapter(slug: string, overrides: Record<string, unknown> = {}) {
  return {
    slug,
    isConfigured: vi.fn(() => true),
    mintSignerSession: vi.fn(async () => ({
      accessToken: `tok-${slug}`,
      tokenType: 'Bearer',
      expiresIn: 3600,
      scope: 'sign:job',
    })),
    ...overrides,
  };
}

const activeKey: NativeKeyRecord = { status: 'ACTIVE', seatId: 'seat-1', teamId: 'team-1' };
const pymtTeam: TeamBillingBinding = {
  id: 'team-1',
  billingAccountProviderSlug: 'pymthouse',
  billingAccountId: 'acct_om_1',
};
const stubTeam: TeamBillingBinding = {
  id: 'team-1',
  billingAccountProviderSlug: 'stub',
  billingAccountId: 'acct_stub_1',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateNativeApiKey', () => {
  it('produces a canonical naap_<16>_<48> key', () => {
    const { rawKey, lookupId, secret } = generateNativeApiKey();
    expect(NATIVE_KEY_RE.test(rawKey)).toBe(true);
    expect(isNativeKeyFormat(rawKey)).toBe(true);
    expect(lookupId).toHaveLength(16);
    expect(secret).toHaveLength(48);
    expect(rawKey).toBe(`naap_${lookupId}_${secret}`);
  });
  it('is unique across calls', () => {
    expect(generateNativeApiKey().rawKey).not.toBe(generateNativeApiKey().rawKey);
  });
});

describe('verifyNativeKeyHash (constant-time)', () => {
  it('accepts the matching hash and rejects others/null', () => {
    const { rawKey } = generateNativeApiKey();
    const hash = hashApiKey(rawKey);
    expect(verifyNativeKeyHash(rawKey, hash)).toBe(true);
    expect(verifyNativeKeyHash(`${rawKey}x`, hash)).toBe(false);
    expect(verifyNativeKeyHash(rawKey, null)).toBe(false);
    expect(verifyNativeKeyHash(rawKey, 'deadbeef')).toBe(false);
  });
});

describe('resolveNativeKeyToProviderSession — provider-agnostic mapping', () => {
  it('resolves a naap_ key to the pymthouse provider session', async () => {
    const adapter = fakeAdapter('pymthouse');
    getBillingProviderAdapter.mockReturnValue(adapter);
    const res = await resolveNativeKeyToProviderSession(activeKey, pymtTeam, { email: 'u@e.co' });
    expect(res.valid).toBe(true);
    expect(res.billingAccountRef).toEqual({ providerSlug: 'pymthouse', accountId: 'acct_om_1' });
    expect(res.signerSession?.accessToken).toBe('tok-pymthouse');
    // externalUserId is the provider account id from the binding.
    expect(adapter.mintSignerSession).toHaveBeenCalledWith(
      expect.objectContaining({ externalUserId: 'acct_om_1', email: 'u@e.co' }),
    );
  });

  it('resolves the SAME key shape against the C0 stub provider', async () => {
    getBillingProviderAdapter.mockReturnValue(fakeAdapter('stub'));
    const res = await resolveNativeKeyToProviderSession(activeKey, stubTeam);
    expect(res.valid).toBe(true);
    expect(res.signerSession?.accessToken).toBe('tok-stub');
  });

  it('revocation invalidates instantly (no provider call)', async () => {
    const adapter = fakeAdapter('pymthouse');
    getBillingProviderAdapter.mockReturnValue(adapter);
    const res = await resolveNativeKeyToProviderSession({ ...activeKey, status: 'REVOKED' }, pymtTeam);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('revoked');
    expect(adapter.mintSignerSession).not.toHaveBeenCalled();
    expect(getBillingProviderAdapter).not.toHaveBeenCalled();
  });

  it('rejects a key whose seat has no team binding', async () => {
    const res = await resolveNativeKeyToProviderSession({ ...activeKey, teamId: null }, null);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('unbound_seat');
  });

  it('rejects when the team is unbound to a billing account', async () => {
    const res = await resolveNativeKeyToProviderSession(activeKey, {
      id: 'team-1',
      billingAccountProviderSlug: null,
      billingAccountId: null,
    });
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('team_unbound');
  });

  it('fails safe when the bound provider is unavailable/unconfigured', async () => {
    getBillingProviderAdapter.mockReturnValue(fakeAdapter('pymthouse', { isConfigured: vi.fn(() => false) }));
    const res = await resolveNativeKeyToProviderSession(activeKey, pymtTeam);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('provider_unavailable');
  });

  it('fails safe (no internals leaked) when mint throws', async () => {
    getBillingProviderAdapter.mockReturnValue(
      fakeAdapter('pymthouse', {
        mintSignerSession: vi.fn(async () => {
          throw new Error('provider boom: secret-token-xyz');
        }),
      }),
    );
    const res = await resolveNativeKeyToProviderSession(activeKey, pymtTeam);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('mint_failed');
    expect(res.signerSession).toBeUndefined();
  });
});
