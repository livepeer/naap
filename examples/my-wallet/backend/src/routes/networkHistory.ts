/**
 * Network history routes — live from Livepeer subgraph Days entity
 */

import { Router, Request, Response } from 'express';
import { getNetworkDays } from '../lib/livepeer.js';

const router = Router();

router.get('/api/v1/wallet/network/history', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 30, 365);
    const days = await getNetworkDays(limit);

    const summary = days.length >= 2 ? {
      participationChange: parseFloat(days[0].participationRate) - parseFloat(days[days.length - 1].participationRate),
      orchestratorCountChange: days[0].activeTranscoderCount - days[days.length - 1].activeTranscoderCount,
      bondedChange: '0',
      periodStart: new Date(days[days.length - 1].date * 86400000).toISOString(),
      periodEnd: new Date(days[0].date * 86400000).toISOString(),
    } : {
      participationChange: 0,
      orchestratorCountChange: 0,
      bondedChange: '0',
      periodStart: new Date().toISOString(),
      periodEnd: new Date().toISOString(),
    };

    res.json({
      data: {
        dataPoints: days.map(d => ({
          round: d.date,
          totalBonded: '0',
          participationRate: parseFloat(d.participationRate),
          inflation: d.inflation,
          activeOrchestrators: d.activeTranscoderCount,
          delegatorsCount: d.delegatorsCount,
          volumeETH: d.volumeETH,
          volumeUSD: d.volumeUSD,
          avgRewardCut: 0,
          avgFeeShare: 0,
          snapshotAt: new Date(d.date * 86400000).toISOString(),
        })),
        summary,
      },
    });
  } catch (error: any) {
    console.error('Error fetching network history:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
