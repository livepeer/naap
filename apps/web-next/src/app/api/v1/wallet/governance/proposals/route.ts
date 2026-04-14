/**
 * Governance proposals endpoint — DB with subgraph fallback.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';
import { getPolls } from '@/lib/wallet/subgraph';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const status = request.nextUrl.searchParams.get('status') || undefined;
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '20', 10);

    const where = status ? { status } : {};
    const dbProposals = await prisma.walletGovernanceProposal.findMany({
      where,
      include: { votes: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    if (dbProposals.length > 0) {
      const data = dbProposals.map(p => ({
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
      return NextResponse.json({ data });
    }

    let subgraphProposals: any[] = [];
    try {
      const polls = await getPolls();
      subgraphProposals = polls.map(p => ({
        id: p.id,
        proposalId: p.id,
        title: `Poll ${p.id.slice(0, 8)}...`,
        description: p.proposal,
        status: 'active',
        votesFor: p.tally?.yes || '0',
        votesAgainst: p.tally?.no || '0',
        createdAt: new Date().toISOString(),
        votes: [],
      }));
    } catch {
      // subgraph unavailable
    }

    return NextResponse.json({ data: subgraphProposals });
  } catch (err) {
    console.error('Governance proposals error:', err);
    return errors.internal('Failed to fetch proposals');
  }
}
