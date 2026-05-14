import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindMany = vi.fn();
const mockFindFirst = vi.fn();
const mockCreate = vi.fn();
const mockUpdateMany = vi.fn();
const mockDeleteMany = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    discoveryPlan: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
      deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
    },
  },
}));

import { listPlans, getPlan, updatePlan, deletePlan, createPlan } from '../plans';

const now = new Date();
const publicPlan = {
  id: 'pub-1',
  billingPlanId: 'naap-default-high-perf',
  name: 'High-Performance Video',
  description: 'Admin default plan',
  visibility: 'public',
  teamId: null,
  ownerUserId: 'admin-id',
  capabilities: ['image-to-video'],
  topN: 10,
  slaWeights: null,
  slaMinScore: null,
  sortBy: null,
  filters: null,
  enabled: true,
  createdAt: now,
  updatedAt: now,
};

const personalPlan = {
  id: 'pers-1',
  billingPlanId: 'user-custom-plan',
  name: 'My Custom Plan',
  description: null,
  visibility: 'personal',
  teamId: 'personal:user-b',
  ownerUserId: 'user-b',
  capabilities: ['noop'],
  topN: 5,
  slaWeights: null,
  slaMinScore: null,
  sortBy: null,
  filters: null,
  enabled: true,
  createdAt: now,
  updatedAt: now,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listPlans', () => {
  it('returns public plans AND the callers personal plans', async () => {
    mockFindMany.mockResolvedValue([publicPlan, personalPlan]);

    const scope = { teamId: 'personal:user-b', ownerUserId: 'user-b' };
    const plans = await listPlans(scope);

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { visibility: 'public' },
          { teamId: 'personal:user-b' },
          { ownerUserId: 'user-b' },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(plans).toHaveLength(2);
    expect(plans[0].visibility).toBe('public');
    expect(plans[1].visibility).toBe('personal');
  });
});

describe('getPlan', () => {
  it('allows reading a public plan even if not the owner', async () => {
    mockFindFirst.mockResolvedValue(publicPlan);

    const scope = { ownerUserId: 'user-b' };
    const plan = await getPlan('pub-1', scope);

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'pub-1',
        OR: [
          { visibility: 'public' },
          { ownerUserId: 'user-b' },
        ],
      },
    });
    expect(plan).not.toBeNull();
    expect(plan!.id).toBe('pub-1');
  });
});

describe('updatePlan', () => {
  it('returns forbidden when non-admin tries to update a public plan', async () => {
    mockFindFirst.mockResolvedValue(publicPlan);

    const scope = { ownerUserId: 'user-b', isAdmin: false };
    const result = await updatePlan('pub-1', { name: 'Hacked' }, scope);

    expect(result).toBe('forbidden');
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('allows admin to update a public plan', async () => {
    mockFindFirst.mockResolvedValueOnce(publicPlan);
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFindFirst.mockResolvedValueOnce({ ...publicPlan, name: 'Updated' });

    const scope = { ownerUserId: 'admin-id', isAdmin: true };
    const result = await updatePlan('pub-1', { name: 'Updated' }, scope);

    expect(result).not.toBe('forbidden');
    expect(result).not.toBeNull();
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pub-1' } }),
    );
  });

  it('allows user to update their own personal plan', async () => {
    mockFindFirst.mockResolvedValueOnce(personalPlan);
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFindFirst.mockResolvedValueOnce({ ...personalPlan, name: 'Updated' });

    const scope = { ownerUserId: 'user-b' };
    const result = await updatePlan('pers-1', { name: 'Updated' }, scope);

    expect(result).not.toBe('forbidden');
    expect(result).not.toBeNull();
  });
});

describe('deletePlan', () => {
  it('returns forbidden when non-admin tries to delete a public plan', async () => {
    mockFindFirst.mockResolvedValue(publicPlan);

    const scope = { ownerUserId: 'user-b', isAdmin: false };
    const result = await deletePlan('pub-1', scope);

    expect(result).toBe('forbidden');
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it('allows admin to delete a public plan', async () => {
    mockFindFirst.mockResolvedValue(publicPlan);
    mockDeleteMany.mockResolvedValue({ count: 1 });

    const scope = { ownerUserId: 'admin-id', isAdmin: true };
    const result = await deletePlan('pub-1', scope);

    expect(result).toBe(true);
    expect(mockDeleteMany).toHaveBeenCalled();
  });

  it('allows user to delete their own personal plan', async () => {
    mockFindFirst.mockResolvedValue(personalPlan);
    mockDeleteMany.mockResolvedValue({ count: 1 });

    const scope = { ownerUserId: 'user-b' };
    const result = await deletePlan('pers-1', scope);

    expect(result).toBe(true);
  });
});

describe('createPlan', () => {
  it('always creates plans with personal visibility', async () => {
    mockCreate.mockResolvedValue(personalPlan);

    const scope = { ownerUserId: 'user-b', teamId: 'personal:user-b' };
    await createPlan(
      { billingPlanId: 'new-plan', name: 'New', capabilities: ['noop'] },
      scope,
    );

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ visibility: 'personal' }),
    });
  });
});
