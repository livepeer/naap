/**
 * BondingManager Contract Wrapper
 *
 * Handles staking operations: bond, unbond, rebond, claim earnings, withdraw.
 */

import { Contract, type Signer, type ContractRunner, type TransactionResponse } from 'ethers';
import { getContractAddresses } from '../addresses.js';

// Minimal ABI for the operations we support
const BONDING_MANAGER_ABI = [
  'function bond(uint256 _amount, address _to) external',
  'function unbond(uint256 _amount) external',
  'function rebond(uint256 _unbondingLockId) external',
  'function rebondFromUnbonded(address _to, uint256 _unbondingLockId) external',
  'function withdrawStake(uint256 _unbondingLockId) external',
  'function withdrawFees(address payable _recipient, uint256 _amount) external',
  'function claimEarnings(uint256 _endRound) external',
  'function reward() external',
  'function getDelegator(address _delegator) external view returns (uint256 bondedAmount, uint256 fees, address delegateAddress, uint256 delegatedAmount, uint256 startRound, uint256 lastClaimRound, uint256 nextUnbondingLockId)',
  'function pendingStake(address _delegator, uint256 _endRound) external view returns (uint256)',
  'function pendingFees(address _delegator, uint256 _endRound) external view returns (uint256)',
  'function getTranscoder(address _transcoder) external view returns (uint256 lastRewardRound, uint256 rewardCut, uint256 feeShare, uint256 pricePerSegment, uint256 pendingRewardCut, uint256 pendingFeeShare, uint256 pendingPricePerSegment, address delegateAddress)',
  'function isRegisteredTranscoder(address _transcoder) external view returns (bool)',
  'function transcoderTotalStake(address _transcoder) external view returns (uint256)',
  'function isActiveTranscoder(address _transcoder) external view returns (bool)',
];

export interface BondingManagerContract {
  bond: (amount: bigint, toAddress: string) => Promise<TransactionResponse>;
  unbond: (amount: bigint) => Promise<TransactionResponse>;
  rebond: (unbondingLockId: number) => Promise<TransactionResponse>;
  withdrawStake: (unbondingLockId: number) => Promise<TransactionResponse>;
  withdrawFees: (recipient: string, amount: bigint) => Promise<TransactionResponse>;
  claimEarnings: (endRound: number) => Promise<TransactionResponse>;
  reward: () => Promise<TransactionResponse>;
  getDelegator: (address: string) => Promise<{
    bondedAmount: bigint;
    fees: bigint;
    delegateAddress: string;
    delegatedAmount: bigint;
    startRound: bigint;
    lastClaimRound: bigint;
    nextUnbondingLockId: bigint;
  }>;
  pendingStake: (delegator: string, endRound: number) => Promise<bigint>;
  pendingFees: (delegator: string, endRound: number) => Promise<bigint>;
  isRegisteredTranscoder: (address: string) => Promise<boolean>;
  transcoderTotalStake: (address: string) => Promise<bigint>;
  isActiveTranscoder: (address: string) => Promise<boolean>;
}

/**
 * Create a typed BondingManager contract instance.
 */
export function createBondingManager(
  chainId: number,
  signerOrProvider: Signer | ContractRunner
): BondingManagerContract {
  const addresses = getContractAddresses(chainId);
  if (!addresses) {
    throw new Error(`No Livepeer contracts found for chain ${chainId}`);
  }

  const contract = new Contract(addresses.bondingManager, BONDING_MANAGER_ABI, signerOrProvider);

  return {
    bond: (amount, toAddress) => contract.bond(amount, toAddress) as Promise<TransactionResponse>,
    unbond: (amount) => contract.unbond(amount) as Promise<TransactionResponse>,
    rebond: (id) => contract.rebond(id) as Promise<TransactionResponse>,
    withdrawStake: (id) => contract.withdrawStake(id) as Promise<TransactionResponse>,
    withdrawFees: (recipient, amount) => contract.withdrawFees(recipient, amount) as Promise<TransactionResponse>,
    claimEarnings: (endRound) => contract.claimEarnings(endRound) as Promise<TransactionResponse>,
    reward: () => contract.reward() as Promise<TransactionResponse>,
    getDelegator: async (address) => {
      const result = await contract.getDelegator(address);
      return {
        bondedAmount: result[0],
        fees: result[1],
        delegateAddress: result[2],
        delegatedAmount: result[3],
        startRound: result[4],
        lastClaimRound: result[5],
        nextUnbondingLockId: result[6],
      };
    },
    pendingStake: (delegator, endRound) => contract.pendingStake(delegator, endRound) as Promise<bigint>,
    pendingFees: (delegator, endRound) => contract.pendingFees(delegator, endRound) as Promise<bigint>,
    isRegisteredTranscoder: (address) => contract.isRegisteredTranscoder(address) as Promise<boolean>,
    transcoderTotalStake: (address) => contract.transcoderTotalStake(address) as Promise<bigint>,
    isActiveTranscoder: (address) => contract.isActiveTranscoder(address) as Promise<boolean>,
  };
}
