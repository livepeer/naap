/**
 * Alert management routes — gracefully degrade when DB unavailable
 */

import { Router, Request, Response } from 'express';

const router = Router();

// List alerts for user
router.get('/api/v1/wallet/alerts', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId || req.query.address;
    if (!userId) return res.json({ data: { alerts: [], unreadCount: 0 } });
    // DB-backed alerts not available without DB — return empty
    res.json({ data: { alerts: [], unreadCount: 0 } });
  } catch (error: any) {
    res.json({ data: { alerts: [], unreadCount: 0 } });
  }
});

// Alert history
router.get('/api/v1/wallet/alerts/history', async (req: Request, res: Response) => {
  res.json({ data: { items: [], total: 0 } });
});

// Create alert (stub)
router.post('/api/v1/wallet/alerts', async (req: Request, res: Response) => {
  res.status(501).json({ error: 'Alerts require database configuration' });
});

// Update/Delete (stubs)
router.patch('/api/v1/wallet/alerts/:id', async (req: Request, res: Response) => {
  res.status(501).json({ error: 'Alerts require database configuration' });
});

router.delete('/api/v1/wallet/alerts/:id', async (req: Request, res: Response) => {
  res.status(501).json({ error: 'Alerts require database configuration' });
});

router.patch('/api/v1/wallet/alerts/history/:id', async (req: Request, res: Response) => {
  res.status(501).json({ error: 'Alerts require database configuration' });
});

export default router;
