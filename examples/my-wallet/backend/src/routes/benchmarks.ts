/**
 * Network benchmark routes
 */

import { Router, Request, Response } from 'express';
import { getNetworkBenchmarks } from '../lib/benchmarkService.js';

const router = Router();

router.get('/api/v1/wallet/network/benchmarks', async (_req: Request, res: Response) => {
  try {
    const benchmarks = await getNetworkBenchmarks();
    res.json(benchmarks);
  } catch (error: any) {
    console.error('Error fetching network benchmarks:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
