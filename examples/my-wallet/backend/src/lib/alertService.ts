/**
 * Alert CRUD and evaluation logic
 */

import { prisma } from '../db/client.js';

export type AlertType = 'reward_cut_change' | 'missed_reward' | 'deactivation' | 'unbonding_ready';

export interface AlertConfig {
  type: AlertType;
  orchestratorAddr?: string;
  threshold?: Record<string, unknown>;
  enabled?: boolean;
}

export async function listAlerts(userId: string) {
  return prisma.walletAlert.findMany({
    where: { userId },
    include: {
      history: {
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createAlert(userId: string, config: AlertConfig) {
  return prisma.walletAlert.create({
    data: {
      userId,
      type: config.type,
      orchestratorAddr: config.orchestratorAddr || null,
      threshold: config.threshold ? JSON.stringify(config.threshold) : null,
      enabled: config.enabled ?? true,
    },
  });
}

export async function updateAlert(id: string, userId: string, updates: Partial<AlertConfig>) {
  const alert = await prisma.walletAlert.findFirst({ where: { id, userId } });
  if (!alert) return null;

  return prisma.walletAlert.update({
    where: { id },
    data: {
      ...(updates.type !== undefined && { type: updates.type }),
      ...(updates.orchestratorAddr !== undefined && { orchestratorAddr: updates.orchestratorAddr }),
      ...(updates.threshold !== undefined && { threshold: JSON.stringify(updates.threshold) }),
      ...(updates.enabled !== undefined && { enabled: updates.enabled }),
    },
  });
}

export async function deleteAlert(id: string, userId: string) {
  const alert = await prisma.walletAlert.findFirst({ where: { id, userId } });
  if (!alert) return null;
  await prisma.walletAlert.delete({ where: { id } });
  return alert;
}

export async function getAlertHistory(userId: string, limit = 50, offset = 0) {
  const alerts = await prisma.walletAlert.findMany({
    where: { userId },
    select: { id: true },
  });
  const alertIds = alerts.map((a: { id: string }) => a.id);

  const [items, total] = await Promise.all([
    prisma.walletAlertHistory.findMany({
      where: { alertId: { in: alertIds } },
      include: { alert: { select: { type: true, orchestratorAddr: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.walletAlertHistory.count({
      where: { alertId: { in: alertIds } },
    }),
  ]);

  return { items, total };
}

export async function markAlertRead(id: string, userId: string) {
  // Verify ownership through alert relation
  const history = await prisma.walletAlertHistory.findFirst({
    where: { id },
    include: { alert: true },
  });
  if (!history || history.alert.userId !== userId) return null;

  return prisma.walletAlertHistory.update({
    where: { id },
    data: { readAt: new Date() },
  });
}

export async function getUnreadCount(userId: string): Promise<number> {
  const alerts = await prisma.walletAlert.findMany({
    where: { userId },
    select: { id: true },
  });
  return prisma.walletAlertHistory.count({
    where: {
      alertId: { in: alerts.map((a: { id: string }) => a.id) },
      readAt: null,
    },
  });
}

/**
 * Create alert history entry (used by cron jobs)
 */
export async function triggerAlert(alertId: string, message: string, data?: Record<string, unknown>) {
  return prisma.walletAlertHistory.create({
    data: {
      alertId,
      message,
      data: data ? JSON.stringify(data) : null,
    },
  });
}
