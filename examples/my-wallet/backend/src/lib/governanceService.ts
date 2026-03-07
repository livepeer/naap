/**
 * Governance tracking service
 * S18: Track governance proposals and orchestrator votes
 */

import { prisma } from '../db/client.js';

export interface GovernanceProposal {
  id: string;
  proposalId: string;
  title: string;
  description: string | null;
  status: string;
  votesFor: string;
  votesAgainst: string;
  createdAt: string;
  votes: GovernanceVote[];
}

export interface GovernanceVote {
  orchestratorAddr: string;
  support: boolean;
  weight: string;
}

export interface OrchestratorGovernance {
  orchestratorAddr: string;
  totalProposals: number;
  totalVotes: number;
  participationRate: number;
  votesFor: number;
  votesAgainst: number;
}

/**
 * List governance proposals with optional status filter
 */
export async function listProposals(status?: string, limit = 20): Promise<GovernanceProposal[]> {
  const where = status ? { status } : {};
  const proposals = await prisma.walletGovernanceProposal.findMany({
    where,
    include: { votes: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return proposals.map(p => ({
    id: p.id,
    proposalId: p.proposalId.toString(),
    title: p.title,
    description: p.description,
    status: p.status,
    votesFor: p.votesFor.toString(),
    votesAgainst: p.votesAgainst.toString(),
    createdAt: p.createdAt.toISOString(),
    votes: p.votes.map(v => ({
      orchestratorAddr: v.orchestratorAddr,
      support: v.support,
      weight: v.weight.toString(),
    })),
  }));
}

/**
 * Get governance participation summary for an orchestrator
 */
export async function getOrchestratorGovernance(orchestratorAddr: string): Promise<OrchestratorGovernance> {
  const totalProposals = await prisma.walletGovernanceProposal.count();
  const votes = await prisma.walletGovernanceVote.findMany({
    where: { orchestratorAddr },
  });

  const votesFor = votes.filter(v => v.support).length;
  const votesAgainst = votes.length - votesFor;
  const participationRate = totalProposals > 0
    ? parseFloat(((votes.length / totalProposals) * 100).toFixed(2))
    : 0;

  return {
    orchestratorAddr,
    totalProposals,
    totalVotes: votes.length,
    participationRate,
    votesFor,
    votesAgainst,
  };
}

/**
 * Get how user's orchestrators vote (for portfolio page)
 */
export async function getUserOrchestratorVotes(userId: string): Promise<OrchestratorGovernance[]> {
  const addresses = await prisma.walletAddress.findMany({
    where: { userId },
    include: { stakingStates: { select: { delegatedTo: true } } },
  });

  const orchestratorAddrs = [...new Set(
    addresses.flatMap(a => a.stakingStates.map(s => s.delegatedTo).filter(Boolean) as string[])
  )];

  return Promise.all(orchestratorAddrs.map(addr => getOrchestratorGovernance(addr)));
}
