/**
 * Staking history routes — on-chain events for a delegator
 */

import { Router, Request, Response } from 'express';
import { getStakingHistory, getTransactionReceipt } from '../lib/livepeer.js';

const gasSummaryCache = new Map<string, { data: any; expiresAt: number }>();
const GAS_CACHE_TTL = 5 * 60_000;

const router = Router();

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

router.get('/api/v1/wallet/staking/gas-summary', async (req: Request, res: Response) => {
  try {
    const address = (req.query.address as string)?.toLowerCase();
    if (!address) {
      return res.json({
        data: {
          totalGasUsed: '0',
          totalGasCostWei: '0',
          totalGasCostEth: 0,
          transactionCount: 0,
          avgGasPerTx: 0,
          byType: {},
        },
      });
    }

    const cacheKey = `gas-summary-${address}`;
    const hit = gasSummaryCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return res.json({ data: hit.data });
    }

    const summary = await (async () => {
      const events = await getStakingHistory(address);
      const txHashes = [...new Set(events.filter(e => e.txHash).map(e => e.txHash!))];

      let totalGasUsed = 0n;
      let totalGasCostWei = 0n;
      const byType: Record<string, { count: number; totalGasWei: bigint }> = {};

      for (const hash of txHashes) {
        const receipt = await getTransactionReceipt(hash);
        if (!receipt) continue;

        const gasUsed = BigInt(parseInt(receipt.gasUsed || '0x0', 16));
        const gasPrice = BigInt(parseInt(receipt.effectiveGasPrice || '0x0', 16));
        const cost = gasUsed * gasPrice;

        totalGasUsed += gasUsed;
        totalGasCostWei += cost;

        const event = events.find(e => e.txHash === hash);
        const type = event?.type || 'unknown';
        if (!byType[type]) byType[type] = { count: 0, totalGasWei: 0n };
        byType[type].count++;
        byType[type].totalGasWei += cost;
      }

      const txCount = txHashes.length;
      const totalGasCostEth = Number(totalGasCostWei) / 1e18;

      const byTypeResult: Record<string, { count: number; totalGasWei: string }> = {};
      for (const [type, data] of Object.entries(byType)) {
        byTypeResult[type] = { count: data.count, totalGasWei: data.totalGasWei.toString() };
      }

      return {
        totalGasUsed: totalGasUsed.toString(),
        totalGasCostWei: totalGasCostWei.toString(),
        totalGasCostEth: parseFloat(totalGasCostEth.toFixed(8)),
        transactionCount: txCount,
        avgGasPerTx: txCount > 0 ? Math.round(Number(totalGasUsed) / txCount) : 0,
        byType: byTypeResult,
      };
    })();

    gasSummaryCache.set(cacheKey, { data: summary, expiresAt: Date.now() + GAS_CACHE_TTL });
    res.json({ data: summary });
  } catch (error: any) {
    console.error('Error fetching gas summary:', error);
    res.json({
      data: {
        totalGasUsed: '0',
        totalGasCostWei: '0',
        totalGasCostEth: 0,
        transactionCount: 0,
        avgGasPerTx: 0,
        byType: {},
      },
    });
  }
});

export default router;
