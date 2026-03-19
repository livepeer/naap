/**
 * Governance proposals endpoint (S18)
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

    const status = request.nextUrl.searchParams.get('status') || undefined;
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '20', 10);

    const where = status ? { status } : {};
    const proposals = await prisma.walletGovernanceProposal.findMany({
      where,
      include: { votes: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const data = proposals.map(p => ({
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

    return success(data);
  } catch (err) {
    console.error('Governance proposals error:', err);
    return errors.internal('Failed to fetch proposals');
  }
}
