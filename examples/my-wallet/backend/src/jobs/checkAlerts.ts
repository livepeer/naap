/**
 * Evaluate alert rules, create WalletAlertHistory entries
 */

import { prisma } from '../db/client.js';
import { triggerAlert } from '../lib/alertService.js';
import { getProtocolParams } from '../lib/protocolService.js';

export async function checkAlerts(): Promise<number> {
  const alerts = await prisma.walletAlert.findMany({
    where: { enabled: true },
  });

  let triggered = 0;

  for (const alert of alerts) {
    try {
      const didTrigger = await evaluateAlert(alert);
      if (didTrigger) triggered++;
    } catch (err) {
      console.error(`[alerts] Error evaluating alert ${alert.id}:`, err);
    }
  }

  console.log(`[alerts] Checked ${alerts.length} alerts, triggered ${triggered}`);
  return triggered;
}

async function evaluateAlert(alert: {
  id: string;
  type: string;
  orchestratorAddr: string | null;
  threshold: string | null;
  userId: string;
}): Promise<boolean> {
  switch (alert.type) {
    case 'reward_cut_change':
      return checkRewardCutChange(alert);
    case 'missed_reward':
      return checkMissedReward(alert);
    case 'deactivation':
      return checkDeactivation(alert);
    case 'unbonding_ready':
      return checkUnbondingReady(alert);
    default:
      return false;
  }
}

async function checkRewardCutChange(alert: { id: string; orchestratorAddr: string | null; threshold: string | null }): Promise<boolean> {
  if (!alert.orchestratorAddr) return false;

  const orchestrator = await prisma.walletOrchestrator.findUnique({
    where: { address: alert.orchestratorAddr },
  });
  if (!orchestrator) return false;

  // Check if recent history already has this alert (within 24h)
  const recent = await prisma.walletAlertHistory.findFirst({
    where: {
      alertId: alert.id,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });
  if (recent) return false;

  // Compare with threshold or detect any change via snapshot data
  const threshold = alert.threshold ? JSON.parse(alert.threshold) : {};
  const lastKnownCut = threshold.lastKnownCut;

  if (lastKnownCut !== undefined && orchestrator.rewardCut !== lastKnownCut) {
    await triggerAlert(alert.id, `Orchestrator ${alert.orchestratorAddr} changed reward cut from ${lastKnownCut / 100}% to ${orchestrator.rewardCut / 100}%`, {
      oldCut: lastKnownCut,
      newCut: orchestrator.rewardCut,
    });
    return true;
  }

  return false;
}

async function checkMissedReward(alert: { id: string; orchestratorAddr: string | null }): Promise<boolean> {
  // Placeholder: would check subgraph for missed reward calls
  // For now, return false (requires subgraph integration)
  return false;
}

async function checkDeactivation(alert: { id: string; orchestratorAddr: string | null }): Promise<boolean> {
  if (!alert.orchestratorAddr) return false;

  const orchestrator = await prisma.walletOrchestrator.findUnique({
    where: { address: alert.orchestratorAddr },
  });
  if (!orchestrator || orchestrator.isActive) return false;

  const recent = await prisma.walletAlertHistory.findFirst({
    where: {
      alertId: alert.id,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });
  if (recent) return false;

  await triggerAlert(alert.id, `Orchestrator ${alert.orchestratorAddr} has been deactivated`, {
    address: alert.orchestratorAddr,
  });
  return true;
}

async function checkUnbondingReady(alert: { id: string; userId: string }): Promise<boolean> {
  const params = await getProtocolParams();

  const userAddresses = await prisma.walletAddress.findMany({
    where: { userId: alert.userId },
    select: { address: true },
  });
  const addressList = userAddresses.map(a => a.address);

  const readyLocks = await prisma.walletUnbondingLock.findMany({
    where: {
      address: { in: addressList },
      status: 'pending',
      withdrawRound: { lte: params.currentRound },
    },
  });

  if (readyLocks.length === 0) return false;

  const recent = await prisma.walletAlertHistory.findFirst({
    where: {
      alertId: alert.id,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });
  if (recent) return false;

  await triggerAlert(alert.id, `${readyLocks.length} unbonding lock(s) are now ready to withdraw`, {
    lockCount: readyLocks.length,
  });
  return true;
}
