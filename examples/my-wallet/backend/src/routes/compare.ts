/**
 * Orchestrator comparison routes
 */

import { Router, Request, Response } from 'express';
import { compareOrchestrators } from '../lib/compareService.js';

const router = Router();

router.get('/api/v1/wallet/orchestrators/compare', async (req: Request, res: Response) => {
  try {
    const { addresses } = req.query;
    if (!addresses) return res.status(400).json({ error: 'addresses query param is required (comma-separated)' });

    const addrList = (addresses as string).split(',').map(a => a.trim()).filter(Boolean);
    if (addrList.length === 0 || addrList.length > 4) {
      return res.status(400).json({ error: 'Provide 1-4 orchestrator addresses' });
    }

    const orchestrators = await compareOrchestrators(addrList);
    res.json({ orchestrators });
  } catch (error: any) {
    console.error('Error comparing orchestrators:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
