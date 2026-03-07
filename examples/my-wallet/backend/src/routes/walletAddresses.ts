/**
 * Wallet addresses routes — for connected wallet, returns the address itself
 */

import { Router, Request, Response } from 'express';

const router = Router();

// In the new architecture the connected wallet address IS the identity.
// This route returns it in the expected format so existing hooks work.
router.get('/api/v1/wallet/addresses', async (req: Request, res: Response) => {
  try {
    const address = (req.query.address || req.query.userId) as string;
    if (!address) return res.status(400).json({ error: 'address is required' });

    res.json({
      data: {
        addresses: [{
          id: address.toLowerCase(),
          address: address,
          label: 'Connected Wallet',
          chainId: 42161,
          isPrimary: true,
        }],
      },
    });
  } catch (err: any) {
    console.error('Error fetching addresses:', err);
    res.status(500).json({ error: 'Failed to fetch addresses' });
  }
});

// Accept POST for adding but just ack
router.post('/api/v1/wallet/addresses', async (req: Request, res: Response) => {
  res.json({ data: { address: req.body } });
});

router.patch('/api/v1/wallet/addresses/:id', async (req: Request, res: Response) => {
  res.json({ data: { address: req.body } });
});

router.delete('/api/v1/wallet/addresses/:id', async (req: Request, res: Response) => {
  res.json({ data: { deleted: true } });
});

export default router;
