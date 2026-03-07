/**
 * Gas accounting service — aggregates gas costs across transactions
 * S7: Transaction history with gas accounting
 */

import { prisma } from '../db/client.js';

export interface GasSummary {
  totalGasUsed: string;
  totalGasCostWei: string;
  totalGasCostEth: number;
  transactionCount: number;
  avgGasPerTx: number;
  byType: Record<string, { count: number; totalGasWei: string }>;
}

/**
 * Compute gas summary for a user's transactions
 */
export async function getGasSummary(userId: string, addressId?: string): Promise<GasSummary> {
  const where: Record<string, unknown> = { userId };
  if (addressId) where.walletAddressId = addressId;

  const transactions = await prisma.walletTransactionLog.findMany({
    where: { ...where, status: 'confirmed', gasUsed: { not: null } },
    select: { type: true, gasUsed: true, gasPrice: true },
  });

  let totalGasUsed = 0n;
  let totalGasCostWei = 0n;
  const byType: Record<string, { count: number; totalGasWei: bigint }> = {};

  for (const tx of transactions) {
    const gasUsed = BigInt(tx.gasUsed || '0');
    const gasPrice = BigInt(tx.gasPrice || '0');
    const cost = gasUsed * gasPrice;

    totalGasUsed += gasUsed;
    totalGasCostWei += cost;

    if (!byType[tx.type]) {
      byType[tx.type] = { count: 0, totalGasWei: 0n };
    }
    byType[tx.type].count++;
    byType[tx.type].totalGasWei += cost;
  }

  const txCount = transactions.length;
  const totalGasCostEth = Number(totalGasCostWei) / 1e18;
  const avgGasPerTx = txCount > 0 ? Number(totalGasUsed) / txCount : 0;

  const byTypeResult: Record<string, { count: number; totalGasWei: string }> = {};
  for (const [type, data] of Object.entries(byType)) {
    byTypeResult[type] = { count: data.count, totalGasWei: data.totalGasWei.toString() };
  }

  return {
    totalGasUsed: totalGasUsed.toString(),
    totalGasCostWei: totalGasCostWei.toString(),
    totalGasCostEth: parseFloat(totalGasCostEth.toFixed(8)),
    transactionCount: txCount,
    avgGasPerTx: Math.round(avgGasPerTx),
    byType: byTypeResult,
  };
}
