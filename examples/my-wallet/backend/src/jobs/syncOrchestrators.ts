/**
 * Sync orchestrator data from subgraph into DB once per round.
 * Detects parameter changes and records per-round history for watchlist alerts.
 */

import { prisma } from '../db/client.js';
import { getOrchestrators, getProtocol, deriveNameFromServiceURI } from '../lib/livepeer.js';

let lastSyncedRound = 0;

export async function syncOrchestrators(): Promise<void> {
  try {
    const protocol = await getProtocol();
    const currentRound = protocol.currentRound;

    if (currentRound === lastSyncedRound) {
      return;
    }

    console.log(`[syncOrchestrators] Syncing round ${currentRound}...`);
    const orchestrators = await getOrchestrators();

    for (const o of orchestrators) {
      const addr = o.address.toLowerCase();

      // Clamp deactivationRound to a safe 32-bit integer range;
      // the subgraph returns a huge number (~5.8e76) for "never deactivated"
      const MAX_SAFE_ROUND = 2_000_000_000;
      const deactivation = o.deactivationRound > MAX_SAFE_ROUND ? MAX_SAFE_ROUND : (o.deactivationRound || null);

      const orch = await prisma.walletOrchestrator.upsert({
        where: { address: addr },
        update: {
          name: deriveNameFromServiceURI(o.serviceURI),
          serviceUri: o.serviceURI,
          totalStake: o.totalStake,
          rewardCut: Math.round(o.rewardCut * 100),
          feeShare: Math.round(o.feeShare * 100),
          isActive: o.active,
          activationRound: o.activationRound || null,
          deactivationRound: deactivation,
          totalVolumeETH: o.totalVolumeETH,
          thirtyDayVolumeETH: o.thirtyDayVolumeETH,
          ninetyDayVolumeETH: o.ninetyDayVolumeETH,
          totalRewardTokens: o.totalRewardTokens,
          lastRewardRound: parseInt(o.lastRewardRound) || 0,
          delegatorCount: o.delegatorCount,
          rewardCallRatio: o.rewardCallRatio,
          syncedAtRound: currentRound,
          lastSynced: new Date(),
        },
        create: {
          address: addr,
          chainId: 42161,
          name: deriveNameFromServiceURI(o.serviceURI),
          serviceUri: o.serviceURI,
          totalStake: o.totalStake,
          rewardCut: Math.round(o.rewardCut * 100),
          feeShare: Math.round(o.feeShare * 100),
          isActive: o.active,
          activationRound: o.activationRound || null,
          deactivationRound: deactivation,
          totalVolumeETH: o.totalVolumeETH,
          thirtyDayVolumeETH: o.thirtyDayVolumeETH,
          ninetyDayVolumeETH: o.ninetyDayVolumeETH,
          totalRewardTokens: o.totalRewardTokens,
          lastRewardRound: parseInt(o.lastRewardRound) || 0,
          delegatorCount: o.delegatorCount,
          rewardCallRatio: o.rewardCallRatio,
          syncedAtRound: currentRound,
        },
      });

      // Record round history for change detection
      try {
        await prisma.walletOrchestratorRoundHistory.upsert({
          where: { address_round: { address: addr, round: currentRound } },
          update: {
            rewardCut: Math.round(o.rewardCut * 100),
            feeShare: Math.round(o.feeShare * 100),
            totalStake: o.totalStake,
            calledReward: o.rewardCallRatio > 0,
          },
          create: {
            orchestratorId: orch.id,
            address: addr,
            round: currentRound,
            rewardCut: Math.round(o.rewardCut * 100),
            feeShare: Math.round(o.feeShare * 100),
            totalStake: o.totalStake,
            calledReward: o.rewardCallRatio > 0,
          },
        });
      } catch (err: any) {
        if (err.code !== 'P2002') {
          console.warn(`[syncOrchestrators] history error for ${addr}:`, err.message);
        }
      }
    }

    lastSyncedRound = currentRound;
    console.log(`[syncOrchestrators] Synced ${orchestrators.length} orchestrators for round ${currentRound}`);
  } catch (err: any) {
    console.error('[syncOrchestrators] Error:', err.message);
  }
}
