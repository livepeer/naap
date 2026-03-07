/**
 * Watchlist routes — gracefully degrade when DB unavailable
 */

import { Router, Request, Response } from 'express';

const router = Router();

router.get('/api/v1/wallet/watchlist', async (req: Request, res: Response) => {
  res.json({ data: [] });
});

router.post('/api/v1/wallet/watchlist', async (req: Request, res: Response) => {
  res.status(501).json({ error: 'Watchlist requires database configuration' });
});

router.patch('/api/v1/wallet/watchlist/:id', async (req: Request, res: Response) => {
  res.status(501).json({ error: 'Watchlist requires database configuration' });
});

router.delete('/api/v1/wallet/watchlist/:id', async (req: Request, res: Response) => {
  res.status(501).json({ error: 'Watchlist requires database configuration' });
});

export default router;
