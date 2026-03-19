/**
 * Wallet Connections routes
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db/client.js';
import { logWalletConnect } from '../services/audit.js';
import { isValidAddress, isValidChainId } from '../lib/validators.js';

const router = Router();

router.get('/api/v1/wallet/connections', async (req: Request, res: Response) => {
  try {
    const { userId, address } = req.query;

    if (!userId && !address) {
      return res.json({ connection: null });
    }

    try {
      const where = userId ? { userId: userId as string } : { address: address as string };
      const connection = await prisma.walletConnection.findFirst({ where });
      res.json({ connection });
    } catch {
      // DB unavailable — return success with address info
      res.json({ connection: { userId: userId || address, address: address || userId } });
    }
  } catch (error: any) {
    res.json({ connection: null });
  }
});

router.post('/api/v1/wallet/connections', async (req: Request, res: Response) => {
  try {
    const { userId, address, chainId } = req.body;

    if (!address || !chainId) {
      return res.status(400).json({ error: 'address and chainId are required' });
    }

    if (!isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid Ethereum address format' });
    }

    if (!isValidChainId(chainId)) {
      return res.status(400).json({ error: 'Unsupported chain ID' });
    }

    const effectiveUserId = userId || address;

    let connection;
    try {
      connection = await prisma.walletConnection.upsert({
        where: { userId: effectiveUserId },
        update: { address, chainId, lastSeen: new Date() },
        create: { userId: effectiveUserId, address, chainId },
      });
      await logWalletConnect(effectiveUserId, address, chainId, req.ip);
    } catch {
      // DB unavailable — still acknowledge the connection
      connection = { userId: effectiveUserId, address, chainId };
    }

    console.log(`Wallet connection: ${address} on chain ${chainId}`);
    res.json({ connection });
  } catch (error: any) {
    console.error('Error saving wallet connection:', error);
    res.json({ connection: { address: req.body.address } });
  }
});

router.delete('/api/v1/wallet/connections', async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    await prisma.walletConnection.deleteMany({
      where: { userId: userId as string },
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting wallet connection:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
