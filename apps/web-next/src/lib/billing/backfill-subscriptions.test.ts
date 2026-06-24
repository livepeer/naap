/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    providerInstance: { findUnique: vi.fn(), create: vi.fn() },
    team: { findMany: vi.fn() },
    subscription: { findFirst: vi.fn(), create: vi.fn() },
    devApiKey: { updateMany: vi.fn() },
  },
}));

const readPymthouseEnv = vi.fn();
vi.mock('@pymthouse/builder-sdk/config', () => ({
  readPymthouseEnv: () => readPymthouseEnv(),
}));

import { prisma } from '@/lib/db';
import {
  backfillDefaultSubscriptions,
  DEFAULT_PYMTHOUSE_INSTANCE_SLUG,
  DEFAULT_PYMTHOUSE_SECRET_REF,
} from './backfill-subscriptions';

const providerFindUnique = prisma.providerInstance.findUnique as ReturnType<typeof vi.fn>;
const providerCreate = prisma.providerInstance.create as ReturnType<typeof vi.fn>;
const teamFindMany = prisma.team.findMany as ReturnType<typeof vi.fn>;
const subFindFirst = prisma.subscription.findFirst as ReturnType<typeof vi.fn>;
const subCreate = prisma.subscription.create as ReturnType<typeof vi.fn>;
const keyUpdateMany = prisma.devApiKey.updateMany as ReturnType<typeof vi.fn>;

const ENV = {
  issuerUrl: 'https://staging.pymthouse.com',
  publicClientId: 'app_default',
  m2mClientId: 'm2m_default',
  m2mClientSecret: 'TOP-SECRET-VALUE',
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('backfillDefaultSubscriptions', () => {
  it('is a no-op when the global pymthouse env is not configured', async () => {
    readPymthouseEnv.mockReturnValue(null);
    const res = await backfillDefaultSubscriptions();
    expect(res.ran).toBe(false);
    expect(res.subscriptionsCreated).toBe(0);
    expect(res.keysLinked).toBe(0);
    expect(providerCreate).not.toHaveBeenCalled();
    expect(teamFindMany).not.toHaveBeenCalled();
  });

  it('first run: seeds the default instance, default subscriptions, and links unlinked keys', async () => {
    readPymthouseEnv.mockReturnValue(ENV);
    providerFindUnique.mockResolvedValue(null);
    providerCreate.mockResolvedValue({ id: 'pi_default' });
    teamFindMany.mockResolvedValue([
      { id: 't1', billingAccountId: 'acct_1' },
      { id: 't2', billingAccountId: 'acct_2' },
    ]);
    subFindFirst.mockResolvedValue(null);
    subCreate.mockResolvedValueOnce({ id: 'sub_1' }).mockResolvedValueOnce({ id: 'sub_2' });
    keyUpdateMany.mockResolvedValueOnce({ count: 3 }).mockResolvedValueOnce({ count: 1 });

    const res = await backfillDefaultSubscriptions();

    expect(res.ran).toBe(true);
    expect(res.providerInstanceId).toBe('pi_default');
    expect(res.providerInstanceCreated).toBe(true);
    expect(res.subscriptionsCreated).toBe(2);
    expect(res.keysLinked).toBe(4);

    // Only pymthouse-bound, account-set teams are backfilled.
    expect(teamFindMany).toHaveBeenCalledWith({
      where: {
        billingAccountProviderSlug: 'pymthouse',
        billingAccountId: { not: null },
      },
      select: { id: true, billingAccountId: true },
    });

    // Default subscription points at the default instance with the team's account.
    expect(subCreate).toHaveBeenCalledWith({
      data: {
        teamId: 't1',
        providerInstanceId: 'pi_default',
        providerPlanId: null,
        accountId: 'acct_1',
        status: 'active',
      },
      select: { id: true },
    });

    // Only UNLINKED keys are linked (subscriptionId: null filter).
    expect(keyUpdateMany).toHaveBeenCalledWith({
      where: { teamId: 't1', subscriptionId: null },
      data: { subscriptionId: 'sub_1' },
    });
  });

  it('INV-secret-isolation: the seeded instance config never contains the M2M secret value', async () => {
    readPymthouseEnv.mockReturnValue(ENV);
    providerFindUnique.mockResolvedValue(null);
    providerCreate.mockResolvedValue({ id: 'pi_default' });
    teamFindMany.mockResolvedValue([]);

    await backfillDefaultSubscriptions();

    const createArg = providerCreate.mock.calls[0][0];
    expect(createArg.data.slug).toBe(DEFAULT_PYMTHOUSE_INSTANCE_SLUG);
    expect(createArg.data.secretRef).toBe(DEFAULT_PYMTHOUSE_SECRET_REF);
    expect(createArg.data.config).toEqual({
      issuerUrl: ENV.issuerUrl,
      publicClientId: ENV.publicClientId,
      m2mClientId: ENV.m2mClientId,
    });
    expect(JSON.stringify(createArg.data)).not.toContain(ENV.m2mClientSecret);
  });

  it('idempotent re-run: existing instance/subscriptions reused, no new rows, no re-link', async () => {
    readPymthouseEnv.mockReturnValue(ENV);
    providerFindUnique.mockResolvedValue({ id: 'pi_default' });
    teamFindMany.mockResolvedValue([
      { id: 't1', billingAccountId: 'acct_1' },
      { id: 't2', billingAccountId: 'acct_2' },
    ]);
    subFindFirst.mockResolvedValueOnce({ id: 'sub_1' }).mockResolvedValueOnce({ id: 'sub_2' });
    keyUpdateMany.mockResolvedValue({ count: 0 });

    const res = await backfillDefaultSubscriptions();

    expect(res.ran).toBe(true);
    expect(res.providerInstanceCreated).toBe(false);
    expect(res.subscriptionsCreated).toBe(0);
    expect(res.keysLinked).toBe(0);
    expect(providerCreate).not.toHaveBeenCalled();
    expect(subCreate).not.toHaveBeenCalled();
  });
});
