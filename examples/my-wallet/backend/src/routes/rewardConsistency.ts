/**
 * Reward consistency routes — computed from subgraph pool data
 */

import { Router, Request, Response } from 'express';
import { querySubgraph, getProtocol } from '../lib/livepeer.js';

const router = Router();

router.get('/api/v1/wallet/orchestrators/consistency', async (req: Request, res: Response) => {
  try {
    const address = (req.query.address as string)?.toLowerCase();
    if (!address) return res.status(400).json({ error: 'address is required' });

    const protocol = await getProtocol();

    // Get last 100 reward pools for this orchestrator
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

    // Calculate miss streaks
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
    // Current miss streak from the most recent round
    for (const p of pools) {
      if (parseFloat(p.rewardTokens) > 0) break;
      currentMissStreak++;
    }

    const recentHistory = pools.slice(0, 50).map(p => ({
      round: parseInt(p.round?.id || p.id),
      called: parseFloat(p.rewardTokens) > 0,
    }));

    res.json({
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
  } catch (error: any) {
    console.error('Error fetching reward consistency:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
