/**
 * Staking routes — state management and orchestrators list
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db/client.js';
import { getOrchestrators as getLiveOrchestrators } from '../lib/livepeer.js';

const router = Router();

router.get('/api/v1/wallet/staking/state', async (req: Request, res: Response) => {
  try {
    const { address } = req.query;

    if (!address) {
      return res.status(400).json({ error: 'address is required' });
    }

    try {
      const state = await prisma.walletStakingState.findUnique({
        where: { address: address as string },
      });
      res.json({ state: state || null });
    } catch {
      res.json({ state: null });
    }
  } catch (error: any) {
    console.error('Error fetching staking state:', error);
    res.json({ state: null });
  }
});

router.post('/api/v1/wallet/staking/state', async (req: Request, res: Response) => {
  try {
    const {
      address,
      chainId,
      stakedAmount,
      delegatedTo,
      pendingRewards,
      pendingFees,
      startRound,
      lastClaimRound,
    } = req.body;

    if (!address || !chainId) {
      return res.status(400).json({ error: 'address and chainId are required' });
    }

    const state = await prisma.walletStakingState.upsert({
      where: { address },
      update: {
        chainId,
        stakedAmount,
        delegatedTo,
        pendingRewards,
        pendingFees,
        startRound,
        lastClaimRound,
        lastSynced: new Date(),
      },
      create: {
        address,
        chainId,
        stakedAmount: stakedAmount || '0',
        delegatedTo,
        pendingRewards: pendingRewards || '0',
        pendingFees: pendingFees || '0',
        startRound,
        lastClaimRound,
      },
    });

    res.json({ state });
  } catch (error: any) {
    console.error('Error updating staking state:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router.get('/api/v1/wallet/staking/orchestrators', async (req: Request, res: Response) => {
  try {
    const orchestrators = await getLiveOrchestrators();
    res.json({ data: { orchestrators } });
  } catch (error: any) {
    console.error('Error fetching orchestrators:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
