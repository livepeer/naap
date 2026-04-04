/**
 * Simulator routes — Rebalancing + Multi-Orchestrator Distribution
 */

import { Router, Request, Response } from 'express';
import { simulateRebalance } from '../lib/simulatorService.js';
import { simulateMultiOrchestrator } from '../lib/multiOSimulatorService.js';

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

router.post('/api/v1/wallet/simulator/multi-orchestrator', async (req: Request, res: Response) => {
  try {
    const { amountLpt, durationMonths, expectedReturnMin, expectedReturnMax } = req.body;

    if (!amountLpt || amountLpt <= 0) {
      return res.status(400).json({ error: 'amountLpt must be a positive number' });
    }
    if (!durationMonths || durationMonths <= 0) {
      return res.status(400).json({ error: 'durationMonths must be a positive number' });
    }

    const result = await simulateMultiOrchestrator({
      amountLpt: Number(amountLpt),
      durationMonths: Number(durationMonths),
      expectedReturnMin: Number(expectedReturnMin || 0),
      expectedReturnMax: Number(expectedReturnMax || 100),
    });

    res.json({ data: result });
  } catch (error: any) {
    console.error('Error simulating multi-orchestrator:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
