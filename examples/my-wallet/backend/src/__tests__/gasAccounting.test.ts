import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/client.js', () => ({
  prisma: {
    walletTransactionLog: {
      findMany: vi.fn(),
    },
  },
}));

import { getGasSummary } from '../lib/gasAccountingService.js';
import { prisma } from '../db/client.js';

const findMany = prisma.walletTransactionLog.findMany as ReturnType<typeof vi.fn>;

beforeEach(() => {
  findMany.mockReset();
});

describe('getGasSummary', () => {
  it('returns zeros when no transactions found', async () => {
    findMany.mockResolvedValue([]);

    const result = await getGasSummary('user-1');

    expect(result.totalGasUsed).toBe('0');
    expect(result.totalGasCostWei).toBe('0');
    expect(result.totalGasCostEth).toBe(0);
    expect(result.transactionCount).toBe(0);
    expect(result.avgGasPerTx).toBe(0);
    expect(result.byType).toEqual({});
  });

  it('correctly sums gas across multiple transactions', async () => {
    findMany.mockResolvedValue([
      { type: 'bond', gasUsed: '21000', gasPrice: '1000000000' },
      { type: 'bond', gasUsed: '42000', gasPrice: '2000000000' },
    ]);

    const result = await getGasSummary('user-1');

    // totalGasUsed = 21000 + 42000 = 63000
    expect(result.totalGasUsed).toBe('63000');
    // totalGasCostWei = 21000*1e9 + 42000*2e9 = 21e12 + 84e12 = 105e12
    expect(result.totalGasCostWei).toBe('105000000000000');
    expect(result.transactionCount).toBe(2);
  });

  it('groups gas costs by transaction type', async () => {
    findMany.mockResolvedValue([
      { type: 'bond', gasUsed: '21000', gasPrice: '1000000000' },
      { type: 'unbond', gasUsed: '30000', gasPrice: '1000000000' },
      { type: 'bond', gasUsed: '21000', gasPrice: '1000000000' },
    ]);

    const result = await getGasSummary('user-1');

    expect(result.byType).toHaveProperty('bond');
    expect(result.byType).toHaveProperty('unbond');
    expect(result.byType['bond'].count).toBe(2);
    expect(result.byType['unbond'].count).toBe(1);
    // bond total: 2 * 21000 * 1e9 = 42e12
    expect(result.byType['bond'].totalGasWei).toBe('42000000000000');
    // unbond total: 30000 * 1e9 = 30e12
    expect(result.byType['unbond'].totalGasWei).toBe('30000000000000');
  });

  it('calculates average gas per transaction', async () => {
    findMany.mockResolvedValue([
      { type: 'bond', gasUsed: '20000', gasPrice: '1000000000' },
      { type: 'bond', gasUsed: '40000', gasPrice: '1000000000' },
    ]);

    const result = await getGasSummary('user-1');

    // avg = (20000 + 40000) / 2 = 30000
    expect(result.avgGasPerTx).toBe(30000);
  });

  it('converts total cost to ETH correctly', async () => {
    findMany.mockResolvedValue([
      { type: 'bond', gasUsed: '21000', gasPrice: '50000000000' }, // 50 gwei
    ]);

    const result = await getGasSummary('user-1');

    // cost = 21000 * 50e9 = 1.05e15 wei = 0.00105 ETH
    expect(result.totalGasCostEth).toBeCloseTo(0.00105, 8);
  });
});
