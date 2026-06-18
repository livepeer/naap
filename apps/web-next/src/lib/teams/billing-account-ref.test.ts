/** @vitest-environment node */

import { describe, it, expect } from 'vitest';

import {
  isBoundProviderConfigured,
  isProviderResolvable,
  normalizeBillingAccountRef,
  teamBillingAccountRef,
} from './billing-account-ref';

describe('normalizeBillingAccountRef', () => {
  it('normalizes a valid ref (lowercases slug, trims)', () => {
    expect(normalizeBillingAccountRef({ providerSlug: ' Pymthouse ', accountId: ' acct_1 ' })).toEqual({
      providerSlug: 'pymthouse',
      accountId: 'acct_1',
    });
  });
  it('rejects non-object / missing fields', () => {
    expect(normalizeBillingAccountRef(null)).toBeNull();
    expect(normalizeBillingAccountRef('x')).toBeNull();
    expect(normalizeBillingAccountRef({ providerSlug: 'pymthouse' })).toBeNull();
    expect(normalizeBillingAccountRef({ accountId: 'a' })).toBeNull();
  });
  it('rejects invalid slug or empty/oversized accountId', () => {
    expect(normalizeBillingAccountRef({ providerSlug: 'Bad_Slug', accountId: 'a' })).toBeNull();
    expect(normalizeBillingAccountRef({ providerSlug: 'ok', accountId: '' })).toBeNull();
    expect(normalizeBillingAccountRef({ providerSlug: 'ok', accountId: 'x'.repeat(257) })).toBeNull();
  });
});

describe('isProviderResolvable — uses the NAAP-A adapter registry', () => {
  it('resolves registered providers (pymthouse AND the C0 stub)', () => {
    expect(isProviderResolvable({ providerSlug: 'pymthouse', accountId: 'a' })).toBe(true);
    expect(isProviderResolvable({ providerSlug: 'stub', accountId: 'a' })).toBe(true);
  });
  it('rejects an unknown provider (stays generic)', () => {
    expect(isProviderResolvable({ providerSlug: 'nope', accountId: 'a' })).toBe(false);
  });
});

describe('isBoundProviderConfigured', () => {
  it('is true for the in-memory stub adapter', () => {
    expect(isBoundProviderConfigured({ providerSlug: 'stub', accountId: 'a' })).toBe(true);
  });
  it('is false for an unknown provider', () => {
    expect(isBoundProviderConfigured({ providerSlug: 'nope', accountId: 'a' })).toBe(false);
  });
});

describe('teamBillingAccountRef', () => {
  it('reads a fully-bound team', () => {
    expect(
      teamBillingAccountRef({
        id: 't1',
        billingAccountProviderSlug: 'pymthouse',
        billingAccountId: 'acct_1',
      }),
    ).toEqual({ providerSlug: 'pymthouse', accountId: 'acct_1' });
  });
  it('treats a partial binding as unbound', () => {
    expect(
      teamBillingAccountRef({ id: 't1', billingAccountProviderSlug: 'pymthouse', billingAccountId: null }),
    ).toBeNull();
    expect(
      teamBillingAccountRef({ id: 't1', billingAccountProviderSlug: null, billingAccountId: 'acct_1' }),
    ).toBeNull();
  });
});
