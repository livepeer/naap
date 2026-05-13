import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const getCurrentPlan = vi.fn();
const customersCreate = vi.fn();
const setupIntentsCreate = vi.fn();
const subscriptionsCreate = vi.fn();
const subscriptionsUpdate = vi.fn();
const billSubFindUnique = vi.fn();
const billSubUpsert = vi.fn();
const billSubUpdate = vi.fn();
const billPlanFindUnique = vi.fn();
const billPlanFindFirst = vi.fn();
const resolveTenant = vi.fn().mockResolvedValue('t1');

vi.mock('@/lib/agentbook-tenant', () => ({ resolveAgentbookTenant: (...a: unknown[]) => resolveTenant(...a) }));
vi.mock('@naap/billing', () => ({
  getCurrentPlan: (...a: unknown[]) => getCurrentPlan(...a),
  invalidateAccount: vi.fn(),
}));
vi.mock('@/lib/billing/stripe', () => ({
  getStripe: () => ({
    customers: { create: (...a: unknown[]) => customersCreate(...a) },
    setupIntents: { create: (...a: unknown[]) => setupIntentsCreate(...a) },
    subscriptions: {
      create: (...a: unknown[]) => subscriptionsCreate(...a),
      update: (...a: unknown[]) => subscriptionsUpdate(...a),
    },
  }),
}));
vi.mock('@naap/database', () => ({
  prisma: {
    billSubscription: {
      findUnique: (...a: unknown[]) => billSubFindUnique(...a),
      upsert: (...a: unknown[]) => billSubUpsert(...a),
      update: (...a: unknown[]) => billSubUpdate(...a),
    },
    billPlan: {
      findUnique: (...a: unknown[]) => billPlanFindUnique(...a),
      findFirst: (...a: unknown[]) => billPlanFindFirst(...a),
    },
  },
}));

import { GET as getMine, POST as subscribe } from '@/app/api/v1/agentbook-billing/me/subscription/route';
import { POST as createIntent } from '@/app/api/v1/agentbook-billing/me/subscription/intent/route';
import { POST as cancel } from '@/app/api/v1/agentbook-billing/me/subscription/cancel/route';
import { POST as reactivate } from '@/app/api/v1/agentbook-billing/me/subscription/reactivate/route';

beforeEach(() => {
  getCurrentPlan.mockReset(); customersCreate.mockReset(); setupIntentsCreate.mockReset();
  subscriptionsCreate.mockReset(); subscriptionsUpdate.mockReset();
  billSubFindUnique.mockReset(); billSubUpsert.mockReset(); billSubUpdate.mockReset();
  billPlanFindUnique.mockReset(); billPlanFindFirst.mockReset();
});

function req(body?: unknown): NextRequest {
  return new NextRequest('http://x/me', {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('GET /me/subscription', () => {
  it('returns the current plan summary', async () => {
    getCurrentPlan.mockResolvedValue({
      plan: {
        id: 'p1', code: 'free', name: 'Free', priceCents: 0,
        features: { telegram_bot: false, tax_package_generation: false, multi_user_teams: false },
        quotas: { expenses_created: 50, ocr_scans: 10, ai_messages: 100, invoices_sent: 5, bank_connections: 0 },
      },
      status: 'active', periodEnd: null, cancelAtPeriodEnd: false,
      usage: {
        expenses_created: { used: 0, limit: 50 },
        ocr_scans: { used: 0, limit: 10 },
        ai_messages: { used: 0, limit: 100 },
        invoices_sent: { used: 0, limit: 5 },
        bank_connections: { used: 0, limit: 0 },
      },
    });
    const r = await getMine(new NextRequest('http://x/me'));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.plan.code).toBe('free');
  });
});

describe('POST /me/subscription/intent', () => {
  it('creates Stripe Customer + SetupIntent when no customer exists', async () => {
    billSubFindUnique.mockResolvedValue(null);
    customersCreate.mockResolvedValue({ id: 'cus_x' });
    billPlanFindFirst.mockResolvedValue({ id: 'plan-free' });
    billSubUpsert.mockResolvedValue({});
    setupIntentsCreate.mockResolvedValue({ id: 'seti_x', client_secret: 'seti_x_secret_y' });
    const r = await createIntent(req());
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.clientSecret).toBe('seti_x_secret_y');
    expect(customersCreate).toHaveBeenCalledTimes(1);
  });

  it('reuses existing customer', async () => {
    billSubFindUnique.mockResolvedValue({ stripeCustomerId: 'cus_existing' });
    setupIntentsCreate.mockResolvedValue({ id: 's', client_secret: 'sec' });
    const r = await createIntent(req());
    expect(r.status).toBe(200);
    expect(customersCreate).not.toHaveBeenCalled();
  });
});

describe('POST /me/subscription', () => {
  it('creates the subscription', async () => {
    billSubFindUnique.mockResolvedValue({ stripeCustomerId: 'cus_x' });
    billPlanFindUnique.mockResolvedValue({ id: 'plan-pro', stripePriceId: 'price_y' });
    subscriptionsCreate.mockResolvedValue({
      id: 'sub_x', status: 'active',
      current_period_start: 1700000000, current_period_end: 1702592000,
      cancel_at_period_end: false,
    });
    billSubUpsert.mockResolvedValue({});
    const r = await subscribe(req({ planId: 'plan-pro', paymentMethodId: 'pm_x' }));
    expect(r.status).toBe(200);
    expect(subscriptionsCreate).toHaveBeenCalled();
  });

  it('returns 400 when no customer exists yet', async () => {
    billSubFindUnique.mockResolvedValue(null);
    billPlanFindUnique.mockResolvedValue({ id: 'plan-pro', stripePriceId: 'price_y' });
    const r = await subscribe(req({ planId: 'plan-pro', paymentMethodId: 'pm_x' }));
    expect(r.status).toBe(400);
  });

  it('returns 400 when plan has no Stripe price', async () => {
    billSubFindUnique.mockResolvedValue({ stripeCustomerId: 'cus_x' });
    billPlanFindUnique.mockResolvedValue({ id: 'plan-broken', stripePriceId: null });
    const r = await subscribe(req({ planId: 'plan-broken', paymentMethodId: 'pm_x' }));
    expect(r.status).toBe(400);
  });
});

describe('POST /me/subscription/cancel', () => {
  it('sets cancel_at_period_end', async () => {
    billSubFindUnique.mockResolvedValue({ stripeSubscriptionId: 'sub_x' });
    subscriptionsUpdate.mockResolvedValue({});
    billSubUpdate.mockResolvedValue({});
    const r = await cancel(req());
    expect(r.status).toBe(200);
    expect(subscriptionsUpdate).toHaveBeenCalledWith('sub_x', { cancel_at_period_end: true });
  });

  it('returns 404 when no subscription', async () => {
    billSubFindUnique.mockResolvedValue(null);
    const r = await cancel(req());
    expect(r.status).toBe(404);
  });
});

describe('POST /me/subscription/reactivate', () => {
  it('clears cancel_at_period_end', async () => {
    billSubFindUnique.mockResolvedValue({ stripeSubscriptionId: 'sub_x' });
    subscriptionsUpdate.mockResolvedValue({});
    billSubUpdate.mockResolvedValue({});
    const r = await reactivate(req());
    expect(r.status).toBe(200);
    expect(subscriptionsUpdate).toHaveBeenCalledWith('sub_x', { cancel_at_period_end: false });
  });
});
