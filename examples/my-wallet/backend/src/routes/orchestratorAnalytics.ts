/**
 * Orchestrator analytics routes — enhanced list, changes detection, capabilities
 * All reads from DB (populated by sync jobs).
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db/client.js';
import { getCapabilitiesByAddress } from '../lib/capabilityService.js';
import { getOrchestrators } from '../lib/livepeer.js';

const router = Router();

// Enhanced orchestrator list with capabilities and date-range filtering
router.get('/api/v1/wallet/orchestrators/enhanced', async (req: Request, res: Response) => {
  try {
    const { from, to, activeOnly } = req.query;

    const where: any = {};
    if (activeOnly === 'true') where.isActive = true;

    const orchestrators = await prisma.walletOrchestrator.findMany({
      where,
      orderBy: { totalStake: 'desc' },
      take: 200,
      include: {
        capabilities: {
          select: { category: true, pipelineId: true, lastChecked: true },
        },
      },
    });

    // If date range provided, fetch round history for that period
    let rangeStats: Record<string, any> = {};
    if (from || to) {
      const historyWhere: any = {};
      if (from) {
        historyWhere.createdAt = { ...historyWhere.createdAt, gte: new Date(parseInt(from as string)) };
      }
      if (to) {
        historyWhere.createdAt = { ...historyWhere.createdAt, lte: new Date(parseInt(to as string)) };
      }

      const history = await prisma.walletOrchestratorRoundHistory.findMany({
        where: historyWhere,
        orderBy: { round: 'asc' },
      });

      for (const h of history) {
        if (!rangeStats[h.address]) {
          rangeStats[h.address] = { rounds: 0, rewardCalls: 0 };
        }
        rangeStats[h.address].rounds++;
        if (h.calledReward) rangeStats[h.address].rewardCalls++;
      }
    }

    let data = orchestrators.map((o) => ({
      ...o,
      categories: [...new Set(o.capabilities.map((c) => c.category))],
      pipelines: o.capabilities.filter((c) => c.pipelineId).map((c) => c.pipelineId),
      rangePerformance: rangeStats[o.address] || null,
    }));

    // Enrich with live subgraph data when DB has zero delegatorCount/volume
    const allDelegatorZero = data.every((o) => o.delegatorCount === 0);
    const allVolumeZero = data.every((o) => o.totalVolumeETH === '0');
    if (allDelegatorZero || allVolumeZero) {
      try {
        const live = await getOrchestrators();
        const liveMap = new Map(live.map((o) => [o.address.toLowerCase(), o]));
        data = data.map((o) => {
          const l = liveMap.get(o.address.toLowerCase());
          if (!l) return o;
          return {
            ...o,
            delegatorCount: o.delegatorCount || l.delegatorCount,
            totalVolumeETH: o.totalVolumeETH === '0' ? l.totalVolumeETH : o.totalVolumeETH,
            thirtyDayVolumeETH: o.thirtyDayVolumeETH === '0' ? l.thirtyDayVolumeETH : o.thirtyDayVolumeETH,
            totalRewardTokens: o.totalRewardTokens === '0' ? l.totalRewardTokens : o.totalRewardTokens,
            rewardCallRatio: o.rewardCallRatio || l.rewardCallRatio,
          };
        });
      } catch { /* serve DB data as-is */ }
    }

    res.json({ data });
  } catch (err: any) {
    console.error('[orchestratorAnalytics] enhanced error:', err.message);
    res.status(500).json({ error: 'Failed to fetch orchestrators' });
  }
});

// Detect parameter changes between rounds for watchlist alerts
router.get('/api/v1/wallet/orchestrators/changes', async (req: Request, res: Response) => {
  try {
    const { addresses, sinceRound } = req.query;

    if (!addresses) {
      return res.json({ data: [] });
    }

    const addrList = (addresses as string).split(',').map((a) => a.trim().toLowerCase());
    const round = sinceRound ? parseInt(sinceRound as string) : 0;

    const history = await prisma.walletOrchestratorRoundHistory.findMany({
      where: {
        address: { in: addrList },
        round: { gte: round },
      },
      orderBy: [{ address: 'asc' }, { round: 'asc' }],
    });

    // Detect changes between consecutive rounds
    const changes: Array<{
      address: string;
      field: string;
      oldValue: number | string;
      newValue: number | string;
      round: number;
      createdAt: string;
    }> = [];

    const byAddr = new Map<string, typeof history>();
    for (const h of history) {
      if (!byAddr.has(h.address)) byAddr.set(h.address, []);
      byAddr.get(h.address)!.push(h);
    }

    for (const [addr, records] of byAddr) {
      for (let i = 1; i < records.length; i++) {
        const prev = records[i - 1];
        const curr = records[i];

        if (curr.rewardCut !== prev.rewardCut) {
          changes.push({
            address: addr,
            field: 'rewardCut',
            oldValue: prev.rewardCut,
            newValue: curr.rewardCut,
            round: curr.round,
            createdAt: curr.createdAt.toISOString(),
          });
        }

        if (curr.feeShare !== prev.feeShare) {
          changes.push({
            address: addr,
            field: 'feeShare',
            oldValue: prev.feeShare,
            newValue: curr.feeShare,
            round: curr.round,
            createdAt: curr.createdAt.toISOString(),
          });
        }
      }
    }

    res.json({ data: changes });
  } catch (err: any) {
    console.error('[orchestratorAnalytics] changes error:', err.message);
    res.status(500).json({ error: 'Failed to fetch changes' });
  }
});

// Get orchestrator capabilities (read from DB cache)
router.get('/api/v1/wallet/orchestrators/capabilities', async (req: Request, res: Response) => {
  try {
    const capabilities = await getCapabilitiesByAddress();
    res.json({ data: capabilities });
  } catch (err: any) {
    console.error('[orchestratorAnalytics] capabilities error:', err.message);
    res.json({ data: {} });
  }
});

export default router;
