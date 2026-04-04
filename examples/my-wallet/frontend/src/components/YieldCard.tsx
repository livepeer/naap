/**
 * YieldCard - Period selector + yield stat cards
 */

import React from 'react';
import type { YieldPeriod } from '../hooks/useYield';

interface YieldCardProps {
  rewardYield: number;
  feeYield: number;
  combinedApy: number;
  dataPoints: number;
  period: YieldPeriod;
  onPeriodChange: (period: YieldPeriod) => void;
  isLoading: boolean;
}

const PERIODS: YieldPeriod[] = ['7d', '30d', '90d', 'ytd'];

export const YieldCard: React.FC<YieldCardProps> = ({
  rewardYield,
  feeYield,
  combinedApy,
  dataPoints,
  period,
  onPeriodChange,
  isLoading,
}) => {
  const formatYield = (val: number) => {
    if (val === 0 && dataPoints < 2) return '--';
    const sign = val >= 0 ? '+' : '';
    return `${sign}${val.toFixed(2)}%`;
  };

  const yieldColor = (val: number) =>
    val > 0 ? 'text-emerald-400' : val < 0 ? 'text-rose-400' : 'text-text-muted';

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-text-primary">Yield Performance</h3>
        <div className="flex gap-1" role="group" aria-label="Period selector">
          {PERIODS.map(p => (
            <button
              key={p}
              onClick={() => onPeriodChange(p)}
              className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                period === p
                  ? 'bg-purple-600 text-white'
                  : 'bg-white/5 text-text-muted hover:bg-white/10'
              }`}
              aria-pressed={period === p}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-white/5 rounded animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-white/5">
            <p className="text-xs text-text-muted mb-1">Reward Yield (APY)</p>
            <p className={`text-xl font-mono font-semibold ${yieldColor(rewardYield)}`}>
              {formatYield(rewardYield)}
            </p>
          </div>
          <div className="p-4 rounded-lg bg-white/5">
            <p className="text-xs text-text-muted mb-1">Fee Yield (APY)</p>
            <p className={`text-xl font-mono font-semibold ${yieldColor(feeYield)}`}>
              {formatYield(feeYield)}
            </p>
          </div>
          <div className="p-4 rounded-lg bg-white/5">
            <p className="text-xs text-text-muted mb-1">Combined APY</p>
            <p className={`text-xl font-mono font-semibold ${yieldColor(combinedApy)}`}>
              {formatYield(combinedApy)}
            </p>
          </div>
        </div>
      )}

      {dataPoints < 2 && !isLoading && (
        <p className="text-xs text-text-muted mt-3">
          Insufficient data. Yield calculation requires at least 2 snapshots.
        </p>
      )}
    </div>
  );
};
