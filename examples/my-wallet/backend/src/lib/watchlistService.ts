/**
 * Watchlist CRUD service
 * S15: Track orchestrators without delegating
 */

import { prisma } from '../db/client.js';

export interface WatchlistEntry {
  id: string;
  orchestratorAddr: string;
  label: string | null;
  notes: string | null;
  addedAt: string;
  orchestrator?: {
    name: string | null;
    rewardCut: number;
    feeShare: number;
    totalStake: string;
    isActive: boolean;
  };
}

export async function listWatchlist(userId: string): Promise<WatchlistEntry[]> {
  const items = await prisma.walletWatchlist.findMany({
    where: { userId },
    orderBy: { addedAt: 'desc' },
  });

  // Enrich with orchestrator data
  const addrs = items.map(i => i.orchestratorAddr);
  const orchestrators = await prisma.walletOrchestrator.findMany({
    where: { address: { in: addrs } },
    select: { address: true, name: true, rewardCut: true, feeShare: true, totalStake: true, isActive: true },
  });

  const oMap = new Map(orchestrators.map(o => [o.address, o]));

  return items.map(item => ({
    id: item.id,
    orchestratorAddr: item.orchestratorAddr,
    label: item.label,
    notes: item.notes,
    addedAt: item.addedAt.toISOString(),
    orchestrator: oMap.get(item.orchestratorAddr) || undefined,
  }));
}

export async function addToWatchlist(
  userId: string,
  orchestratorAddr: string,
  label?: string,
  notes?: string,
) {
  return prisma.walletWatchlist.create({
    data: { userId, orchestratorAddr, label: label || null, notes: notes || null },
  });
}

export async function updateWatchlistEntry(
  id: string,
  userId: string,
  updates: { label?: string; notes?: string },
) {
  const entry = await prisma.walletWatchlist.findFirst({ where: { id, userId } });
  if (!entry) return null;

  return prisma.walletWatchlist.update({
    where: { id },
    data: {
      ...(updates.label !== undefined && { label: updates.label }),
      ...(updates.notes !== undefined && { notes: updates.notes }),
    },
  });
}

export async function removeFromWatchlist(id: string, userId: string) {
  const entry = await prisma.walletWatchlist.findFirst({ where: { id, userId } });
  if (!entry) return null;
  await prisma.walletWatchlist.delete({ where: { id } });
  return entry;
}
