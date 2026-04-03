import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/client.js', () => ({
  prisma: {
    walletOrchestrator: {
      findMany: vi.fn(),
    },
  },
}));

import { compareOrchestrators } from '../lib/compareService.js';
import { prisma } from '../db/client.js';

const findMany = prisma.walletOrchestrator.findMany as ReturnType<typeof vi.fn>;

beforeEach(() => {
  findMany.mockReset();
});

const ADDR_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ADDR_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function makeOrch(overrides: Partial<{
  address: string; name: string | null; rewardCut: number;
  feeShare: number; totalStake: string; isActive: boolean; serviceUri: string | null;
}> = {}) {
  return {
    address: overrides.address ?? ADDR_A,
    name: overrides.name ?? 'TestOrch',
    rewardCut: overrides.rewardCut ?? 10,
    feeShare: overrides.feeShare ?? 90,
    totalStake: overrides.totalStake ?? '50000',
    isActive: overrides.isActive ?? true,
    serviceUri: overrides.serviceUri ?? 'https://orch.example.com',
  };
}

describe('compareOrchestrators', () => {
  it('returns data for valid addresses', async () => {
    const orchA = makeOrch({ address: ADDR_A });
    const orchB = makeOrch({ address: ADDR_B, name: 'OrchB' });
    findMany.mockResolvedValue([orchA, orchB]);

    const result = await compareOrchestrators([ADDR_A, ADDR_B]);

    expect(result).toHaveLength(2);
    expect(result[0].address).toBe(ADDR_A);
    expect(result[1].address).toBe(ADDR_B);
  });

  it('throws error for empty array', async () => {
    await expect(compareOrchestrators([])).rejects.toThrow('Provide 1-4 orchestrator addresses');
  });

  it('throws error for more than 4 addresses', async () => {
    const five = Array.from({ length: 5 }, (_, i) =>
      `0x${'a'.repeat(39)}${i}`,
    );
    await expect(compareOrchestrators(five)).rejects.toThrow('Provide 1-4 orchestrator addresses');
  });

  it('returns correct fields from orchestrator data', async () => {
    const orch = makeOrch({
      address: ADDR_A,
      name: 'MyOrch',
      rewardCut: 15,
      feeShare: 85,
      totalStake: '123456',
      isActive: true,
      serviceUri: 'https://example.com',
    });
    findMany.mockResolvedValue([orch]);

    const [result] = await compareOrchestrators([ADDR_A]);

    expect(result).toEqual({
      address: ADDR_A,
      name: 'MyOrch',
      rewardCut: 15,
      feeShare: 85,
      totalStake: '123456',
      isActive: true,
      serviceUri: 'https://example.com',
    });
  });
});
