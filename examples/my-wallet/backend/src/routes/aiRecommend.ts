/**
 * AI recommendation routes — scores live orchestrators from subgraph
 */

import { Router, Request, Response } from 'express';
import { getOrchestrators, type OrchestratorData } from '../lib/livepeer.js';

const router = Router();

router.post('/api/v1/wallet/ai/recommend', async (req: Request, res: Response) => {
  try {
    const { profile, limit = 5 } = req.body;
    const riskTolerance = profile?.riskTolerance || 'moderate';

    const orchestrators = await getOrchestrators();

    // Score each orchestrator based on risk profile
    const scored = orchestrators.map(o => {
      let score = 0;
      const reasons: string[] = [];

      // Reward consistency (0-30 points)
      const consistencyScore = o.rewardCallRatio * 30;
      score += consistencyScore;
      if (o.rewardCallRatio >= 0.95) reasons.push('Excellent reward consistency');
      else if (o.rewardCallRatio >= 0.8) reasons.push('Good reward consistency');

      // Fee volume signals real demand (0-20 points)
      const vol30d = parseFloat(o.thirtyDayVolumeETH);
      if (vol30d > 1) { score += 20; reasons.push('High fee volume'); }
      else if (vol30d > 0.1) { score += 12; reasons.push('Active fee volume'); }
      else if (vol30d > 0) { score += 5; }

      // Stake size (0-15 points) — moderate prefers mid-range, conservative prefers large
      const stakeNum = parseFloat(o.totalStake) / 1e18;
      if (riskTolerance === 'conservative') {
        if (stakeNum > 100000) { score += 15; reasons.push('Large stake pool'); }
        else if (stakeNum > 10000) score += 8;
      } else if (riskTolerance === 'aggressive') {
        if (stakeNum > 1000 && stakeNum < 50000) { score += 15; reasons.push('Growth potential'); }
        else if (stakeNum > 50000) score += 5;
      } else {
        if (stakeNum > 10000) { score += 15; reasons.push('Solid stake size'); }
        else if (stakeNum > 1000) score += 10;
      }

      // Reward cut (0-20 points) — lower is better for delegators
      if (o.rewardCut <= 5) { score += 20; reasons.push('Low reward cut'); }
      else if (o.rewardCut <= 15) { score += 14; reasons.push('Fair reward cut'); }
      else if (o.rewardCut <= 25) score += 8;
      else score += 2;

      // Fee share (0-15 points) — higher is better for delegators
      if (o.feeShare >= 80) { score += 15; reasons.push('High fee share'); }
      else if (o.feeShare >= 50) { score += 10; reasons.push('Good fee share'); }
      else score += 3;

      return {
        address: o.address,
        name: null as string | null,
        rewardCut: o.rewardCut,
        feeShare: o.feeShare,
        totalStake: o.totalStake,
        thirtyDayVolumeETH: o.thirtyDayVolumeETH,
        rewardCallRatio: o.rewardCallRatio,
        delegatorCount: o.delegatorCount,
        score: Math.round(score),
        reasons,
      };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    res.json({ data: scored.slice(0, parseInt(String(limit))) });
  } catch (error: any) {
    console.error('Error getting recommendations:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
