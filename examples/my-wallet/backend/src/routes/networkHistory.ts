/**
 * Network history routes (S21)
 */

import { Router, Request, Response } from 'express';
import { getNetworkHistory } from '../lib/networkHistoryService.js';

const router = Router();

router.get('/api/v1/wallet/network/history', async (req: Request, res: Response) => {
  try {
    const { limit, startDate } = req.query;
    const history = await getNetworkHistory(
      limit ? parseInt(limit as string, 10) : 90,
      startDate ? new Date(startDate as string) : undefined,
    );
    res.json({ data: history });
  } catch (error: any) {
    console.error('Error fetching network history:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
