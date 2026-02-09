/**
 * Wallet Transactions API Routes
 * GET /api/v1/wallet/transactions - List transactions
 * POST /api/v1/wallet/transactions - Log new transaction
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken, parsePagination } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

// Validation helpers
const isValidAddress = (address: string): boolean => {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
};

const isValidTxHash = (hash: string): boolean => {
  return /^0x[a-fA-F0-9]{64}$/.test(hash);
};

const isValidChainId = (chainId: number): boolean => {
  return [1, 5, 42161, 421613].includes(chainId);
};

const validTxTypes = ['stake', 'unstake', 'claim', 'transfer', 'other'];

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const searchParams = request.nextUrl.searchParams;
    const { page, pageSize, skip } = parsePagination(searchParams);
    const address = searchParams.get('address');
    const type = searchParams.get('type');
    const status = searchParams.get('status');

    const where: {
      userId?: string;
      address?: string;
      type?: string;
      status?: string;
    } = { userId: user.id };

    if (address) where.address = address;
    if (type) where.type = type;
    if (status) where.status = status;

    const [transactions, total] = await Promise.all([
      prisma.walletTransactionLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: pageSize,
        skip,
      }),
      prisma.walletTransactionLog.count({ where }),
    ]);

    return success(
      { transactions },
      { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    );
  } catch (err) {
    console.error('Error fetching transactions:', err);
    return errors.internal('Failed to fetch transactions');
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const csrfError = validateCSRF(request, token);
    if (csrfError) {
      return csrfError;
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const body = await request.json();
    const {
      address,
      txHash,
      type,
      chainId,
      value,
      gasUsed,
      gasPrice,
      toAddress,
      metadata,
    } = body;

    if (!address || !txHash || !type || !chainId) {
      return errors.badRequest('address, txHash, type, and chainId are required');
    }

    if (!isValidAddress(address)) {
      return errors.badRequest('Invalid Ethereum address format');
    }

    if (!isValidTxHash(txHash)) {
      return errors.badRequest('Invalid transaction hash format');
    }

    if (!isValidChainId(chainId)) {
      return errors.badRequest('Unsupported chain ID');
    }

    if (!validTxTypes.includes(type)) {
      return errors.badRequest(`Invalid transaction type. Must be one of: ${validTxTypes.join(', ')}`);
    }

    const transaction = await prisma.walletTransactionLog.create({
      data: {
        userId: user.id,
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

    return success({ transaction });
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error.code === 'P2002') {
      return errors.conflict('Transaction already exists');
    }
    console.error('Error logging transaction:', err);
    return errors.internal('Failed to log transaction');
  }
}
