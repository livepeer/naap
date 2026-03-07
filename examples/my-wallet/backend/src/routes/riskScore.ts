/**
 * Risk score routes (S16)
 */

import { Router, Request, Response } from 'express';
import { calculateRiskScore } from '../lib/riskScoreService.js';

const router = Router();

router.get('/api/v1/wallet/orchestrators/risk-score', async (req: Request, res: Response) => {
  try {
    const { address } = req.query;
    if (!address) return res.status(400).json({ error: 'address is required' });

    const score = await calculateRiskScore(address as string);
    res.json({ data: score });
  } catch (error: any) {
    console.error('Error calculating risk score:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
