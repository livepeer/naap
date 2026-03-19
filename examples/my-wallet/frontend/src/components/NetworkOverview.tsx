/**
 * Dune-style network overview dashboard.
 * KPI cards + Fee ETH over time by capability + Fee ETH over time by gateway.
 */

import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import { useNetworkOverview, TopOrchestrator } from '../hooks/useNetworkOverview';
import { Activity, Users, TrendingUp, BarChart3, Coins, Copy, Check, ChevronUp, ChevronDown } from 'lucide-react';
import { CapabilityBadgeList } from './CapabilityBadge';
import { getApiUrl } from '../App';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const KPICard: React.FC<{
  label: string;
  value: string;
  sub?: string;
  icon: React.FC<{ className?: string }>;
}> = ({ label, value, sub, icon: Icon }) => (
  <div className="bg-bg-secondary border border-white/5 rounded-xl p-4">
    <div className="flex items-center gap-2 mb-2">
      <Icon className="w-4 h-4 text-accent-blue" />
      <span className="text-xs text-text-muted uppercase tracking-wider">{label}</span>
    </div>
    <div className="text-lg font-bold text-text-primary">{value}</div>
    {sub && <div className="text-xs text-text-muted mt-1">{sub}</div>}
  </div>
);

function formatLargeNumber(value: string): string {
  const n = parseFloat(value);
  if (Number.isNaN(n) || n === 0) return '0';
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(2);
}

function formatUSD(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

const CopyableAddress: React.FC<{ address: string; name?: string | null }> = ({ address, name }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={handleCopy} className="flex items-center gap-1 font-mono text-text-primary hover:text-accent-blue transition-colors group" title={address}>
      <span>{name || `${address.slice(0, 8)}...${address.slice(-4)}`}</span>
      {copied ? <Check className="w-3 h-3 text-accent-emerald" /> : <Copy className="w-3 h-3 opacity-0 group-hover:opacity-60" />}
    </button>
  );
};

// ---------------------------------------------------------------------------
// Stacked Area Chart — used for both fee breakdown charts
// ---------------------------------------------------------------------------

const PALETTE = [
  '#14b8a6', '#a855f7', '#3b82f6', '#f59e0b', '#ec4899',
  '#10b981', '#6366f1', '#ef4444', '#06b6d4', '#84cc16',
];

const StackedAreaChart: React.FC<{
  data: Record<string, any>[];
  keys: string[];
  label: string;
  colors?: Record<string, string>;
}> = ({ data, keys, label, colors }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current || !data.length || !keys.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 16, right: 16, bottom: 30, left: 55 };
    const width = svgRef.current.clientWidth - margin.left - margin.right;
    const height = 220 - margin.top - margin.bottom;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const colorScale = (key: string, i: number) =>
      colors?.[key] || PALETTE[i % PALETTE.length];

    const x = d3.scaleTime()
      .domain(d3.extent(data, (d) => new Date(d.date)) as [Date, Date])
      .range([0, width]);

    const stack = d3.stack<Record<string, any>>()
      .keys(keys)
      .value((d, key) => d[key] || 0)
      .order(d3.stackOrderNone)
      .offset(d3.stackOffsetNone);

    const stacked = stack(data);

    const yMax = d3.max(stacked, (layer) => d3.max(layer, (d) => d[1])) || 1;
    const y = d3.scaleLinear().domain([0, yMax]).nice().range([height, 0]);

    // Grid
    g.append('g').attr('class', 'grid')
      .call(d3.axisLeft(y).ticks(4).tickSize(-width).tickFormat(() => ''))
      .selectAll('line').attr('stroke', 'rgba(255,255,255,0.05)');
    g.selectAll('.grid .domain').remove();

    // Areas
    const area = d3.area<d3.SeriesPoint<Record<string, any>>>()
      .x((d) => x(new Date(d.data.date)))
      .y0((d) => y(d[0]))
      .y1((d) => y(d[1]))
      .curve(d3.curveMonotoneX);

    stacked.forEach((layer, i) => {
      g.append('path')
        .datum(layer)
        .attr('fill', colorScale(layer.key, i))
        .attr('fill-opacity', 0.7)
        .attr('d', area);
    });

    // Axes
    g.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat('%b %d') as any))
      .selectAll('text').attr('fill', 'rgba(255,255,255,0.4)').attr('font-size', '10px');
    g.selectAll('.domain').attr('stroke', 'rgba(255,255,255,0.1)');
    g.selectAll('.tick line').attr('stroke', 'rgba(255,255,255,0.1)');

    g.append('g')
      .call(d3.axisLeft(y).ticks(4).tickFormat((d) => `${(d as number).toFixed(2)}`))
      .selectAll('text').attr('fill', 'rgba(255,255,255,0.4)').attr('font-size', '10px');

    // Interactive tooltip
    const bisect = d3.bisector<Record<string, any>, Date>((d) => new Date(d.date)).left;
    const crosshair = g.append('line')
      .attr('stroke', 'rgba(255,255,255,0.2)').attr('stroke-dasharray', '3,3')
      .attr('y1', 0).attr('y2', height).style('display', 'none');

    svg.on('mousemove', (event) => {
      const [mx] = d3.pointer(event, g.node()!);
      if (mx < 0 || mx > width) { crosshair.style('display', 'none'); return; }
      const x0 = x.invert(mx);
      const idx = bisect(data, x0, 1);
      const d = data[Math.min(idx, data.length - 1)];
      if (!d) return;
      crosshair.style('display', null).attr('x1', x(new Date(d.date))).attr('x2', x(new Date(d.date)));

      if (tooltipRef.current) {
        const dateStr = new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const rows = keys
          .filter((k) => (d[k] || 0) > 0)
          .map((k, i) => {
            const c = colorScale(k, keys.indexOf(k));
            return `<div style="display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:${c};flex-shrink:0"></span><span>${k}</span><span style="margin-left:auto;font-family:monospace">${(d[k] as number).toFixed(4)}</span></div>`;
          }).join('');
        tooltipRef.current.innerHTML = `<div style="font-weight:600;margin-bottom:4px">${dateStr}</div>${rows}`;
        tooltipRef.current.style.display = 'block';
      }
    });

    svg.on('mouseleave', () => {
      crosshair.style('display', 'none');
      if (tooltipRef.current) tooltipRef.current.style.display = 'none';
    });

    return () => {
      svg.on('mousemove', null).on('mouseleave', null);
    };
  }, [data, keys, colors]);

  return (
    <div className="bg-bg-secondary border border-white/5 rounded-xl p-4 relative">
      <h4 className="text-xs text-text-muted uppercase tracking-wider mb-3">{label}</h4>
      <div className="relative">
        <svg ref={svgRef} width="100%" height={220} />
        <div
          ref={tooltipRef}
          className="absolute top-2 right-2 bg-bg-primary/95 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-text-primary pointer-events-none z-10 min-w-[160px]"
          style={{ display: 'none' }}
        />
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-2">
        {keys.map((k, i) => (
          <div key={k} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: colors?.[k] || PALETTE[i % PALETTE.length] }} />
            <span className="text-[10px] text-text-muted capitalize">{k.replace(/_/g, ' ')}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Hooks for fee breakdown data
// ---------------------------------------------------------------------------

function useFeesByCapability(days: number) {
  const [data, setData] = useState<{ series: Record<string, any>[]; categories: string[] } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetch_ = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/network/fees-by-capability?days=${days}`);
      if (res.ok) {
        const json = await res.json();
        setData(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch fees by capability:', err);
    } finally {
      setIsLoading(false);
    }
  }, [days]);

  useEffect(() => { fetch_(); }, [fetch_]);
  return { data, isLoading };
}

function useFeesByGateway(days: number) {
  const [data, setData] = useState<{ series: Record<string, any>[]; gateways: string[] } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetch_ = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/network/fees-by-gateway?days=${days}`);
      if (res.ok) {
        const json = await res.json();
        setData(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch fees by gateway:', err);
    } finally {
      setIsLoading(false);
    }
  }, [days]);

  useEffect(() => { fetch_(); }, [fetch_]);
  return { data, isLoading };
}

// ---------------------------------------------------------------------------
// Capability Donut
// ---------------------------------------------------------------------------

const CapabilityDonut: React.FC<{ orchestrators: TopOrchestrator[] }> = ({ orchestrators }) => {
  const svgRef = useRef<SVGSVGElement>(null);

  const catCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of orchestrators) {
      const cats = o.categories || [];
      if (cats.length === 0) counts['transcoding'] = (counts['transcoding'] || 0) + 1;
      else for (const c of cats) counts[c] = (counts[c] || 0) + 1;
    }
    return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [orchestrators]);

  const COLORS: Record<string, string> = { transcoding: '#14b8a6', realtime_ai: '#a855f7', ai_batch: '#3b82f6', agent: '#f59e0b', other: '#6b7280' };
  const LABELS: Record<string, string> = { transcoding: 'Transcoding', realtime_ai: 'Realtime AI', ai_batch: 'AI Batch', agent: 'Agent', other: 'Other' };

  useEffect(() => {
    if (!svgRef.current || !catCounts.length) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    const size = 160, radius = size / 2, innerRadius = radius * 0.55;
    const g = svg.append('g').attr('transform', `translate(${radius},${radius})`);
    const pie = d3.pie<{ name: string; count: number }>().value((d) => d.count).sort(null).padAngle(0.02);
    const arc = d3.arc<d3.PieArcDatum<{ name: string; count: number }>>().innerRadius(innerRadius).outerRadius(radius - 4);
    g.selectAll('path').data(pie(catCounts)).join('path').attr('d', arc).attr('fill', (d) => COLORS[d.data.name] || '#6b7280').attr('stroke', 'rgba(0,0,0,0.3)').attr('stroke-width', 1);
    g.append('text').attr('text-anchor', 'middle').attr('dy', '-0.2em').attr('fill', 'rgba(255,255,255,0.8)').attr('font-size', '18px').attr('font-weight', 'bold').text(orchestrators.length);
    g.append('text').attr('text-anchor', 'middle').attr('dy', '1.2em').attr('fill', 'rgba(255,255,255,0.4)').attr('font-size', '9px').text("Orchestrators");

    return () => {
      svg.selectAll('*').remove();
    };
  }, [catCounts, orchestrators.length]);

  return (
    <div className="bg-bg-secondary border border-white/5 rounded-xl p-4">
      <h4 className="text-xs text-text-muted uppercase tracking-wider mb-3">Capability Breakdown</h4>
      <div className="flex items-center gap-4">
        <svg ref={svgRef} width={160} height={160} />
        <div className="flex flex-col gap-1.5">
          {catCounts.map((c) => (
            <div key={c.name} className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[c.name] || '#6b7280' }} />
              <span className="text-xs text-text-muted">{LABELS[c.name] || c.name}</span>
              <span className="text-xs font-mono text-text-primary ml-auto">{c.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Top Orchestrators Table
// ---------------------------------------------------------------------------

type TableSortField = 'totalStake' | 'rewardCut' | 'feeShare' | 'totalVolumeETH' | 'delegatorCount';

const SortHeader: React.FC<{
  label: string; field: TableSortField; current: TableSortField; dir: 'asc' | 'desc'; onSort: (f: TableSortField) => void; align?: 'left' | 'right';
}> = ({ label, field, current, dir, onSort, align = 'right' }) => (
  <th className={`${align === 'left' ? 'text-left' : 'text-right'} py-2 pr-4 cursor-pointer select-none hover:text-text-primary transition-colors`} onClick={() => onSort(field)}>
    <span className="inline-flex items-center gap-0.5">{label}{current === field && (dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</span>
  </th>
);

const TopOrchestratorsTable: React.FC<{ orchestrators: TopOrchestrator[] }> = ({ orchestrators }) => {
  const [sortField, setSortField] = useState<TableSortField>('totalStake');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (field: TableSortField) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('desc'); }
  };

  const sorted = useMemo(() => {
    const list = [...orchestrators];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'totalStake': cmp = parseFloat(b.totalStake || '0') - parseFloat(a.totalStake || '0'); break;
        case 'rewardCut': cmp = a.rewardCut - b.rewardCut; break;
        case 'feeShare': cmp = a.feeShare - b.feeShare; break;
        case 'totalVolumeETH': cmp = parseFloat(b.totalVolumeETH || '0') - parseFloat(a.totalVolumeETH || '0'); break;
        case 'delegatorCount': cmp = (b.delegatorCount || 0) - (a.delegatorCount || 0); break;
      }
      return sortDir === 'asc' ? -cmp : cmp;
    });
    return list;
  }, [orchestrators, sortField, sortDir]);

  return (
    <div className="bg-bg-secondary border border-white/5 rounded-xl p-4">
      <h4 className="text-xs text-text-muted uppercase tracking-wider mb-3">Top Orchestrators</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-text-muted border-b border-white/5">
              <th className="text-left py-2 pr-4">#</th>
              <th className="text-left py-2 pr-4">Address</th>
              <th className="text-left py-2 pr-4">Capabilities</th>
              <SortHeader label="Stake (LPT)" field="totalStake" current={sortField} dir={sortDir} onSort={toggleSort} />
              <SortHeader label="Cut %" field="rewardCut" current={sortField} dir={sortDir} onSort={toggleSort} />
              <SortHeader label="Fee %" field="feeShare" current={sortField} dir={sortDir} onSort={toggleSort} />
              <SortHeader label="Total Fees (ETH)" field="totalVolumeETH" current={sortField} dir={sortDir} onSort={toggleSort} />
              <SortHeader label="Delegators" field="delegatorCount" current={sortField} dir={sortDir} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 20).map((o, i) => (
              <tr key={`${o.address}-${i}`} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="py-2 pr-4 text-text-muted">{i + 1}</td>
                <td className="py-2 pr-4"><CopyableAddress address={o.address} name={o.name} /></td>
                <td className="py-2 pr-4">
                  {(o.categories?.length || 0) > 0
                    ? <CapabilityBadgeList categories={o.categories!} />
                    : <span className="text-text-muted text-[10px]">Transcoding</span>}
                </td>
                <td className="py-2 pr-4 text-right font-mono">{formatLargeNumber(o.totalStake)}</td>
                <td className="py-2 pr-4 text-right">{(o.rewardCut / 100).toFixed(1)}</td>
                <td className="py-2 pr-4 text-right">{(o.feeShare / 100).toFixed(1)}</td>
                <td className="py-2 pr-4 text-right font-mono">{formatLargeNumber(o.totalVolumeETH)}</td>
                <td className="py-2 text-right">{o.delegatorCount.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const NetworkOverview: React.FC = () => {
  const [days, setDays] = useState(90);
  const { data, isLoading, error } = useNetworkOverview(days);
  const feesByCap = useFeesByCapability(days);
  const feesByGw = useFeesByGateway(days);

  const CAP_COLORS: Record<string, string> = {
    transcoding: '#14b8a6', realtime_ai: '#a855f7', ai_batch: '#3b82f6', agent: '#f59e0b', other: '#6b7280',
  };

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-6 h-6 border-2 border-accent-blue border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error && !data) {
    return <div className="text-center py-12 text-text-muted">Failed to load network data. {error}</div>;
  }

  if (!data) return null;

  const { topOrchestrators, prices, current } = data;

  return (
    <div className="space-y-6">
      {/* Time range selector */}
      <div className="flex items-center gap-2">
        {[7, 30, 90, 180, 365].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              days === d
                ? 'bg-accent-blue text-white'
                : 'bg-bg-secondary text-text-muted hover:text-text-primary border border-white/5'
            }`}
          >
            {d === 365 ? '1Y' : d === 7 ? '7D' : `${d}D`}
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      {current && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KPICard icon={Coins} label="Total Stake" value={`${formatLargeNumber(current.totalBonded)} LPT`} sub={formatUSD(prices.lptUsd * parseFloat(current.totalBonded))} />
          <KPICard icon={Activity} label="Participation" value={`${current.participationRate.toFixed(1)}%`} />
          <KPICard icon={Users} label="Active O's" value={current.activeOrchestrators.toString()} />
          <KPICard icon={Users} label="Delegators" value={current.delegatorsCount > 0 ? current.delegatorsCount.toLocaleString() : '—'} />
          <KPICard icon={TrendingUp} label="LPT Price" value={`$${prices.lptUsd.toFixed(2)}`} sub={`${prices.lptChange24h >= 0 ? '+' : ''}${prices.lptChange24h.toFixed(1)}% 24h`} />
          <KPICard icon={BarChart3} label="Total Fees" value={parseFloat(current.totalVolumeETH) > 0 ? `${formatLargeNumber(current.totalVolumeETH)} ETH` : '—'} sub={parseFloat(current.totalVolumeETH) > 0 ? formatUSD(prices.ethUsd * parseFloat(current.totalVolumeETH)) : undefined} />
        </div>
      )}

      {/* Fee Breakdown Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Fees by Capability */}
        {feesByCap.isLoading && !feesByCap.data ? (
          <div className="bg-bg-secondary border border-white/5 rounded-xl p-4 h-[300px] animate-pulse" />
        ) : feesByCap.data && feesByCap.data.series.length > 0 ? (
          <StackedAreaChart
            data={feesByCap.data.series}
            keys={feesByCap.data.categories}
            label="Fees (ETH) by Capability"
            colors={CAP_COLORS}
          />
        ) : (
          <div className="bg-bg-secondary border border-white/5 rounded-xl p-4 flex items-center justify-center h-[300px]">
            <p className="text-xs text-text-muted">No fee data for this period</p>
          </div>
        )}

        {/* Fees by Gateway */}
        {feesByGw.isLoading && !feesByGw.data ? (
          <div className="bg-bg-secondary border border-white/5 rounded-xl p-4 h-[300px] animate-pulse" />
        ) : feesByGw.data && feesByGw.data.series.length > 0 ? (
          <StackedAreaChart
            data={feesByGw.data.series}
            keys={feesByGw.data.gateways}
            label="Fees (ETH) by Gateway"
          />
        ) : (
          <div className="bg-bg-secondary border border-white/5 rounded-xl p-4 flex items-center justify-center h-[300px]">
            <p className="text-xs text-text-muted">No gateway fee data for this period</p>
          </div>
        )}
      </div>

      {/* Capability Breakdown Donut */}
      {topOrchestrators.length > 0 && <CapabilityDonut orchestrators={topOrchestrators} />}

      {/* Top Orchestrators Table */}
      {topOrchestrators.length > 0 && <TopOrchestratorsTable orchestrators={topOrchestrators} />}
    </div>
  );
};
