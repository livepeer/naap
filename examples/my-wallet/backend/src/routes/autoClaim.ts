/**
 * Auto-claim config routes (S17)
 */

import { Router, Request, Response } from 'express';
import { getAutoClaimConfig, setAutoClaimConfig, findClaimablePositions } from '../lib/autoClaimService.js';

const router = Router();

router.get('/api/v1/wallet/auto-claim/:walletAddressId', async (req: Request, res: Response) => {
  try {
    const config = await getAutoClaimConfig(req.params.walletAddressId);
    res.json({ data: config || null });
  } catch (error: any) {
    // Not-found or invalid ID is not a server error — return null
    if (error?.code === 'P2023' || error?.code === 'P2025') {
      return res.json({ data: null });
    }
    console.error('Error fetching auto-claim config:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router.post('/api/v1/wallet/auto-claim', async (req: Request, res: Response) => {
  try {
    const { walletAddressId, enabled, minRewardLpt } = req.body;
    if (!walletAddressId || minRewardLpt === undefined) {
      return res.status(400).json({ error: 'walletAddressId and minRewardLpt are required' });
    }

    const config = await setAutoClaimConfig(walletAddressId, enabled ?? false, minRewardLpt);
    res.json({ data: config });
  } catch (error: any) {
    console.error('Error setting auto-claim config:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router.get('/api/v1/wallet/auto-claim/claimable', async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const positions = await findClaimablePositions(userId as string);
    res.json({ data: positions });
  } catch (error: any) {
    console.error('Error finding claimable positions:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
