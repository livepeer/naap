/**
 * Wallet Settings routes
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db/client.js';

const router = Router();

router.get('/api/v1/wallet/settings', async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const settings = await prisma.walletSettings.findUnique({
      where: { userId: userId as string },
    });

    res.json({
      settings: settings || {
        defaultNetwork: 'arbitrum-one',
        autoConnect: true,
        showTestnets: false,
        gasStrategy: 'standard',
      },
    });
  } catch (error: any) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router.post('/api/v1/wallet/settings', async (req: Request, res: Response) => {
  try {
    const { userId, defaultNetwork, autoConnect, showTestnets, gasStrategy } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const settings = await prisma.walletSettings.upsert({
      where: { userId },
      update: {
        defaultNetwork,
        autoConnect,
        showTestnets,
        gasStrategy,
      },
      create: {
        userId,
        defaultNetwork: defaultNetwork || 'arbitrum-one',
        autoConnect: autoConnect ?? true,
        showTestnets: showTestnets ?? false,
        gasStrategy: gasStrategy || 'standard',
      },
    });

    res.json({ settings });
  } catch (error: any) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
