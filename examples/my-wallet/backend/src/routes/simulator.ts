/**
 * Rebalancing simulator routes (S8)
 */

import { Router, Request, Response } from 'express';
import { simulateRebalance } from '../lib/simulatorService.js';

const router = Router();

router.post('/api/v1/wallet/simulator/rebalance', async (req: Request, res: Response) => {
  try {
    const { fromOrchestrator, toOrchestrator, amountWei, unbondingPeriodDays = 7 } = req.body;

    if (!fromOrchestrator || !toOrchestrator || !amountWei) {
      return res.status(400).json({
        error: 'fromOrchestrator, toOrchestrator, and amountWei are required',
      });
    }

    const result = await simulateRebalance({
      fromOrchestrator,
      toOrchestrator,
      amountWei,
      unbondingPeriodDays,
    });

    res.json({ data: result });
  } catch (error: any) {
    console.error('Error simulating rebalance:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
