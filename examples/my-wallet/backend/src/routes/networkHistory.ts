/**
 * Network history routes — live from Livepeer subgraph Days entity
 * Falls back to RPC protocol data when subgraph is unavailable
 */

import { Router, Request, Response } from 'express';
import { getNetworkDays, getProtocol, getOrchestrators } from '../lib/livepeer.js';

const router = Router();

router.get('/api/v1/wallet/network/history', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 30, 365);
    const days = await getNetworkDays(limit);

    if (days.length >= 2) {
      const summary = {
        participationChange: parseFloat(days[0].participationRate) - parseFloat(days[days.length - 1].participationRate),
        orchestratorCountChange: days[0].activeTranscoderCount - days[days.length - 1].activeTranscoderCount,
        bondedChange: '0',
        periodStart: new Date(days[days.length - 1].date * 86400000).toISOString(),
        periodEnd: new Date(days[0].date * 86400000).toISOString(),
      };

      return res.json({
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
    }

    // Fallback: build a single snapshot from RPC protocol data + orchestrators
    const [protocol, orchestrators] = await Promise.all([
      getProtocol(),
      getOrchestrators(),
    ]);

    const avgRewardCut = orchestrators.length > 0
      ? orchestrators.reduce((sum, o) => sum + o.rewardCut, 0) / orchestrators.length
      : 0;
    const avgFeeShare = orchestrators.length > 0
      ? orchestrators.reduce((sum, o) => sum + o.feeShare, 0) / orchestrators.length
      : 0;

    const totalStakeFormatted = (Number(BigInt(protocol.totalActiveStake)) / 1e18).toFixed(0);

    res.json({
      data: {
        dataPoints: [{
          round: protocol.currentRound,
          totalBonded: totalStakeFormatted,
          participationRate: protocol.participationRate,
          inflation: protocol.inflation,
          activeOrchestrators: protocol.activeTranscoderCount,
          delegatorsCount: protocol.delegatorsCount,
          avgRewardCut: parseFloat(avgRewardCut.toFixed(2)),
          avgFeeShare: parseFloat(avgFeeShare.toFixed(2)),
          snapshotAt: protocol.lastUpdated,
        }],
        summary: {
          bondedChange: totalStakeFormatted,
          participationChange: protocol.participationRate / 100,
          orchestratorCountChange: protocol.activeTranscoderCount,
          periodStart: protocol.lastUpdated,
          periodEnd: protocol.lastUpdated,
        },
      },
    });
  } catch (error: any) {
    console.error('Error fetching network history:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
