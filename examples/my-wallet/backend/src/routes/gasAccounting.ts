/**
 * Gas accounting routes (S7)
 */

import { Router, Request, Response } from 'express';

const router = Router();

router.get('/api/v1/wallet/gas-summary', async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      // Return empty summary instead of 400
      return res.json({
        data: {
          totalGasUsed: '0',
          totalGasETH: '0',
          totalGasUSD: '0',
          transactionCount: 0,
        },
      });
    }

    // Try to load from service, fall back to empty
    try {
      const { getGasSummary } = await import('../lib/gasAccountingService.js');
      const summary = await getGasSummary(userId as string, req.query.addressId as string | undefined);
      res.json({ data: summary });
    } catch {
      res.json({
        data: {
          totalGasUsed: '0',
          totalGasETH: '0',
          totalGasUSD: '0',
          transactionCount: 0,
        },
      });
    }
  } catch (error: any) {
    console.error('Error fetching gas summary:', error);
    res.json({
      data: {
        totalGasUsed: '0',
        totalGasETH: '0',
        totalGasUSD: '0',
        transactionCount: 0,
      },
    });
  }
});

export default router;
