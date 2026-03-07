/**
 * NetworkBenchmarks - Collapsible panel showing network-level stats
 */

import React, { useState } from 'react';

interface NetworkBenchmarksProps {
  avgRewardCut: number;
  avgFeeShare: number;
  medianRewardCut: number;
  activeOrchestratorCount: number;
  totalDelegatorStake: string;
  userAvgRewardCut?: number;
  isLoading: boolean;
}

export const NetworkBenchmarks: React.FC<NetworkBenchmarksProps> = ({
  avgRewardCut,
  avgFeeShare,
  medianRewardCut: _medianRewardCut,
  activeOrchestratorCount,
  totalDelegatorStake,
  userAvgRewardCut,
  isLoading,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const formatStake = (stake: string) => {
    const val = parseFloat(stake) / 1e18;
    if (val >= 1e6) return `${(val / 1e6).toFixed(2)}M LPT`;
    if (val >= 1e3) return `${(val / 1e3).toFixed(1)}K LPT`;
    return `${val.toFixed(2)} LPT`;
  };

  return (
    <div className="glass-card overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <span className="text-sm font-semibold text-text-primary">Network Benchmarks</span>
        </div>
        <svg
          className={`w-4 h-4 text-text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
        <div className="p-4 pt-0 border-t border-white/5">
          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-14 bg-white/5 rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
              <BenchmarkStat
                label="Avg Reward Cut"
                value={`${(avgRewardCut / 10000).toFixed(2)}%`}
                comparison={userAvgRewardCut !== undefined
                  ? (userAvgRewardCut < avgRewardCut ? 'better' : userAvgRewardCut > avgRewardCut ? 'worse' : 'equal')
                  : undefined
                }
              />
              <BenchmarkStat label="Avg Fee Share" value={`${(avgFeeShare / 10000).toFixed(2)}%`} />
              <BenchmarkStat label="Active Orchestrators" value={String(activeOrchestratorCount)} />
              <BenchmarkStat label="Total Delegated" value={formatStake(totalDelegatorStake)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const BenchmarkStat: React.FC<{
  label: string;
  value: string;
  comparison?: 'better' | 'worse' | 'equal';
}> = ({ label, value, comparison }) => (
  <div className="p-3 rounded-lg bg-white/5">
    <p className="text-[10px] uppercase tracking-wide text-text-muted mb-1">{label}</p>
    <p className="text-sm font-mono font-semibold text-text-primary">{value}</p>
    {comparison && (
      <p className={`text-[10px] mt-1 ${
        comparison === 'better' ? 'text-emerald-400' : comparison === 'worse' ? 'text-rose-400' : 'text-text-muted'
      }`}>
        {comparison === 'better' ? 'Below avg (good)' : comparison === 'worse' ? 'Above avg' : 'At avg'}
      </p>
    )}
  </div>
);
