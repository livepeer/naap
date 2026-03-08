/**
 * Portfolio routes — live from Livepeer subgraph
 */

import { Router, Request, Response } from 'express';
import { getDelegator, getProtocol, getPrices, estimateDailyReward } from '../lib/livepeer.js';
import { prisma } from '../db/client.js';

const router = Router();

router.get('/api/v1/wallet/portfolio', async (req: Request, res: Response) => {
  try {
    const address = (req.query.address || req.query.userId) as string;
    if (!address) return res.status(400).json({ error: 'address is required' });

    const [delegator, protocol, prices] = await Promise.all([
      getDelegator(address),
      getProtocol(),
      getPrices(),
    ]);

    // Compute daily reward estimate using already-fetched data
    const dailyReward = await estimateDailyReward(address, delegator, protocol);

    if (!delegator) {
      return res.json({
        data: {
          totalStaked: '0',
          totalPendingRewards: '0',
          totalPendingFees: '0',
          addressCount: 1,
          positions: [],
          currentRound: protocol.currentRound,
          lptUsd: prices.lptUsd,
        },
      });
    }

    const portfolio = {
      totalStaked: delegator.bondedAmount,
      totalPendingRewards: delegator.principal !== '0'
        ? (BigInt(delegator.bondedAmount) - BigInt(delegator.principal)).toString()
        : '0',
      totalPendingFees: delegator.fees,
      addressCount: 1,
      currentRound: protocol.currentRound,
      lptUsd: prices.lptUsd,
      dailyRewardEstimate: dailyReward.dailyRewardLpt,
      dailyRewardMethod: dailyReward.method,
      estimatedAPR: dailyReward.apr,
      positions: delegator.delegateAddress ? [{
        address,
        orchestrator: delegator.delegateAddress,
        stakedAmount: delegator.bondedAmount,
        pendingRewards: delegator.principal !== '0'
          ? (BigInt(delegator.bondedAmount) - BigInt(delegator.principal)).toString()
          : '0',
        pendingFees: delegator.fees,
        startRound: delegator.startRound,
        lastClaimRound: delegator.lastClaimRound,
        orchestratorInfo: delegator.delegateInfo ? {
          name: null,
          rewardCut: delegator.delegateInfo.rewardCut,
          feeShare: delegator.delegateInfo.feeShare,
          totalStake: delegator.delegateInfo.totalStake,
          isActive: delegator.delegateInfo.active,
        } : undefined,
      }] : [],
    };

    res.json({ data: portfolio });

    // Fire-and-forget: save snapshot for historical tracking
    if (delegator && delegator.delegateAddress) {
      prisma.walletStakingSnapshot.upsert({
        where: {
          address_round: {
            address: address.toLowerCase(),
            round: protocol.currentRound,
          },
        },
        update: {
          pendingStake: delegator.bondedAmount,
          pendingFees: delegator.fees || '0',
          lptPriceUsd: prices.lptUsd,
          ethPriceUsd: prices.ethUsd,
        },
        create: {
          address: address.toLowerCase(),
          orchestrator: delegator.delegateAddress,
          round: protocol.currentRound,
          bondedAmount: delegator.principal || '0',
          pendingStake: delegator.bondedAmount,
          pendingFees: delegator.fees || '0',
          lptPriceUsd: prices.lptUsd,
          ethPriceUsd: prices.ethUsd,
        },
      }).catch(err => {
        console.warn('[snapshot] opportunistic save failed:', err.message);
      });
    }
  } catch (err: any) {
    console.error('Error fetching portfolio:', err);
    res.status(500).json({ error: 'Failed to fetch portfolio' });
  }
});

router.get('/api/v1/wallet/portfolio/positions', async (req: Request, res: Response) => {
  try {
    const address = (req.query.address || req.query.userId) as string;
    if (!address) return res.status(400).json({ error: 'address is required' });

    const delegator = await getDelegator(address);
    if (!delegator || !delegator.delegateAddress) {
      return res.json({ data: { positions: [] } });
    }

    res.json({
      data: {
        positions: [{
          address,
          orchestrator: delegator.delegateAddress,
          stakedAmount: delegator.bondedAmount,
          startRound: delegator.startRound,
        }],
      },
    });
  } catch (err: any) {
    console.error('Error fetching positions:', err);
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
});

export default router;
