/**
 * Gas summary endpoint (S7)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const addressId = request.nextUrl.searchParams.get('addressId') || undefined;
    const where: Record<string, unknown> = { userId: user.id, status: 'confirmed', gasUsed: { not: null } };
    if (addressId) where.walletAddressId = addressId;

    const transactions = await prisma.walletTransactionLog.findMany({
      where,
      select: { type: true, gasUsed: true, gasPrice: true },
    });

    let totalGasUsed = 0n;
    let totalGasCostWei = 0n;
    const byType: Record<string, { count: number; totalGasWei: string }> = {};

    for (const tx of transactions) {
      const gasUsed = BigInt(tx.gasUsed || '0');
      const gasPrice = BigInt(tx.gasPrice || '0');
      const cost = gasUsed * gasPrice;
      totalGasUsed += gasUsed;
      totalGasCostWei += cost;

      if (!byType[tx.type]) byType[tx.type] = { count: 0, totalGasWei: '0' };
      byType[tx.type].count++;
      byType[tx.type].totalGasWei = (BigInt(byType[tx.type].totalGasWei) + cost).toString();
    }

    const txCount = transactions.length;

    return success({
      totalGasUsed: totalGasUsed.toString(),
      totalGasCostWei: totalGasCostWei.toString(),
      totalGasCostEth: parseFloat((Number(totalGasCostWei) / 1e18).toFixed(8)),
      transactionCount: txCount,
      avgGasPerTx: txCount > 0 ? Math.round(Number(totalGasUsed) / txCount) : 0,
      byType,
    });
  } catch (err) {
    console.error('Gas summary error:', err);
    return errors.internal('Failed to compute gas summary');
  }
}
