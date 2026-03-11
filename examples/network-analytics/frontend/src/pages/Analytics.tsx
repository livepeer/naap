/**
 * Analytics Page (Phase 4e)
 *
 * Rewritten to use live protocol data from livepeer-svc via SDK hooks.
 * Replaces mockChartData with useProtocolParameters() and useOrchestrators().
 */

import React, { useState, useMemo } from 'react';
import { Download, RefreshCw, Loader2, AlertTriangle, Activity, TrendingUp, Layers, Clock } from 'lucide-react';
import { Card, Badge } from '@naap/ui';
import { useProtocolParameters, useCurrentRound, useOrchestrators } from '@naap/plugin-sdk';

function formatLPT(wei: string): string {
  try {
    const eth = parseFloat(wei) / 1e18;
    if (eth >= 1_000_000) return `${(eth / 1_000_000).toFixed(2)}M`;
    if (eth >= 1_000) return `${(eth / 1_000).toFixed(1)}K`;
    return eth.toFixed(2);
  } catch {
    return '0';
  }
}

function formatPercent(value: string, divisor = 1_000_000): string {
  try {
    return ((parseFloat(value) / divisor) * 100).toFixed(2) + '%';
  } catch {
    return '0%';
  }
}

export const AnalyticsPage: React.FC = () => {
  const { data: protocol, loading: protocolLoading, error: protocolError, refetch: refetchProtocol } = useProtocolParameters();
  const { data: round, loading: roundLoading } = useCurrentRound();
  const { data: orchestrators, loading: orchLoading } = useOrchestrators();

  const loading = protocolLoading || roundLoading || orchLoading;

  // Compute derived stats from orchestrators
  const orchStats = useMemo(() => {
    if (!orchestrators || orchestrators.length === 0) {
      return { total: 0, active: 0, avgRewardCut: '0', avgFeeShare: '0', totalStake: '0' };
    }
    const active = orchestrators.filter((o) => o.active);
    const totalStake = orchestrators.reduce((sum, o) => sum + parseFloat(o.delegatedStake || '0'), 0);
    const avgRewardCut = active.length > 0
      ? active.reduce((sum, o) => sum + parseFloat(o.rewardCut || '0'), 0) / active.length
      : 0;
    const avgFeeShare = active.length > 0
      ? active.reduce((sum, o) => sum + parseFloat(o.feeShare || '0'), 0) / active.length
      : 0;
    return {
      total: orchestrators.length,
      active: active.length,
      avgRewardCut: ((avgRewardCut / 1_000_000) * 100).toFixed(2),
      avgFeeShare: ((avgFeeShare / 1_000_000) * 100).toFixed(2),
      totalStake: totalStake.toString(),
    };
  }, [orchestrators]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-accent-blue" />
        <p className="text-text-secondary text-sm">Loading network data from Livepeer protocol...</p>
      </div>
    );
  }

  if (protocolError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-center px-8">
        <div className="w-16 h-16 rounded-full bg-accent-rose/10 flex items-center justify-center">
          <AlertTriangle size={32} className="text-accent-rose" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-text-primary mb-2">Failed to Load Protocol Data</h3>
          <p className="text-text-secondary text-sm max-w-md">{protocolError.message}</p>
        </div>
        <button onClick={() => refetchProtocol()} className="px-4 py-2 bg-accent-blue text-white rounded-lg flex items-center gap-2">
          <RefreshCw size={16} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-outfit font-bold text-text-primary">Network Analytics</h1>
          <p className="text-text-secondary mt-1">Live Livepeer protocol metrics</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => refetchProtocol()} className="p-3 bg-bg-secondary border border-white/10 rounded-xl hover:bg-bg-tertiary transition-all" title="Refresh">
            <RefreshCw size={18} className="text-text-secondary" />
          </button>
        </div>
      </div>

      {/* Protocol Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-2">
            <Activity size={16} className="text-accent-blue" />
            <p className="text-xs text-text-secondary">Current Round</p>
          </div>
          <p className="text-2xl font-mono font-bold text-text-primary">{protocol?.currentRound || round?.round || 'N/A'}</p>
          <p className="text-xs text-text-secondary mt-1">
            {round?.initialized ? 'Initialized' : 'Not initialized'}
          </p>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={16} className="text-accent-emerald" />
            <p className="text-xs text-text-secondary">Total Bonded</p>
          </div>
          <p className="text-2xl font-mono font-bold text-accent-emerald">{formatLPT(protocol?.totalBonded || '0')}</p>
          <p className="text-xs text-text-secondary mt-1">LPT staked in protocol</p>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-2">
            <Layers size={16} className="text-accent-amber" />
            <p className="text-xs text-text-secondary">Total Supply</p>
          </div>
          <p className="text-2xl font-mono font-bold text-accent-amber">{formatLPT(protocol?.totalSupply || '0')}</p>
          <p className="text-xs text-text-secondary mt-1">LPT total supply</p>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={16} className="text-purple-400" />
            <p className="text-xs text-text-secondary">Round Length</p>
          </div>
          <p className="text-2xl font-mono font-bold text-text-primary">{protocol?.roundLength || 'N/A'}</p>
          <p className="text-xs text-text-secondary mt-1">blocks per round</p>
        </div>
      </div>

      {/* Staking Economics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Protocol Parameters" subtitle="Current network configuration">
          <div className="space-y-3 mt-4">
            <div className="flex justify-between py-2 border-b border-white/5">
              <span className="text-text-secondary text-sm">Inflation Rate</span>
              <span className="font-mono text-text-primary">{formatPercent(protocol?.inflation || '0', 1_000_000_000)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-white/5">
              <span className="text-text-secondary text-sm">Inflation Change</span>
              <span className="font-mono text-text-primary">{formatPercent(protocol?.inflationChange || '0', 1_000_000_000)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-white/5">
              <span className="text-text-secondary text-sm">Target Bonding Rate</span>
              <span className="font-mono text-text-primary">{formatPercent(protocol?.targetBondingRate || '0', 1_000_000)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-white/5">
              <span className="text-text-secondary text-sm">Protocol Paused</span>
              <Badge variant={protocol?.paused ? 'rose' : 'emerald'}>{protocol?.paused ? 'Yes' : 'No'}</Badge>
            </div>
            <div className="flex justify-between py-2 border-b border-white/5">
              <span className="text-text-secondary text-sm">Last Initialized Round</span>
              <span className="font-mono text-text-primary">{protocol?.lastInitializedRound || 'N/A'}</span>
            </div>
          </div>
        </Card>

        <Card title="Orchestrator Pool" subtitle="Network participant statistics">
          <div className="space-y-3 mt-4">
            <div className="flex justify-between py-2 border-b border-white/5">
              <span className="text-text-secondary text-sm">Total Orchestrators</span>
              <span className="font-mono text-text-primary">{orchStats.total}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-white/5">
              <span className="text-text-secondary text-sm">Active Orchestrators</span>
              <span className="font-mono text-accent-emerald">{orchStats.active}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-white/5">
              <span className="text-text-secondary text-sm">Total Orchestrator Stake</span>
              <span className="font-mono text-text-primary">{formatLPT(orchStats.totalStake)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-white/5">
              <span className="text-text-secondary text-sm">Avg Reward Cut</span>
              <span className="font-mono text-text-primary">{orchStats.avgRewardCut}%</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-text-secondary text-sm">Avg Fee Share</span>
              <span className="font-mono text-text-primary">{orchStats.avgFeeShare}%</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Bonding Rate Analysis */}
      {protocol?.totalBonded && protocol?.totalSupply && (
        <Card title="Bonding Rate" subtitle="Current vs target bonding participation">
          <div className="mt-4">
            {(() => {
              const bonded = parseFloat(protocol.totalBonded) / 1e18;
              const supply = parseFloat(protocol.totalSupply) / 1e18;
              const currentRate = supply > 0 ? (bonded / supply) * 100 : 0;
              const targetRate = parseFloat(protocol.targetBondingRate || '500000') / 10_000; // Convert from parts per million
              return (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-text-secondary">Current Bonding Rate</span>
                    <span className="font-mono font-bold text-text-primary text-lg">{currentRate.toFixed(2)}%</span>
                  </div>
                  <div className="h-4 bg-bg-tertiary rounded-full overflow-hidden">
                    <div className="h-full bg-accent-emerald rounded-full relative" style={{ width: `${Math.min(currentRate, 100)}%` }}>
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-white rounded-full" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-text-secondary">
                    <span>0%</span>
                    <span className="text-accent-amber">Target: {targetRate.toFixed(1)}%</span>
                    <span>100%</span>
                  </div>
                  <p className="text-xs text-text-secondary">
                    {currentRate < targetRate
                      ? `Below target — inflation will increase to incentivize staking`
                      : `Above target — inflation will decrease`
                    }
                  </p>
                </div>
              );
            })()}
          </div>
        </Card>
      )}
    </div>
  );
};

export default AnalyticsPage;
