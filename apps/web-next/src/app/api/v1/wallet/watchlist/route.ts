/**
 * Watchlist CRUD endpoint (S15)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const items = await prisma.walletWatchlist.findMany({
      where: { userId: user.id },
      orderBy: { addedAt: 'desc' },
    });

    const addrs = items.map(i => i.orchestratorAddr);
    const orchestrators = await prisma.walletOrchestrator.findMany({
      where: { address: { in: addrs } },
      select: { address: true, name: true, rewardCut: true, feeShare: true, totalStake: true, isActive: true },
    });
    const oMap = new Map(orchestrators.map(o => [o.address, o]));

    const enriched = items.map(item => ({
      id: item.id,
      orchestratorAddr: item.orchestratorAddr,
      label: item.label,
      notes: item.notes,
      addedAt: item.addedAt.toISOString(),
      orchestrator: oMap.get(item.orchestratorAddr) || null,
    }));

    return success(enriched);
  } catch (err) {
    console.error('Watchlist error:', err);
    return errors.internal('Failed to fetch watchlist');
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const csrfError = validateCSRF(request, { shadowMode: true });
    if (csrfError) return csrfError;
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const body = await request.json();
    const { orchestratorAddr, label, notes } = body;
    if (!orchestratorAddr) return errors.badRequest('orchestratorAddr is required');

    const entry = await prisma.walletWatchlist.create({
      data: { userId: user.id, orchestratorAddr, label: label || null, notes: notes || null },
    });

    return success(entry);
  } catch (err: any) {
    if (err?.code === 'P2002') return errors.conflict('Already in watchlist');
    console.error('Watchlist create error:', err);
    return errors.internal('Failed to add to watchlist');
  }
}
