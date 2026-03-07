/**
 * Portfolio Page - Main view replacing Dashboard
 * Shows wallet selector, portfolio summary, yield, positions, unbonding,
 * alerts, benchmarks, and export controls
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { useWalletAddresses } from '../hooks/useWalletAddresses';
import { usePortfolio } from '../hooks/usePortfolio';
import { useUnbondingLocks } from '../hooks/useUnbondingLocks';
import { useProtocolParams } from '../hooks/useProtocolParams';
import { useYield } from '../hooks/useYield';
import { usePrices } from '../hooks/usePrices';
import { useAlerts } from '../hooks/useAlerts';
import { useBenchmarks } from '../hooks/useBenchmarks';
import { useExport } from '../hooks/useExport';
import { PageHeader } from '../components/PageHeader';
import { WalletSelector } from '../components/WalletSelector';
import { PortfolioSummary } from '../components/PortfolioSummary';
import { PositionsTable } from '../components/PositionsTable';
import { UnbondingPanel } from '../components/UnbondingPanel';
import { AddWalletModal } from '../components/AddWalletModal';
import { YieldCard } from '../components/YieldCard';
import { AlertsPanel } from '../components/AlertsPanel';
import { AlertConfigModal } from '../components/AlertConfigModal';
import { NetworkBenchmarks } from '../components/NetworkBenchmarks';
import { ExportButton } from '../components/ExportButton';
import { useStakingOps } from '../hooks/useStakingOps';

export const PortfolioPage: React.FC = () => {
  const navigate = useNavigate();
  const { isConnected } = useWallet();
  const { addresses, addAddress } = useWalletAddresses();
  const { portfolio, isLoading: portfolioLoading, refresh: refreshPortfolio } = usePortfolio();
  const { locks, isLoading: locksLoading } = useUnbondingLocks();
  const { params } = useProtocolParams();
  const { withdrawStake, rebond } = useStakingOps();
  const yieldData = useYield();
  const prices = usePrices();
  const alerts = useAlerts();
  const benchmarks = useBenchmarks();
  const { exportCSV, exportJSON, isExporting } = useExport();

  const [selectedAddressId, setSelectedAddressId] = useState<string>();
  const [showAddWallet, setShowAddWallet] = useState(false);
  const [showAlertConfig, setShowAlertConfig] = useState(false);

  React.useEffect(() => {
    if (!isConnected) navigate('/');
  }, [isConnected, navigate]);

  const handleWithdraw = async (lockId: number) => {
    try {
      await withdrawStake(lockId);
      refreshPortfolio();
    } catch (err) {
      console.error('Withdraw failed:', err);
    }
  };

  const handleRebond = async (lockId: number) => {
    try {
      await rebond(lockId);
      refreshPortfolio();
    } catch (err) {
      console.error('Rebond failed:', err);
    }
  };

  const positions = portfolio
    ? addresses.map(addr => ({
        walletAddressId: addr.id,
        address: addr.address,
        label: addr.label,
        chainId: addr.chainId,
        orchestrator: null,
        stakedAmount: '0',
        pendingRewards: '0',
        pendingFees: '0',
        startRound: null,
      }))
    : [];

  // Calculate USD portfolio value
  const totalStakedNum = parseFloat(portfolio?.totalStaked || '0') / 1e18;
  const portfolioValueUsd = prices.lptUsd > 0 ? totalStakedNum * prices.lptUsd : 0;

  return (
    <div className="space-y-6">
      {/* Header with wallet selector and alerts */}
      <div className="flex items-center justify-between">
        <PageHeader
          title="Portfolio"
          subtitle="Manage your LPT staking portfolio"
        />
        <div className="flex items-center gap-3">
          <AlertsPanel
            history={alerts.history}
            unreadCount={alerts.unreadCount}
            onMarkRead={alerts.markRead}
            onConfigure={() => setShowAlertConfig(true)}
            isLoading={alerts.isLoading}
          />
          <WalletSelector
            addresses={addresses}
            selectedId={selectedAddressId}
            onSelect={setSelectedAddressId}
            onAddWallet={() => setShowAddWallet(true)}
          />
        </div>
      </div>

      {/* Portfolio summary with USD value */}
      <PortfolioSummary
        totalStaked={portfolio?.totalStaked || '0'}
        totalPendingRewards={portfolio?.totalPendingRewards || '0'}
        totalPendingFees={portfolio?.totalPendingFees || '0'}
        addressCount={portfolio?.addressCount || 0}
        isLoading={portfolioLoading}
      />

      {/* USD overlay */}
      {prices.lptUsd > 0 && (
        <div className="flex items-center gap-4 px-1">
          <span className="text-xs text-text-muted">
            LPT ${prices.lptUsd.toFixed(2)} | ETH ${prices.ethUsd.toFixed(2)}
          </span>
          {portfolioValueUsd > 0 && (
            <span className="text-xs font-mono text-purple-400">
              Portfolio: ${portfolioValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          )}
        </div>
      )}

      {/* Yield performance */}
      <YieldCard
        rewardYield={yieldData.rewardYield}
        feeYield={yieldData.feeYield}
        combinedApy={yieldData.combinedApy}
        dataPoints={yieldData.dataPoints}
        period={yieldData.period}
        onPeriodChange={yieldData.setPeriod}
        isLoading={yieldData.isLoading}
      />

      {/* Positions table with export */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-secondary">Positions</h3>
          <div className="flex items-center gap-3">
            <ExportButton
              onExportCSV={() => exportCSV('positions')}
              onExportJSON={() => exportJSON('positions')}
              isExporting={isExporting}
              label="Export Positions"
            />
            <button
              onClick={() => navigate('/compare')}
              className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
            >
              Compare Os
            </button>
          </div>
        </div>
        <PositionsTable
          positions={positions}
          isLoading={portfolioLoading}
          onSelectPosition={() => navigate('/staking')}
        />
      </div>

      {/* Leaderboard export */}
      <div className="flex items-center justify-between glass-card p-4">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Orchestrator Leaderboard</h3>
          <p className="text-xs text-text-muted">Export the full orchestrator leaderboard for analysis</p>
        </div>
        <ExportButton
          onExportCSV={() => exportCSV('leaderboard')}
          onExportJSON={() => exportJSON('leaderboard')}
          isExporting={isExporting}
          label="Export Leaderboard"
        />
      </div>

      {/* Network benchmarks */}
      <NetworkBenchmarks
        avgRewardCut={benchmarks.avgRewardCut}
        avgFeeShare={benchmarks.avgFeeShare}
        medianRewardCut={benchmarks.medianRewardCut}
        activeOrchestratorCount={benchmarks.activeOrchestratorCount}
        totalDelegatorStake={benchmarks.totalDelegatorStake}
        isLoading={benchmarks.isLoading}
      />

      {/* Unbonding panel */}
      <UnbondingPanel
        locks={locks.map(l => ({
          id: l.id,
          lockId: l.lockId,
          amount: l.amount,
          withdrawRound: l.withdrawRound,
          status: l.status,
          walletAddress: l.walletAddress,
        }))}
        currentRound={params?.currentRound || 0}
        roundLength={params?.roundLength || 5760}
        isLoading={locksLoading}
        onWithdraw={handleWithdraw}
        onRebond={handleRebond}
      />

      {/* Modals */}
      <AddWalletModal
        isOpen={showAddWallet}
        onClose={() => setShowAddWallet(false)}
        onAdd={async (address, chainId, label) => {
          await addAddress(address, chainId, label);
          refreshPortfolio();
        }}
      />

      <AlertConfigModal
        isOpen={showAlertConfig}
        onClose={() => setShowAlertConfig(false)}
        onCreate={alerts.create}
        existingAlerts={alerts.alerts}
        onToggle={(id, enabled) => alerts.update(id, { enabled })}
        onDelete={alerts.remove}
      />
    </div>
  );
};
