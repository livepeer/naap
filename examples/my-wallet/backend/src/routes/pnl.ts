/**
 * P&L export routes (S13)
 */

import { Router, Request, Response } from 'express';
import { calculatePnl, pnlToCsv } from '../lib/pnlService.js';

const router = Router();

router.get('/api/v1/wallet/export/pnl', async (req: Request, res: Response) => {
  try {
    const { userId, format = 'json', startDate, endDate } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const start = startDate ? new Date(startDate as string) : undefined;
    const end = endDate ? new Date(endDate as string) : undefined;

    const pnl = await calculatePnl(userId as string, start, end);

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=wallet-pnl.csv');
      return res.send(pnlToCsv(pnl));
    }

    res.json({ data: pnl });
  } catch (error: any) {
    console.error('Error exporting P&L:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
