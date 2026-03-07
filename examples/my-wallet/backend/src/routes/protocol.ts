/**
 * Express routes for protocol parameters
 */

import { Router, Request, Response } from 'express';
import { getProtocolParams } from '../lib/protocolService.js';

const router = Router();

router.get('/params', async (req: Request, res: Response) => {
  try {
    const params = await getProtocolParams();
    res.json({ params });
  } catch (err) {
    console.error('Error fetching protocol params:', err);
    res.status(500).json({ error: 'Failed to fetch protocol params' });
  }
});

export default router;
