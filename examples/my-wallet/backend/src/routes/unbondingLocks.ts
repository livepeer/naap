/**
 * Unbonding locks routes — live from Livepeer subgraph
 */

import { Router, Request, Response } from 'express';
import { getDelegator, getProtocol } from '../lib/livepeer.js';

const router = Router();

router.get('/api/v1/wallet/unbonding-locks', async (req: Request, res: Response) => {
  try {
    const address = (req.query.address || req.query.userId) as string;
    if (!address) return res.status(400).json({ error: 'address is required' });

    const [delegator, protocol] = await Promise.all([
      getDelegator(address),
      getProtocol(),
    ]);

    if (!delegator) return res.json({ data: { locks: [] } });

    const currentRound = protocol.currentRound;
    const locks = delegator.unbondingLocks.map(l => ({
      id: l.id,
      lockId: parseInt(l.id),
      amount: l.amount,
      withdrawRound: parseInt(l.withdrawRound),
      delegateAddress: l.delegateAddress,
      status: parseInt(l.withdrawRound) <= currentRound ? 'withdrawable' : 'pending',
      roundsRemaining: Math.max(0, parseInt(l.withdrawRound) - currentRound),
    }));

    res.json({ data: { locks, currentRound } });
  } catch (err: any) {
    console.error('Error fetching unbonding locks:', err);
    res.status(500).json({ error: 'Failed to fetch unbonding locks' });
  }
});

export default router;
