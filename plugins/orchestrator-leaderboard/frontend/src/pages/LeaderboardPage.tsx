import React, { useState, useMemo, useId } from 'react';
import {
  Trophy, Activity, Gauge, Zap, RefreshCw, ChevronDown, ChevronUp,
  SlidersHorizontal, Timer, TrendingUp, AlertCircle, Search, Loader2, Radio,
} from 'lucide-react';
import { useCapabilities } from '../hooks/useCapabilities';
import { useLeaderboard } from '../hooks/useLeaderboard';
import type { LeaderboardFilters, SLAWeights, LeaderboardRequest, OrchestratorRow } from '../lib/api';

const TOP_N_OPTIONS = [5, 10, 20, 50];

export const LeaderboardPage: React.FC = () => {
  const { capabilities, loading: capsLoading } = useCapabilities();

  const [capability, setCapability] = useState('');
  const [topN, setTopN] = useState(10);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showSla, setShowSla] = useState(false);

  const [filters, setFilters] = useState<LeaderboardFilters>({});
  const [slaWeights, setSlaWeights] = useState<SLAWeights>({
    latency: 0.4, swapRate: 0.3, price: 0.3,
  });

  const hasActiveFilters =
    filters.gpuRamGbMin != null ||
    filters.gpuRamGbMax != null ||
    filters.priceMax != null ||
    filters.maxAvgLatencyMs != null ||
    filters.maxSwapRatio != null;

  const request = useMemo<LeaderboardRequest | null>(() => {
    if (!capability) return null;
    return {
      capability, topN,
      filters: hasActiveFilters ? filters : undefined,
      slaWeights: showSla ? slaWeights : undefined,
    };
  }, [capability, topN, filters, slaWeights, hasActiveFilters, showSla]);

  const {
    data, loading, error, cacheStatus, lastUpdated, refresh,
  } = useLeaderboard(request, { autoRefresh, refreshInterval: 5000 });

  const handleWeightChange = (key: keyof SLAWeights, value: number) => {
    const updated = { ...slaWeights, [key]: value };
    const sum = (updated.latency || 0) + (updated.swapRate || 0) + (updated.price || 0);
    if (sum <= 0) {
      updated[key] = 1;
      const newSum = (updated.latency || 0) + (updated.swapRate || 0) + (updated.price || 0);
      updated.latency = Math.round(((updated.latency || 0) / newSum) * 100) / 100;
      updated.swapRate = Math.round(((updated.swapRate || 0) / newSum) * 100) / 100;
      updated.price = Math.round(((updated.price || 0) / newSum) * 100) / 100;
    } else {
      updated.latency = Math.round(((updated.latency || 0) / sum) * 100) / 100;
      updated.swapRate = Math.round(((updated.swapRate || 0) / sum) * 100) / 100;
      updated.price = Math.round(((updated.price || 0) / sum) * 100) / 100;
    }
    setSlaWeights(updated);
  };

  const stats = useMemo(() => computeStats(data), [data]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-5">
      {/* ─── Header ─── */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-500/10 text-blue-400 rounded-xl">
            <Trophy size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-100 tracking-tight">
              Orchestrator Leaderboard
            </h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Real-time rankings by latency, stability &amp; price
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              autoRefresh
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600'
            }`}
          >
            <Radio size={12} className={autoRefresh ? 'animate-pulse' : ''} />
            {autoRefresh ? 'Live' : 'Auto-refresh'}
          </button>
          <button
            onClick={refresh}
            disabled={!capability || loading}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* ─── Capability Selector (pills) ─── */}
      <div className="panel p-4">
        <div className="flex items-center gap-2 mb-3">
          <Zap size={14} className="text-gray-400" />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Capability
          </span>
          {capsLoading && <Loader2 size={12} className="animate-spin text-gray-500" />}
        </div>
        <div className="flex flex-wrap gap-2">
          {capabilities.map((c) => (
            <button
              key={c}
              onClick={() => setCapability(c === capability ? '' : c)}
              className={`pill-btn ${c === capability ? 'pill-btn-active' : 'pill-btn-inactive'}`}
            >
              {c}
            </button>
          ))}
          {!capsLoading && capabilities.length === 0 && (
            <span className="text-xs text-gray-500">No capabilities available</span>
          )}
        </div>
      </div>

      {/* ─── Summary Stats ─── */}
      {data.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            icon={<Activity size={16} />}
            label="Orchestrators"
            value={String(stats.count)}
            color="text-blue-400"
          />
          <StatCard
            icon={<Timer size={16} />}
            label="Best Latency"
            value={stats.bestLat != null ? `${stats.bestLat}ms` : '—'}
            color={stats.bestLat != null && stats.bestLat < 200 ? 'text-emerald-400' : 'text-yellow-400'}
          />
          <StatCard
            icon={<Gauge size={16} />}
            label="Avg Swap Ratio"
            value={stats.avgSwap != null ? stats.avgSwap.toFixed(3) : '—'}
            color={stats.avgSwap != null && stats.avgSwap < 0.1 ? 'text-emerald-400' : 'text-yellow-400'}
          />
          <StatCard
            icon={<TrendingUp size={16} />}
            label="Avg Price/Unit"
            value={stats.avgPrice != null ? stats.avgPrice.toFixed(4) : '—'}
            color="text-gray-200"
          />
        </div>
      )}

      {/* ─── Controls Row: TopN + Filter Toggle + SLA Toggle ─── */}
      {capability && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-gray-800/60 border border-gray-700/60 rounded-lg p-1">
            {TOP_N_OPTIONS.map((n) => (
              <button
                key={n}
                onClick={() => setTopN(n)}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                  topN === n ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                Top {n}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              showFilters || hasActiveFilters
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-600'
            }`}
          >
            <SlidersHorizontal size={13} />
            Filters
            {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
            {showFilters ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          <button
            onClick={() => setShowSla(!showSla)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              showSla
                ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-600'
            }`}
          >
            <Gauge size={13} />
            SLA Ranking
            {showSla ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          {/* Status */}
          <div className="ml-auto flex items-center gap-3 text-[11px] text-gray-500">
            {lastUpdated && (
              <>
                <span>Updated {lastUpdated.toLocaleTimeString()}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  cacheStatus === 'HIT' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-yellow-500/10 text-yellow-400'
                }`}>
                  {cacheStatus}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── Advanced Filters Panel ─── */}
      {showFilters && capability && (
        <div className="panel p-4">
          <div className="flex gap-4 flex-wrap items-end">
            <FilterInput label="Min GPU RAM (GB)" value={filters.gpuRamGbMin ?? ''}
              onChange={(v) => setFilters({ ...filters, gpuRamGbMin: v !== '' ? Number(v) : undefined })}
              type="number" min={0} step={1} />
            <FilterInput label="Max GPU RAM (GB)" value={filters.gpuRamGbMax ?? ''}
              onChange={(v) => setFilters({ ...filters, gpuRamGbMax: v !== '' ? Number(v) : undefined })}
              type="number" min={0} step={1} />
            <FilterInput label="Max Price" value={filters.priceMax ?? ''}
              onChange={(v) => setFilters({ ...filters, priceMax: v !== '' ? Number(v) : undefined })}
              type="number" min={0} step={0.001} />
            <FilterInput label="Max Avg Latency (ms)" value={filters.maxAvgLatencyMs ?? ''}
              onChange={(v) => setFilters({ ...filters, maxAvgLatencyMs: v !== '' ? Number(v) : undefined })}
              type="number" min={0} />
            <FilterInput label="Max Swap Ratio" value={filters.maxSwapRatio ?? ''}
              onChange={(v) => setFilters({ ...filters, maxSwapRatio: v !== '' ? Number(v) : undefined })}
              type="number" min={0} max={1} step={0.01} />
            {hasActiveFilters && (
              <button
                onClick={() => setFilters({})}
                className="text-xs text-amber-400 hover:text-amber-300 font-medium px-2 py-2"
              >
                Clear all
              </button>
            )}
          </div>
        </div>
      )}

      {/* ─── SLA Weight Panel ─── */}
      {showSla && capability && (
        <div className="panel p-4 border-purple-500/20">
          <div className="flex items-center gap-2 mb-4">
            <Gauge size={14} className="text-purple-400" />
            <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider">
              Custom SLA Weights
            </span>
            <span className="text-[10px] text-gray-500 ml-2">
              Weights auto-normalize to 100%
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <WeightSlider label="Latency" value={slaWeights.latency || 0}
              onChange={(v) => handleWeightChange('latency', v)} color="blue" />
            <WeightSlider label="Swap Rate" value={slaWeights.swapRate || 0}
              onChange={(v) => handleWeightChange('swapRate', v)} color="amber" />
            <WeightSlider label="Price" value={slaWeights.price || 0}
              onChange={(v) => handleWeightChange('price', v)} color="emerald" />
          </div>
        </div>
      )}

      {/* ─── Error ─── */}
      {error && (
        <div className="flex items-center gap-3 panel p-4 border-red-500/30 bg-red-500/5">
          <AlertCircle size={18} className="text-red-400 shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={refresh} className="ml-auto text-xs text-red-400 hover:text-red-300 font-medium">
            Retry
          </button>
        </div>
      )}

      {/* ─── Empty: No capability selected ─── */}
      {!capability && !loading && (
        <EmptyState
          icon={<Search size={36} />}
          title="Select a Capability"
          description="Choose a capability above to see the real-time orchestrator rankings."
        />
      )}

      {/* ─── Loading skeleton ─── */}
      {loading && data.length === 0 && capability && (
        <div className="panel overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700/60">
            <div className="h-4 bg-gray-700/60 rounded w-48 animate-pulse" />
          </div>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-6 px-4 py-3.5 border-b border-gray-700/30 animate-pulse">
              <div className="h-3 bg-gray-700/50 rounded w-6" />
              <div className="h-3 bg-gray-700/50 rounded w-56" />
              <div className="h-3 bg-gray-700/50 rounded w-20" />
              <div className="h-3 bg-gray-700/50 rounded w-12 ml-auto" />
              <div className="h-3 bg-gray-700/50 rounded w-16" />
              <div className="h-3 bg-gray-700/50 rounded w-12" />
            </div>
          ))}
        </div>
      )}

      {/* ─── Empty results ─── */}
      {capability && !loading && data.length === 0 && !error && (
        <EmptyState
          icon={<Activity size={36} />}
          title="No Orchestrators Found"
          description={`No orchestrators match "${capability}" with current filters. Try adjusting your criteria.`}
        />
      )}

      {/* ─── Results Table ─── */}
      {data.length > 0 && (
        <div className="panel overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700/60 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400">
              {data.length} orchestrator{data.length !== 1 ? 's' : ''} for <span className="text-blue-400">{capability}</span>
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-gray-700/60 text-[11px] uppercase tracking-wider">
                  <th className="px-4 py-2.5 text-left text-gray-500 font-semibold w-10">#</th>
                  <th className="px-4 py-2.5 text-left text-gray-500 font-semibold">Orchestrator</th>
                  <th className="px-4 py-2.5 text-left text-gray-500 font-semibold">GPU</th>
                  <th className="px-4 py-2.5 text-right text-gray-500 font-semibold">VRAM</th>
                  <th className="px-4 py-2.5 text-right text-gray-500 font-semibold">Capacity</th>
                  <th className="px-4 py-2.5 text-right text-gray-500 font-semibold">Price</th>
                  <th className="px-4 py-2.5 text-right text-gray-500 font-semibold">Best Lat</th>
                  <th className="px-4 py-2.5 text-right text-gray-500 font-semibold">Avg Lat</th>
                  <th className="px-4 py-2.5 text-right text-gray-500 font-semibold">Swap</th>
                  <th className="px-4 py-2.5 text-right text-gray-500 font-semibold">Avg Avail</th>
                  {showSla && <th className="px-4 py-2.5 text-right text-gray-500 font-semibold">SLA</th>}
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr
                    key={`${row.orchUri || 'row'}-${i}`}
                    className="border-b border-gray-700/30 hover:bg-gray-800/60 transition-colors group"
                  >
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                      {i < 3 ? (
                        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                          i === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                          i === 1 ? 'bg-gray-400/20 text-gray-300' :
                          'bg-amber-700/20 text-amber-500'
                        }`}>{i + 1}</span>
                      ) : (
                        <span className="text-gray-600">{i + 1}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-gray-200 max-w-[260px] truncate group-hover:text-blue-400 transition-colors" title={row.orchUri}>
                      {row.orchUri}
                    </td>
                    <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60" />
                        {row.gpuName}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300 whitespace-nowrap">{row.gpuGb} GB</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <span className="text-gray-200">{row.avail}</span>
                      <span className="text-gray-600">/{row.totalCap}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300 whitespace-nowrap font-mono text-[11px]">{row.pricePerUnit}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <MetricBadge value={row.bestLatMs} suffix="ms" thresholds={[200, 500]} />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <MetricBadge value={row.avgLatMs} suffix="ms" thresholds={[200, 500]} />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <MetricBadge value={row.swapRatio} thresholds={[0.1, 0.3]} />
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300 whitespace-nowrap">
                      {row.avgAvail != null ? row.avgAvail : '—'}
                    </td>
                    {showSla && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {row.slaScore != null ? (
                          <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                            row.slaScore >= 0.7 ? 'bg-emerald-500/15 text-emerald-400' :
                            row.slaScore >= 0.4 ? 'bg-yellow-500/15 text-yellow-400' :
                            'bg-red-500/15 text-red-400'
                          }`}>
                            {row.slaScore.toFixed(3)}
                          </span>
                        ) : '—'}
                      </td>
                    )}
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

/* ─── Sub-components ─── */

function computeStats(data: OrchestratorRow[]) {
  if (data.length === 0) return { count: 0, bestLat: null as number | null, avgSwap: null as number | null, avgPrice: null as number | null };
  const lats = data.map(d => d.bestLatMs).filter((v): v is number => v != null);
  const swaps = data.map(d => d.swapRatio).filter((v): v is number => v != null);
  const prices = data.map(d => d.pricePerUnit).filter((v): v is number => v != null);
  return {
    count: data.length,
    bestLat: lats.length ? Math.min(...lats) : null,
    avgSwap: swaps.length ? swaps.reduce((a, b) => a + b, 0) / swaps.length : null,
    avgPrice: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null,
  };
}

const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: string; color: string }> = ({ icon, label, value, color }) => (
  <div className="stat-card">
    <div className="flex items-center gap-2 text-gray-500 mb-2">
      {icon}
      <span className="text-[11px] font-medium uppercase tracking-wider">{label}</span>
    </div>
    <div className={`text-xl font-bold ${color}`}>{value}</div>
  </div>
);

const MetricBadge: React.FC<{ value: number | null; suffix?: string; thresholds: [number, number] }> = ({ value, suffix = '', thresholds }) => {
  if (value == null) return <span className="text-gray-600">—</span>;
  const color = value < thresholds[0] ? 'text-emerald-400' : value < thresholds[1] ? 'text-yellow-400' : 'text-red-400';
  return <span className={`font-medium ${color}`}>{value}{suffix}</span>;
};

const EmptyState: React.FC<{ icon: React.ReactNode; title: string; description: string }> = ({ icon, title, description }) => (
  <div className="text-center py-20">
    <div className="w-20 h-20 mx-auto mb-5 bg-gray-800/80 border border-gray-700/60 rounded-2xl flex items-center justify-center text-gray-500">
      {icon}
    </div>
    <h2 className="text-lg font-semibold text-gray-200 mb-2">{title}</h2>
    <p className="text-sm text-gray-400 max-w-md mx-auto">{description}</p>
  </div>
);

const FilterInput: React.FC<{
  label: string; value: string | number; onChange: (v: string) => void;
  type?: string; min?: number; max?: number; step?: number;
}> = ({ label, value, onChange, ...inputProps }) => {
  const id = useId();
  return (
    <div className="min-w-[130px]">
      <label htmlFor={id} className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{label}</label>
      <input
        id={id}
        {...inputProps}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 placeholder-gray-600 transition-all"
      />
    </div>
  );
};

const WEIGHT_COLORS = {
  blue: { bar: 'bg-blue-500/30', text: 'text-blue-400' },
  amber: { bar: 'bg-amber-500/30', text: 'text-amber-400' },
  emerald: { bar: 'bg-emerald-500/30', text: 'text-emerald-400' },
};

const WeightSlider: React.FC<{
  label: string; value: number; onChange: (v: number) => void; color: keyof typeof WEIGHT_COLORS;
}> = ({ label, value, onChange, color }) => {
  const id = useId();
  const c = WEIGHT_COLORS[color];
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label htmlFor={id} className="text-xs font-medium text-gray-300">{label}</label>
        <span className={`text-sm font-bold ${c.text}`}>{Math.round(value * 100)}%</span>
      </div>
      <input
        id={id}
        type="range" min={0} max={100}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className={`w-full ${c.bar} cursor-pointer`}
      />
    </div>
  );
};
