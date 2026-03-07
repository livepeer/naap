/**
 * Gas accounting routes (S7)
 */

import { Router, Request, Response } from 'express';
import { getGasSummary } from '../lib/gasAccountingService.js';

const router = Router();

router.get('/api/v1/wallet/gas-summary', async (req: Request, res: Response) => {
  try {
    const { userId, addressId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const summary = await getGasSummary(userId as string, addressId as string | undefined);
    res.json({ data: summary });
  } catch (error: any) {
    console.error('Error fetching gas summary:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
