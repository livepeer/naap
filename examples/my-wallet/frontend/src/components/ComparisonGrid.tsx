/**
 * ComparisonGrid - 1-4 side-by-side orchestrator cards
 */

import React from 'react';

interface OrchestratorData {
  address: string;
  name: string | null;
  rewardCut: number;
  feeShare: number;
  totalStake: string;
  isActive: boolean;
}

interface ComparisonGridProps {
  orchestrators: OrchestratorData[];
  onRemove: (address: string) => void;
  isLoading: boolean;
}

export const ComparisonGrid: React.FC<ComparisonGridProps> = ({
  orchestrators,
  onRemove,
  isLoading,
}) => {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2].map(i => (
          <div key={i} className="glass-card p-4 h-48 animate-pulse bg-white/5 rounded-xl" />
        ))}
      </div>
    );
  }

  if (orchestrators.length === 0) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="text-text-muted">Add orchestrators to compare them side-by-side</p>
      </div>
    );
  }

  const formatStake = (stake: string) => {
    const val = parseFloat(stake) / 1e18;
    if (val >= 1e6) return `${(val / 1e6).toFixed(2)}M`;
    if (val >= 1e3) return `${(val / 1e3).toFixed(1)}K`;
    return val.toFixed(2);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {orchestrators.map(o => (
        <div key={o.address} className="glass-card p-4 relative">
          <button
            onClick={() => onRemove(o.address)}
            className="absolute top-2 right-2 text-text-muted hover:text-rose-400 transition-colors"
            aria-label={`Remove ${o.name || o.address}`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="mb-3">
            <h4 className="text-sm font-semibold text-text-primary truncate" title={o.name || o.address}>
              {o.name || 'Unknown'}
            </h4>
            <p className="text-xs font-mono text-text-muted">
              {o.address.slice(0, 8)}...{o.address.slice(-6)}
            </p>
          </div>

          <div className="space-y-3">
            <MetricRow label="Reward Cut" value={`${(o.rewardCut / 10000).toFixed(2)}%`} />
            <MetricRow label="Fee Share" value={`${(o.feeShare / 10000).toFixed(2)}%`} />
            <MetricRow label="Total Stake" value={`${formatStake(o.totalStake)} LPT`} />
            <MetricRow
              label="Status"
              value={o.isActive ? 'Active' : 'Inactive'}
              valueClass={o.isActive ? 'text-emerald-400' : 'text-rose-400'}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

const MetricRow: React.FC<{ label: string; value: string; valueClass?: string }> = ({
  label, value, valueClass = 'text-text-primary',
}) => (
  <div className="flex justify-between items-center">
    <span className="text-xs text-text-muted">{label}</span>
    <span className={`text-sm font-mono font-medium ${valueClass}`}>{value}</span>
  </div>
);
