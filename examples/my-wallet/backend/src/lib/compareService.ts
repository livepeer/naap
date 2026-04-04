/**
 * Orchestrator comparison queries
 */

import { prisma } from '../db/client.js';

export interface OrchestratorComparison {
  address: string;
  name: string | null;
  rewardCut: number;
  feeShare: number;
  totalStake: string;
  isActive: boolean;
  serviceUri: string | null;
}

/**
 * Get side-by-side data for 1-4 orchestrators
 */
export async function compareOrchestrators(addresses: string[]): Promise<OrchestratorComparison[]> {
  if (addresses.length === 0 || addresses.length > 4) {
    throw new Error('Provide 1-4 orchestrator addresses');
  }

  const orchestrators = await prisma.walletOrchestrator.findMany({
    where: { address: { in: addresses } },
  });

  return orchestrators.map(o => ({
    address: o.address,
    name: o.name,
    rewardCut: o.rewardCut,
    feeShare: o.feeShare,
    totalStake: o.totalStake,
    isActive: o.isActive,
    serviceUri: o.serviceUri,
  }));
}
