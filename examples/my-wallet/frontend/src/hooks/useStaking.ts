/**
 * useStaking - Hook for Livepeer staking operations
 */

import { useState, useEffect, useCallback } from 'react';
import { Contract, parseUnits } from 'ethers';
import { useWallet } from '../context/WalletContext';
import { 
  BONDING_MANAGER_ABI, 
  ERC20_ABI, 
  ROUNDS_MANAGER_ABI,
  getNetworkByChainId,
} from '../lib/contracts';

export interface DelegatorInfo {
  bondedAmount: bigint;
  fees: bigint;
  delegateAddress: string;
  delegatedAmount: bigint;
  startRound: bigint;
  lastClaimRound: bigint;
  nextUnbondingLockId: bigint;
}

export interface StakingState {
  lptBalance: bigint;
  stakedAmount: bigint;      // Total staked including accumulated rewards (= pendingStake)
  pendingRewards: bigint;    // Accumulated rewards only (= pendingStake - principal)
  pendingFees: bigint;
  delegatedTo: string | null;
  currentRound: bigint;
  lastClaimRound: bigint;    // Round when earnings were last claimed
  principal: bigint;         // Original bonded amount (at last claim)
  isLoading: boolean;
  error: string | null;
}

export interface UseStakingReturn extends StakingState {
  stake: (amount: string, orchestrator: string) => Promise<string>;
  unstake: (amount: string) => Promise<string>;
  claimRewards: () => Promise<string>;
  withdrawFees: () => Promise<string>;
  refreshStakingState: () => Promise<void>;
}

const initialState: StakingState = {
  lptBalance: 0n,
  stakedAmount: 0n,
  pendingRewards: 0n,
  pendingFees: 0n,
  delegatedTo: null,
  currentRound: 0n,
  lastClaimRound: 0n,
  principal: 0n,
  isLoading: false,
  error: null,
};

export function useStaking(): UseStakingReturn {
  const { address, chainId, provider, signer, isConnected } = useWallet();
  const [state, setState] = useState<StakingState>(initialState);

  // Get contract instances
  const getContracts = useCallback(() => {
    if (!provider || !chainId) return null;

    const network = getNetworkByChainId(chainId);
    if (!network) return null;

    const contracts = (network as any).contracts;
    if (!contracts?.bondingManager || !contracts?.livepeerToken) return null;

    const bondingManager = new Contract(contracts.bondingManager, BONDING_MANAGER_ABI, signer || provider);
    const lptToken = new Contract(contracts.livepeerToken, ERC20_ABI, signer || provider);
    const roundsManager = contracts.roundsManager 
      ? new Contract(contracts.roundsManager, ROUNDS_MANAGER_ABI, provider)
      : null;

    return { bondingManager, lptToken, roundsManager };
  }, [provider, chainId, signer]);

  // Refresh staking state
  const refreshStakingState = useCallback(async () => {
    if (!address || !isConnected) {
      setState(initialState);
      return;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const contracts = getContracts();
      if (!contracts) {
        setState(prev => ({ ...prev, isLoading: false, error: 'Contracts not available on this network' }));
        return;
      }

      const { bondingManager, lptToken, roundsManager } = contracts;

      // Get LPT balance
      const lptBalance = await lptToken.balanceOf(address);

      // Get current round
      let currentRound = 0n;
      if (roundsManager) {
        currentRound = await roundsManager.currentRound();
      }

      // Get delegator info: bondedAmount, fees, delegateAddress, delegatedAmount, startRound, lastClaimRound, nextUnbondingLockId
      const delegatorInfo = await bondingManager.getDelegator(address);
      const [bondedAmount, fees, delegateAddress, , , lastClaimRound] = delegatorInfo;

      // Get pending stake and fees
      let pendingStake = bondedAmount; // fallback to principal
      let pendingFees = 0n;
      if (currentRound > 0n) {
        try {
          pendingStake = await bondingManager.pendingStake(address, currentRound);
          pendingFees = await bondingManager.pendingFees(address, currentRound);
        } catch {
          // Some networks may not support these calls
        }
      }

      // Normalize: stakedAmount = total (pendingStake), pendingRewards = accumulated only
      const accumulatedRewards = pendingStake > bondedAmount ? pendingStake - bondedAmount : 0n;

      setState({
        lptBalance,
        stakedAmount: pendingStake,           // Total staked including rewards
        pendingRewards: accumulatedRewards,    // Just accumulated rewards
        pendingFees: pendingFees > 0n ? pendingFees : fees,
        delegatedTo: delegateAddress !== '0x0000000000000000000000000000000000000000' ? delegateAddress : null,
        currentRound,
        lastClaimRound: lastClaimRound || 0n,
        principal: bondedAmount,               // Original bonded amount
        isLoading: false,
        error: null,
      });
    } catch (err: any) {
      console.error('Failed to fetch staking state via MetaMask, trying backend API:', err);
      // Fallback: try the backend API which uses its own RPC
      try {
        const { getApiUrl } = await import('../App');
        const apiUrl = getApiUrl();
        const [portfolioRes, protocolRes] = await Promise.all([
          fetch(`${apiUrl}/portfolio?address=${address}`),
          fetch(`${apiUrl}/protocol/params`),
        ]);
        const portfolio = (await portfolioRes.json()).data;
        const protocol = (await protocolRes.json()).data;

        const pos = portfolio?.positions?.[0];
        setState({
          lptBalance: 0n, // Can't get LPT balance without direct RPC
          stakedAmount: BigInt(portfolio?.totalStaked || '0'),
          pendingRewards: BigInt(portfolio?.totalPendingRewards || '0'),
          pendingFees: BigInt(portfolio?.totalPendingFees || '0'),
          delegatedTo: pos?.orchestrator || null,
          currentRound: BigInt(protocol?.currentRound || 0),
          lastClaimRound: BigInt(pos?.lastClaimRound || '0'),
          principal: BigInt(portfolio?.totalStaked || '0') - BigInt(portfolio?.totalPendingRewards || '0'),
          isLoading: false,
          error: null,
        });
      } catch (fallbackErr) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: 'Failed to fetch staking state. Please ensure MetaMask is on Arbitrum One.',
        }));
      }
    }
  }, [address, isConnected, getContracts]);

  // Stake LPT to an orchestrator
  const stake = useCallback(async (amount: string, orchestrator: string): Promise<string> => {
    if (!signer || !address) throw new Error('Wallet not connected');

    const contracts = getContracts();
    if (!contracts) throw new Error('Contracts not available');

    const { bondingManager, lptToken } = contracts;
    const amountWei = parseUnits(amount, 18);

    // Check allowance and approve if needed
    const allowance = await lptToken.allowance(address, await bondingManager.getAddress());
    if (allowance < amountWei) {
      const approveTx = await lptToken.approve(await bondingManager.getAddress(), amountWei);
      await approveTx.wait();
    }

    // Bond to orchestrator
    const tx = await bondingManager.bond(amountWei, orchestrator);
    const receipt = await tx.wait();

    // Refresh state
    await refreshStakingState();

    return receipt.hash;
  }, [signer, address, getContracts, refreshStakingState]);

  // Unstake LPT
  const unstake = useCallback(async (amount: string): Promise<string> => {
    if (!signer) throw new Error('Wallet not connected');

    const contracts = getContracts();
    if (!contracts) throw new Error('Contracts not available');

    const { bondingManager } = contracts;
    const amountWei = parseUnits(amount, 18);

    const tx = await bondingManager.unbond(amountWei);
    const receipt = await tx.wait();

    await refreshStakingState();

    return receipt.hash;
  }, [signer, getContracts, refreshStakingState]);

  // Claim rewards
  const claimRewards = useCallback(async (): Promise<string> => {
    if (!signer) throw new Error('Wallet not connected');

    const contracts = getContracts();
    if (!contracts) throw new Error('Contracts not available');

    const { bondingManager } = contracts;

    const tx = await bondingManager.claimEarnings(state.currentRound);
    const receipt = await tx.wait();

    await refreshStakingState();

    return receipt.hash;
  }, [signer, getContracts, state.currentRound, refreshStakingState]);

  // Withdraw fees
  const withdrawFees = useCallback(async (): Promise<string> => {
    if (!signer || !address) throw new Error('Wallet not connected');

    const contracts = getContracts();
    if (!contracts) throw new Error('Contracts not available');

    const { bondingManager } = contracts;

    const tx = await bondingManager.withdrawFees(address, state.pendingFees);
    const receipt = await tx.wait();

    await refreshStakingState();

    return receipt.hash;
  }, [signer, address, getContracts, state.pendingFees, refreshStakingState]);

  // Auto-refresh on wallet connection
  useEffect(() => {
    if (isConnected && address) {
      refreshStakingState();
    } else {
      setState(initialState);
    }
  }, [isConnected, address, chainId, refreshStakingState]);

  return {
    ...state,
    stake,
    unstake,
    claimRewards,
    withdrawFees,
    refreshStakingState,
  };
}
