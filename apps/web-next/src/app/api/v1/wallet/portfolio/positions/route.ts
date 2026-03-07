/**
 * Portfolio Positions API Route
 * GET /api/v1/wallet/portfolio/positions - Get per-orchestrator positions
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');

    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const addresses = await prisma.walletAddress.findMany({
      where: { userId: user.id },
      include: { stakingStates: true },
      orderBy: [{ isPrimary: 'desc' }, { connectedAt: 'asc' }],
    });

    const positions = [];
    const orchestratorAddrs: string[] = [];

    for (const addr of addresses) {
      const state = addr.stakingStates[0];
      positions.push({
        walletAddressId: addr.id,
        address: addr.address,
        label: addr.label,
        chainId: addr.chainId,
        orchestrator: state?.delegatedTo || null,
        stakedAmount: state?.stakedAmount || '0',
        pendingRewards: state?.pendingRewards || '0',
        pendingFees: state?.pendingFees || '0',
        startRound: state?.startRound || null,
        lastClaimRound: state?.lastClaimRound || null,
      });
      if (state?.delegatedTo) orchestratorAddrs.push(state.delegatedTo);
    }

    // Enrich with orchestrator info
    if (orchestratorAddrs.length > 0) {
      const orchestrators = await prisma.walletOrchestrator.findMany({
        where: { address: { in: orchestratorAddrs } },
      });
      const oMap = new Map(orchestrators.map(o => [o.address, o]));

      for (const pos of positions) {
        if (pos.orchestrator) {
          const o = oMap.get(pos.orchestrator);
          if (o) {
            (pos as any).orchestratorInfo = {
              name: o.name,
              rewardCut: o.rewardCut,
              feeShare: o.feeShare,
              totalStake: o.totalStake,
              isActive: o.isActive,
            };
          }
        }
      }
    }

    return success({ positions });
  } catch (err) {
    console.error('Error fetching positions:', err);
    return errors.internal('Failed to fetch positions');
  }
}
