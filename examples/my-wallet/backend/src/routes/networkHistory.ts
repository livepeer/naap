/**
 * Network history routes — live from Livepeer subgraph Days entity
 * Falls back to RPC protocol data when subgraph is unavailable
 */

import { Router, Request, Response } from 'express';
import { getNetworkDays, getProtocol, getRoundProgress, getWinningTicketEvents } from '../lib/livepeer.js';

const router = Router();

router.get('/api/v1/wallet/network/history', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 30, 365);
    const [days, protocol, roundProgress] = await Promise.all([
      getNetworkDays(limit),
      getProtocol(),
      getRoundProgress().catch(() => null),
    ]);

    // Subgraph returns LPT-unit decimals; RPC returns wei integers — handle both
    const parseLpt = (v: string) => {
      if (!v || v === '0') return 0;
      if (v.includes('.')) return parseFloat(v);           // already in LPT
      return Number(BigInt(v)) / 1e18;                     // wei → LPT
    };
    const totalSupplyLpt = parseLpt(protocol.totalSupply || '0');
    const totalBondedLpt = parseLpt(protocol.totalActiveStake || '0');

    const protocolStatus = {
      currentRound: protocol.currentRound,
      roundLength: protocol.roundLength,
      participationRate: protocol.participationRate,
      inflation: protocol.inflation,
      activeOrchestrators: protocol.activeTranscoderCount,
      delegatorsCount: protocol.delegatorsCount,
      totalSupply: totalSupplyLpt > 0 ? `${(totalSupplyLpt / 1e6).toFixed(1)}m` : 'N/A',
      totalSupplyRaw: totalSupplyLpt,
      totalBonded: totalBondedLpt > 0 ? `${(totalBondedLpt / 1e6).toFixed(2)}m` : 'N/A',
      totalBondedRaw: totalBondedLpt,
      totalVolumeETH: protocol.totalVolumeETH,
      totalVolumeUSD: protocol.totalVolumeUSD,
      roundProgress: roundProgress || undefined,
    };

    if (days.length >= 2) {
      const toDate = (ts: number) => new Date(ts * 1000).toISOString();
      const toInt = (v: string | number) => typeof v === 'string' ? parseInt(v, 10) || 0 : v;

      const summary = {
        participationChange: (parseFloat(days[0].participationRate) - parseFloat(days[days.length - 1].participationRate)) * 100,
        orchestratorCountChange: toInt(days[0].activeTranscoderCount) - toInt(days[days.length - 1].activeTranscoderCount),
        bondedChange: '0',
        periodStart: toDate(days[days.length - 1].date),
        periodEnd: toDate(days[0].date),
      };

      return res.json({
        data: {
          protocolStatus,
          dataPoints: days.map(d => ({
            round: d.date,
            totalBonded: '0',
            participationRate: parseFloat(d.participationRate) * 100,
            inflation: d.inflation,
            activeOrchestrators: toInt(d.activeTranscoderCount),
            delegatorsCount: toInt(d.delegatorsCount),
            volumeETH: d.volumeETH,
            volumeUSD: d.volumeUSD,
            avgRewardCut: 0,
            avgFeeShare: 0,
            snapshotAt: toDate(d.date),
          })),
          summary,
        },
      });
    }

    // Fallback: single snapshot from protocol data only
    const totalStakeFormatted = Math.round(totalBondedLpt).toString();

    res.json({
      data: {
        protocolStatus,
        dataPoints: [{
          round: protocol.currentRound,
          totalBonded: totalStakeFormatted,
          participationRate: protocol.participationRate,
          inflation: protocol.inflation,
          activeOrchestrators: protocol.activeTranscoderCount,
          delegatorsCount: protocol.delegatorsCount,
          avgRewardCut: 0,
          avgFeeShare: 0,
          snapshotAt: protocol.lastUpdated,
        }],
        summary: {
          bondedChange: totalStakeFormatted,
          participationChange: 0,
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

router.get('/api/v1/wallet/network/tickets', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const events = await getWinningTicketEvents(limit);
    res.json({ data: events });
  } catch (error: any) {
    console.error('Error fetching ticket events:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
