/**
 * User's orchestrators governance participation (S18)
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
      include: { stakingStates: { select: { delegatedTo: true } } },
    });

    const orchestratorAddrs = [...new Set(
      addresses.flatMap(a => a.stakingStates.map(s => s.delegatedTo).filter(Boolean) as string[])
    )];

    const totalProposals = await prisma.walletGovernanceProposal.count();
    const results = [];

    for (const addr of orchestratorAddrs) {
      const votes = await prisma.walletGovernanceVote.findMany({ where: { orchestratorAddr: addr } });
      results.push({
        orchestratorAddr: addr,
        totalProposals,
        totalVotes: votes.length,
        participationRate: totalProposals > 0 ? parseFloat(((votes.length / totalProposals) * 100).toFixed(2)) : 0,
        votesFor: votes.filter(v => v.support).length,
        votesAgainst: votes.filter(v => !v.support).length,
      });
    }

    return success(results);
  } catch (err) {
    console.error('My orchestrators governance error:', err);
    return errors.internal('Failed to fetch governance data');
  }
}
