/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  listPullCapableProviderSlugs,
  pullSpend,
  resetUsagePullCacheForTests,
  resolveSpendWindow,
  spendScopeKey,
} from './usage-pull';
import type {
  AppUsageInput,
  BillingProviderAdapter,
  Capability,
  CuratedOrchestrator,
  MintSignerSessionInput,
  Plan,
  ProviderSpendRecord,
  ProviderSpendResult,
  ProviderSpendScope,
  SignerSessionToken,
  UsageForExternalUserInput,
  ValidateResult,
} from '@/lib/billing/adapter';
import {
  registerBillingProviderAdapter,
  resetBillingProviderRegistryForTests,
} from '@/lib/billing/registry';

const FAKE_SLUG = 'fakeprov';

/** A minimal pull-capable provider adapter for exercising usage-pull in isolation. */
class FakePullAdapter implements BillingProviderAdapter {
  readonly slug = FAKE_SLUG;
  configured = true;
  getSpend = vi.fn(async (_scope: ProviderSpendScope): Promise<ProviderSpendResult> => ({
    records: [],
  }));

  isConfigured(): boolean {
    return this.configured;
  }
  async validate(_key: string): Promise<ValidateResult> {
    return { valid: false };
  }
  async getPlans(): Promise<Plan[]> {
    return [];
  }
  async getUsageForExternalUser(_input: UsageForExternalUserInput): Promise<unknown> {
    return {};
  }
  async getAppUsage(_input: AppUsageInput): Promise<unknown> {
    return {};
  }
  async mintSignerSession(_input: MintSignerSessionInput): Promise<SignerSessionToken> {
    return { accessToken: 'x' };
  }
  async receiveCuratedOrchestrators(_plan: string, _list: CuratedOrchestrator[]): Promise<void> {}
  async getCapabilityManifest(): Promise<Capability[]> {
    return [];
  }
}

function rec(accountId: string, tickets: number): ProviderSpendRecord {
  return { providerSlug: FAKE_SLUG, accountId, tickets, networkFeeUsdMicros: String(tickets * 100) };
}

const WINDOW = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-01-31T23:59:59Z') };
const OPTS = { correlationId: 'test-cid' };

let adapter: FakePullAdapter;

beforeEach(() => {
  resetBillingProviderRegistryForTests();
  resetUsagePullCacheForTests();
  delete process.env.USAGE_PULL_CACHE_TTL_MS;
  adapter = new FakePullAdapter();
  registerBillingProviderAdapter(adapter);
});

afterEach(() => {
  vi.useRealTimers();
  resetBillingProviderRegistryForTests();
  resetUsagePullCacheForTests();
  delete process.env.USAGE_PULL_CACHE_TTL_MS;
});

describe('resolveSpendWindow', () => {
  it('uses explicit bounds when provided', () => {
    const w = resolveSpendWindow(WINDOW.from, WINDOW.to);
    expect(w.startDate).toBe(WINDOW.from.toISOString());
    expect(w.endDate).toBe(WINDOW.to.toISOString());
  });

  it('defaults to the current UTC month-to-now when omitted', () => {
    const w = resolveSpendWindow(null, new Date('2026-03-15T12:00:00Z'));
    expect(w.startDate).toBe('2026-03-01T00:00:00.000Z');
    expect(w.endDate).toBe('2026-03-15T12:00:00.000Z');
  });
});

describe('listPullCapableProviderSlugs', () => {
  it('includes a configured adapter that implements getSpend', () => {
    expect(listPullCapableProviderSlugs()).toContain(FAKE_SLUG);
  });

  it('excludes an adapter that is not configured', () => {
    adapter.configured = false;
    expect(listPullCapableProviderSlugs()).not.toContain(FAKE_SLUG);
  });
});

describe('pullSpend', () => {
  it('pulls a scoped account and marks it pulled', async () => {
    adapter.getSpend.mockResolvedValue({ records: [rec('acct_1', 5)], source: 'openmeter' });

    const out = await pullSpend([{ providerSlug: FAKE_SLUG, accountId: 'acct_1' }], WINDOW, OPTS);

    expect(adapter.getSpend).toHaveBeenCalledTimes(1);
    expect(adapter.getSpend).toHaveBeenCalledWith({
      accountId: 'acct_1',
      startDate: WINDOW.from.toISOString(),
      endDate: WINDOW.to.toISOString(),
    });
    expect(out.records).toEqual([rec('acct_1', 5)]);
    expect(out.pulled.has(spendScopeKey({ providerSlug: FAKE_SLUG, accountId: 'acct_1' }))).toBe(true);
  });

  it('serves a cache hit on the second call (no second provider call)', async () => {
    adapter.getSpend.mockResolvedValue({ records: [rec('acct_1', 5)] });
    const scope = [{ providerSlug: FAKE_SLUG, accountId: 'acct_1' }];

    await pullSpend(scope, WINDOW, OPTS);
    const second = await pullSpend(scope, WINDOW, OPTS);

    expect(adapter.getSpend).toHaveBeenCalledTimes(1); // cached
    expect(second.records).toEqual([rec('acct_1', 5)]);
    expect(second.pulled.size).toBe(1);
  });

  it('re-pulls after the TTL expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-01T00:00:00Z'));
    process.env.USAGE_PULL_CACHE_TTL_MS = '1000';
    adapter.getSpend.mockResolvedValue({ records: [rec('acct_1', 5)] });
    const scope = [{ providerSlug: FAKE_SLUG, accountId: 'acct_1' }];

    await pullSpend(scope, WINDOW, OPTS);
    vi.advanceTimersByTime(1500); // past TTL
    await pullSpend(scope, WINDOW, OPTS);

    expect(adapter.getSpend).toHaveBeenCalledTimes(2);
  });

  it('bypasses the cache entirely when TTL <= 0', async () => {
    process.env.USAGE_PULL_CACHE_TTL_MS = '0';
    adapter.getSpend.mockResolvedValue({ records: [rec('acct_1', 5)] });
    const scope = [{ providerSlug: FAKE_SLUG, accountId: 'acct_1' }];

    await pullSpend(scope, WINDOW, OPTS);
    await pullSpend(scope, WINDOW, OPTS);

    expect(adapter.getSpend).toHaveBeenCalledTimes(2);
  });

  it('degrades gracefully when the provider pull throws (no throw, not pulled)', async () => {
    adapter.getSpend.mockRejectedValue(new Error('provider 503'));

    const out = await pullSpend([{ providerSlug: FAKE_SLUG, accountId: 'acct_1' }], WINDOW, OPTS);

    expect(out.records).toEqual([]);
    expect(out.pulled.size).toBe(0); // caller will backfill from the DB
  });

  it('skips a provider with no pull-capable adapter (push-only)', async () => {
    const out = await pullSpend([{ providerSlug: 'stub', accountId: 'acct_1' }], WINDOW, OPTS);
    expect(out.records).toEqual([]);
    expect(out.pulled.size).toBe(0);
  });

  it('isolates tenants: only the requested account is pulled and cached per-account', async () => {
    adapter.getSpend.mockImplementation(async (scope: ProviderSpendScope) => ({
      records: [rec(scope.accountId ?? '*app*', 1)],
    }));

    await pullSpend(
      [
        { providerSlug: FAKE_SLUG, accountId: 'acct_1' },
        { providerSlug: FAKE_SLUG, accountId: 'acct_2' },
      ],
      WINDOW,
      OPTS,
    );

    // Each account asked the provider for ITS OWN id only — never another's.
    const askedAccounts = adapter.getSpend.mock.calls.map((c) => c[0].accountId);
    expect(askedAccounts.sort()).toEqual(['acct_1', 'acct_2']);

    // A different account is a different cache key → its own provider call.
    adapter.getSpend.mockClear();
    await pullSpend([{ providerSlug: FAKE_SLUG, accountId: 'acct_3' }], WINDOW, OPTS);
    expect(adapter.getSpend).toHaveBeenCalledTimes(1);
    expect(adapter.getSpend.mock.calls[0][0].accountId).toBe('acct_3');
  });
});
