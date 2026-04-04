/**
 * Express routes for protocol parameters — live from Livepeer subgraph
 */

import { Router, Request, Response } from 'express';
import { getProtocol } from '../lib/livepeer.js';

const router = Router();

router.get('/api/v1/wallet/protocol/params', async (_req: Request, res: Response) => {
  try {
    const params = await getProtocol();
    res.json({ data: params });
  } catch (err: any) {
    console.error('Error fetching protocol params:', err);
    res.status(500).json({ error: 'Failed to fetch protocol params' });
  }
});

export default router;
