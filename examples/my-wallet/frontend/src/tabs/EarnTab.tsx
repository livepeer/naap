/**
 * Earn Tab — real on-chain staking state
 *
 * Multi-wallet support:
 * - Aggregated view across all permitted MetaMask accounts
 * - Drill-down per wallet
 * - Auto-refreshes on account switch
 *
 * Data sources:
 * - useStaking (via MetaMask provider) for active wallet
 * - Backend API for additional wallets (no signer needed, read-only)
 * - usePrices for USD conversion
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Gift, Clock, ChevronRight, ChevronDown, Plus, TrendingUp, TrendingDown, ExternalLink, RefreshCw, Wallet, Calculator } from 'lucide-react';
import { formatUnits } from 'ethers';
import { useWallet } from '../context/WalletContext';
import { useStakingOps } from '../hooks/useStakingOps';
import { usePrices, usePriceChart } from '../hooks/usePrices';
import { useUnbondingLocks } from '../hooks/useUnbondingLocks';
import { useOrchestratorCache } from '../hooks/useOrchestratorCache';
import { formatAddress } from '../lib/utils';
import { getApiUrl } from '../App';
import type { TabId } from '../components/AppLayout';

interface EarnTabProps {
  onNavigate: (tab: TabId) => void;
}

interface WalletStakingData {
  address: string;
  stakedAmount: bigint;      // Total staked including accumulated rewards
  pendingRewards: bigint;    // Accumulated rewards only
  pendingFees: bigint;
  lptBalance: bigint;
  delegatedTo: string | null;
  currentRound: bigint;
  lastClaimRound: bigint;    // Round when earnings were last claimed
  principal: bigint;         // Original bonded amount
  dailyRewardEstimate: number; // Backend-computed daily reward estimate (LPT)
  isLoading: boolean;
  error: string | null;
}

function fmtLpt(wei: bigint): string {
  const val = parseFloat(formatUnits(wei, 18));
  if (val === 0) return '0';
  if (val < 0.01) return '<0.01';
  if (val < 100) return val.toFixed(2);
  return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtEth(wei: bigint): string {
  const val = parseFloat(formatUnits(wei, 18));
  if (val === 0) return '0';
  if (val < 0.0001) return '<0.0001';
  return val.toFixed(4);
}

function weiToUsd(wei: bigint, pricePerToken: number): number {
  return parseFloat(formatUnits(wei, 18)) * pricePerToken;
}

function fmtUsd(usd: number): string {
  if (usd < 0.01) return '$0.00';
  return '$' + usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Fetch staking data for a non-active wallet via backend API */
async function fetchWalletDataFromAPI(addr: string): Promise<WalletStakingData> {
  try {
    const apiUrl = getApiUrl();
    const [portfolioRes, protocolRes] = await Promise.all([
      fetch(`${apiUrl}/portfolio?address=${addr}`),
      fetch(`${apiUrl}/protocol/params`),
    ]);
    const portfolio = (await portfolioRes.json()).data;
    const protocol = (await protocolRes.json()).data;
    const pos = portfolio?.positions?.[0];
    const totalStaked = BigInt(portfolio?.totalStaked || '0');
    const totalPendingRewards = BigInt(portfolio?.totalPendingRewards || '0');

    return {
      address: addr,
      stakedAmount: totalStaked,
      pendingRewards: totalPendingRewards,
      pendingFees: BigInt(portfolio?.totalPendingFees || '0'),
      lptBalance: 0n,
      delegatedTo: pos?.orchestrator || null,
      currentRound: BigInt(protocol?.currentRound || 0),
      lastClaimRound: BigInt(pos?.lastClaimRound || '0'),
      principal: totalStaked - totalPendingRewards,
      dailyRewardEstimate: portfolio?.dailyRewardEstimate || 0,
      isLoading: false,
      error: null,
    };
  } catch (err: any) {
    return {
      address: addr,
      stakedAmount: 0n, pendingRewards: 0n, pendingFees: 0n, lptBalance: 0n,
      delegatedTo: null, currentRound: 0n, lastClaimRound: 0n, principal: 0n,
      dailyRewardEstimate: 0, isLoading: false, error: err?.message,
    };
  }
}

export const EarnTab: React.FC<EarnTabProps> = ({ onNavigate }) => {
  const { address, accounts, switchAccount } = useWallet();
  const staking = useStakingOps();
  const prices = usePrices();
  const { locks } = useUnbondingLocks();
  const { orchestrators: cachedOrchestrators } = useOrchestratorCache();
  const [claimingAddr, setClaimingAddr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedWallet, setExpandedWallet] = useState<string | null>(null);

  // Multi-wallet staking data (non-active wallets fetched from API)
  const [otherWallets, setOtherWallets] = useState<WalletStakingData[]>([]);

  // Fetch daily reward estimate for active wallet from backend
  const [activeDailyReward, setActiveDailyReward] = useState(0);
  useEffect(() => {
    if (!address) return;
    const apiUrl = getApiUrl();
    fetch(`${apiUrl}/portfolio?address=${address}`)
      .then(r => r.json())
      .then(json => setActiveDailyReward(json.data?.dailyRewardEstimate || 0))
      .catch(() => {});
  }, [address]);

  // Active wallet data (from useStaking hook which uses MetaMask provider)
  const activeData: WalletStakingData = {
    address: address || '',
    stakedAmount: staking.stakedAmount,
    pendingRewards: staking.pendingRewards,
    pendingFees: staking.pendingFees,
    lptBalance: staking.lptBalance,
    delegatedTo: staking.delegatedTo,
    currentRound: staking.currentRound,
    lastClaimRound: staking.lastClaimRound,
    principal: staking.principal,
    dailyRewardEstimate: activeDailyReward,
    isLoading: staking.isLoading,
    error: staking.error,
  };

  // Fetch data for other wallets when accounts change
  useEffect(() => {
    const others = accounts.filter(a => a.toLowerCase() !== address?.toLowerCase());
    if (others.length === 0) {
      setOtherWallets([]);
      return;
    }
    let cancelled = false;
    Promise.all(others.map(fetchWalletDataFromAPI)).then(results => {
      if (!cancelled) setOtherWallets(results);
    });
    return () => { cancelled = true; };
  }, [accounts, address]);

  // All wallets: active first, then others (deduplicated by address)
  const allWallets = useMemo(() => {
    const seen = new Set<string>();
    const result: WalletStakingData[] = [];
    for (const w of [activeData, ...otherWallets]) {
      const key = w.address.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(w);
    }
    return result;
  }, [activeData, otherWallets]);
  const hasMultipleWallets = accounts.length > 1;

  // Aggregated totals
  const totalStaked = allWallets.reduce((s, w) => s + w.stakedAmount, 0n);
  const totalRewards = allWallets.reduce((s, w) => s + w.pendingRewards, 0n);
  const totalFees = allWallets.reduce((s, w) => s + w.pendingFees, 0n);
  const totalBalance = allWallets.reduce((s, w) => s + w.lptBalance, 0n);

  const totalStakedUsd = weiToUsd(totalStaked, prices.lptUsd);
  const totalRewardsUsd = weiToUsd(totalRewards, prices.lptUsd);
  const totalFeesUsd = weiToUsd(totalFees, prices.ethUsd);
  const totalBalanceUsd = weiToUsd(totalBalance, prices.lptUsd);
  // stakedAmount already includes pendingRewards (it's pendingStake), so don't add rewards again
  const totalValueUsd = totalStakedUsd + totalFeesUsd + totalBalanceUsd;

  const hasPendingRewards = staking.pendingRewards > 0n;
  const withdrawableLocks = locks.filter(l => l.status === 'withdrawable');

  const handleClaim = async () => {
    setClaimingAddr(address);
    try { await staking.claimRewards(); } catch (err) { console.error('Claim failed:', err); }
    finally { setClaimingAddr(null); }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await staking.refreshStakingState();
      await prices.refresh();
      // Re-fetch other wallets
      const others = accounts.filter(a => a.toLowerCase() !== address?.toLowerCase());
      if (others.length > 0) {
        const results = await Promise.all(others.map(fetchWalletDataFromAPI));
        setOtherWallets(results);
      }
    } finally { setRefreshing(false); }
  };

  const handleSwitchTo = useCallback(async (addr: string) => {
    try {
      await switchAccount(addr);
    } catch (err) {
      console.error('Failed to switch account:', err);
    }
  }, [switchAccount]);

  if (staking.isLoading && otherWallets.length === 0) {
    return (
      <div className="space-y-4">
        <div className="glass-card p-6 animate-pulse">
          <div className="h-5 bg-[var(--bg-tertiary)] rounded w-32 mb-3" />
          <div className="h-8 bg-[var(--bg-tertiary)] rounded w-48 mb-2" />
          <div className="h-4 bg-[var(--bg-tertiary)] rounded w-24" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Hero: Aggregated Portfolio */}
      <div className="glass-card p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-xs text-text-secondary mb-1">
              {hasMultipleWallets ? `Total Value (${accounts.length} wallets)` : 'Total Value'}
            </p>
            <p className="text-2xl font-bold font-mono text-text-primary">
              {totalValueUsd > 0 ? fmtUsd(totalValueUsd) : fmtLpt(totalStaked + totalBalance) + ' LPT'}
            </p>
          </div>
          <button
            onClick={handleRefresh}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
            title="Refresh all wallets"
          >
            <RefreshCw className={`w-4 h-4 text-text-tertiary ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Aggregated Stats */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Total Staked" lpt={fmtLpt(totalStaked)} usd={fmtUsd(totalStakedUsd)} color="text-accent-emerald" />
          <StatCard label="LPT Balance" lpt={fmtLpt(totalBalance)} usd={fmtUsd(totalBalanceUsd)} color="text-text-primary" />
          <StatCard label="Pending Rewards" lpt={fmtLpt(totalRewards)} usd={fmtUsd(totalRewardsUsd)} color="text-accent-emerald" />
          <StatCard label="Pending Fees" eth={fmtEth(totalFees)} usd={fmtUsd(totalFeesUsd)} color="text-accent-blue" />
        </div>
      </div>

      {/* Per-Wallet Breakdown */}
      <div>
        <h3 className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide mb-2">
          {hasMultipleWallets ? 'Wallets' : 'Wallet'}
        </h3>

        <div className="space-y-2">
          {allWallets.map((w, i) => {
            const isActive = w.address.toLowerCase() === address?.toLowerCase();
            const isExpanded = expandedWallet === w.address;
            const wStakedUsd = weiToUsd(w.stakedAmount, prices.lptUsd);
            const wRewardsUsd = weiToUsd(w.pendingRewards, prices.lptUsd);
            const wFeesUsd = weiToUsd(w.pendingFees, prices.ethUsd);

            return (
              <div key={w.address} className="glass-card overflow-hidden">
                {/* Wallet Header — click to expand */}
                <button
                  onClick={() => setExpandedWallet(isExpanded ? null : w.address)}
                  className="w-full p-3 flex items-center justify-between hover:bg-[var(--bg-tertiary)]/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      isActive ? 'bg-accent-emerald/10' : 'bg-[var(--bg-tertiary)]'
                    }`}>
                      <Wallet className={`w-4 h-4 ${isActive ? 'text-accent-emerald' : 'text-text-tertiary'}`} />
                    </div>
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-mono text-text-primary">{formatAddress(w.address, 6)}</p>
                        {isActive && (
                          <span className="text-[9px] bg-accent-emerald/10 text-accent-emerald px-1.5 py-0.5 rounded">active</span>
                        )}
                      </div>
                      <p className="text-[11px] text-text-tertiary">
                        {w.stakedAmount > 0n
                          ? `${fmtLpt(w.stakedAmount)} LPT staked${wStakedUsd > 0 ? ` · ${fmtUsd(wStakedUsd)}` : ''}`
                          : 'No active stake'}
                      </p>
                    </div>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-text-tertiary transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </button>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="px-3 pb-3 pt-1 border-t border-[var(--border-color)]">
                    {/* Delegation */}
                    {w.delegatedTo ? (
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="text-[10px] text-text-tertiary uppercase">Delegated to</p>
                          <p className="text-xs font-mono text-text-primary">{formatAddress(w.delegatedTo, 8)}</p>
                        </div>
                        <a
                          href={`https://explorer.livepeer.org/accounts/${w.delegatedTo}/orchestrating`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 rounded hover:bg-[var(--bg-tertiary)]"
                        >
                          <ExternalLink className="w-3 h-3 text-text-tertiary" />
                        </a>
                      </div>
                    ) : (
                      <p className="text-[11px] text-text-tertiary mb-3">Not delegated to any orchestrator</p>
                    )}

                    {/* Per-wallet stats */}
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <MiniStat label="Staked" value={fmtLpt(w.stakedAmount)} sub={fmtUsd(wStakedUsd)} color="text-accent-emerald" />
                      <MiniStat label="Rewards" value={fmtLpt(w.pendingRewards)} sub={fmtUsd(wRewardsUsd)} color="text-accent-emerald" />
                      <MiniStat label="Fees" value={fmtEth(w.pendingFees)} sub={fmtUsd(wFeesUsd)} color="text-accent-blue" />
                    </div>

                    {w.error && (
                      <p className="text-[10px] text-accent-rose mb-2">{w.error}</p>
                    )}

                    {/* Actions for this wallet */}
                    <div className="flex gap-2">
                      {!isActive && (
                        <button
                          onClick={() => handleSwitchTo(w.address)}
                          className="px-3 py-1.5 text-[11px] font-medium rounded-lg bg-[var(--bg-tertiary)] text-text-primary hover:bg-[var(--bg-tertiary)]/80 transition-colors"
                        >
                          Switch to this wallet
                        </button>
                      )}
                      <a
                        href={`https://explorer.livepeer.org/accounts/${w.address}/delegating`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 text-[11px] font-medium rounded-lg bg-[var(--bg-tertiary)] text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1"
                      >
                        Explorer <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pending Actions (for active wallet only) */}
      {(hasPendingRewards || withdrawableLocks.length > 0) && (
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Actions</h3>

          {hasPendingRewards && (
            <div className="glass-card p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-accent-emerald/10 flex items-center justify-center">
                  <Gift className="w-4 h-4 text-accent-emerald" />
                </div>
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    {fmtLpt(staking.pendingRewards)} LPT rewards
                  </p>
                  {weiToUsd(staking.pendingRewards, prices.lptUsd) > 0 && (
                    <p className="text-[11px] text-text-tertiary">{fmtUsd(weiToUsd(staking.pendingRewards, prices.lptUsd))}</p>
                  )}
                </div>
              </div>
              <button
                onClick={handleClaim}
                disabled={claimingAddr !== null}
                className="px-3 py-1.5 bg-accent-emerald text-white text-xs font-medium rounded-lg hover:bg-accent-emerald/90 disabled:opacity-50 transition-colors"
              >
                {claimingAddr ? 'Claiming...' : 'Claim'}
              </button>
            </div>
          )}

          {withdrawableLocks.map(lock => (
            <div key={lock.id} className="glass-card p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-accent-amber/10 flex items-center justify-center">
                  <Clock className="w-4 h-4 text-accent-amber" />
                </div>
                <div>
                  <p className="text-sm font-medium text-text-primary">Unbonding complete</p>
                  <p className="text-[11px] text-text-tertiary">{lock.amount} LPT ready</p>
                </div>
              </div>
              <button
                onClick={() => staking.withdrawStake(lock.lockId)}
                className="px-3 py-1.5 bg-accent-amber text-white text-xs font-medium rounded-lg hover:bg-accent-amber/90 transition-colors"
              >
                Withdraw
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Projected Earnings */}
      {totalStaked > 0n && (
        <ProjectedEarnings
          allWallets={allWallets}
          cachedOrchestrators={cachedOrchestrators}
          lptUsd={prices.lptUsd}
          ethUsd={prices.ethUsd}
        />
      )}

      {/* No Stake CTA */}
      {totalStaked === 0n && (
        <div className="glass-card p-5 text-center">
          <div className="w-10 h-10 mx-auto mb-2 rounded-lg bg-accent-emerald/10 flex items-center justify-center">
            <Plus className="w-5 h-5 text-accent-emerald" />
          </div>
          <p className="text-sm font-medium text-text-primary mb-1">Start earning</p>
          <p className="text-[11px] text-text-secondary mb-3">Stake LPT to an orchestrator to earn rewards</p>
          <button
            onClick={() => onNavigate('explore')}
            className="px-5 py-2 bg-accent-emerald text-white text-xs font-medium rounded-lg hover:bg-accent-emerald/90 transition-colors"
          >
            Explore Orchestrators
          </button>
        </div>
      )}

      {/* Price Widget */}
      <PriceWidget prices={prices} />

      {/* Quick Navigate */}
      {totalStaked > 0n && (
        <button
          onClick={() => onNavigate('explore')}
          className="w-full glass-card p-3 flex items-center justify-between hover:border-accent-emerald/30 transition-colors"
        >
          <span className="text-xs text-text-secondary">Compare orchestrators & optimize your stake</span>
          <ChevronRight className="w-4 h-4 text-text-tertiary" />
        </button>
      )}
    </div>
  );
};

const StatCard: React.FC<{
  label: string; lpt?: string; eth?: string; usd: string; color: string;
}> = ({ label, lpt, eth, usd, color }) => (
  <div className="glass-card p-3">
    <p className="text-[10px] text-text-tertiary mb-1">{label}</p>
    <p className={`text-sm font-mono font-semibold ${color}`}>
      {lpt != null ? `${lpt} LPT` : `${eth} ETH`}
    </p>
    <p className="text-[10px] text-text-tertiary font-mono">{usd}</p>
  </div>
);

const MiniStat: React.FC<{
  label: string; value: string; sub: string; color: string;
}> = ({ label, value, sub, color }) => (
  <div>
    <p className="text-[9px] text-text-tertiary">{label}</p>
    <p className={`text-xs font-mono font-semibold ${color}`}>{value}</p>
    <p className="text-[9px] text-text-tertiary font-mono">{sub}</p>
  </div>
);

/** Projected Earnings — monthly, quarterly, yearly based on observed reward rate */
const ProjectedEarnings: React.FC<{
  allWallets: WalletStakingData[];
  cachedOrchestrators: Array<{ address: string; rewardCut: number; feeShare: number }>;
  lptUsd: number;
  ethUsd: number;
}> = ({ allWallets, cachedOrchestrators, lptUsd, ethUsd }) => {
  const projections = useMemo(() => {
    let totalDailyRewardsLpt = 0;
    let totalAnnualFeesEth = 0;
    let hasObservedRate = false;

    // First pass: compute observed per-LPT daily yield from wallets with data
    let observedYieldPerLpt = 0;
    let observedStakeForYield = 0;
    for (const w of allWallets) {
      const stakedLpt = parseFloat(formatUnits(w.stakedAmount, 18));
      const accumulatedRewards = parseFloat(formatUnits(w.pendingRewards, 18));
      const roundsElapsed = Number(w.currentRound) - Number(w.lastClaimRound);
      if (accumulatedRewards > 0 && roundsElapsed > 0 && stakedLpt > 0) {
        const dailyReward = accumulatedRewards / roundsElapsed;
        // Use average stake (midpoint between principal and current) for yield calc
        const avgStake = (stakedLpt + parseFloat(formatUnits(w.principal, 18))) / 2;
        if (avgStake > 0) {
          observedYieldPerLpt += dailyReward;
          observedStakeForYield += avgStake;
        }
      }
    }
    const perLptDailyYield = observedStakeForYield > 0 ? observedYieldPerLpt / observedStakeForYield : 0;

    for (const w of allWallets) {
      const stakedLpt = parseFloat(formatUnits(w.stakedAmount, 18));
      if (stakedLpt <= 0) continue;

      const accumulatedRewards = parseFloat(formatUnits(w.pendingRewards, 18));
      const currentRound = Number(w.currentRound);
      const lastClaimRound = Number(w.lastClaimRound);
      const roundsElapsed = currentRound - lastClaimRound;

      if (accumulatedRewards > 0 && roundsElapsed > 0) {
        // Observed daily reward rate (1 round ≈ 1 day on Livepeer Arbitrum)
        const dailyReward = accumulatedRewards / roundsElapsed;
        totalDailyRewardsLpt += dailyReward;
        hasObservedRate = true;
      } else if (w.dailyRewardEstimate > 0) {
        // Backend-computed estimate (uses orchestrator pool data and network inflation)
        totalDailyRewardsLpt += w.dailyRewardEstimate;
        hasObservedRate = true;
      } else if (stakedLpt > 0 && perLptDailyYield > 0) {
        // Fallback: per-LPT yield from other wallets
        totalDailyRewardsLpt += stakedLpt * perLptDailyYield;
        hasObservedRate = true;
      }

      // Fee projection from pending fees over elapsed rounds
      const pendingFeesEth = parseFloat(formatUnits(w.pendingFees, 18));
      if (pendingFeesEth > 0) {
        if (roundsElapsed > 0) {
          totalAnnualFeesEth += (pendingFeesEth / roundsElapsed) * 365;
        } else {
          totalAnnualFeesEth += pendingFeesEth * 12;
        }
      }
    }

    const monthly = {
      rewardsLpt: totalDailyRewardsLpt * 30,
      feesEth: totalAnnualFeesEth / 12,
    };
    const quarterly = {
      rewardsLpt: totalDailyRewardsLpt * 91,
      feesEth: totalAnnualFeesEth / 4,
    };
    const yearly = {
      rewardsLpt: totalDailyRewardsLpt * 365,
      feesEth: totalAnnualFeesEth,
    };

    return { monthly, quarterly, yearly, dailyRate: totalDailyRewardsLpt, hasObservedRate };
  }, [allWallets, cachedOrchestrators]);

  const fmtNum = (n: number, dec = 2) => {
    if (n < 0.01) return '< 0.01';
    return n.toLocaleString(undefined, { maximumFractionDigits: dec });
  };

  const toUsd = (lpt: number, eth: number) => {
    return lpt * lptUsd + eth * ethUsd;
  };

  const periods = [
    { label: 'Monthly', data: projections.monthly },
    { label: 'Quarterly', data: projections.quarterly },
    { label: 'Yearly', data: projections.yearly },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Calculator className="w-3.5 h-3.5 text-accent-emerald" />
        <h3 className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">
          Projected Earnings
        </h3>
      </div>
      <div className="glass-card p-4">
        {projections.dailyRate > 0 && (
          <div className="text-center mb-3 pb-3 border-b border-[var(--border-color)]">
            <p className="text-[10px] text-text-tertiary mb-0.5">Daily Rate</p>
            <p className="text-lg font-bold font-mono text-accent-emerald">
              {fmtNum(projections.dailyRate)} <span className="text-xs font-normal text-text-tertiary">LPT/day</span>
            </p>
            {lptUsd > 0 && (
              <p className="text-[11px] font-mono text-text-tertiary">
                {fmtUsd(projections.dailyRate * lptUsd)}/day
              </p>
            )}
          </div>
        )}
        <div className="grid grid-cols-3 gap-3">
          {periods.map(({ label, data }) => {
            const totalUsd = toUsd(data.rewardsLpt, data.feesEth);
            return (
              <div key={label} className="text-center">
                <p className="text-[10px] text-text-tertiary mb-1">{label}</p>
                <p className="text-sm font-bold font-mono text-accent-emerald">
                  {fmtNum(data.rewardsLpt)} <span className="text-[10px] font-normal text-text-tertiary">LPT</span>
                </p>
                {data.feesEth > 0.0001 && (
                  <p className="text-[11px] font-mono text-accent-blue mt-0.5">
                    + {fmtNum(data.feesEth, 4)} <span className="text-[10px] text-text-tertiary">ETH</span>
                  </p>
                )}
                {lptUsd > 0 && (
                  <p className="text-[10px] font-mono text-text-tertiary mt-1">
                    {fmtUsd(totalUsd)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[9px] text-text-tertiary text-center mt-3">
          {projections.hasObservedRate
            ? 'Based on actual observed reward rate from on-chain data (accumulated rewards / rounds elapsed).'
            : 'Estimated from network inflation rate. Connect wallet for accurate projections.'}
        </p>
      </div>
    </div>
  );
};

/** LPT Price widget with sparkline */
const PriceWidget: React.FC<{ prices: ReturnType<typeof usePrices> }> = ({ prices }) => {
  const [chartDays, setChartDays] = useState(7);
  const { points } = usePriceChart(chartDays);

  if (prices.lptUsd <= 0) return null;

  const change24h = prices.lptChange24h;
  const isUp = change24h >= 0;
  const ChangeIcon = isUp ? TrendingUp : TrendingDown;

  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-accent-emerald/10 flex items-center justify-center">
            <span className="text-[10px] font-bold text-accent-emerald">LPT</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-text-primary font-mono">${prices.lptUsd.toFixed(2)}</p>
            <div className="flex items-center gap-1">
              <ChangeIcon className={`w-3 h-3 ${isUp ? 'text-accent-emerald' : 'text-accent-rose'}`} />
              <span className={`text-[11px] font-mono ${isUp ? 'text-accent-emerald' : 'text-accent-rose'}`}>
                {isUp ? '+' : ''}{change24h.toFixed(2)}% 24h
              </span>
            </div>
          </div>
        </div>
        <div className="text-right text-[10px] text-text-tertiary">
          <p>MCap ${(prices.lptMarketCap / 1e6).toFixed(1)}M</p>
          <p>Vol ${(prices.lptVolume24h / 1e6).toFixed(2)}M</p>
        </div>
      </div>

      {points.length > 2 && (
        <div className="h-14 mb-2">
          <Sparkline points={points} isUp={isUp} />
        </div>
      )}

      <div className="flex gap-1 justify-center">
        {[7, 30, 90].map(d => (
          <button
            key={d}
            onClick={() => setChartDays(d)}
            className={`px-2 py-0.5 text-[10px] rounded ${
              chartDays === d
                ? 'bg-[var(--bg-tertiary)] text-text-primary'
                : 'text-text-tertiary hover:text-text-secondary'
            }`}
          >
            {d}d
          </button>
        ))}
      </div>
    </div>
  );
};

const Sparkline: React.FC<{ points: Array<{ timestamp: number; price: number }>; isUp: boolean }> = ({ points, isUp }) => {
  if (points.length < 2) return null;

  const priceValues = points.map(p => p.price);
  const min = Math.min(...priceValues);
  const max = Math.max(...priceValues);
  const range = max - min || 1;
  const width = 400;
  const height = 56;
  const pad = 2;

  const pathPoints = points.map((p, i) => {
    const x = pad + (i / (points.length - 1)) * (width - pad * 2);
    const y = height - pad - ((p.price - min) / range) * (height - pad * 2);
    return `${x},${y}`;
  });

  const linePath = `M${pathPoints.join(' L')}`;
  const areaPath = `${linePath} L${width - pad},${height} L${pad},${height} Z`;
  const color = isUp ? 'var(--accent-emerald)' : 'var(--accent-rose)';

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.12" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#sparkGrad)" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
};
