/**
 * Transaction Service - Transaction logging and tracking
 */

import { prisma } from '../db/client.js';

export type TransactionType = 'stake' | 'unstake' | 'claim' | 'transfer' | 'other';
export type TransactionStatus = 'pending' | 'confirmed' | 'failed';

export interface LogTransactionInput {
  userId: string;
  address: string;
  txHash: string;
  type: TransactionType;
  chainId: number;
  value?: string;
  gasUsed?: string;
  gasPrice?: string;
  toAddress?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Log a new transaction
 */
export async function logTransaction(input: LogTransactionInput) {
  return prisma.walletTransactionLog.create({
    data: {
      ...input,
      status: 'pending',
    },
  });
}

/**
 * Update transaction status
 */
export async function updateTransactionStatus(
  txHash: string,
  status: TransactionStatus,
  extra?: {
    blockNumber?: number;
    gasUsed?: string;
    confirmedAt?: Date;
  }
) {
  return prisma.walletTransactionLog.update({
    where: { txHash },
    data: {
      status,
      ...extra,
    },
  });
}

/**
 * Get pending transactions for monitoring
 */
export async function getPendingTransactions(chainId?: number) {
  const where: any = { status: 'pending' };
  if (chainId) where.chainId = chainId;
  
  return prisma.walletTransactionLog.findMany({
    where,
    orderBy: { timestamp: 'asc' },
  });
}

/**
 * Get transaction history for an address
 */
export async function getTransactionHistory(
  address: string,
  options?: {
    type?: TransactionType;
    status?: TransactionStatus;
    limit?: number;
    offset?: number;
  }
) {
  const where: any = { address };
  if (options?.type) where.type = options.type;
  if (options?.status) where.status = options.status;

  const [transactions, total] = await Promise.all([
    prisma.walletTransactionLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: options?.limit || 50,
      skip: options?.offset || 0,
    }),
    prisma.walletTransactionLog.count({ where }),
  ]);

  return { transactions, total };
}

/**
 * Get transaction stats for a user
 */
export async function getTransactionStats(userId: string) {
  const [total, byType, byStatus] = await Promise.all([
    prisma.walletTransactionLog.count({ where: { userId } }),
    prisma.walletTransactionLog.groupBy({
      by: ['type'],
      where: { userId },
      _count: true,
    }),
    prisma.walletTransactionLog.groupBy({
      by: ['status'],
      where: { userId },
      _count: true,
    }),
  ]);

  return {
    total,
    byType: Object.fromEntries(byType.map(t => [t.type, t._count])),
    byStatus: Object.fromEntries(byStatus.map(s => [s.status, s._count])),
  };
}
