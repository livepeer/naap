/**
 * Price routes — live CoinGecko data with chart
 */

import { Router, Request, Response } from 'express';
import { getPrices, getPriceChart } from '../lib/livepeer.js';

const router = Router();

router.get('/api/v1/wallet/prices', async (_req: Request, res: Response) => {
  try {
    const prices = await getPrices();
    res.json({ data: prices });
  } catch (error: any) {
    console.error('Error fetching prices:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch prices' });
  }
});

router.get('/api/v1/wallet/prices/chart', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const validDays = [7, 30, 90, 365];
    const d = validDays.includes(days) ? days : 30;
    const chart = await getPriceChart(d);
    res.json({ data: { days: d, points: chart } });
  } catch (error: any) {
    console.error('Error fetching price chart:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch price chart' });
  }
});

export default router;
