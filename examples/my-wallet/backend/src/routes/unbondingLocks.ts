/**
 * Express routes for unbonding locks
 */

import { Router, Request, Response } from 'express';
import { getUnbondingLocks } from '../lib/unbondingService.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const locks = await getUnbondingLocks(userId);
    res.json({ locks });
  } catch (err) {
    console.error('Error fetching unbonding locks:', err);
    res.status(500).json({ error: 'Failed to fetch unbonding locks' });
  }
});

export default router;
