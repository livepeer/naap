/**
 * Wallet Sync route — on-demand data refresh
 */

import { Router, Request, Response } from 'express';
import { snapshotStaking } from '../jobs/snapshotStaking.js';
import { fetchPrices } from '../jobs/fetchPrices.js';
import { updateUnbonding } from '../jobs/updateUnbonding.js';

const router = Router();

router.post('/api/v1/wallet/sync', async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const [snapCount] = await Promise.all([
      snapshotStaking(userId),
      fetchPrices(),
      updateUnbonding(),
    ]);

    res.json({ synced: true, snapshotCount: snapCount });
  } catch (error: any) {
    console.error('Error syncing:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
