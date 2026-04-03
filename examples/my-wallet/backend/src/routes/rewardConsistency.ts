/**
 * Reward consistency routes — computed from subgraph pool data
 * Falls back to orchestrator cache data when subgraph unavailable
 */

import { Router, Request, Response } from 'express';
import { querySubgraph, getProtocol, getOrchestrators } from '../lib/livepeer.js';

const router = Router();

// Single orchestrator consistency check
router.get('/api/v1/wallet/orchestrators/consistency', async (req: Request, res: Response) => {
  try {
    const address = (req.query.address as string)?.toLowerCase();
    if (!address) return res.status(400).json({ error: 'address is required' });

    const protocol = await getProtocol();

    try {
      // Try subgraph for detailed pool data
      const data = await querySubgraph<{
        transcoder: {
          pools: Array<{ id: string; rewardTokens: string; round: { id: string } }>;
        } | null;
      }>(`{
        transcoder(id: "${address}") {
          pools(first: 100, orderBy: id, orderDirection: desc) {
            id
            rewardTokens
            round { id }
          }
        }
      }`);

      if (!data.transcoder || !data.transcoder.pools.length) {
        return res.json({ data: null });
      }

      const pools = data.transcoder.pools;
      const totalRounds = pools.length;
      const rewardsCalled = pools.filter(p => parseFloat(p.rewardTokens) > 0).length;
      const rewardsMissed = totalRounds - rewardsCalled;
      const callRate = totalRounds > 0 ? (rewardsCalled / totalRounds) * 100 : 0;

      let currentMissStreak = 0;
      let longestMissStreak = 0;
      let streak = 0;
      for (const p of pools) {
        const called = parseFloat(p.rewardTokens) > 0;
        if (!called) {
          streak++;
          longestMissStreak = Math.max(longestMissStreak, streak);
        } else {
          streak = 0;
        }
      }
      for (const p of pools) {
        if (parseFloat(p.rewardTokens) > 0) break;
        currentMissStreak++;
      }

      const recentHistory = pools.slice(0, 50).map(p => ({
        round: parseInt(p.round?.id || p.id),
        called: parseFloat(p.rewardTokens) > 0,
      }));

      return res.json({
        data: {
          orchestratorAddr: address,
          totalRounds,
          rewardsCalled,
          rewardsMissed,
          callRate,
          currentMissStreak,
          longestMissStreak,
          recentHistory,
        },
      });
    } catch {
      // Subgraph unavailable — use cached orchestrator data for basic info
      const orchestrators = await getOrchestrators();
      const orch = orchestrators.find(o => o.address.toLowerCase() === address);
      if (!orch) return res.json({ data: null });

      // We know lastRewardRound — compute basic consistency from that
      const lastReward = parseInt(orch.lastRewardRound);
      const currentRound = protocol.currentRound;
      const roundsSinceReward = currentRound - lastReward;
      const callRate = roundsSinceReward <= 1 ? 100 : Math.max(0, 100 - roundsSinceReward * 2);

      return res.json({
        data: {
          orchestratorAddr: address,
          totalRounds: 1,
          rewardsCalled: roundsSinceReward <= 1 ? 1 : 0,
          rewardsMissed: roundsSinceReward <= 1 ? 0 : 1,
          callRate,
          currentMissStreak: roundsSinceReward <= 1 ? 0 : Math.min(roundsSinceReward, 10),
          longestMissStreak: roundsSinceReward <= 1 ? 0 : Math.min(roundsSinceReward, 10),
          recentHistory: [{
            round: currentRound,
            called: roundsSinceReward <= 1,
          }],
        },
      });
    }
  } catch (error: any) {
    console.error('Error fetching reward consistency:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Bulk: top N best and worst orchestrators by reward health
router.get('/api/v1/wallet/orchestrators/reward-health', async (req: Request, res: Response) => {
  try {
    const topN = Math.min(parseInt(req.query.topN as string) || 10, 50);
    const orchestrators = await getOrchestrators();
    const protocol = await getProtocol();

    const withHealth = orchestrators.map(o => {
      const lastReward = parseInt(o.lastRewardRound);
      const roundsSince = protocol.currentRound - lastReward;
      // Score: higher is better. Max 100 for calling every round
      const healthScore = roundsSince <= 1 ? 100
        : roundsSince <= 3 ? 80
        : roundsSince <= 10 ? 60
        : roundsSince <= 30 ? 30
        : 0;

      return {
        address: o.address,
        totalStake: o.totalStake,
        rewardCut: o.rewardCut,
        feeShare: o.feeShare,
        lastRewardRound: o.lastRewardRound,
        roundsSinceLastReward: roundsSince,
        healthScore,
        rewardCallRatio: o.rewardCallRatio,
      };
    });

    // Sort by healthScore desc for best, asc for worst
    const sorted = [...withHealth].sort((a, b) => b.healthScore - a.healthScore || a.roundsSinceLastReward - b.roundsSinceLastReward);
    const best = sorted.slice(0, topN);
    const worst = sorted.slice(-topN).reverse();

    res.json({
      data: {
        best,
        worst,
        totalOrchestrators: orchestrators.length,
        currentRound: protocol.currentRound,
      },
    });
  } catch (error: any) {
    console.error('Error fetching reward health:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
