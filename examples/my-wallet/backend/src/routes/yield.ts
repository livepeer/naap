/**
 * Yield calculation routes
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db/client.js';
import { calculateYield, parsePeriod } from '../lib/yieldCalc.js';

const router = Router();

router.get('/api/v1/wallet/yield', async (req: Request, res: Response) => {
  try {
    const { userId, period = '30d' } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const periodDays = parsePeriod(period as string);
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

    const snapshots = await prisma.walletStakingSnapshot.findMany({
      where: {
        walletAddress: { userId: userId as string },
        snapshotAt: { gte: since },
      },
      orderBy: { snapshotAt: 'asc' },
    });

    const mapped = snapshots.map((s: { bondedAmount: { toString(): string }; pendingStake: { toString(): string }; pendingFees: { toString(): string }; round: number; snapshotAt: Date }) => ({
      bondedAmount: s.bondedAmount.toString(),
      pendingStake: s.pendingStake.toString(),
      pendingFees: s.pendingFees.toString(),
      round: s.round,
      snapshotAt: s.snapshotAt.toISOString(),
    }));

    const result = calculateYield(mapped, periodDays);
    res.json(result);
  } catch (error: any) {
    console.error('Error calculating yield:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
