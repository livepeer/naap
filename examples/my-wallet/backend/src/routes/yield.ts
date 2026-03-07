/**
 * Yield calculation routes — estimate based on protocol inflation and orchestrator reward cut
 */

import { Router, Request, Response } from 'express';
import { getProtocol, getDelegator } from '../lib/livepeer.js';

const router = Router();

router.get('/api/v1/wallet/yield', async (req: Request, res: Response) => {
  try {
    const address = (req.query.address || req.query.userId) as string | undefined;
    const period = (req.query.period as string) || '30d';

    const [protocol, delegator] = await Promise.all([
      getProtocol(),
      address ? getDelegator(address) : Promise.resolve(null),
    ]);

    // Estimate APY from protocol inflation and reward cut
    // Annual inflation ≈ inflation * rounds_per_year / totalSupply
    const roundsPerYear = 365; // ~1 round per day on Arbitrum
    const inflationPerRound = parseFloat(protocol.inflation) / 1e18;
    const totalSupply = parseFloat(protocol.totalSupply) / 1e18;
    const totalStaked = parseFloat(protocol.totalActiveStake) / 1e18;

    // Base staking APY = (inflation * rounds_per_year) / totalStaked * 100
    const annualInflation = inflationPerRound * roundsPerYear;
    const stakingApy = totalStaked > 0 ? (annualInflation / totalStaked) * 100 : 0;

    // Delegator APY = stakingApy * (1 - rewardCut/100)
    const rewardCut = delegator?.delegateInfo?.rewardCut ?? 10;
    const delegatorApy = stakingApy * (1 - rewardCut / 100);

    res.json({
      data: {
        period,
        combinedApy: Math.min(delegatorApy, 50), // cap at 50% for sanity
        stakingApy: Math.min(stakingApy, 50),
        rewardCut,
        inflationRate: (annualInflation / totalSupply) * 100,
        participationRate: protocol.participationRate,
      },
    });
  } catch (error: any) {
    console.error('Error calculating yield:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
