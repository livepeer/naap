/**
 * Optimize Tab - "What if" analysis & insights-to-action
 *
 * Rebalancing Simulator
 * Reward Consistency checker
 * Governance tracking
 * Network Trends overview
 */

import React, { useState, useEffect } from 'react';
import { Sliders, BarChart3, Vote, Activity, ArrowRight, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { useSimulator } from '../hooks/useSimulator';
import { useRewardConsistency } from '../hooks/useRewardConsistency';
import { useGovernance } from '../hooks/useGovernance';
import { useNetworkHistory } from '../hooks/useNetworkHistory';
import { formatAddress, formatBalance } from '../lib/utils';
import { getApiUrl } from '../App';

type SubView = 'simulator' | 'consistency' | 'governance' | 'network';

interface OrchestratorOption {
  address: string;
  name: string | null;
}

export const OptimizeTab: React.FC = () => {
  const [subView, setSubView] = useState<SubView>('simulator');

  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
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
      {subView === 'consistency' && <ConsistencyView />}
      {subView === 'governance' && <GovernanceView />}
      {subView === 'network' && <NetworkView />}
    </div>
  );
};

/** Rebalancing Simulator */
const SimulatorView: React.FC = () => {
  const simulator = useSimulator();
  const [orchestrators, setOrchestrators] = useState<OrchestratorOption[]>([]);
  const [fromAddr, setFromAddr] = useState('');
  const [toAddr, setToAddr] = useState('');
  const [amount, setAmount] = useState('');

  useEffect(() => {
    fetch(`${getApiUrl()}/staking/orchestrators?activeOnly=true`)
      .then(r => r.json())
      .then(json => {
        const data = json.data ?? json;
        setOrchestrators(data.orchestrators || []);
      })
      .catch(() => {});
  }, []);

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

      {/* Input Form */}
      <div className="glass-card p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-text-secondary mb-1 block">From Orchestrator</label>
            <select
              value={fromAddr}
              onChange={e => setFromAddr(e.target.value)}
              className="w-full p-2.5 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg text-sm text-text-primary"
            >
              <option value="">Select current...</option>
              {orchestrators.map(o => (
                <option key={o.address} value={o.address}>
                  {o.name || formatAddress(o.address)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-text-secondary mb-1 block">To Orchestrator</label>
            <select
              value={toAddr}
              onChange={e => setToAddr(e.target.value)}
              className="w-full p-2.5 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg text-sm text-text-primary"
            >
              <option value="">Select target...</option>
              {orchestrators.filter(o => o.address !== fromAddr).map(o => (
                <option key={o.address} value={o.address}>
                  {o.name || formatAddress(o.address)}
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
          className="w-full py-2.5 bg-accent-purple text-white text-sm font-medium rounded-lg hover:bg-accent-purple/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
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

      {/* Error */}
      {simulator.error && (
        <div className="glass-card p-4 border-accent-rose/30">
          <p className="text-sm text-accent-rose">{simulator.error}</p>
        </div>
      )}

      {/* Result */}
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
            <StatBlock label="Reward Cut Diff" value={`${result.rewardCutDiff > 0 ? '+' : ''}${result.rewardCutDiff}%`} color="text-text-primary" />
            <StatBlock label="Net Benefit" value={`${result.netBenefit > 0 ? '+' : ''}${result.netBenefit.toFixed(2)} LPT`} color={result.netBenefit > 0 ? 'text-accent-emerald' : 'text-accent-rose'} />
          </div>
        </div>
      )}

      {/* Empty state */}
      {!result && !simulator.isSimulating && !simulator.error && (
        <div className="glass-card p-8 text-center">
          <Sliders className="w-8 h-8 text-text-tertiary mx-auto mb-2" />
          <p className="text-sm text-text-secondary">Select orchestrators and amount to simulate a rebalance</p>
        </div>
      )}
    </div>
  );
};

/** Reward Consistency View */
const ConsistencyView: React.FC = () => {
  const [orchestrators, setOrchestrators] = useState<OrchestratorOption[]>([]);
  const [selectedAddr, setSelectedAddr] = useState('');
  const consistency = useRewardConsistency(selectedAddr || undefined);

  useEffect(() => {
    fetch(`${getApiUrl()}/staking/orchestrators?activeOnly=true`)
      .then(r => r.json())
      .then(json => {
        const data = json.data ?? json;
        const list = data.orchestrators || [];
        setOrchestrators(list);
        if (list.length > 0) setSelectedAddr(list[0].address);
      })
      .catch(() => {});
  }, []);

  const data = consistency.data;
  const callRateColor = data
    ? data.callRate >= 95 ? 'text-accent-emerald'
      : data.callRate >= 80 ? 'text-accent-amber'
        : 'text-accent-rose'
    : 'text-text-tertiary';

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-text-primary mb-1">Reward Health Check</h2>
        <p className="text-xs text-text-tertiary">How consistently does this orchestrator call rewards?</p>
      </div>

      <div>
        <select
          value={selectedAddr}
          onChange={e => setSelectedAddr(e.target.value)}
          className="w-full p-2.5 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg text-sm text-text-primary"
        >
          <option value="">Select orchestrator...</option>
          {orchestrators.map(o => (
            <option key={o.address} value={o.address}>
              {o.name || formatAddress(o.address)}
            </option>
          ))}
        </select>
      </div>

      {consistency.isLoading ? (
        <div className="glass-card p-6 animate-pulse h-40" />
      ) : data ? (
        <div className="space-y-3">
          {/* Hero call rate */}
          <div className="glass-card p-6 text-center">
            <p className={`text-4xl font-bold font-mono ${callRateColor}`}>
              {data.callRate.toFixed(1)}%
            </p>
            <p className="text-xs text-text-tertiary mt-1">Reward Call Rate ({data.totalRounds} rounds)</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="glass-card p-4">
              <p className="text-[11px] text-text-tertiary mb-1">Rewards Called</p>
              <p className="text-lg font-bold font-mono text-accent-emerald">{data.rewardsCalled}</p>
            </div>
            <div className="glass-card p-4">
              <p className="text-[11px] text-text-tertiary mb-1">Rewards Missed</p>
              <p className="text-lg font-bold font-mono text-accent-rose">{data.rewardsMissed}</p>
            </div>
            <div className="glass-card p-4">
              <p className="text-[11px] text-text-tertiary mb-1">Current Miss Streak</p>
              <p className={`text-lg font-bold font-mono ${data.currentMissStreak > 0 ? 'text-accent-rose' : 'text-accent-emerald'}`}>
                {data.currentMissStreak}
              </p>
            </div>
            <div className="glass-card p-4">
              <p className="text-[11px] text-text-tertiary mb-1">Longest Miss Streak</p>
              <p className="text-lg font-bold font-mono text-text-primary">{data.longestMissStreak}</p>
            </div>
          </div>

          {/* Recent History - visual blocks */}
          {data.recentHistory.length > 0 && (
            <div className="glass-card p-4">
              <p className="text-[11px] text-text-tertiary mb-2">Recent Rounds (newest first)</p>
              <div className="flex flex-wrap gap-1">
                {data.recentHistory.slice(0, 50).map(r => (
                  <div
                    key={r.round}
                    title={`Round ${r.round}: ${r.called ? 'Called' : 'Missed'}`}
                    className={`w-3 h-3 rounded-sm ${r.called ? 'bg-accent-emerald' : 'bg-accent-rose'}`}
                  />
                ))}
              </div>
              <div className="flex items-center gap-3 mt-2 text-[10px] text-text-tertiary">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-accent-emerald inline-block" /> Called</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-accent-rose inline-block" /> Missed</span>
              </div>
            </div>
          )}
        </div>
      ) : selectedAddr ? (
        <div className="glass-card p-8 text-center text-text-tertiary text-sm">No data available</div>
      ) : null}
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
                  ? 'bg-accent-purple text-white'
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
          <p className="text-sm text-text-secondary">No proposals found</p>
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
                  p.status === 'active' ? 'bg-accent-blue/15 text-accent-blue'
                    : p.status === 'passed' ? 'bg-accent-emerald/15 text-accent-emerald'
                      : 'bg-accent-rose/15 text-accent-rose'
                }`}>
                  {p.status}
                </span>
              </div>

              {/* Vote bar */}
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

              {/* Orchestrator votes */}
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

      {/* My Orchestrators Governance */}
      {governance.myOrchestrators.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
            Your Orchestrators' Participation
          </h3>
          <div className="space-y-2">
            {governance.myOrchestrators.map(o => (
              <div key={o.orchestratorAddr} className="glass-card p-3 flex items-center justify-between">
                <span className="text-xs font-mono text-text-primary">{formatAddress(o.orchestratorAddr, 6)}</span>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-text-secondary">
                    {o.totalVotes}/{o.totalProposals} voted
                  </span>
                  <span className={`font-mono font-semibold ${
                    o.participationRate >= 80 ? 'text-accent-emerald'
                      : o.participationRate >= 50 ? 'text-accent-amber'
                        : 'text-accent-rose'
                  }`}>
                    {o.participationRate.toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
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
      ) : data ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="glass-card p-4">
              <p className="text-[11px] text-text-tertiary mb-1">Total Bonded</p>
              <p className="text-lg font-bold font-mono text-accent-purple">
                {formatBalance(data.summary.bondedChange)}
              </p>
              <p className="text-[10px] text-text-tertiary">LPT change over period</p>
            </div>
            <div className="glass-card p-4">
              <p className="text-[11px] text-text-tertiary mb-1">Participation Rate</p>
              <p className={`text-lg font-bold font-mono ${
                data.summary.participationChange >= 0 ? 'text-accent-emerald' : 'text-accent-rose'
              }`}>
                {data.summary.participationChange >= 0 ? '+' : ''}{(data.summary.participationChange * 100).toFixed(2)}%
              </p>
            </div>
            <div className="glass-card p-4">
              <p className="text-[11px] text-text-tertiary mb-1">Active Orchestrators</p>
              <p className={`text-lg font-bold font-mono ${
                data.summary.orchestratorCountChange >= 0 ? 'text-accent-emerald' : 'text-accent-rose'
              }`}>
                {data.summary.orchestratorCountChange >= 0 ? '+' : ''}{data.summary.orchestratorCountChange}
              </p>
            </div>
            <div className="glass-card p-4">
              <p className="text-[11px] text-text-tertiary mb-1">Data Points</p>
              <p className="text-lg font-bold font-mono text-text-primary">{data.dataPoints.length}</p>
              <p className="text-[10px] text-text-tertiary">snapshots</p>
            </div>
          </div>

          {/* Mini sparkline table */}
          {data.dataPoints.length > 0 && (
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
                    <span className="text-text-secondary">
                      Avg cut: {dp.avgRewardCut.toFixed(1)}%
                    </span>
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
          <p className="text-sm text-text-secondary">Connect wallet to view network trends</p>
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
