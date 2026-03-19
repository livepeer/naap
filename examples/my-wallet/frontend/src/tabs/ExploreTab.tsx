/**
 * Explore Tab - Discovery: find where to earn
 *
 * Sub-views: Overview | Recommended | Browse All | Watchlist
 * Enhanced with capabilities, fees, rewards, change alerts, and date-range filter.
 */

import React, { useState, useMemo } from 'react';
import { Search, Star, Sparkles, ArrowUpDown, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { useWallet } from '../context/WalletContext';
import { useAiRecommend } from '../hooks/useAiRecommend';
import { useWatchlist } from '../hooks/useWatchlist';
import { useOrchestratorCache } from '../hooks/useOrchestratorCache';
import { useStaking } from '../hooks/useStaking';
import { useEnhancedOrchestrators, EnhancedOrchestrator } from '../hooks/useEnhancedOrchestrators';
import { useOrchestratorChanges, OrchestratorChange } from '../hooks/useOrchestratorChanges';
import { formatAddress, formatBalance } from '../lib/utils';
import { NetworkOverview } from '../components/NetworkOverview';
import { CapabilityBadgeList } from '../components/CapabilityBadge';
import { DateRangeFilter } from '../components/DateRangeFilter';

type SubView = 'overview' | 'recommended' | 'browse' | 'watchlist';
type SortField = 'rewardCut' | 'feeShare' | 'totalStake';
type SortDir = 'asc' | 'desc';

const PAGE_SIZES = [10, 20, 50, 100];

function formatEth(wei: string): string {
  const n = parseFloat(wei) / 1e18;
  if (n === 0) return '0';
  if (n < 0.001) return '<0.001';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toFixed(3);
}

function formatLpt(wei: string): string {
  const n = parseFloat(wei) / 1e18;
  if (n === 0) return '0';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toFixed(1);
}

export const ExploreTab: React.FC = () => {
  const { isConnected } = useWallet();
  const aiRecommend = useAiRecommend();
  const watchlist = useWatchlist();
  const { orchestrators, isLoading: orchLoading, total: orchTotal, lastFetched } = useOrchestratorCache();
  const { stake } = useStaking();

  const [subView, setSubView] = useState<SubView>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [risk, setRisk] = useState<'conservative' | 'moderate' | 'aggressive'>('moderate');
  const [sortField, setSortField] = useState<SortField>('totalStake');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [stakingAddr, setStakingAddr] = useState<string | null>(null);
  const [stakeAmount, setStakeAmount] = useState('');
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date } | null>(null);

  // Enhanced orchestrator data (from DB with capabilities)
  const { orchestrators: enhanced } = useEnhancedOrchestrators(
    dateRange?.from.getTime(),
    dateRange?.to.getTime(),
  );

  // Create a lookup map for enhanced data
  const enhancedMap = useMemo(() => {
    const map = new Map<string, EnhancedOrchestrator>();
    for (const o of enhanced) map.set(o.address.toLowerCase(), o);
    return map;
  }, [enhanced]);

  // Watchlist change alerts
  const watchedAddresses = useMemo(() => watchlist.items.map((i) => i.orchestratorAddr), [watchlist.items]);
  const { changes } = useOrchestratorChanges(watchedAddresses);
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('dismissed-alerts');
      return new Set(stored ? JSON.parse(stored) : []);
    } catch { return new Set(); }
  });

  const activeChanges = useMemo(
    () => changes.filter((c) => !dismissedAlerts.has(`${c.address}-${c.round}-${c.field}`)),
    [changes, dismissedAlerts],
  );

  const dismissAlert = (change: OrchestratorChange) => {
    const key = `${change.address}-${change.round}-${change.field}`;
    setDismissedAlerts((prev) => {
      const next = new Set(prev);
      next.add(key);
      localStorage.setItem('dismissed-alerts', JSON.stringify([...next]));
      return next;
    });
  };

  // Auto-fetch recommendations on mount
  React.useEffect(() => {
    if (isConnected && aiRecommend.recommendations.length === 0) {
      aiRecommend.fetchRecommendations(risk, 'medium', true);
    }
  }, [isConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filtered + sorted list (deduplicated by address)
  const processedList = useMemo(() => {
    const seen = new Set<string>();
    let list = orchestrators.filter((o) => {
      const key = o.address.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (o) => o.name?.toLowerCase().includes(q) || o.address.toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'totalStake') {
        cmp = parseFloat(b.totalStake || '0') - parseFloat(a.totalStake || '0');
      } else if (sortField === 'rewardCut') {
        cmp = a.rewardCut - b.rewardCut;
      } else {
        cmp = a.feeShare - b.feeShare;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [orchestrators, searchQuery, sortField, sortDir]);

  const totalPages = Math.ceil(processedList.length / pageSize);
  const pagedList = processedList.slice(page * pageSize, (page + 1) * pageSize);

  React.useEffect(() => { setPage(0); }, [searchQuery, sortField, sortDir, pageSize]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'totalStake' ? 'desc' : 'asc');
    }
  };

  const handleStake = async (addr: string) => {
    if (stakingAddr === addr && stakeAmount) {
      try {
        await stake(stakeAmount, addr);
        setStakingAddr(null);
        setStakeAmount('');
      } catch (err: any) {
        console.error('Stake failed:', err);
      }
    } else {
      setStakingAddr(addr);
      setStakeAmount('');
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="flex gap-1 bg-[var(--bg-tertiary)] p-1 rounded-lg w-fit">
        {([
          { id: 'overview' as SubView, label: 'Overview' },
          { id: 'recommended' as SubView, label: 'Recommended' },
          { id: 'browse' as SubView, label: `Browse All (${orchTotal})` },
          { id: 'watchlist' as SubView, label: `Watchlist (${watchlist.items.length})` },
        ]).map((s) => (
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

      {/* Overview View */}
      {subView === 'overview' && <NetworkOverview />}

      {/* Recommended View */}
      {subView === 'recommended' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-accent-emerald" />
              <h2 className="text-sm font-semibold text-text-primary">AI-Picked Orchestrators</h2>
            </div>
            <div className="flex gap-1">
              {(['conservative', 'moderate', 'aggressive'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    setRisk(r);
                    aiRecommend.fetchRecommendations(r, 'medium', true);
                  }}
                  className={`px-2.5 py-1 text-[10px] rounded-full capitalize ${
                    risk === r
                      ? 'bg-accent-emerald text-white'
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
              {[1, 2, 3].map((i) => <div key={i} className="glass-card p-4 h-24 animate-pulse" />)}
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
                  enhanced={enhancedMap.get(rec.address.toLowerCase())}
                  isWatched={watchlist.isWatched(rec.address)}
                  onWatch={() => watchlist.add(rec.address, rec.name || undefined)}
                  onUnwatch={() => { const it = watchlist.getItem(rec.address); if (it) watchlist.remove(it.id); }}
                  stakingAddr={stakingAddr}
                  stakeAmount={stakeAmount}
                  onStakeAmountChange={setStakeAmount}
                  onStake={handleStake}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Browse All View */}
      {subView === 'browse' && (
        <div className="space-y-4">
          {/* Date range filter */}
          <DateRangeFilter onChange={(r) => setDateRange(r)} />

          {/* Search + Sort controls */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-tertiary" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name or address..."
                className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-text-primary text-sm placeholder:text-text-tertiary focus:outline-none focus:border-accent-emerald"
              />
            </div>
            <div className="flex gap-1">
              {([
                { field: 'totalStake' as SortField, label: 'Stake' },
                { field: 'rewardCut' as SortField, label: 'Reward Cut' },
                { field: 'feeShare' as SortField, label: 'Fee Share' },
              ]).map((s) => (
                <button
                  key={s.field}
                  onClick={() => toggleSort(s.field)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded-lg transition-colors ${
                    sortField === s.field
                      ? 'bg-accent-emerald/15 text-accent-emerald'
                      : 'bg-[var(--bg-tertiary)] text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <ArrowUpDown className="w-3 h-3" />
                  {s.label}
                  {sortField === s.field && (
                    <span className="text-[9px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-text-tertiary">
            <span>{processedList.length} orchestrator{processedList.length !== 1 ? 's' : ''}{searchQuery ? ' found' : ' total'}</span>
            {lastFetched && <span>Updated {lastFetched.toLocaleTimeString()}</span>}
          </div>

          {orchLoading && orchestrators.length === 0 ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => <div key={i} className="glass-card p-4 h-24 animate-pulse" />)}
            </div>
          ) : (
            <div className="space-y-2">
              {pagedList.map((o) => (
                <OrchestratorCard
                  key={o.address}
                  address={o.address}
                  name={o.name}
                  rewardCut={o.rewardCut}
                  feeShare={o.feeShare}
                  totalStake={o.totalStake}
                  isActive={o.isActive}
                  enhanced={enhancedMap.get(o.address.toLowerCase())}
                  isWatched={watchlist.isWatched(o.address)}
                  onWatch={() => watchlist.add(o.address, o.name || undefined)}
                  onUnwatch={() => { const it = watchlist.getItem(o.address); if (it) watchlist.remove(it.id); }}
                  stakingAddr={stakingAddr}
                  stakeAmount={stakeAmount}
                  onStakeAmountChange={setStakeAmount}
                  onStake={handleStake}
                />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-text-tertiary">Per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="text-[11px] bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-1.5 py-1 text-text-primary"
                >
                  {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="p-1 rounded hover:bg-[var(--bg-tertiary)] disabled:opacity-30 text-text-secondary">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[11px] text-text-secondary">{page + 1} / {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="p-1 rounded hover:bg-[var(--bg-tertiary)] disabled:opacity-30 text-text-secondary">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Watchlist View */}
      {subView === 'watchlist' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4 text-accent-amber" />
            <h2 className="text-sm font-semibold text-text-primary">Your Watchlist</h2>
          </div>

          {/* Change Alerts */}
          {activeChanges.length > 0 && (
            <div className="space-y-2">
              {activeChanges.map((change) => (
                <div
                  key={`${change.address}-${change.round}-${change.field}`}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    change.field === 'rewardCut' && Number(change.newValue) > Number(change.oldValue)
                      ? 'bg-accent-rose/10 border-accent-rose/30 text-accent-rose'
                      : 'bg-accent-blue/10 border-accent-blue/30 text-accent-blue'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    <div className="text-xs">
                      <span className="font-mono">{formatAddress(change.address, 6)}</span>
                      {' changed '}
                      <span className="font-bold">{change.field === 'rewardCut' ? 'reward cut' : 'fee share'}</span>
                      {' from '}
                      <span className="font-mono">{Number(change.oldValue) / 100}%</span>
                      {' to '}
                      <span className="font-mono">{Number(change.newValue) / 100}%</span>
                      {' (round {change.round})'}
                    </div>
                  </div>
                  <button
                    onClick={() => dismissAlert(change)}
                    className="text-[10px] opacity-60 hover:opacity-100 px-2"
                  >
                    Dismiss
                  </button>
                </div>
              ))}
            </div>
          )}

          {watchlist.items.length === 0 ? (
            <div className="glass-card p-8 text-center">
              <Star className="w-8 h-8 text-text-tertiary mx-auto mb-2" />
              <p className="text-sm text-text-secondary mb-1">Watchlist is empty</p>
              <p className="text-xs text-text-tertiary">Browse orchestrators and add candidates you want to monitor</p>
              <button onClick={() => setSubView('browse')} className="mt-3 text-xs text-accent-emerald hover:underline">
                Browse All
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {watchlist.items.map((item) => {
                const cached = orchestrators.find((o) => o.address.toLowerCase() === item.orchestratorAddr.toLowerCase());
                return (
                  <OrchestratorCard
                    key={item.id}
                    address={item.orchestratorAddr}
                    name={cached?.name || item.label}
                    rewardCut={cached?.rewardCut ?? 0}
                    feeShare={cached?.feeShare ?? 0}
                    totalStake={cached?.totalStake ?? '0'}
                    isActive={cached?.isActive}
                    enhanced={enhancedMap.get(item.orchestratorAddr.toLowerCase())}
                    isWatched={true}
                    onUnwatch={() => watchlist.remove(item.id)}
                    notes={item.notes}
                    stakingAddr={stakingAddr}
                    stakeAmount={stakeAmount}
                    onStakeAmountChange={setStakeAmount}
                    onStake={handleStake}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** Unified orchestrator card with capabilities, fees, rewards, last claim */
const OrchestratorCard = React.memo<{
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
  enhanced?: EnhancedOrchestrator;
  stakingAddr: string | null;
  stakeAmount: string;
  onStakeAmountChange: (v: string) => void;
  onStake: (addr: string) => void;
}>(({ rank, address, name, rewardCut, feeShare, totalStake, score, reasons, isActive, isWatched, onWatch, onUnwatch, notes, enhanced, stakingAddr, stakeAmount, onStakeAmountChange, onStake }) => {
  const delegatorYield = (12 * (100 - rewardCut) / 100).toFixed(1);
  const showStakeInput = stakingAddr === address;

  const categories = enhanced?.categories || [];
  const totalVolume = enhanced?.totalVolumeETH || '0';
  const totalRewards = enhanced?.totalRewardTokens || '0';
  const lastRewardRound = enhanced?.lastRewardRound || 0;

  return (
    <div className="glass-card p-4 hover:border-accent-emerald/30 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {rank && (
            <div className="w-7 h-7 rounded-full bg-accent-emerald/15 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-accent-emerald">#{rank}</span>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
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
            {categories.length > 0 && (
              <div className="mt-1.5">
                <CapabilityBadgeList categories={categories} />
              </div>
            )}
          </div>
        </div>

        <div className="text-right flex-shrink-0 ml-3">
          <p className="text-lg font-bold font-mono text-accent-emerald">~{delegatorYield}%</p>
          <p className="text-[10px] text-text-tertiary">Est. APY</p>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 mt-3 text-[11px] text-text-secondary flex-wrap">
        <span>Cut: <span className="font-mono text-text-primary">{rewardCut.toFixed(2)}%</span></span>
        <span>Fee: <span className="font-mono text-text-primary">{feeShare.toFixed(2)}%</span></span>
        <span>Stake: <span className="font-mono text-text-primary">{formatBalance(totalStake)}</span> LPT</span>
        {totalVolume !== '0' && (
          <span>Fees: <span className="font-mono text-accent-blue">{formatEth(totalVolume)} ETH</span></span>
        )}
        {totalRewards !== '0' && (
          <span>Rewards: <span className="font-mono text-accent-purple">{formatLpt(totalRewards)} LPT</span></span>
        )}
        {lastRewardRound > 0 && (
          <span>Last Claim: <span className="font-mono text-text-primary">R{lastRewardRound}</span></span>
        )}
      </div>

      {reasons && reasons.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {reasons.map((r, j) => (
            <span key={j} className="text-[10px] bg-accent-emerald/10 text-accent-emerald px-1.5 py-0.5 rounded">
              {r}
            </span>
          ))}
        </div>
      )}

      {notes && <p className="text-[11px] text-text-tertiary mt-2 italic">{notes}</p>}

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
        <button onClick={() => onStake(address)} className="text-[11px] text-accent-emerald hover:underline">
          {showStakeInput ? 'Confirm' : 'Stake'}
        </button>
        {showStakeInput && (
          <input
            type="number"
            value={stakeAmount}
            onChange={(e) => onStakeAmountChange(e.target.value)}
            placeholder="LPT amount"
            className="ml-1 w-24 px-2 py-1 text-[11px] font-mono bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded text-text-primary"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') onStake(address); }}
          />
        )}
      </div>
    </div>
  );
});
