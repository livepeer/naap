/**
 * Watchlist routes — CRUD backed by watchlistService + WalletWatchlist model
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
    const userId = (req.query.userId || req.query.address) as string;
    if (!userId) return res.json({ data: [] });

    const data = await listWatchlist(userId.toLowerCase());
    res.json({ data });
  } catch (err: any) {
    console.error('[watchlist] list error:', err.message);
    res.json({ data: [] });
  }
});

router.post('/api/v1/wallet/watchlist', async (req: Request, res: Response) => {
  try {
    const { userId, address, orchestratorAddr, label, notes } = req.body;
    const effectiveUserId = (userId || address || '').toLowerCase();

    if (!effectiveUserId || !orchestratorAddr) {
      return res.status(400).json({ error: 'userId/address and orchestratorAddr are required' });
    }

    const entry = await addToWatchlist(
      effectiveUserId,
      orchestratorAddr.toLowerCase(),
      label,
      notes,
    );
    res.status(201).json({ data: entry });
  } catch (err: any) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Already in watchlist' });
    }
    console.error('[watchlist] add error:', err.message);
    res.status(500).json({ error: 'Failed to add to watchlist' });
  }
});

router.patch('/api/v1/wallet/watchlist/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req.body.userId || req.body.address || '').toLowerCase();
    if (!userId) return res.status(400).json({ error: 'userId/address is required' });

    const { label, notes } = req.body;
    const updated = await updateWatchlistEntry(id, userId, { label, notes });
    if (!updated) return res.status(404).json({ error: 'Entry not found' });

    res.json({ data: updated });
  } catch (err: any) {
    console.error('[watchlist] update error:', err.message);
    res.status(500).json({ error: 'Failed to update watchlist entry' });
  }
});

router.delete('/api/v1/wallet/watchlist/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = ((req.query.userId || req.query.address) as string || '').toLowerCase();
    if (!userId) return res.status(400).json({ error: 'userId/address is required' });

    const removed = await removeFromWatchlist(id, userId);
    if (!removed) return res.status(404).json({ error: 'Entry not found' });

    res.json({ data: removed });
  } catch (err: any) {
    console.error('[watchlist] delete error:', err.message);
    res.status(500).json({ error: 'Failed to remove from watchlist' });
  }
});

export default router;
