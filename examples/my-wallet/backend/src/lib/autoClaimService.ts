/**
 * Auto-claim configuration and detection service
 * S17: Notification-based auto-claim (backend detects, user approves via MetaMask)
 */

import { prisma } from '../db/client.js';

export interface AutoClaimConfig {
  id: string;
  walletAddressId: string;
  enabled: boolean;
  minRewardLpt: string;
  lastClaimedAt: string | null;
}

export interface ClaimablePosition {
  walletAddressId: string;
  address: string;
  orchestrator: string;
  pendingRewards: string;
  pendingFees: string;
  meetsThreshold: boolean;
}

/**
 * Get auto-claim config for a wallet address
 */
export async function getAutoClaimConfig(walletAddressId: string): Promise<AutoClaimConfig | null> {
  if (!prisma) return null;
  try {
    const config = await (prisma as any).walletAutoClaimConfig?.findUnique({
      where: { walletAddressId },
    });
    if (!config) return null;

    return {
      id: config.id,
      walletAddressId: config.walletAddressId,
      enabled: config.enabled,
      minRewardLpt: config.minRewardLpt.toString(),
      lastClaimedAt: config.lastClaimedAt?.toISOString() || null,
    };
  } catch {
    return null;
  }
}

/**
 * Create or update auto-claim config
 */
export async function setAutoClaimConfig(
  walletAddressId: string,
  enabled: boolean,
  minRewardLpt: string,
): Promise<AutoClaimConfig> {
  if (!prisma) throw new Error('Database not available');
  try {
    const config = await (prisma as any).walletAutoClaimConfig?.upsert({
      where: { walletAddressId },
      update: { enabled, minRewardLpt },
      create: { walletAddressId, enabled, minRewardLpt },
    });
    if (!config) throw new Error('Auto-claim model not available');

    return {
      id: config.id,
      walletAddressId: config.walletAddressId,
      enabled: config.enabled,
      minRewardLpt: config.minRewardLpt.toString(),
      lastClaimedAt: config.lastClaimedAt?.toISOString() || null,
    };
  } catch (err: any) {
    throw new Error('Auto-claim configuration not yet available');
  }
}

/**
 * Find all positions with claimable rewards above threshold
 * Called by cron job to generate alert notifications
 */
export async function findClaimablePositions(userId: string): Promise<ClaimablePosition[]> {
  if (!prisma) return [];
  try {
    const addresses = await (prisma as any).walletAddress?.findMany({
      where: { userId },
      include: {
        stakingStates: true,
        autoClaimConfig: true,
      },
    });
    if (!addresses) return [];

  const results: ClaimablePosition[] = [];

  for (const addr of addresses) {
    const config = addr.autoClaimConfig;
    if (!config || !config.enabled) continue;

    const threshold = BigInt(config.minRewardLpt.toString());

    for (const state of addr.stakingStates) {
      const pendingRewards = BigInt(state.pendingRewards || '0');
      const meetsThreshold = pendingRewards >= threshold;

      if (meetsThreshold) {
        results.push({
          walletAddressId: addr.id,
          address: addr.address,
          orchestrator: state.delegatedTo || 'Unknown',
          pendingRewards: state.pendingRewards || '0',
          pendingFees: state.pendingFees || '0',
          meetsThreshold,
        });
      }
    }
  }

  return results;
  } catch {
    return [];
  }
}
