/**
 * Explore Tab - Discovery: find where to earn
 *
 * AI Recommendations (hero)
 * Orchestrator Search + Compare
 * Watchlist
 * Risk scores on every orchestrator card
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Search, Star, Sparkles } from 'lucide-react';
import { useWallet } from '../context/WalletContext';
import { useAiRecommend } from '../hooks/useAiRecommend';
import { useWatchlist } from '../hooks/useWatchlist';
import { formatAddress, formatBalance } from '../lib/utils';
import { getApiUrl } from '../App';

interface OrchestratorOption {
  address: string;
  name: string | null;
  rewardCut: number;
  feeShare: number;
  totalStake: string;
  isActive: boolean;
}

type SubView = 'recommended' | 'browse' | 'watchlist';

export const ExploreTab: React.FC = () => {
  const { isConnected } = useWallet();
  const aiRecommend = useAiRecommend();
  const watchlist = useWatchlist();
  const [subView, setSubView] = useState<SubView>('recommended');
  const [allOrchestrators, setAllOrchestrators] = useState<OrchestratorOption[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [risk, setRisk] = useState<'conservative' | 'moderate' | 'aggressive'>('moderate');

  // Fetch orchestrators list
  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch(`${getApiUrl()}/staking/orchestrators?activeOnly=true`);
      const json = await res.json();
      const data = json.data ?? json;
      setAllOrchestrators(data.orchestrators || []);
    } catch (err) {
      console.error('Failed to fetch orchestrators:', err);
    }
  }, []);

  useEffect(() => { if (isConnected) fetchAll(); }, [isConnected, fetchAll]);

  // Auto-fetch recommendations on mount
  useEffect(() => {
    if (isConnected && aiRecommend.recommendations.length === 0) {
      aiRecommend.fetchRecommendations(risk, 'medium', true);
    }
  }, [isConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = allOrchestrators.filter(o =>
    o.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    o.address.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="flex gap-1 bg-[var(--bg-tertiary)] p-1 rounded-lg w-fit">
        {([
          { id: 'recommended' as SubView, label: 'Recommended' },
          { id: 'browse' as SubView, label: 'Browse All' },
          { id: 'watchlist' as SubView, label: `Watchlist (${watchlist.items.length})` },
        ]).map(s => (
          <button
            key={s.id}
            onClick={() => setSubView(s.id)}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
              subView === s.id
                ? 'bg-[var(--bg-primary)] text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Recommended View */}
      {subView === 'recommended' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-accent-purple" />
              <h2 className="text-sm font-semibold text-text-primary">AI-Picked Orchestrators</h2>
            </div>
            <div className="flex gap-1">
              {(['conservative', 'moderate', 'aggressive'] as const).map(r => (
                <button
                  key={r}
                  onClick={() => {
                    setRisk(r);
                    aiRecommend.fetchRecommendations(r, 'medium', true);
                  }}
                  className={`px-2.5 py-1 text-[10px] rounded-full capitalize ${
                    risk === r
                      ? 'bg-accent-purple text-white'
                      : 'bg-[var(--bg-tertiary)] text-text-secondary'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {aiRecommend.isLoading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="glass-card p-4 h-24 animate-pulse" />)}
            </div>
          ) : aiRecommend.recommendations.length === 0 ? (
            <div className="glass-card p-8 text-center">
              <Sparkles className="w-8 h-8 text-text-tertiary mx-auto mb-2" />
              <p className="text-sm text-text-secondary">Click a risk profile to get recommendations</p>
            </div>
          ) : (
            <div className="space-y-3">
              {aiRecommend.recommendations.map((rec, i) => (
                <OrchestratorCard
                  key={rec.address}
                  rank={i + 1}
                  address={rec.address}
                  name={rec.name}
                  rewardCut={rec.rewardCut}
                  feeShare={rec.feeShare}
                  totalStake={rec.totalStake}
                  score={rec.score}
                  reasons={rec.reasons}
                  isWatched={watchlist.items.some(w => w.orchestratorAddr === rec.address)}
                  onWatch={() => watchlist.add(rec.address, rec.name || undefined)}
                  onUnwatch={() => {
                    const item = watchlist.items.find(w => w.orchestratorAddr === rec.address);
                    if (item) watchlist.remove(item.id);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Browse All View */}
      {subView === 'browse' && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-tertiary" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by name or address..."
              className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-text-primary text-sm placeholder:text-text-tertiary focus:outline-none focus:border-accent-purple"
            />
          </div>

          <div className="space-y-2">
            {(searchQuery ? filtered : allOrchestrators).slice(0, 20).map(o => (
              <OrchestratorCard
                key={o.address}
                address={o.address}
                name={o.name}
                rewardCut={o.rewardCut}
                feeShare={o.feeShare}
                totalStake={o.totalStake}
                isActive={o.isActive}
                isWatched={watchlist.items.some(w => w.orchestratorAddr === o.address)}
                onWatch={() => watchlist.add(o.address, o.name || undefined)}
                onUnwatch={() => {
                  const item = watchlist.items.find(w => w.orchestratorAddr === o.address);
                  if (item) watchlist.remove(item.id);
                }}
              />
            ))}

            {allOrchestrators.length === 0 && (
              <div className="glass-card p-8 text-center text-text-tertiary text-sm">
                Loading orchestrators...
              </div>
            )}
          </div>
        </div>
      )}

      {/* Watchlist View */}
      {subView === 'watchlist' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4 text-accent-amber" />
            <h2 className="text-sm font-semibold text-text-primary">Your Watchlist</h2>
          </div>

          {watchlist.items.length === 0 ? (
            <div className="glass-card p-8 text-center">
              <Star className="w-8 h-8 text-text-tertiary mx-auto mb-2" />
              <p className="text-sm text-text-secondary mb-1">Watchlist is empty</p>
              <p className="text-xs text-text-tertiary">Browse orchestrators and add candidates you want to monitor</p>
              <button
                onClick={() => setSubView('browse')}
                className="mt-3 text-xs text-accent-purple hover:underline"
              >
                Browse All
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {watchlist.items.map(item => (
                <OrchestratorCard
                  key={item.id}
                  address={item.orchestratorAddr}
                  name={item.orchestrator?.name || item.label}
                  rewardCut={item.orchestrator?.rewardCut ?? 0}
                  feeShare={item.orchestrator?.feeShare ?? 0}
                  totalStake={item.orchestrator?.totalStake ?? '0'}
                  isActive={item.orchestrator?.isActive}
                  isWatched={true}
                  onUnwatch={() => watchlist.remove(item.id)}
                  notes={item.notes}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** Unified orchestrator card used across all sub-views */
const OrchestratorCard: React.FC<{
  rank?: number;
  address: string;
  name: string | null;
  rewardCut: number;
  feeShare: number;
  totalStake: string;
  score?: number;
  reasons?: string[];
  isActive?: boolean;
  isWatched?: boolean;
  onWatch?: () => void;
  onUnwatch?: () => void;
  notes?: string | null;
}> = ({ rank, address, name, rewardCut, feeShare, totalStake, score, reasons, isActive, isWatched, onWatch, onUnwatch, notes }) => {
  const delegatorYield = (12 * (100 - rewardCut) / 100).toFixed(1);

  return (
    <div className="glass-card p-4 hover:border-accent-purple/30 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {rank && (
            <div className="w-7 h-7 rounded-full bg-accent-purple/15 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-accent-purple">#{rank}</span>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-text-primary truncate">
                {name || formatAddress(address)}
              </p>
              {isActive === false && (
                <span className="text-[10px] bg-accent-rose/15 text-accent-rose px-1.5 py-0.5 rounded">Inactive</span>
              )}
              {score !== undefined && (
                <span className="text-[10px] font-mono bg-accent-emerald/15 text-accent-emerald px-1.5 py-0.5 rounded">
                  {score}/100
                </span>
              )}
            </div>
            <p className="text-[11px] font-mono text-text-tertiary">{formatAddress(address, 6)}</p>
          </div>
        </div>

        {/* Est. APY hero number */}
        <div className="text-right flex-shrink-0 ml-3">
          <p className="text-lg font-bold font-mono text-accent-emerald">~{delegatorYield}%</p>
          <p className="text-[10px] text-text-tertiary">Est. APY</p>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 mt-3 text-[11px] text-text-secondary">
        <span>Cut: <span className="font-mono text-text-primary">{rewardCut}%</span></span>
        <span>Fee: <span className="font-mono text-text-primary">{feeShare}%</span></span>
        <span>Stake: <span className="font-mono text-text-primary">{formatBalance(totalStake)}</span> LPT</span>
      </div>

      {/* Reasons (from AI) */}
      {reasons && reasons.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {reasons.map((r, j) => (
            <span key={j} className="text-[10px] bg-accent-purple/10 text-accent-purple px-1.5 py-0.5 rounded">
              {r}
            </span>
          ))}
        </div>
      )}

      {notes && (
        <p className="text-[11px] text-text-tertiary mt-2 italic">{notes}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--border-color)]">
        {isWatched ? (
          <button onClick={onUnwatch} className="text-[11px] text-accent-amber hover:underline flex items-center gap-1">
            <Star className="w-3 h-3 fill-current" /> Watching
          </button>
        ) : (
          <button onClick={onWatch} className="text-[11px] text-text-secondary hover:text-accent-amber flex items-center gap-1">
            <Star className="w-3 h-3" /> Watch
          </button>
        )}
        <span className="text-[var(--border-color)]">|</span>
        <button className="text-[11px] text-accent-purple hover:underline">
          Stake
        </button>
      </div>
    </div>
  );
};
