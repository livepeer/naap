/**
 * Vercel Cron trigger for alert checking
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '');
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return errors.unauthorized('Invalid cron secret');
  }

  try {
    const alerts = await prisma.walletAlert.findMany({ where: { enabled: true } });
    let triggered = 0;

    for (const alert of alerts) {
      if (alert.type === 'deactivation' && alert.orchestratorAddr) {
        const o = await prisma.walletOrchestrator.findUnique({ where: { address: alert.orchestratorAddr } });
        if (o && !o.isActive) {
          const recent = await prisma.walletAlertHistory.findFirst({
            where: { alertId: alert.id, createdAt: { gte: new Date(Date.now() - 86400000) } },
          });
          if (!recent) {
            await prisma.walletAlertHistory.create({
              data: { alertId: alert.id, message: `Orchestrator ${alert.orchestratorAddr} deactivated` },
            });
            triggered++;
          }
        }
      }

      if (alert.type === 'unbonding_ready') {
        const readyLocks = await prisma.walletUnbondingLock.count({
          where: { walletAddress: { userId: alert.userId }, status: 'withdrawable' },
        });
        if (readyLocks > 0) {
          const recent = await prisma.walletAlertHistory.findFirst({
            where: { alertId: alert.id, createdAt: { gte: new Date(Date.now() - 86400000) } },
          });
          if (!recent) {
            await prisma.walletAlertHistory.create({
              data: { alertId: alert.id, message: `${readyLocks} unbonding lock(s) ready to withdraw` },
            });
            triggered++;
          }
        }
      }
    }

    return success({ checked: alerts.length, triggered });
  } catch (err) {
    console.error('Cron alerts error:', err);
    return errors.internal('Alert check job failed');
  }
}
