import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/client.js', () => ({
  prisma: {
    walletWatchlist: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    walletOrchestrator: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from '../db/client.js';
import {
  listWatchlist,
  addToWatchlist,
  updateWatchlistEntry,
  removeFromWatchlist,
} from '../lib/watchlistService.js';

const mockWatchlist = prisma.walletWatchlist as unknown as {
  findMany: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const mockOrchestrator = prisma.walletOrchestrator as unknown as {
  findMany: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listWatchlist', () => {
  it('returns enriched entries with orchestrator data', async () => {
    const now = new Date('2025-01-15T12:00:00Z');
    mockWatchlist.findMany.mockResolvedValue([
      { id: 'w1', orchestratorAddr: '0xabc', label: 'Main', notes: null, addedAt: now },
      { id: 'w2', orchestratorAddr: '0xdef', label: null, notes: 'test', addedAt: now },
    ]);
    mockOrchestrator.findMany.mockResolvedValue([
      { address: '0xabc', name: 'OrcA', rewardCut: 5000, feeShare: 5000, totalStake: '100000', isActive: true },
    ]);

    const result = await listWatchlist('user1');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 'w1',
      orchestratorAddr: '0xabc',
      label: 'Main',
      notes: null,
      addedAt: now.toISOString(),
      orchestrator: { address: '0xabc', name: 'OrcA', rewardCut: 5000, feeShare: 5000, totalStake: '100000', isActive: true },
    });
    expect(result[1]).toEqual({
      id: 'w2',
      orchestratorAddr: '0xdef',
      label: null,
      notes: 'test',
      addedAt: now.toISOString(),
      orchestrator: undefined,
    });
    expect(mockWatchlist.findMany).toHaveBeenCalledWith({
      where: { userId: 'user1' },
      orderBy: { addedAt: 'desc' },
    });
  });

  it('returns entries without orchestrator data when DB has none', async () => {
    const now = new Date('2025-01-15T12:00:00Z');
    mockWatchlist.findMany.mockResolvedValue([
      { id: 'w1', orchestratorAddr: '0xabc', label: null, notes: null, addedAt: now },
    ]);
    mockOrchestrator.findMany.mockResolvedValue([]);

    const result = await listWatchlist('user1');

    expect(result).toHaveLength(1);
    expect(result[0].orchestrator).toBeUndefined();
  });

  it('returns empty array when user has no watchlist entries', async () => {
    mockWatchlist.findMany.mockResolvedValue([]);
    mockOrchestrator.findMany.mockResolvedValue([]);

    const result = await listWatchlist('user1');

    expect(result).toEqual([]);
  });
});

describe('addToWatchlist', () => {
  it('creates entry with correct data', async () => {
    const created = { id: 'w1', userId: 'user1', orchestratorAddr: '0xabc', label: 'MyOrch', notes: 'good one' };
    mockWatchlist.create.mockResolvedValue(created);

    const result = await addToWatchlist('user1', '0xabc', 'MyOrch', 'good one');

    expect(result).toEqual(created);
    expect(mockWatchlist.create).toHaveBeenCalledWith({
      data: { userId: 'user1', orchestratorAddr: '0xabc', label: 'MyOrch', notes: 'good one' },
    });
  });

  it('handles optional label and notes (undefined → null)', async () => {
    const created = { id: 'w2', userId: 'user1', orchestratorAddr: '0xdef', label: null, notes: null };
    mockWatchlist.create.mockResolvedValue(created);

    const result = await addToWatchlist('user1', '0xdef');

    expect(result).toEqual(created);
    expect(mockWatchlist.create).toHaveBeenCalledWith({
      data: { userId: 'user1', orchestratorAddr: '0xdef', label: null, notes: null },
    });
  });

  it('converts empty-string label and notes to null', async () => {
    const created = { id: 'w3', userId: 'user1', orchestratorAddr: '0x111', label: null, notes: null };
    mockWatchlist.create.mockResolvedValue(created);

    await addToWatchlist('user1', '0x111', '', '');

    expect(mockWatchlist.create).toHaveBeenCalledWith({
      data: { userId: 'user1', orchestratorAddr: '0x111', label: null, notes: null },
    });
  });
});

describe('updateWatchlistEntry', () => {
  it('updates only provided fields', async () => {
    const existing = { id: 'w1', userId: 'user1', orchestratorAddr: '0xabc', label: 'Old', notes: 'old note' };
    mockWatchlist.findFirst.mockResolvedValue(existing);
    const updated = { ...existing, label: 'New' };
    mockWatchlist.update.mockResolvedValue(updated);

    const result = await updateWatchlistEntry('w1', 'user1', { label: 'New' });

    expect(result).toEqual(updated);
    expect(mockWatchlist.update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: { label: 'New' },
    });
  });

  it('updates both label and notes when provided', async () => {
    const existing = { id: 'w1', userId: 'user1' };
    mockWatchlist.findFirst.mockResolvedValue(existing);
    mockWatchlist.update.mockResolvedValue({ ...existing, label: 'New', notes: 'New note' });

    await updateWatchlistEntry('w1', 'user1', { label: 'New', notes: 'New note' });

    expect(mockWatchlist.update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: { label: 'New', notes: 'New note' },
    });
  });

  it('returns null when entry not found', async () => {
    mockWatchlist.findFirst.mockResolvedValue(null);

    const result = await updateWatchlistEntry('nonexistent', 'user1', { label: 'X' });

    expect(result).toBeNull();
    expect(mockWatchlist.update).not.toHaveBeenCalled();
  });

  it('returns null when userId does not match', async () => {
    mockWatchlist.findFirst.mockResolvedValue(null);

    const result = await updateWatchlistEntry('w1', 'wrong-user', { label: 'X' });

    expect(result).toBeNull();
    expect(mockWatchlist.update).not.toHaveBeenCalled();
  });
});

describe('removeFromWatchlist', () => {
  it('deletes entry and returns it', async () => {
    const entry = { id: 'w1', userId: 'user1', orchestratorAddr: '0xabc', label: null, notes: null };
    mockWatchlist.findFirst.mockResolvedValue(entry);
    mockWatchlist.delete.mockResolvedValue(entry);

    const result = await removeFromWatchlist('w1', 'user1');

    expect(result).toEqual(entry);
    expect(mockWatchlist.findFirst).toHaveBeenCalledWith({ where: { id: 'w1', userId: 'user1' } });
    expect(mockWatchlist.delete).toHaveBeenCalledWith({ where: { id: 'w1' } });
  });

  it('returns null when not found', async () => {
    mockWatchlist.findFirst.mockResolvedValue(null);

    const result = await removeFromWatchlist('nonexistent', 'user1');

    expect(result).toBeNull();
    expect(mockWatchlist.delete).not.toHaveBeenCalled();
  });
});
