/**
 * Governance routes (S18)
 */

import { Router, Request, Response } from 'express';
import { listProposals, getOrchestratorGovernance, getUserOrchestratorVotes } from '../lib/governanceService.js';

const router = Router();

router.get('/api/v1/wallet/governance/proposals', async (req: Request, res: Response) => {
  try {
    const { status, limit } = req.query;
    const proposals = await listProposals(
      status as string | undefined,
      limit ? parseInt(limit as string, 10) : 20,
    );
    res.json({ data: proposals });
  } catch (error: any) {
    console.error('Error fetching proposals:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router.get('/api/v1/wallet/governance/orchestrator/:address', async (req: Request, res: Response) => {
  try {
    const governance = await getOrchestratorGovernance(req.params.address);
    res.json({ data: governance });
  } catch (error: any) {
    console.error('Error fetching orchestrator governance:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router.get('/api/v1/wallet/governance/my-orchestrators', async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const votes = await getUserOrchestratorVotes(userId as string);
    res.json({ data: votes });
  } catch (error: any) {
    console.error('Error fetching user orchestrator votes:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
