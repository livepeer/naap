/** @vitest-environment node */

import { describe, it, expect } from 'vitest';

import {
  SUBSCRIPTION_STATUS_ACTIVE,
  SUBSCRIPTION_STATUS_CANCELED,
  SUBSCRIPTION_STATUS_PAUSED,
  isCancelableStatus,
  parseCreateSubscriptionBody,
  toCatalogInstanceView,
  toSubscriptionView,
  type CatalogInstanceRow,
  type SubscriptionRow,
} from './subscription-catalog';

const instance: CatalogInstanceRow = {
  id: 'inst-1',
  slug: 'pymthouse-default',
  displayName: 'PymtHouse (default)',
  adapterType: 'pymthouse',
  enabled: true,
  sortOrder: 0,
};

describe('toCatalogInstanceView', () => {
  it('exposes only non-secret identity fields + empty plans by default', () => {
    const view = toCatalogInstanceView(instance);
    expect(view).toEqual({
      providerInstanceId: 'inst-1',
      slug: 'pymthouse-default',
      displayName: 'PymtHouse (default)',
      adapterType: 'pymthouse',
      plans: [],
    });
    // No secret-bearing fields ever leak into the catalog view.
    expect(JSON.stringify(view)).not.toContain('secretRef');
    expect(JSON.stringify(view)).not.toContain('config');
  });

  it('passes through provided plans (P4 will populate these)', () => {
    const view = toCatalogInstanceView(instance, [
      { providerPlanId: 'p1', name: 'Starter', capabilities: ['text-to-image'] },
    ]);
    expect(view.plans).toHaveLength(1);
    expect(view.plans[0].providerPlanId).toBe('p1');
  });
});

describe('toSubscriptionView', () => {
  it('serializes dates and keeps the opaque accountId', () => {
    const row: SubscriptionRow = {
      id: 'sub-1',
      teamId: 'team-1',
      providerInstanceId: 'inst-1',
      providerPlanId: null,
      accountId: 'acct_42',
      status: 'active',
      appId: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    const view = toSubscriptionView(row);
    expect(view.id).toBe('sub-1');
    expect(view.accountId).toBe('acct_42');
    expect(view.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(view.updatedAt).toBe('2026-01-02T00:00:00.000Z');
    // teamId is internal scoping, not part of the provider-neutral view.
    expect(view).not.toHaveProperty('teamId');
  });
});

describe('isCancelableStatus', () => {
  it('active + paused are cancelable; canceled is not', () => {
    expect(isCancelableStatus(SUBSCRIPTION_STATUS_ACTIVE)).toBe(true);
    expect(isCancelableStatus(SUBSCRIPTION_STATUS_PAUSED)).toBe(true);
    expect(isCancelableStatus(SUBSCRIPTION_STATUS_CANCELED)).toBe(false);
    expect(isCancelableStatus('garbage')).toBe(false);
  });
});

describe('parseCreateSubscriptionBody', () => {
  it('requires providerInstanceId', () => {
    expect(parseCreateSubscriptionBody({}).ok).toBe(false);
    expect(parseCreateSubscriptionBody({ providerInstanceId: '   ' }).ok).toBe(false);
    expect(parseCreateSubscriptionBody(null).ok).toBe(false);
    expect(parseCreateSubscriptionBody('nope').ok).toBe(false);
  });

  it('trims + defaults optional fields to null', () => {
    const r = parseCreateSubscriptionBody({ providerInstanceId: '  inst-1 ' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    expect(r.value).toEqual({
      providerInstanceId: 'inst-1',
      providerPlanId: null,
      accountId: null,
      appId: null,
    });
  });

  it('captures optional providerPlanId / accountId / appId', () => {
    const r = parseCreateSubscriptionBody({
      providerInstanceId: 'inst-1',
      providerPlanId: 'plan-9',
      accountId: 'acct_7',
      appId: 'storyboard',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    expect(r.value.providerPlanId).toBe('plan-9');
    expect(r.value.accountId).toBe('acct_7');
    expect(r.value.appId).toBe('storyboard');
  });
});
