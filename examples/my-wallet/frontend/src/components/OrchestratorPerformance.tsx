/**
 * Orchestrator Performance component — monthly snapshot tracking with D3 charts
 * Shows performance of "All Orchestrators" or "My Staked" orchestrators.
 */

import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { useOrchestratorPerformance } from '../hooks/useOrchestratorPerformance';
import { RefreshCw, Download, BarChart3, Coins, TrendingUp, Calendar } from 'lucide-react';
import { formatAddress } from '../lib/utils';
import { CapabilityBadgeList } from './CapabilityBadge';

function formatWei(wei: string, decimals = 2): string {
  const n = parseFloat(wei) / 1e18;
  if (n === 0) return '0';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(decimals);
}

const SummaryCard: React.FC<{
  label: string;
  value: string;
  sub?: string;
  icon: React.FC<{ className?: string }>;
}> = ({ label, value, sub, icon: Icon }) => (
  <div className="glass-card p-3">
    <div className="flex items-center gap-1.5 mb-1">
      <Icon className="w-3.5 h-3.5 text-accent-blue" />
      <span className="text-[10px] text-text-tertiary uppercase tracking-wider">{label}</span>
    </div>
    <p className="text-sm font-mono font-bold text-text-primary">{value}</p>
    {sub && <p className="text-[10px] text-text-tertiary mt-0.5">{sub}</p>}
  </div>
);

// D3 Bar Chart for monthly metrics
const MonthlyBarChart: React.FC<{
  data: { month: string; value: number }[];
  label: string;
  color?: string;
  format?: (n: number) => string;
}> = ({ data, label, color = '#3b82f6', format = (n) => n.toFixed(2) }) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !data.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 16, right: 16, bottom: 40, left: 50 };
    const width = svgRef.current.clientWidth - margin.left - margin.right;
    const height = 160 - margin.top - margin.bottom;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
      .domain(data.map((d) => d.month))
      .range([0, width])
      .padding(0.3);

    const y = d3.scaleLinear()
      .domain([0, d3.max(data, (d) => d.value) || 1])
      .nice()
      .range([height, 0]);

    // Bars
    g.selectAll('.bar')
      .data(data)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', (d) => x(d.month) || 0)
      .attr('y', (d) => y(d.value))
      .attr('width', x.bandwidth())
      .attr('height', (d) => height - y(d.value))
      .attr('fill', color)
      .attr('rx', 2)
      .attr('opacity', 0.8);

    // X-axis
    g.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .attr('fill', 'rgba(255,255,255,0.4)')
      .attr('font-size', '9px')
      .attr('transform', 'rotate(-30)')
      .attr('text-anchor', 'end');
    g.selectAll('.domain').attr('stroke', 'rgba(255,255,255,0.1)');
    g.selectAll('.tick line').attr('stroke', 'rgba(255,255,255,0.1)');

    // Y-axis
    g.append('g')
      .call(d3.axisLeft(y).ticks(4).tickFormat((d) => format(d as number)))
      .selectAll('text')
      .attr('fill', 'rgba(255,255,255,0.4)')
      .attr('font-size', '10px');

    return () => {
      svg.selectAll('*').remove();
    };
  }, [data, color, format]);

  return (
    <div className="bg-bg-secondary border border-white/5 rounded-xl p-4">
      <h4 className="text-xs text-text-muted uppercase tracking-wider mb-2">{label}</h4>
      <svg ref={svgRef} width="100%" height={160} />
    </div>
  );
};

export const OrchestratorPerformance: React.FC = () => {
  const [mode, setMode] = useState<'all' | 'staked'>('all');
  const [months] = useState(12);
  const { orchestrators, summary, isLoading, error, synced, refresh, triggerSnapshot } = useOrchestratorPerformance(mode, months);
  const [isSnapshotting, setIsSnapshotting] = useState(false);

  const handleSnapshot = async () => {
    setIsSnapshotting(true);
    await triggerSnapshot();
    setIsSnapshotting(false);
  };

  // Prepare chart data from monthly snapshots
  const monthlyRewards = new Map<string, number>();
  const monthlyFees = new Map<string, number>();

  for (const orch of orchestrators) {
    for (const snap of orch.monthlySnapshots) {
      const rewardVal = parseFloat(snap.lptRewardsAccrued || '0') / 1e18;
      const feeVal = parseFloat(snap.ethFeesAccrued || '0') / 1e18;
      monthlyRewards.set(snap.month, (monthlyRewards.get(snap.month) || 0) + rewardVal);
      monthlyFees.set(snap.month, (monthlyFees.get(snap.month) || 0) + feeVal);
    }
  }

  const rewardsChartData = [...monthlyRewards.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, value]) => ({ month, value }));

  const feesChartData = [...monthlyFees.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, value]) => ({ month, value }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Orchestrator Performance</h2>
          <p className="text-xs text-text-tertiary">Monthly tracking of orchestrator rewards and fees</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <div className="flex gap-0.5 bg-[var(--bg-tertiary)] p-0.5 rounded-lg">
            <button
              onClick={() => setMode('all')}
              className={`px-3 py-1 text-[10px] font-medium rounded-md ${
                mode === 'all' ? 'bg-[var(--bg-primary)] text-text-primary shadow-sm' : 'text-text-tertiary'
              }`}
            >
              All Orchestrators
            </button>
            <button
              onClick={() => setMode('staked')}
              className={`px-3 py-1 text-[10px] font-medium rounded-md ${
                mode === 'staked' ? 'bg-[var(--bg-primary)] text-text-primary shadow-sm' : 'text-text-tertiary'
              }`}
            >
              My Staked
            </button>
          </div>

          <button
            onClick={handleSnapshot}
            disabled={isSnapshotting}
            className="flex items-center gap-1 px-2.5 py-1 text-[10px] bg-accent-blue text-white rounded-md disabled:opacity-50"
          >
            <Download className={`w-3 h-3 ${isSnapshotting ? 'animate-spin' : ''}`} />
            Pull Latest
          </button>

          <button onClick={refresh} className="p-1 rounded hover:bg-[var(--bg-tertiary)]">
            <RefreshCw className={`w-3.5 h-3.5 text-text-tertiary ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard
            icon={Coins}
            label="Total LPT Rewards"
            value={`${formatWei(summary.totalLptRewards)} LPT`}
          />
          <SummaryCard
            icon={BarChart3}
            label="Total ETH Fees"
            value={`${formatWei(summary.totalEthFees, 6)} ETH`}
          />
          <SummaryCard
            icon={TrendingUp}
            label="Total Staked"
            value={`${formatWei(summary.totalStaked)} LPT`}
          />
          <SummaryCard
            icon={Calendar}
            label="Months Tracked"
            value={summary.monthsTracked.toString()}
          />
        </div>
      )}

      {/* Charts */}
      {rewardsChartData.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <MonthlyBarChart
            data={rewardsChartData}
            label="Monthly LPT Rewards"
            color="#10b981"
            format={(n) => `${n.toFixed(1)} LPT`}
          />
          <MonthlyBarChart
            data={feesChartData}
            label="Monthly ETH Fees"
            color="#6366f1"
            format={(n) => `${n.toFixed(4)} ETH`}
          />
        </div>
      )}

      {/* Performance Table */}
      {error && (
        <div className="glass-card p-4 border border-accent-rose/20 bg-accent-rose/10 flex items-center justify-between">
          <p className="text-xs text-accent-rose">{error}</p>
          <button onClick={() => refresh()} className="text-xs text-accent-rose underline ml-2">Retry</button>
        </div>
      )}

      {!synced && !error && (
        <div className="glass-card p-3 border border-accent-amber/20 bg-accent-amber/10">
          <p className="text-xs text-accent-amber">
            Syncing orchestrator data... Showing live data while the database populates.
          </p>
        </div>
      )}

      {isLoading && !orchestrators.length ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="glass-card p-4 h-16 animate-pulse" />)}
        </div>
      ) : orchestrators.length === 0 && !error ? (
        <div className="glass-card p-8 text-center">
          <BarChart3 className="w-8 h-8 text-text-tertiary mx-auto mb-2" />
          <p className="text-sm text-text-secondary">
            {mode === 'staked'
              ? 'No staked positions found. Stake LPT to track performance.'
              : 'No performance data yet. Data will populate as sync jobs run.'}
          </p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-tertiary border-b border-[var(--border-color)]">
                  <th className="text-left px-3 py-2">Orchestrator</th>
                  <th className="text-left px-3 py-2">Capabilities</th>
                  <th className="text-right px-3 py-2">Stake (LPT)</th>
                  <th className="text-right px-3 py-2">Cut %</th>
                  <th className="text-right px-3 py-2">Reward Call</th>
                  <th className="text-right px-3 py-2">Total Vol (ETH)</th>
                  <th className="text-right px-3 py-2">LPT Rewards</th>
                  <th className="text-right px-3 py-2">ETH Fees</th>
                </tr>
              </thead>
              <tbody>
                {orchestrators.slice(0, 30).map((orch, idx) => (
                  <tr key={`${orch.address}-${idx}`} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-tertiary)]/30">
                    <td className="px-3 py-2 font-mono text-text-primary">
                      {orch.name || formatAddress(orch.address, 8)}
                    </td>
                    <td className="px-3 py-2">
                      {(orch.categories?.length || 0) > 0
                        ? <CapabilityBadgeList categories={orch.categories!} />
                        : <span className="text-[10px] text-text-muted">Transcoding</span>
                      }
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{formatWei(orch.totalStake)}</td>
                    <td className="px-3 py-2 text-right">{(orch.rewardCut / 100).toFixed(1)}</td>
                    <td className="px-3 py-2 text-right">{(orch.rewardCallRatio * 100).toFixed(0)}%</td>
                    <td className="px-3 py-2 text-right font-mono">{formatWei(orch.totalVolumeETH, 4)}</td>
                    <td className="px-3 py-2 text-right font-mono text-accent-emerald">
                      {formatWei(orch.performance.totalLptRewards)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-accent-blue">
                      {formatWei(orch.performance.totalEthFees, 6)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
