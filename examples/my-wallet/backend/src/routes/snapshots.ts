/**
 * Staking snapshot query endpoint
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db/client.js';

const router = Router();

router.get('/api/v1/wallet/staking/snapshots', async (req: Request, res: Response) => {
  try {
    const address = (req.query.address as string)?.toLowerCase();
    if (!address) return res.status(400).json({ error: 'address is required' });

    const days = Math.min(parseInt(req.query.days as string) || 30, 365);
    const since = new Date(Date.now() - days * 86400000);

    const snapshots = await prisma.walletStakingSnapshot.findMany({
      where: {
        address,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Compute reward delta between first and last snapshot
    let rewardDelta: string | null = null;
    if (snapshots.length >= 2) {
      const first = BigInt(snapshots[0].pendingStake);
      const last = BigInt(snapshots[snapshots.length - 1].pendingStake);
      rewardDelta = (last - first).toString();
    }

    res.json({
      data: {
        snapshots,
        summary: {
          count: snapshots.length,
          days,
          rewardDelta,
        },
      },
    });
  } catch (err: any) {
    console.error('Error fetching snapshots:', err);
    res.status(500).json({ error: 'Failed to fetch snapshots' });
  }
});

export default router;
