/**
 * Express routes for portfolio aggregation
 */

import { Router, Request, Response } from 'express';
import { getPortfolio, getPositions } from '../lib/portfolioService.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const portfolio = await getPortfolio(userId);
    res.json({ portfolio });
  } catch (err) {
    console.error('Error fetching portfolio:', err);
    res.status(500).json({ error: 'Failed to fetch portfolio' });
  }
});

router.get('/positions', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const positions = await getPositions(userId);
    res.json({ positions });
  } catch (err) {
    console.error('Error fetching positions:', err);
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
});

export default router;
