/**
 * Optimize Tab - "What if" analysis & insights-to-action
 *
 * Rebalancing Simulator (uses cached orchestrators, no Prisma)
 * Reward Health: top/bottom N orchestrators with export
 * Governance tracking
 * Network Trends (RPC fallback)
 */

import React, { useState, useMemo } from 'react';
import { Sliders, BarChart3, Vote, Activity, ArrowRight, CheckCircle, XCircle, AlertTriangle, Download, Search } from 'lucide-react';
import { useSimulator } from '../hooks/useSimulator';
import { useGovernance } from '../hooks/useGovernance';
import { useNetworkHistory } from '../hooks/useNetworkHistory';
import { useOrchestratorCache, CachedOrchestrator } from '../hooks/useOrchestratorCache';
import { formatAddress, formatBalance } from '../lib/utils';
import { getApiUrl } from '../App';

type SubView = 'simulator' | 'consistency' | 'governance' | 'network';

export const OptimizeTab: React.FC = () => {
  const [subView, setSubView] = useState<SubView>('simulator');

  return (
    <div className="space-y-6">
      <div className="flex gap-1 bg-[var(--bg-tertiary)] p-1 rounded-lg w-fit flex-wrap">
        {([
          { id: 'simulator' as SubView, label: 'Simulator', icon: <Sliders className="w-3.5 h-3.5" /> },
          { id: 'consistency' as SubView, label: 'Reward Health', icon: <BarChart3 className="w-3.5 h-3.5" /> },
          { id: 'governance' as SubView, label: 'Governance', icon: <Vote className="w-3.5 h-3.5" /> },
          { id: 'network' as SubView, label: 'Network', icon: <Activity className="w-3.5 h-3.5" /> },
        ]).map(s => (
          <button
            key={s.id}
            onClick={() => setSubView(s.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              subView === s.id
                ? 'bg-[var(--bg-primary)] text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {s.icon}
            {s.label}
          </button>
        ))}
      </div>

      {subView === 'simulator' && <SimulatorView />}
      {subView === 'consistency' && <RewardHealthView />}
      {subView === 'governance' && <GovernanceView />}
      {subView === 'network' && <NetworkView />}
    </div>
  );
};

/** Rebalancing Simulator — uses cached orchestrators */
const SimulatorView: React.FC = () => {
  const simulator = useSimulator();
  const { orchestrators } = useOrchestratorCache();
  const [fromAddr, setFromAddr] = useState('');
  const [toAddr, setToAddr] = useState('');
  const [amount, setAmount] = useState('');
  const [searchFrom, setSearchFrom] = useState('');
  const [searchTo, setSearchTo] = useState('');

  const filterOrch = (list: CachedOrchestrator[], query: string) => {
    if (!query) return list;
    const q = query.toLowerCase();
    return list.filter(o => o.name?.toLowerCase().includes(q) || o.address.toLowerCase().includes(q));
  };

  const handleSimulate = () => {
    if (!fromAddr || !toAddr || !amount) return;
    const amountWei = BigInt(Math.floor(parseFloat(amount) * 1e18)).toString();
    simulator.simulate(fromAddr, toAddr, amountWei);
  };

  const result = simulator.result;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-text-primary mb-1">Rebalancing Simulator</h2>
        <p className="text-xs text-text-tertiary">Compare moving your stake to a different orchestrator</p>
      </div>

      <div className="glass-card p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-text-secondary mb-1 block">From Orchestrator</label>
            <input
              type="text"
              value={searchFrom}
              onChange={e => setSearchFrom(e.target.value)}
              placeholder="Search..."
              className="w-full mb-1 p-2 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg text-xs text-text-primary placeholder:text-text-tertiary"
            />
            <select
              value={fromAddr}
              onChange={e => setFromAddr(e.target.value)}
              className="w-full p-2.5 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg text-sm text-text-primary"
            >
              <option value="">Select current...</option>
              {filterOrch(orchestrators, searchFrom).map(o => (
                <option key={o.address} value={o.address}>
                  {o.name || formatAddress(o.address, 8)} — Cut: {o.rewardCut.toFixed(1)}%
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-text-secondary mb-1 block">To Orchestrator</label>
            <input
              type="text"
              value={searchTo}
              onChange={e => setSearchTo(e.target.value)}
              placeholder="Search..."
              className="w-full mb-1 p-2 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg text-xs text-text-primary placeholder:text-text-tertiary"
            />
            <select
              value={toAddr}
              onChange={e => setToAddr(e.target.value)}
              className="w-full p-2.5 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg text-sm text-text-primary"
            >
              <option value="">Select target...</option>
              {filterOrch(orchestrators, searchTo).filter(o => o.address !== fromAddr).map(o => (
                <option key={o.address} value={o.address}>
                  {o.name || formatAddress(o.address, 8)} — Cut: {o.rewardCut.toFixed(1)}%
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="text-[11px] text-text-secondary mb-1 block">Amount (LPT)</label>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="e.g. 1000"
            className="w-full p-2.5 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg text-sm text-text-primary font-mono placeholder:text-text-tertiary"
          />
        </div>

        <button
          onClick={handleSimulate}
          disabled={!fromAddr || !toAddr || !amount || simulator.isSimulating}
          className="w-full py-2.5 bg-accent-emerald text-white text-sm font-medium rounded-lg hover:bg-accent-emerald/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {simulator.isSimulating ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Simulating...
            </>
          ) : (
            <>
              <Sliders className="w-4 h-4" />
              Run Simulation
            </>
          )}
        </button>
      </div>

      {simulator.error && (
        <div className="glass-card p-4 border-accent-rose/30">
          <p className="text-sm text-accent-rose">{simulator.error}</p>
        </div>
      )}

      {result && (
        <div className="glass-card p-4 space-y-4">
          <div className="flex items-center gap-2">
            {result.recommendation === 'favorable' ? (
              <CheckCircle className="w-5 h-5 text-accent-emerald" />
            ) : result.recommendation === 'unfavorable' ? (
              <XCircle className="w-5 h-5 text-accent-rose" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-accent-amber" />
            )}
            <span className={`text-sm font-semibold capitalize ${
              result.recommendation === 'favorable' ? 'text-accent-emerald'
                : result.recommendation === 'unfavorable' ? 'text-accent-rose'
                  : 'text-accent-amber'
            }`}>
              {result.recommendation} Move
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs text-text-secondary">
            <span className="font-medium text-text-primary">{result.fromOrchestrator.name || formatAddress(result.fromOrchestrator.address)}</span>
            <ArrowRight className="w-3.5 h-3.5" />
            <span className="font-medium text-text-primary">{result.toOrchestrator.name || formatAddress(result.toOrchestrator.address)}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StatBlock label="Projected Yield Delta" value={`${result.projectedYieldDelta > 0 ? '+' : ''}${result.projectedYieldDelta.toFixed(2)}%`} color={result.projectedYieldDelta > 0 ? 'text-accent-emerald' : 'text-accent-rose'} />
            <StatBlock label="Unbonding Cost" value={`${result.unbondingOpportunityCost.toFixed(2)} LPT`} color="text-accent-amber" />
            <StatBlock label="Reward Cut Diff" value={`${result.rewardCutDiff > 0 ? '+' : ''}${result.rewardCutDiff.toFixed(2)}%`} color="text-text-primary" />
            <StatBlock label="Net Benefit" value={`${result.netBenefit > 0 ? '+' : ''}${result.netBenefit.toFixed(2)} LPT`} color={result.netBenefit > 0 ? 'text-accent-emerald' : 'text-accent-rose'} />
          </div>
        </div>
      )}

      {!result && !simulator.isSimulating && !simulator.error && (
        <div className="glass-card p-8 text-center">
          <Sliders className="w-8 h-8 text-text-tertiary mx-auto mb-2" />
          <p className="text-sm text-text-secondary">Select orchestrators and amount to simulate a rebalance</p>
        </div>
      )}
    </div>
  );
};

/** Reward Health View — Top N best/worst + export */
const RewardHealthView: React.FC = () => {
  const { orchestrators } = useOrchestratorCache();
  const [topN, setTopN] = useState(10);
  const [searchQuery, setSearchQuery] = useState('');
  const [rewardHealth, setRewardHealth] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch reward health from backend
  React.useEffect(() => {
    setIsLoading(true);
    fetch(`${getApiUrl()}/orchestrators/reward-health?topN=${topN}`)
      .then(r => r.json())
      .then(json => setRewardHealth(json.data))
      .catch(err => console.error('Reward health fetch failed:', err))
      .finally(() => setIsLoading(false));
  }, [topN]);

  const exportData = (format: 'json' | 'csv') => {
    if (!rewardHealth) return;
    const allData = [...(rewardHealth.best || []), ...(rewardHealth.worst || [])];

    if (format === 'json') {
      const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
      downloadBlob(blob, 'reward-health.json');
    } else {
      const headers = 'Address,Health Score,Reward Cut,Fee Share,Total Stake,Last Reward Round,Rounds Since Reward\n';
      const rows = allData.map(o =>
        `${o.address},${o.healthScore},${o.rewardCut},${o.feeShare},${o.totalStake},${o.lastRewardRound},${o.roundsSinceLastReward}`
      ).join('\n');
      const blob = new Blob([headers + rows], { type: 'text/csv' });
      downloadBlob(blob, 'reward-health.csv');
    }
  };

  // Filter search within displayed orchestrators
  const filterBySearch = (list: any[]) => {
    if (!searchQuery) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((o: any) => o.address.toLowerCase().includes(q));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text-primary mb-1">Reward Health Summary</h2>
          <p className="text-xs text-text-tertiary">
            Top {topN} best and worst orchestrators by reward calling consistency
            {rewardHealth?.totalOrchestrators ? ` (${rewardHealth.totalOrchestrators} total)` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-text-tertiary">Top N:</label>
          <select
            value={topN}
            onChange={e => setTopN(Number(e.target.value))}
            className="text-[11px] bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded px-1.5 py-1 text-text-primary"
          >
            {[5, 10, 15, 20, 30, 50].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      {/* Search + Export */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-text-tertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Filter by address..."
            className="w-full pl-8 pr-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-text-primary text-xs placeholder:text-text-tertiary"
          />
        </div>
        <button
          onClick={() => exportData('json')}
          className="flex items-center gap-1 px-2.5 py-2 text-[11px] bg-[var(--bg-tertiary)] text-text-secondary hover:text-text-primary rounded-lg transition-colors"
        >
          <Download className="w-3 h-3" /> JSON
        </button>
        <button
          onClick={() => exportData('csv')}
          className="flex items-center gap-1 px-2.5 py-2 text-[11px] bg-[var(--bg-tertiary)] text-text-secondary hover:text-text-primary rounded-lg transition-colors"
        >
          <Download className="w-3 h-3" /> CSV
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="glass-card p-4 h-16 animate-pulse" />)}
        </div>
      ) : rewardHealth ? (
        <div className="space-y-4">
          {/* Best orchestrators */}
          <div>
            <h3 className="text-xs font-semibold text-accent-emerald mb-2 uppercase tracking-wide">
              Best ({filterBySearch(rewardHealth.best || []).length})
            </h3>
            <div className="space-y-1">
              {filterBySearch(rewardHealth.best || []).map((o: any, i: number) => (
                <HealthRow key={o.address} rank={i + 1} data={o} type="best" />
              ))}
            </div>
          </div>

          {/* Worst orchestrators */}
          <div>
            <h3 className="text-xs font-semibold text-accent-rose mb-2 uppercase tracking-wide">
              Worst ({filterBySearch(rewardHealth.worst || []).length})
            </h3>
            <div className="space-y-1">
              {filterBySearch(rewardHealth.worst || []).map((o: any, i: number) => (
                <HealthRow key={o.address} rank={i + 1} data={o} type="worst" />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="glass-card p-8 text-center">
          <BarChart3 className="w-8 h-8 text-text-tertiary mx-auto mb-2" />
          <p className="text-sm text-text-secondary">Loading reward health data...</p>
        </div>
      )}
    </div>
  );
};

const HealthRow: React.FC<{ rank: number; data: any; type: 'best' | 'worst' }> = ({ rank, data, type }) => {
  const scoreColor = data.healthScore >= 80 ? 'text-accent-emerald'
    : data.healthScore >= 50 ? 'text-accent-amber'
    : 'text-accent-rose';

  return (
    <div className="glass-card p-3 flex items-center gap-3">
      <span className={`text-[11px] font-bold w-6 text-center ${type === 'best' ? 'text-accent-emerald' : 'text-accent-rose'}`}>
        #{rank}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-mono text-text-primary truncate">{formatAddress(data.address, 8)}</p>
      </div>
      <div className="flex items-center gap-4 text-[11px]">
        <span className="text-text-tertiary">Cut: <span className="text-text-primary">{data.rewardCut?.toFixed(1)}%</span></span>
        <span className="text-text-tertiary">Stake: <span className="text-text-primary">{formatBalance(data.totalStake)}</span></span>
        <span className={`font-bold font-mono ${scoreColor}`}>{data.healthScore}/100</span>
      </div>
    </div>
  );
};

/** Governance View */
const GovernanceView: React.FC = () => {
  const governance = useGovernance();
  const [filter, setFilter] = useState<string>('');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text-primary mb-1">Governance Proposals</h2>
          <p className="text-xs text-text-tertiary">Track how your orchestrators vote</p>
        </div>
        <div className="flex gap-1">
          {['', 'active', 'passed', 'defeated'].map(s => (
            <button
              key={s}
              onClick={() => { setFilter(s); governance.fetchProposals(s || undefined); }}
              className={`px-2.5 py-1 text-[10px] rounded-full capitalize ${
                filter === s
                  ? 'bg-accent-emerald text-white'
                  : 'bg-[var(--bg-tertiary)] text-text-secondary'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
      </div>

      {governance.isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="glass-card p-4 h-20 animate-pulse" />)}
        </div>
      ) : governance.proposals.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <Vote className="w-8 h-8 text-text-tertiary mx-auto mb-2" />
          <p className="text-sm text-text-secondary">No governance proposals found</p>
          <p className="text-xs text-text-tertiary mt-1">Proposal data requires The Graph subgraph access</p>
        </div>
      ) : (
        <div className="space-y-3">
          {governance.proposals.map(p => (
            <div key={p.id} className="glass-card p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{p.title}</p>
                  <p className="text-[11px] text-text-tertiary mt-0.5">
                    {new Date(p.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ml-2 ${
                  p.status === 'active' ? 'bg-accent-emerald/15 text-accent-emerald'
                    : p.status === 'passed' ? 'bg-accent-emerald/15 text-accent-emerald'
                      : 'bg-accent-rose/15 text-accent-rose'
                }`}>
                  {p.status}
                </span>
              </div>

              <div className="mt-3">
                <div className="flex justify-between text-[10px] text-text-tertiary mb-1">
                  <span>For: {formatBalance(p.votesFor)} LPT</span>
                  <span>Against: {formatBalance(p.votesAgainst)} LPT</span>
                </div>
                <div className="h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden flex">
                  {(() => {
                    const f = parseFloat(p.votesFor);
                    const a = parseFloat(p.votesAgainst);
                    const total = f + a;
                    const pct = total > 0 ? (f / total) * 100 : 50;
                    return (
                      <>
                        <div className="h-full bg-accent-emerald rounded-l-full" style={{ width: `${pct}%` }} />
                        <div className="h-full bg-accent-rose rounded-r-full" style={{ width: `${100 - pct}%` }} />
                      </>
                    );
                  })()}
                </div>
              </div>

              {p.votes.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {p.votes.map((v, i) => (
                    <span
                      key={i}
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        v.support
                          ? 'bg-accent-emerald/10 text-accent-emerald'
                          : 'bg-accent-rose/10 text-accent-rose'
                      }`}
                    >
                      {formatAddress(v.orchestratorAddr)}: {v.support ? 'For' : 'Against'}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/** Network Trends View */
const NetworkView: React.FC = () => {
  const networkHistory = useNetworkHistory();
  const data = networkHistory.data;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-text-primary mb-1">Network Trends</h2>
        <p className="text-xs text-text-tertiary">Livepeer network health at a glance</p>
      </div>

      {networkHistory.isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="glass-card p-4 h-24 animate-pulse" />)}
        </div>
      ) : data && data.dataPoints.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="glass-card p-4">
              <p className="text-[11px] text-text-tertiary mb-1">Active Orchestrators</p>
              <p className="text-lg font-bold font-mono text-accent-emerald">
                {data.dataPoints[0].activeOrchestrators}
              </p>
            </div>
            <div className="glass-card p-4">
              <p className="text-[11px] text-text-tertiary mb-1">Participation Rate</p>
              <p className="text-lg font-bold font-mono text-accent-emerald">
                {typeof data.dataPoints[0].participationRate === 'number'
                  ? `${data.dataPoints[0].participationRate.toFixed(2)}%`
                  : 'N/A'}
              </p>
            </div>
            {data.dataPoints[0].totalBonded && data.dataPoints[0].totalBonded !== '0' && (
              <div className="glass-card p-4">
                <p className="text-[11px] text-text-tertiary mb-1">Total Bonded</p>
                <p className="text-lg font-bold font-mono text-text-primary">
                  {formatBalance(data.dataPoints[0].totalBonded)} LPT
                </p>
              </div>
            )}
            {data.dataPoints[0].avgRewardCut > 0 && (
              <div className="glass-card p-4">
                <p className="text-[11px] text-text-tertiary mb-1">Avg Reward Cut</p>
                <p className="text-lg font-bold font-mono text-text-primary">
                  {data.dataPoints[0].avgRewardCut.toFixed(1)}%
                </p>
              </div>
            )}
            <div className="glass-card p-4">
              <p className="text-[11px] text-text-tertiary mb-1">Current Round</p>
              <p className="text-lg font-bold font-mono text-text-primary">
                {data.dataPoints[0].round}
              </p>
            </div>
            <div className="glass-card p-4">
              <p className="text-[11px] text-text-tertiary mb-1">Data Points</p>
              <p className="text-lg font-bold font-mono text-text-primary">{data.dataPoints.length}</p>
              <p className="text-[10px] text-text-tertiary">snapshots</p>
            </div>
          </div>

          {data.dataPoints.length > 1 && (
            <div className="glass-card overflow-hidden">
              <div className="p-3 border-b border-[var(--border-color)]">
                <p className="text-xs font-semibold text-text-primary">Recent Snapshots</p>
              </div>
              <div className="divide-y divide-[var(--border-color)]">
                {data.dataPoints.slice(0, 10).map(dp => (
                  <div key={dp.round} className="px-3 py-2 flex items-center gap-4 text-[11px]">
                    <span className="text-text-tertiary font-mono w-16">R{dp.round}</span>
                    <span className="text-text-primary">
                      {dp.activeOrchestrators} Os
                    </span>
                    <span className="text-text-secondary">
                      {(dp.participationRate * 100).toFixed(1)}% part.
                    </span>
                    {dp.avgRewardCut > 0 && (
                      <span className="text-text-secondary">
                        Avg cut: {dp.avgRewardCut.toFixed(1)}%
                      </span>
                    )}
                    <span className="text-text-tertiary ml-auto">
                      {new Date(dp.snapshotAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="glass-card p-8 text-center">
          <Activity className="w-8 h-8 text-text-tertiary mx-auto mb-2" />
          <p className="text-sm text-text-secondary">Loading network data...</p>
          <p className="text-xs text-text-tertiary mt-1">Data sourced from Arbitrum RPC</p>
        </div>
      )}
    </div>
  );
};

const StatBlock: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <div className="glass-card p-3">
    <p className="text-[11px] text-text-tertiary mb-0.5">{label}</p>
    <p className={`text-sm font-bold font-mono ${color}`}>{value}</p>
  </div>
);

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
