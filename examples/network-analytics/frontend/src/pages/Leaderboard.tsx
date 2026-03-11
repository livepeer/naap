/**
 * Leaderboard Page (Phase 4e)
 *
 * Rewritten to use live orchestrator data from livepeer-svc.
 * Replaces mockLeaderboard with useOrchestrators() hook,
 * sorted by delegated stake.
 */

import React from 'react';
import { Trophy, Medal, Star, TrendingUp, Cpu, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { Card, Badge } from '@naap/ui';
import { useOrchestrators } from '@naap/plugin-sdk';

function shortenAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

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

const RankBadge: React.FC<{ rank: number }> = ({ rank }) => {
  if (rank === 1) return <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-yellow-400 to-amber-500 flex items-center justify-center"><Trophy size={20} className="text-white" /></div>;
  if (rank === 2) return <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-gray-300 to-gray-400 flex items-center justify-center"><Medal size={20} className="text-white" /></div>;
  if (rank === 3) return <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-600 to-orange-700 flex items-center justify-center"><Star size={20} className="text-white" /></div>;
  return <div className="w-10 h-10 rounded-xl bg-bg-tertiary flex items-center justify-center font-mono font-bold text-text-secondary">{rank}</div>;
};

export const LeaderboardPage: React.FC = () => {
  const { data: orchestrators, loading, error, refetch } = useOrchestrators();

  // Sort by delegated stake (descending)
  const ranked = [...(orchestrators || [])]
    .sort((a, b) => parseFloat(b.delegatedStake || '0') - parseFloat(a.delegatedStake || '0'))
    .slice(0, 25);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-accent-blue" />
        <p className="text-text-secondary text-sm">Loading leaderboard from Livepeer network...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-center px-8">
        <div className="w-16 h-16 rounded-full bg-accent-rose/10 flex items-center justify-center">
          <AlertTriangle size={32} className="text-accent-rose" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-text-primary mb-2">Failed to Load Leaderboard</h3>
          <p className="text-text-secondary text-sm max-w-md">{error.message}</p>
        </div>
        <button onClick={() => refetch()} className="px-4 py-2 bg-accent-blue text-white rounded-lg flex items-center gap-2">
          <RefreshCw size={16} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-outfit font-bold text-text-primary">Leaderboard</h1>
          <p className="text-text-secondary mt-1">Top orchestrators by delegated stake</p>
        </div>
        <button onClick={() => refetch()} className="p-3 bg-bg-secondary border border-white/10 rounded-xl hover:bg-bg-tertiary transition-all" title="Refresh">
          <RefreshCw size={18} className="text-text-secondary" />
        </button>
      </div>

      <Card>
        <div className="space-y-2">
          {/* Header */}
          <div className="grid grid-cols-12 gap-4 px-4 py-3 text-xs font-bold text-text-secondary uppercase tracking-wider border-b border-white/5">
            <div className="col-span-1">Rank</div>
            <div className="col-span-4">Orchestrator</div>
            <div className="col-span-2 text-right">Stake</div>
            <div className="col-span-2 text-right">Reward Cut</div>
            <div className="col-span-2 text-right">Fee Share</div>
            <div className="col-span-1 text-right">Status</div>
          </div>

          {/* Rows */}
          {ranked.map((orch, index) => (
            <div key={orch.address} className="grid grid-cols-12 gap-4 px-4 py-4 rounded-xl hover:bg-bg-tertiary/50 transition-all cursor-pointer items-center">
              <div className="col-span-1"><RankBadge rank={index + 1} /></div>
              <div className="col-span-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-accent-blue to-purple-500 flex items-center justify-center">
                  <Cpu size={18} className="text-white" />
                </div>
                <div>
                  <p className="font-bold font-mono text-sm text-text-primary">{shortenAddress(orch.address)}</p>
                  <p className="text-xs text-text-secondary truncate max-w-[200px]">{orch.serviceURI || 'No URI'}</p>
                </div>
              </div>
              <div className="col-span-2 text-right font-mono font-bold text-accent-emerald">{formatLPT(orch.delegatedStake || '0')}</div>
              <div className="col-span-2 text-right font-mono text-text-primary">{((parseFloat(orch.rewardCut || '0') / 1_000_000) * 100).toFixed(1)}%</div>
              <div className="col-span-2 text-right font-mono text-text-primary">{((parseFloat(orch.feeShare || '0') / 1_000_000) * 100).toFixed(1)}%</div>
              <div className="col-span-1 text-right">
                <Badge variant={orch.active ? 'emerald' : 'amber'}>{orch.active ? 'Active' : 'Inactive'}</Badge>
              </div>
            </div>
          ))}

          {ranked.length === 0 && (
            <div className="text-center py-12 text-text-secondary">
              No orchestrators found on the network
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export default LeaderboardPage;
