/**
 * Staking Page - Stake/unstake LPT
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, ArrowDown, ArrowUp, Gift, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { useWallet } from '../context/WalletContext';
import { useStaking } from '../hooks/useStaking';
import { usePermissions } from '../hooks/usePermissions';
import { AccessDenied } from '../components/RequirePermission';
import { PageHeader } from '../components/PageHeader';
import { formatBalance, formatAddress } from '../lib/utils';

type StakeMode = 'stake' | 'unstake' | 'claim';

export const StakingPage: React.FC = () => {
  const navigate = useNavigate();
  const { address, isConnected } = useWallet();
  const { canStake } = usePermissions();
  const {
    lptBalance,
    stakedAmount,
    pendingRewards,
    pendingFees,
    delegatedTo,
    currentRound,
    error,
    stake,
    unstake,
    claimRewards,
  } = useStaking();

  const [mode, setMode] = useState<StakeMode>('stake');
  const [amount, setAmount] = useState('');
  const [orchestrator, setOrchestrator] = useState('');
  const [txPending, setTxPending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  if (!isConnected || !address) {
    return (
      <div className="text-center py-12">
        <p className="text-text-secondary">Please connect your wallet first</p>
        <button
          onClick={() => navigate('/')}
          className="mt-4 px-6 py-2 bg-accent-purple text-white rounded-lg font-medium"
        >
          Connect Wallet
        </button>
      </div>
    );
  }

  // RBAC: Check if user can stake
  if (!canStake) {
    return <AccessDenied permission="wallet:stake" message="You need staking permissions to access this page." />;
  }

  const handleStake = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      setTxError('Please enter a valid amount');
      return;
    }
    if (!orchestrator) {
      setTxError('Please enter an orchestrator address');
      return;
    }

    setTxPending(true);
    setTxError(null);
    setTxHash(null);

    try {
      const hash = await stake(amount, orchestrator);
      setTxHash(hash);
      setAmount('');
    } catch (err: any) {
      setTxError(err?.message || 'Transaction failed');
    } finally {
      setTxPending(false);
    }
  };

  const handleUnstake = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      setTxError('Please enter a valid amount');
      return;
    }

    setTxPending(true);
    setTxError(null);
    setTxHash(null);

    try {
      const hash = await unstake(amount);
      setTxHash(hash);
      setAmount('');
    } catch (err: any) {
      setTxError(err?.message || 'Transaction failed');
    } finally {
      setTxPending(false);
    }
  };

  const handleClaimRewards = async () => {
    setTxPending(true);
    setTxError(null);
    setTxHash(null);

    try {
      const hash = await claimRewards();
      setTxHash(hash);
    } catch (err: any) {
      setTxError(err?.message || 'Transaction failed');
    } finally {
      setTxPending(false);
    }
  };

  const maxAmount = mode === 'stake' ? lptBalance : stakedAmount;

  return (
    <div className="space-y-6">
      {/* Header with Back Navigation */}
      <PageHeader
        title="Staking"
        subtitle="Stake LPT to earn rewards"
        actions={
          <div className="text-right">
            <p className="text-sm text-text-secondary">Current Round</p>
            <p className="font-semibold text-accent-purple">{currentRound.toString()}</p>
          </div>
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="Available LPT"
          value={formatBalance(lptBalance)}
          subtitle="In wallet"
          icon={<TrendingUp className="w-5 h-5" />}
        />
        <StatCard
          title="Staked LPT"
          value={formatBalance(stakedAmount)}
          subtitle={delegatedTo ? `To ${formatAddress(delegatedTo, 4)}` : 'Not delegated'}
          icon={<ArrowUp className="w-5 h-5" />}
          accent
        />
        <StatCard
          title="Pending Rewards"
          value={formatBalance(pendingRewards)}
          subtitle="LPT"
          icon={<Gift className="w-5 h-5" />}
          accent
        />
        <StatCard
          title="Pending Fees"
          value={formatBalance(pendingFees)}
          subtitle="ETH"
          icon={<Gift className="w-5 h-5" />}
        />
      </div>

      {/* Staking Form */}
      <div className="glass-card p-6">
        {/* Mode Tabs */}
        <div className="flex gap-2 mb-6">
          {(['stake', 'unstake', 'claim'] as StakeMode[]).map(m => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setTxError(null);
                setTxHash(null);
              }}
              className={`px-4 py-2 rounded-lg font-medium capitalize transition-colors ${
                mode === m
                  ? 'bg-accent-purple text-white'
                  : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
              }`}
            >
              {m === 'claim' ? 'Claim Rewards' : m}
            </button>
          ))}
        </div>

        {/* Form Content */}
        {mode === 'claim' ? (
          <div className="space-y-4">
            <div className="p-4 bg-bg-tertiary rounded-lg">
              <p className="text-text-secondary mb-2">You will claim:</p>
              <p className="text-2xl font-bold text-accent-emerald">
                {formatBalance(pendingRewards)} LPT
              </p>
              {pendingFees > 0n && (
                <p className="text-lg text-accent-blue mt-1">
                  + {formatBalance(pendingFees)} ETH fees
                </p>
              )}
            </div>

            <button
              onClick={handleClaimRewards}
              disabled={txPending || pendingRewards === 0n}
              className="w-full py-3 bg-accent-emerald text-white rounded-lg font-semibold hover:bg-accent-emerald/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {txPending ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Gift className="w-5 h-5" />
                  Claim Rewards
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Amount Input */}
            <div>
              <label className="block text-sm text-text-secondary mb-2">Amount (LPT)</label>
              <div className="relative">
                <input
                  type="number"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.0"
                  className="w-full p-3 bg-bg-tertiary border border-white/10 rounded-lg text-text-primary text-lg focus:outline-none focus:border-accent-purple"
                />
                <button
                  onClick={() => setAmount(formatBalance(maxAmount, 18, 18))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-accent-purple hover:underline"
                >
                  MAX
                </button>
              </div>
              <p className="text-xs text-text-secondary mt-1">
                Available: {formatBalance(maxAmount)} LPT
              </p>
            </div>

            {/* Orchestrator Input (for staking) */}
            {mode === 'stake' && (
              <div>
                <label className="block text-sm text-text-secondary mb-2">Orchestrator Address</label>
                <input
                  type="text"
                  value={orchestrator}
                  onChange={e => setOrchestrator(e.target.value)}
                  placeholder="0x..."
                  className="w-full p-3 bg-bg-tertiary border border-white/10 rounded-lg text-text-primary font-mono focus:outline-none focus:border-accent-purple"
                />
                <p className="text-xs text-text-secondary mt-1">
                  The orchestrator address you want to delegate your stake to
                </p>
              </div>
            )}

            {/* Action Button */}
            <button
              onClick={mode === 'stake' ? handleStake : handleUnstake}
              disabled={txPending || !amount}
              className={`w-full py-3 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
                mode === 'stake'
                  ? 'bg-accent-emerald text-white hover:bg-accent-emerald/90'
                  : 'bg-accent-amber text-white hover:bg-accent-amber/90'
              }`}
            >
              {txPending ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processing...
                </>
              ) : mode === 'stake' ? (
                <>
                  <ArrowUp className="w-5 h-5" />
                  Stake LPT
                </>
              ) : (
                <>
                  <ArrowDown className="w-5 h-5" />
                  Unstake LPT
                </>
              )}
            </button>
          </div>
        )}

        {/* Transaction Status */}
        {txHash && (
          <div className="mt-4 p-4 bg-accent-emerald/10 border border-accent-emerald/30 rounded-lg flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-accent-emerald flex-shrink-0" />
            <div>
              <p className="text-accent-emerald font-medium">Transaction Submitted</p>
              <p className="text-sm text-text-secondary font-mono">{formatAddress(txHash, 12)}</p>
            </div>
          </div>
        )}

        {txError && (
          <div className="mt-4 p-4 bg-accent-rose/10 border border-accent-rose/30 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-accent-rose flex-shrink-0" />
            <p className="text-accent-rose">{txError}</p>
          </div>
        )}

        {error && (
          <div className="mt-4 p-4 bg-accent-amber/10 border border-accent-amber/30 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-accent-amber flex-shrink-0" />
            <p className="text-accent-amber">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
};

// Stat Card Component
interface StatCardProps {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  accent?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, subtitle, icon, accent }) => (
  <div className={`glass-card p-4 ${accent ? 'border-accent-purple/30' : ''}`}>
    <div className="flex items-center justify-between mb-2">
      <span className="text-sm text-text-secondary">{title}</span>
      <span className={accent ? 'text-accent-purple' : 'text-text-secondary'}>{icon}</span>
    </div>
    <p className="text-xl font-bold text-text-primary">{value}</p>
    <p className="text-xs text-text-secondary">{subtitle}</p>
  </div>
);
