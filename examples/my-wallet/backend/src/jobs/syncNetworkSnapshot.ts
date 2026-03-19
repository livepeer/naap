/**
 * Capture network-wide protocol metrics once per round.
 * Seeds the Dune-style overview dashboard.
 */

import { prisma } from '../db/client.js';
import { getProtocol, getPrices, getNetworkDays } from '../lib/livepeer.js';

let lastSnapshotRound = 0;
let seeded = false;

export async function syncNetworkSnapshot(): Promise<void> {
  try {
    const protocol = await getProtocol();
    const currentRound = protocol.currentRound;

    if (currentRound === lastSnapshotRound) {
      return;
    }

    const prices = await getPrices();

    // Compute averages from current orchestrator data in DB
    const orchStats = await prisma.walletOrchestrator.aggregate({
      where: { isActive: true },
      _avg: { rewardCut: true, feeShare: true },
      _count: true,
    });

    const snapshotData = {
      totalBonded: String(protocol.totalActiveStake),
      totalSupply: String(protocol.totalSupply),
      participationRate: Number(protocol.participationRate) || 0,
      inflation: String(protocol.inflation),
      activeOrchestrators: Number(protocol.activeTranscoderCount) || 0,
      delegatorsCount: Number(protocol.delegatorsCount) || 0,
      totalVolumeETH: String(protocol.totalVolumeETH),
      totalVolumeUSD: String(protocol.totalVolumeUSD),
      avgRewardCut: orchStats._avg.rewardCut ?? 0,
      avgFeeShare: orchStats._avg.feeShare ?? 0,
      lptPriceUsd: prices.lptUsd,
      ethPriceUsd: prices.ethUsd,
    };

    await prisma.walletNetworkSnapshot.upsert({
      where: { round: currentRound },
      update: { ...snapshotData, snapshotAt: new Date() },
      create: { round: currentRound, ...snapshotData },
    });

    lastSnapshotRound = currentRound;
    console.log(`[syncNetworkSnapshot] Saved snapshot for round ${currentRound}`);

    // On first run, backfill from subgraph Days entity
    if (!seeded) {
      await backfillFromDays();
      seeded = true;
    }
  } catch (err: any) {
    console.error('[syncNetworkSnapshot] Error:', err.message);
  }
}

async function backfillFromDays(): Promise<void> {
  try {
    const existing = await prisma.walletNetworkSnapshot.count();
    if (existing > 10) return; // already seeded

    const days = await getNetworkDays(365);
    if (!days.length) return;

    let backfilled = 0;
    for (const day of days) {
      // Use the date field as a pseudo-round (days are not rounds, but useful for chart seeding)
      const pseudoRound = day.date;
      try {
        await prisma.walletNetworkSnapshot.upsert({
          where: { round: pseudoRound },
          update: {},
          create: {
            round: pseudoRound,
            totalVolumeETH: String(day.volumeETH || '0'),
            totalVolumeUSD: String(day.volumeUSD || '0'),
            participationRate: parseFloat(String(day.participationRate || '0')),
            inflation: String(day.inflation || '0'),
            activeOrchestrators: Number(day.activeTranscoderCount) || 0,
            delegatorsCount: Number(day.delegatorsCount) || 0,
            snapshotAt: new Date(day.date * 1000),
          },
        });
        backfilled++;
      } catch {
        // Ignore duplicates
      }
    }
    console.log(`[syncNetworkSnapshot] Backfilled ${backfilled} historical snapshots`);
  } catch (err: any) {
    console.warn('[syncNetworkSnapshot] Backfill failed:', err.message);
  }
}
