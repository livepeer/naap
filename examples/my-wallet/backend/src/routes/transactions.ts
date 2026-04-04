/**
 * Wallet Transactions routes
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db/client.js';
import { logTransactionSubmit, logTransactionStatus } from '../services/audit.js';
import { isValidAddress, isValidTxHash, isValidChainId } from '../lib/validators.js';

const router = Router();

router.get('/api/v1/wallet/transactions', async (req: Request, res: Response) => {
  try {
    const { address, userId, type, status, limit = '50', offset = '0' } = req.query;

    if (!address && !userId) {
      return res.status(400).json({ error: 'address or userId is required' });
    }

    try {
      const where: any = {};
      if (address) where.address = address;
      if (userId) where.userId = userId;
      if (type) where.type = type;
      if (status) where.status = status;

      const [transactions, total] = await Promise.all([
        prisma.walletTransactionLog.findMany({
          where,
          orderBy: { timestamp: 'desc' },
          take: Math.min(parseInt(limit as string, 10) || 50, 200),
          skip: parseInt(offset as string, 10),
        }),
        prisma.walletTransactionLog.count({ where }),
      ]);

      res.json({
        transactions,
        total,
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
      });
    } catch {
      // DB unavailable — return empty
      res.json({
        transactions: [],
        total: 0,
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
      });
    }
  } catch (error: any) {
    console.error('Error fetching transactions:', error);
    res.json({ transactions: [], total: 0 });
  }
});

router.post('/api/v1/wallet/transactions', async (req: Request, res: Response) => {
  try {
    const {
      userId,
      address,
      txHash,
      type,
      chainId,
      value,
      gasUsed,
      gasPrice,
      toAddress,
      metadata,
    } = req.body;

    if (!address || !txHash || !type || !chainId) {
      return res.status(400).json({ error: 'address, txHash, type, and chainId are required' });
    }

    if (!isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid Ethereum address format' });
    }

    if (!isValidTxHash(txHash)) {
      return res.status(400).json({ error: 'Invalid transaction hash format' });
    }

    if (!isValidChainId(chainId)) {
      return res.status(400).json({ error: 'Unsupported chain ID' });
    }

    const validTypes = ['stake', 'unstake', 'claim', 'transfer', 'other'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid transaction type. Must be one of: ${validTypes.join(', ')}` });
    }

    const effectiveUserId = userId || address;

    const transaction = await prisma.walletTransactionLog.create({
      data: {
        userId: effectiveUserId,
        address,
        txHash,
        type,
        chainId,
        value,
        gasUsed,
        gasPrice,
        toAddress,
        status: 'pending',
        metadata,
      },
    });

    await logTransactionSubmit(effectiveUserId, address, chainId, txHash, type, value);

    console.log(`Transaction logged: ${txHash} (${type})`);
    res.status(201).json({ transaction });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Transaction already exists' });
    }
    console.error('Error logging transaction:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router.patch('/api/v1/wallet/transactions/:txHash', async (req: Request, res: Response) => {
  try {
    const { txHash } = req.params;
    const { status, blockNumber, gasUsed, confirmedAt } = req.body;

    if (!isValidTxHash(txHash)) {
      return res.status(400).json({ error: 'Invalid transaction hash format' });
    }

    const validStatuses = ['pending', 'confirmed', 'failed'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const transaction = await prisma.walletTransactionLog.update({
      where: { txHash },
      data: {
        status,
        blockNumber,
        gasUsed,
        confirmedAt: confirmedAt ? new Date(confirmedAt) : undefined,
      },
    });

    if (status === 'confirmed' || status === 'failed') {
      await logTransactionStatus(
        transaction.userId,
        transaction.address,
        transaction.chainId,
        txHash,
        status === 'confirmed' ? 'confirm' : 'fail',
        blockNumber,
      );
    }

    res.json({ transaction });
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    console.error('Error updating transaction:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
