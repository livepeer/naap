/**
 * useStakingOps - Enhanced staking hook with redelegate, rebond, withdrawStake
 * Extends the base useStaking hook with additional operations.
 */

import { useCallback } from 'react';
import { Contract, parseUnits } from 'ethers';
import { useWallet } from '../context/WalletContext';
import { useStaking } from './useStaking';
import {
  BONDING_MANAGER_ABI,
  getNetworkByChainId,
} from '../lib/contracts';

// Extended ABI entries for new operations
const EXTENDED_ABI = [
  ...BONDING_MANAGER_ABI,
  'function getDelegatorUnbondingLock(address _delegator, uint256 _unbondingLockId) view returns (uint256 amount, uint256 withdrawRound)',
  'function rebondFromUnbonded(address _to, uint256 _unbondingLockId) external',
  'function transferBond(address _delegator, uint256 _amount, address _oldDelegateNewPosPrev, address _oldDelegateNewPosNext, address _newDelegateNewPosPrev, address _newDelegateNewPosNext) external',
  'function unbondingPeriod() view returns (uint64)',
  'function getTotalBonded() view returns (uint256)',
];

export function useStakingOps() {
  const staking = useStaking();
  const { address, chainId, provider, signer } = useWallet();

  const getExtendedContract = useCallback(() => {
    if (!provider || !chainId) return null;
    const network = getNetworkByChainId(chainId);
    if (!network) return null;
    const contracts = (network as any).contracts;
    if (!contracts?.bondingManager) return null;
    return new Contract(contracts.bondingManager, EXTENDED_ABI, signer || provider);
  }, [provider, chainId, signer]);

  /** Redelegate: unbond from current O and bond to new O in one step */
  const redelegate = useCallback(async (amount: string, newOrchestrator: string): Promise<string> => {
    if (!signer || !address) throw new Error('Wallet not connected');

    const contract = getExtendedContract();
    if (!contract) throw new Error('Contract not available');

    // First unbond
    const amountWei = parseUnits(amount, 18);
    const unbondTx = await contract.unbond(amountWei);
    await unbondTx.wait();

    // Then bond to new orchestrator
    const bondTx = await contract.bond(amountWei, newOrchestrator);
    const receipt = await bondTx.wait();

    await staking.refreshStakingState();
    return receipt.hash;
  }, [signer, address, getExtendedContract, staking]);

  /** Rebond: rebond an unbonding lock back to the current orchestrator */
  const rebond = useCallback(async (lockId: number): Promise<string> => {
    if (!signer) throw new Error('Wallet not connected');

    const contract = getExtendedContract();
    if (!contract) throw new Error('Contract not available');

    const tx = await contract.rebond(lockId);
    const receipt = await tx.wait();

    await staking.refreshStakingState();
    return receipt.hash;
  }, [signer, getExtendedContract, staking]);

  /** Rebond from unbonded state to a specific orchestrator */
  const rebondFromUnbonded = useCallback(async (orchestrator: string, lockId: number): Promise<string> => {
    if (!signer) throw new Error('Wallet not connected');

    const contract = getExtendedContract();
    if (!contract) throw new Error('Contract not available');

    const tx = await contract.rebondFromUnbonded(orchestrator, lockId);
    const receipt = await tx.wait();

    await staking.refreshStakingState();
    return receipt.hash;
  }, [signer, getExtendedContract, staking]);

  /** Withdraw stake from a completed unbonding lock */
  const withdrawStake = useCallback(async (lockId: number): Promise<string> => {
    if (!signer) throw new Error('Wallet not connected');

    const contract = getExtendedContract();
    if (!contract) throw new Error('Contract not available');

    const tx = await contract.withdrawStake(lockId);
    const receipt = await tx.wait();

    await staking.refreshStakingState();
    return receipt.hash;
  }, [signer, getExtendedContract, staking]);

  /** Get a specific unbonding lock's details from chain */
  const getUnbondingLock = useCallback(async (lockId: number) => {
    if (!address) throw new Error('Wallet not connected');

    const contract = getExtendedContract();
    if (!contract) throw new Error('Contract not available');

    const [amount, withdrawRound] = await contract.getDelegatorUnbondingLock(address, lockId);
    return { amount, withdrawRound };
  }, [address, getExtendedContract]);

  return {
    ...staking,
    redelegate,
    rebond,
    rebondFromUnbonded,
    withdrawStake,
    getUnbondingLock,
  };
}
