/**
 * Staking history routes — on-chain events for a delegator
 */

import { Router, Request, Response } from 'express';
import { getStakingHistory, getDelegator, getProtocol, getPrices } from '../lib/livepeer.js';

const router = Router();

// Get staking event history for an address
router.get('/api/v1/wallet/staking/history', async (req: Request, res: Response) => {
  try {
    const address = (req.query.address as string)?.toLowerCase();
    if (!address) return res.status(400).json({ error: 'address is required' });

    const events = await getStakingHistory(address);
    res.json({ data: { events, total: events.length } });
  } catch (error: any) {
    console.error('Error fetching staking history:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Gas cost summary derived from on-chain state (no DB needed)
router.get('/api/v1/wallet/staking/gas-summary', async (req: Request, res: Response) => {
  try {
    const address = (req.query.address as string)?.toLowerCase();
    if (!address) {
      return res.json({
        data: {
          totalGasCostEth: 0,
          transactionCount: 0,
          avgGasPerTx: 0,
          note: 'Gas tracking requires transaction indexing. Connect a subgraph API key for full history.',
        },
      });
    }

    // Count events as approximate transaction count
    const events = await getStakingHistory(address);
    const uniqueTxHashes = new Set(events.filter(e => e.txHash).map(e => e.txHash));

    res.json({
      data: {
        totalGasCostEth: 0, // Can't determine gas cost without tx receipts
        transactionCount: uniqueTxHashes.size || events.length,
        avgGasPerTx: 0,
        estimatedTxCount: events.length,
        note: 'Gas costs require transaction receipts. Showing event count as proxy.',
      },
    });
  } catch (error: any) {
    console.error('Error fetching gas summary:', error);
    res.json({
      data: { totalGasCostEth: 0, transactionCount: 0, avgGasPerTx: 0 },
    });
  }
});

export default router;
