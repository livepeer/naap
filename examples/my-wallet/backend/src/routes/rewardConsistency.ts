/**
 * Reward consistency routes (S9)
 */

import { Router, Request, Response } from 'express';
import { getRewardConsistency } from '../lib/rewardConsistencyService.js';

const router = Router();

router.get('/api/v1/wallet/orchestrators/consistency', async (req: Request, res: Response) => {
  try {
    const { address } = req.query;
    if (!address) return res.status(400).json({ error: 'address is required' });

    const consistency = await getRewardConsistency(address as string);
    res.json({ data: consistency });
  } catch (error: any) {
    console.error('Error fetching reward consistency:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
