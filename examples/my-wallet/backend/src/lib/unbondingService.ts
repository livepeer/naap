/**
 * Unbonding lock queries and management
 */

import { prisma } from '../db/client.js';

export async function getUnbondingLocks(userId: string) {
  const walletAddresses = await prisma.walletAddress.findMany({
    where: { userId },
    select: { address: true, label: true, chainId: true },
  });
  const addressList = walletAddresses.map(a => a.address);

  const locks = await prisma.walletUnbondingLock.findMany({
    where: { address: { in: addressList } },
    orderBy: { createdAt: 'desc' },
  });

  return locks.map(lock => ({
    ...lock,
    walletAddress: walletAddresses.find(a => a.address === lock.address) ?? null,
  }));
}

export async function upsertUnbondingLock(
  address: string,
  lockId: number,
  amount: string,
  withdrawRound: number,
  txHash?: string
) {
  return prisma.walletUnbondingLock.upsert({
    where: {
      address_lockId: { address, lockId },
    },
    update: {
      amount,
      withdrawRound,
      txHash: txHash || undefined,
    },
    create: {
      address,
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

export async function markLockWithdrawn(address: string, lockId: number, txHash?: string) {
  return prisma.walletUnbondingLock.update({
    where: {
      address_lockId: { address, lockId },
    },
    data: {
      status: 'withdrawn',
      resolvedAt: new Date(),
      txHash: txHash || undefined,
    },
  });
}

export async function markLockRebonded(address: string, lockId: number, txHash?: string) {
  return prisma.walletUnbondingLock.update({
    where: {
      address_lockId: { address, lockId },
    },
    data: {
      status: 'rebonded',
      resolvedAt: new Date(),
      txHash: txHash || undefined,
    },
  });
}
