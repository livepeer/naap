/**
 * Export routes for leaderboard and positions
 */

import { Router, Request, Response } from 'express';
import { exportLeaderboard, exportPositions, ExportFormat } from '../lib/exportService.js';

const router = Router();

router.get('/api/v1/wallet/export/leaderboard', async (req: Request, res: Response) => {
  try {
    const format = (req.query.format as ExportFormat) || 'csv';
    if (format !== 'csv' && format !== 'json') {
      return res.status(400).json({ error: 'format must be csv or json' });
    }

    const result = await exportLeaderboard(format);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.data);
  } catch (error: any) {
    console.error('Error exporting leaderboard:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router.get('/api/v1/wallet/export/positions', async (req: Request, res: Response) => {
  try {
    const userId = (req.query.userId || req.query.address) as string | undefined;
    const { format: fmt } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId or address is required' });

    const format = (fmt as ExportFormat) || 'csv';
    if (format !== 'csv' && format !== 'json') {
      return res.status(400).json({ error: 'format must be csv or json' });
    }

    const result = await exportPositions(userId as string, format);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.data);
  } catch (error: any) {
    console.error('Error exporting positions:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
