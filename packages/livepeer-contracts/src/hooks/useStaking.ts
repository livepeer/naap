/**
 * useStaking Hook
 *
 * High-level staking operations using BondingManager.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Signer } from 'ethers';
import { createBondingManager } from '../contracts/BondingManager.js';
import { createLPTToken } from '../contracts/LPTToken.js';
import { getContractAddresses } from '../addresses.js';
import { parseEther } from 'ethers';

export interface DelegatorState {
  bondedAmount: string;
  fees: string;
  delegateAddress: string;
  delegatedAmount: string;
  startRound: string;
  lastClaimRound: string;
  pendingStake: string;
  pendingFees: string;
  status: 'Pending' | 'Bonded' | 'Unbonded';
  loading: boolean;
  error: Error | null;
}

export interface StakingActions {
  bond: (amount: string, toAddress: string) => Promise<string>;
  unbond: (amount: string) => Promise<string>;
  claimEarnings: (endRound: number) => Promise<string>;
  withdrawStake: (unbondingLockId: number) => Promise<string>;
  withdrawFees: (amount?: string) => Promise<string>;
}

/**
 * Hook for staking operations on Livepeer.
 */
export function useStaking(
  signer: Signer | null,
  chainId: number | null,
  address: string | null
): {
  delegator: DelegatorState;
  actions: StakingActions;
  refresh: () => void;
} {
  const [delegator, setDelegator] = useState<DelegatorState>({
    bondedAmount: '0',
    fees: '0',
    delegateAddress: '',
    delegatedAmount: '0',
    startRound: '0',
    lastClaimRound: '0',
    pendingStake: '0',
    pendingFees: '0',
    status: 'Unbonded',
    loading: false,
    error: null,
  });

  const mountedRef = useRef(true);

  const fetchDelegator = useCallback(async () => {
    if (!signer || !chainId || !address) return;

    setDelegator(prev => ({ ...prev, loading: true, error: null }));

    try {
      const bm = createBondingManager(chainId, signer);
      const info = await bm.getDelegator(address);

      if (!mountedRef.current) return;

      const bondedAmount = info.bondedAmount.toString();
      const status: DelegatorState['status'] = 
        BigInt(bondedAmount) > 0n ? 'Bonded' : 'Unbonded';

      setDelegator({
        bondedAmount,
        fees: info.fees.toString(),
        delegateAddress: info.delegateAddress,
        delegatedAmount: info.delegatedAmount.toString(),
        startRound: info.startRound.toString(),
        lastClaimRound: info.lastClaimRound.toString(),
        pendingStake: '0', // Would need currentRound to calculate
        pendingFees: '0',
        status,
        loading: false,
        error: null,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setDelegator(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err : new Error('Failed to fetch delegator'),
      }));
    }
  }, [signer, chainId, address]);

  useEffect(() => {
    mountedRef.current = true;
    fetchDelegator();
    return () => { mountedRef.current = false; };
  }, [fetchDelegator]);

  const actions: StakingActions = {
    bond: async (amount: string, toAddress: string) => {
      if (!signer || !chainId) throw new Error('Not connected');
      const addresses = getContractAddresses(chainId);
      if (!addresses) throw new Error('Unsupported chain');

      const lpt = createLPTToken(chainId, signer);
      const bm = createBondingManager(chainId, signer);
      const amountWei = parseEther(amount);

      // Approve BondingManager to spend LPT
      const approveTx = await lpt.approve(addresses.bondingManager, amountWei);
      await approveTx.wait();

      // Bond
      const tx = await bm.bond(amountWei, toAddress);
      await tx.wait();
      fetchDelegator();
      return tx.hash;
    },

    unbond: async (amount: string) => {
      if (!signer || !chainId) throw new Error('Not connected');
      const bm = createBondingManager(chainId, signer);
      const tx = await bm.unbond(parseEther(amount));
      await tx.wait();
      fetchDelegator();
      return tx.hash;
    },

    claimEarnings: async (endRound: number) => {
      if (!signer || !chainId) throw new Error('Not connected');
      const bm = createBondingManager(chainId, signer);
      const tx = await bm.claimEarnings(endRound);
      await tx.wait();
      fetchDelegator();
      return tx.hash;
    },

    withdrawStake: async (unbondingLockId: number) => {
      if (!signer || !chainId) throw new Error('Not connected');
      const bm = createBondingManager(chainId, signer);
      const tx = await bm.withdrawStake(unbondingLockId);
      await tx.wait();
      fetchDelegator();
      return tx.hash;
    },

    withdrawFees: async (amount?: string) => {
      if (!signer || !chainId || !address) throw new Error('Not connected');
      const bm = createBondingManager(chainId, signer);
      const amountWei = amount ? parseEther(amount) : 0n;
      const tx = await bm.withdrawFees(address, amountWei);
      await tx.wait();
      fetchDelegator();
      return tx.hash;
    },
  };

  return { delegator, actions, refresh: fetchDelegator };
}
