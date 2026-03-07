/**
 * Unbonding lock queries and management
 */

import { prisma } from '../db/client.js';

export async function getUnbondingLocks(userId: string) {
  return prisma.walletUnbondingLock.findMany({
    where: {
      walletAddress: { userId },
    },
    include: {
      walletAddress: {
        select: { address: true, label: true, chainId: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function upsertUnbondingLock(
  walletAddressId: string,
  lockId: number,
  amount: string,
  withdrawRound: number,
  txHash?: string
) {
  return prisma.walletUnbondingLock.upsert({
    where: {
      walletAddressId_lockId: { walletAddressId, lockId },
    },
    update: {
      amount,
      withdrawRound,
      txHash: txHash || undefined,
    },
    create: {
      walletAddressId,
      lockId,
      amount,
      withdrawRound,
      status: 'pending',
      txHash: txHash || null,
    },
  });
}

export async function markWithdrawableLocks(currentRound: number) {
  return prisma.walletUnbondingLock.updateMany({
    where: {
      status: 'pending',
      withdrawRound: { lte: currentRound },
    },
    data: {
      status: 'withdrawable',
    },
  });
}

export async function markLockWithdrawn(walletAddressId: string, lockId: number, txHash?: string) {
  return prisma.walletUnbondingLock.update({
    where: {
      walletAddressId_lockId: { walletAddressId, lockId },
    },
    data: {
      status: 'withdrawn',
      resolvedAt: new Date(),
      txHash: txHash || undefined,
    },
  });
}

export async function markLockRebonded(walletAddressId: string, lockId: number, txHash?: string) {
  return prisma.walletUnbondingLock.update({
    where: {
      walletAddressId_lockId: { walletAddressId, lockId },
    },
    data: {
      status: 'rebonded',
      resolvedAt: new Date(),
      txHash: txHash || undefined,
    },
  });
}
