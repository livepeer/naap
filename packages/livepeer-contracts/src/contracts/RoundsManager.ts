/**
 * RoundsManager Contract Wrapper
 *
 * Manages protocol round information.
 */

import { Contract, type ContractRunner } from 'ethers';
import { getContractAddresses } from '../addresses.js';

const ROUNDS_MANAGER_ABI = [
  'function currentRound() view returns (uint256)',
  'function currentRoundInitialized() view returns (bool)',
  'function currentRoundStartBlock() view returns (uint256)',
  'function roundLength() view returns (uint256)',
  'function lastInitializedRound() view returns (uint256)',
  'function currentRoundLocked() view returns (bool)',
];

export interface RoundsManagerContract {
  currentRound: () => Promise<bigint>;
  currentRoundInitialized: () => Promise<boolean>;
  currentRoundStartBlock: () => Promise<bigint>;
  roundLength: () => Promise<bigint>;
  lastInitializedRound: () => Promise<bigint>;
  currentRoundLocked: () => Promise<boolean>;
}

/**
 * Create a typed RoundsManager contract instance.
 */
export function createRoundsManager(
  chainId: number,
  provider: ContractRunner
): RoundsManagerContract {
  const addresses = getContractAddresses(chainId);
  if (!addresses) {
    throw new Error(`No Livepeer contracts found for chain ${chainId}`);
  }

  const contract = new Contract(addresses.roundsManager, ROUNDS_MANAGER_ABI, provider);

  return {
    currentRound: () => contract.currentRound() as Promise<bigint>,
    currentRoundInitialized: () => contract.currentRoundInitialized() as Promise<boolean>,
    currentRoundStartBlock: () => contract.currentRoundStartBlock() as Promise<bigint>,
    roundLength: () => contract.roundLength() as Promise<bigint>,
    lastInitializedRound: () => contract.lastInitializedRound() as Promise<bigint>,
    currentRoundLocked: () => contract.currentRoundLocked() as Promise<boolean>,
  };
}
