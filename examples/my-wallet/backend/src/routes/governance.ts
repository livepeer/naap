/**
 * Governance routes — live polls from Livepeer subgraph
 */

import { Router, Request, Response } from 'express';
import { getPolls } from '../lib/livepeer.js';

const router = Router();

router.get('/api/v1/wallet/governance/proposals', async (req: Request, res: Response) => {
  try {
    const polls = await getPolls();
    const proposals = polls.map(p => ({
      id: p.id,
      proposalId: p.id,
      title: `Poll ${p.id.slice(0, 8)}...`,
      description: p.proposal,
      status: 'active', // Would need block comparison to determine
      votesFor: p.tally?.yes || '0',
      votesAgainst: p.tally?.no || '0',
      createdAt: new Date().toISOString(),
      votes: [],
    }));
    res.json({ data: proposals });
  } catch (error: any) {
    console.error('Error fetching proposals:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router.get('/api/v1/wallet/governance/orchestrator/:address', async (_req: Request, res: Response) => {
  res.json({ data: { totalProposals: 0, totalVotes: 0, participationRate: 0 } });
});

router.get('/api/v1/wallet/governance/my-orchestrators', async (_req: Request, res: Response) => {
  res.json({ data: [] });
});

export default router;
