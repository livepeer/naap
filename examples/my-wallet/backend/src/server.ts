/**
 * My Wallet Plugin - Backend Server
 * Production-ready with error handling, validation, and audit logging
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import { readFileSync } from 'node:fs';
import { prisma } from './db/client.js';
import { logWalletConnect, logTransactionSubmit, logTransactionStatus } from './services/audit.js';
import {
  getRedis,
  closeRedis,
  standardRateLimit,
  getCacheStats,
} from '@naap/cache';

const pluginConfig = JSON.parse(
  readFileSync(new URL('../../plugin.json', import.meta.url), 'utf8')
);
const app = express();
const PORT = process.env.PORT || pluginConfig.backend?.devPort || 4008;

// Initialize Redis (will fallback to memory if unavailable)
const redis = getRedis();
if (redis) {
  console.log('[my-wallet-svc] Redis caching enabled');
} else {
  console.log('[my-wallet-svc] Using in-memory caching (Redis not configured)');
}

// Parse CORS origins from environment variable, with localhost defaults for development
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://localhost:3008', 'http://localhost:4000'];

// Middleware
app.use(cors({
  origin: CORS_ORIGINS,
  credentials: true,
}));
app.use(compression({
  level: 6,
  threshold: 1024,
}));
app.use(express.json({ limit: '1mb' }));

// Rate limiting middleware (Redis-backed with memory fallback)
app.use(standardRateLimit);

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Input validation helpers
const isValidAddress = (address: string): boolean => {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
};

const isValidTxHash = (hash: string): boolean => {
  return /^0x[a-fA-F0-9]{64}$/.test(hash);
};

const isValidChainId = (chainId: number): boolean => {
  return [1, 5, 42161, 421613].includes(chainId);
};

// Health check
app.get('/healthz', (req, res) => {
  const cacheStats = getCacheStats();
  res.json({
    status: 'ok',
    service: 'my-wallet',
    timestamp: new Date().toISOString(),
    cache: {
      backend: cacheStats.backend,
      redisConnected: cacheStats.redisConnected,
    }
  });
});

// ============================================
// Wallet Connections API
// ============================================

// Get wallet connection for user
app.get('/api/v1/wallet/connections', async (req: Request, res: Response) => {
  try {
    const { userId, address } = req.query;

    if (!userId && !address) {
      return res.status(400).json({ error: 'userId or address is required' });
    }

    const where = userId ? { userId: userId as string } : { address: address as string };
    const connection = await prisma.walletConnection.findFirst({ where });

    res.json({ connection });
  } catch (error: any) {
    console.error('Error fetching wallet connection:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Create or update wallet connection
app.post('/api/v1/wallet/connections', async (req: Request, res: Response) => {
  try {
    const { userId, address, chainId } = req.body;

    if (!address || !chainId) {
      return res.status(400).json({ error: 'address and chainId are required' });
    }

    // Validate address format
    if (!isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid Ethereum address format' });
    }

    // Validate chain ID
    if (!isValidChainId(chainId)) {
      return res.status(400).json({ error: 'Unsupported chain ID' });
    }

    // Use address as userId if not provided (for unauthenticated connections)
    const effectiveUserId = userId || address;

    const connection = await prisma.walletConnection.upsert({
      where: { userId: effectiveUserId },
      update: { 
        address, 
        chainId, 
        lastSeen: new Date(),
      },
      create: {
        userId: effectiveUserId,
        address,
        chainId,
      },
    });

    // Audit log
    await logWalletConnect(effectiveUserId, address, chainId, req.ip);

    console.log(`Wallet connection saved: ${address} on chain ${chainId}`);
    res.json({ connection });
  } catch (error: any) {
    console.error('Error saving wallet connection:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Delete wallet connection
app.delete('/api/v1/wallet/connections', async (req: Request, res: Response) => {
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

// ============================================
// Transactions API
// ============================================

// Get transactions
app.get('/api/v1/wallet/transactions', async (req: Request, res: Response) => {
  try {
    const { address, userId, type, status, limit = '50', offset = '0' } = req.query;

    if (!address && !userId) {
      return res.status(400).json({ error: 'address or userId is required' });
    }

    const where: any = {};
    if (address) where.address = address;
    if (userId) where.userId = userId;
    if (type) where.type = type;
    if (status) where.status = status;

    const [transactions, total] = await Promise.all([
      prisma.walletTransactionLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: parseInt(limit as string, 10),
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
  } catch (error: any) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Log a new transaction
app.post('/api/v1/wallet/transactions', async (req: Request, res: Response) => {
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
      metadata 
    } = req.body;

    if (!address || !txHash || !type || !chainId) {
      return res.status(400).json({ error: 'address, txHash, type, and chainId are required' });
    }

    // Validate inputs
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

    // Audit log
    await logTransactionSubmit(effectiveUserId, address, chainId, txHash, type, value);

    console.log(`Transaction logged: ${txHash} (${type})`);
    res.status(201).json({ transaction });
  } catch (error: any) {
    // Handle duplicate txHash
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Transaction already exists' });
    }
    console.error('Error logging transaction:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Update transaction status
app.patch('/api/v1/wallet/transactions/:txHash', async (req: Request, res: Response) => {
  try {
    const { txHash } = req.params;
    const { status, blockNumber, gasUsed, confirmedAt } = req.body;

    // Validate txHash format
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

    // Audit log for status changes
    if (status === 'confirmed' || status === 'failed') {
      await logTransactionStatus(
        transaction.userId, 
        transaction.address, 
        transaction.chainId, 
        txHash, 
        status === 'confirmed' ? 'confirm' : 'fail',
        blockNumber
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

// ============================================
// Staking API
// ============================================

// Get staking state for address
app.get('/api/v1/wallet/staking/state', async (req: Request, res: Response) => {
  try {
    const { address } = req.query;

    if (!address) {
      return res.status(400).json({ error: 'address is required' });
    }

    const state = await prisma.walletStakingState.findUnique({
      where: { address: address as string },
    });

    res.json({ state: state || null });
  } catch (error: any) {
    console.error('Error fetching staking state:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Update staking state (called after chain sync)
app.post('/api/v1/wallet/staking/state', async (req: Request, res: Response) => {
  try {
    const { 
      address, 
      chainId, 
      stakedAmount, 
      delegatedTo, 
      pendingRewards, 
      pendingFees,
      startRound,
      lastClaimRound,
    } = req.body;

    if (!address || !chainId) {
      return res.status(400).json({ error: 'address and chainId are required' });
    }

    const state = await prisma.walletStakingState.upsert({
      where: { address },
      update: {
        chainId,
        stakedAmount,
        delegatedTo,
        pendingRewards,
        pendingFees,
        startRound,
        lastClaimRound,
        lastSynced: new Date(),
      },
      create: {
        address,
        chainId,
        stakedAmount: stakedAmount || '0',
        delegatedTo,
        pendingRewards: pendingRewards || '0',
        pendingFees: pendingFees || '0',
        startRound,
        lastClaimRound,
      },
    });

    res.json({ state });
  } catch (error: any) {
    console.error('Error updating staking state:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get orchestrators list
app.get('/api/v1/wallet/staking/orchestrators', async (req: Request, res: Response) => {
  try {
    const { chainId, activeOnly = 'true' } = req.query;

    const where: any = {};
    if (chainId) where.chainId = parseInt(chainId as string, 10);
    if (activeOnly === 'true') where.isActive = true;

    const orchestrators = await prisma.walletOrchestrator.findMany({
      where,
      orderBy: { totalStake: 'desc' },
    });

    res.json({ orchestrators });
  } catch (error: any) {
    console.error('Error fetching orchestrators:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================
// Settings API
// ============================================

// Get user settings
app.get('/api/v1/wallet/settings', async (req: Request, res: Response) => {
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
      }
    });
  } catch (error: any) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Update user settings
app.post('/api/v1/wallet/settings', async (req: Request, res: Response) => {
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

// ============================================
// Error Handler
// ============================================

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================
// Start Server
// ============================================

const server = app.listen(PORT, () => {
  console.log(`🚀 My Wallet backend running on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/healthz`);
  console.log(`   API: http://localhost:${PORT}/api/v1/wallet/*`);
});

// Graceful shutdown
async function shutdown() {
  console.log('Shutting down gracefully...');

  server.close(async () => {
    console.log('HTTP server closed');

    try {
      await closeRedis();
      console.log('Redis connection closed');
    } catch (err) {
      console.error('Error closing Redis:', err);
    }

    try {
      await prisma.$disconnect();
      console.log('Database connection closed');
    } catch (err) {
      console.error('Error closing database:', err);
    }

    process.exit(0);
  });

  // Force close after 30s
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
