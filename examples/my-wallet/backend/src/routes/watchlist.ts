/**
 * Watchlist routes (S15)
 */

import { Router, Request, Response } from 'express';
import {
  listWatchlist,
  addToWatchlist,
  updateWatchlistEntry,
  removeFromWatchlist,
} from '../lib/watchlistService.js';

const router = Router();

router.get('/api/v1/wallet/watchlist', async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const items = await listWatchlist(userId as string);
    res.json({ data: items });
  } catch (error: any) {
    console.error('Error fetching watchlist:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router.post('/api/v1/wallet/watchlist', async (req: Request, res: Response) => {
  try {
    const { userId, orchestratorAddr, label, notes } = req.body;
    if (!userId || !orchestratorAddr) {
      return res.status(400).json({ error: 'userId and orchestratorAddr are required' });
    }

    const entry = await addToWatchlist(userId, orchestratorAddr, label, notes);
    res.status(201).json({ data: entry });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Orchestrator already in watchlist' });
    }
    console.error('Error adding to watchlist:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router.patch('/api/v1/wallet/watchlist/:id', async (req: Request, res: Response) => {
  try {
    const { userId, label, notes } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const entry = await updateWatchlistEntry(req.params.id, userId, { label, notes });
    if (!entry) return res.status(404).json({ error: 'Watchlist entry not found' });

    res.json({ data: entry });
  } catch (error: any) {
    console.error('Error updating watchlist:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router.delete('/api/v1/wallet/watchlist/:id', async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const entry = await removeFromWatchlist(req.params.id, userId as string);
    if (!entry) return res.status(404).json({ error: 'Watchlist entry not found' });

    res.json({ data: entry });
  } catch (error: any) {
    console.error('Error removing from watchlist:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
