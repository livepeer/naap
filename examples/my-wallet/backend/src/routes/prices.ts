/**
 * Price cache routes
 */

import { Router, Request, Response } from 'express';
import { getPrices } from '../lib/priceService.js';

const router = Router();

router.get('/api/v1/wallet/prices', async (_req: Request, res: Response) => {
  try {
    const prices = await getPrices();
    res.json(prices);
  } catch (error: any) {
    console.error('Error fetching prices:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
