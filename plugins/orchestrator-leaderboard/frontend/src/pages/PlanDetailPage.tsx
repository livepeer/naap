import React, { useId } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Loader2, AlertCircle, Gauge, SlidersHorizontal,
  Save, ChevronDown, ChevronUp, Activity, Clock, Power, PowerOff,
  Check,
} from 'lucide-react';
import { usePlanDetail } from '../hooks/usePlanDetail';
import { EndpointGuide } from '../components/EndpointGuide';
import type { SLAWeights, LeaderboardFilters, PlanSortBy, OrchestratorRow } from '../lib/api';

const TOP_N_OPTIONS = [5, 10, 20, 50];
const SORT_OPTIONS: { value: PlanSortBy; label: string }[] = [
  { value: 'slaScore', label: 'SLA Score' },
  { value: 'latency', label: 'Latency' },
  { value: 'price', label: 'Price' },
  { value: 'swapRate', label: 'Swap Rate' },
  { value: 'avail', label: 'Availability' },
];

export const PlanDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    plan, results, loading, resultsLoading, error,
    dirty, saving, savedFlash, draft, setDraft, applyChanges,
  } = usePlanDetail(id!);

  const [showFilters, setShowFilters] = React.useState(false);

  const handleWeightChange = (key: keyof SLAWeights, value: number) => {
    const current = draft.slaWeights ?? { latency: 0.4, swapRate: 0.3, price: 0.3 };
    const updated = { ...current, [key]: value };
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
    setDraft({ slaWeights: updated });
  };

  const updateFilter = (key: keyof LeaderboardFilters, value: string) => {
    const current = draft.filters ?? {};
    setDraft({
      filters: {
        ...current,
        [key]: value !== '' ? Number(value) : undefined,
      },
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={28} className="animate-spin text-text-muted" />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <button onClick={() => navigate('/plans')} className="flex items-center gap-1 text-sm text-text-muted hover:text-text-primary mb-4 transition-colors">
          <ArrowLeft size={16} /> Back to Plans
        </button>
        <div className="text-center py-20">
          <AlertCircle size={36} className="mx-auto text-text-muted mb-4" />
          <h2 className="text-lg font-semibold text-text-primary mb-2">Plan Not Found</h2>
          <p className="text-sm text-text-secondary">{error || 'The requested plan does not exist.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-5">
      {/* Back + Header */}
      <button onClick={() => navigate('/plans')} className="flex items-center gap-1 text-sm text-text-muted hover:text-text-primary transition-colors">
        <ArrowLeft size={16} /> Back to Plans
      </button>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-text-primary tracking-tight">{plan.name}</h1>
            {plan.enabled ? (
              <span className="flex items-center gap-1 text-[11px] text-accent-emerald bg-accent-emerald/10 px-2 py-0.5 rounded-full">
                <Power size={10} /> Enabled
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[11px] text-text-muted bg-bg-tertiary px-2 py-0.5 rounded-full">
                <PowerOff size={10} /> Disabled
              </span>
            )}
          </div>
          <p className="text-[12px] text-text-muted font-mono mt-1">{plan.billingPlanId}</p>
          <div className="flex items-center gap-4 text-[11px] text-text-muted mt-1">
            <span className="flex items-center gap-1">
              <Clock size={10} /> Created {new Date(plan.createdAt).toLocaleDateString()}
            </span>
            <span>Updated {new Date(plan.updatedAt).toLocaleDateString()}</span>
          </div>
        </div>

        {/* Save button + status badges */}
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-accent-amber/15 text-accent-amber border border-accent-amber/30">
              Unsaved changes
            </span>
          )}
          {savedFlash && (
            <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-accent-emerald/15 text-accent-emerald border border-accent-emerald/30 flex items-center gap-1">
              <Check size={10} /> Results updated
            </span>
          )}
          <button
            onClick={applyChanges}
            disabled={!dirty || saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent-emerald hover:bg-accent-emerald/90 disabled:bg-bg-tertiary disabled:text-text-disabled text-white text-sm font-medium rounded-lg transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Apply Changes
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 glass-card p-4" style={{ borderColor: 'rgba(220, 38, 38, 0.3)', background: 'rgba(220, 38, 38, 0.05)' }}>
          <AlertCircle size={18} className="text-accent-rose shrink-0" />
          <p className="text-sm text-accent-rose">{error}</p>
        </div>
      )}

      {/* Capabilities */}
      <div className="glass-card p-4">
        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Capabilities</span>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {plan.capabilities.map((c) => (
            <span key={c} className="pill-btn pill-btn-active text-[10px] px-2 py-0.5 cursor-default">{c}</span>
          ))}
        </div>
      </div>

      {/* Interactive Configuration Panel */}
      <div className="glass-card p-5 space-y-5">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={14} className="text-accent-blue" />
          <span className="text-xs font-semibold text-accent-blue uppercase tracking-wider">Configuration</span>
          <span className="text-[10px] text-text-muted ml-2">Edit to see how results change</span>
        </div>

        {/* Top N + Sort By row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Top N</label>
            <div className="flex items-center gap-1 bg-bg-secondary border border-[var(--border-color)] rounded-lg p-1">
              {TOP_N_OPTIONS.map((n) => (
                <button
                  key={n}
                  onClick={() => setDraft({ topN: n })}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    draft.topN === n ? 'bg-accent-emerald text-white' : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">Sort By</label>
            <select
              value={draft.sortBy ?? 'slaScore'}
              onChange={(e) => setDraft({ sortBy: e.target.value as PlanSortBy })}
              className="w-full px-3 py-2 bg-bg-secondary border border-[var(--border-color)] rounded-lg text-text-primary text-sm focus:ring-2 focus:ring-accent-emerald/40 focus:border-accent-emerald/40 transition-all"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* SLA Min Score slider */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
              <Gauge size={13} className="text-accent-blue" />
              SLA Min Score Gate
            </label>
            <span className="text-sm font-bold text-accent-blue">
              {draft.slaMinScore != null ? draft.slaMinScore.toFixed(2) : 'Off'}
            </span>
          </div>
          <input
            type="range"
            min={0} max={100} step={5}
            value={Math.round((draft.slaMinScore ?? 0) * 100)}
            onChange={(e) => {
              const v = Number(e.target.value) / 100;
              setDraft({ slaMinScore: v > 0 ? v : null });
            }}
            className="w-full bg-accent-blue/30 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-text-disabled mt-1">
            <span>Off</span>
            <span>0.25</span>
            <span>0.50</span>
            <span>0.75</span>
            <span>1.0</span>
          </div>
        </div>

        {/* SLA Weights */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Gauge size={14} className="text-accent-emerald" />
            <span className="text-xs font-semibold text-accent-emerald uppercase tracking-wider">SLA Weights</span>
            <span className="text-[10px] text-text-muted ml-2">Auto-normalize to 100%</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <WeightSlider label="Latency" value={(draft.slaWeights?.latency) ?? 0.4}
              onChange={(v) => handleWeightChange('latency', v)} color="blue" />
            <WeightSlider label="Swap Rate" value={(draft.slaWeights?.swapRate) ?? 0.3}
              onChange={(v) => handleWeightChange('swapRate', v)} color="amber" />
            <WeightSlider label="Price" value={(draft.slaWeights?.price) ?? 0.3}
              onChange={(v) => handleWeightChange('price', v)} color="emerald" />
          </div>
        </div>

        {/* Filters toggle */}
        <div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              showFilters
                ? 'bg-accent-amber/10 text-accent-amber border-accent-amber/30'
                : 'bg-bg-secondary text-text-secondary border-[var(--border-color)] hover:border-white/20'
            }`}
          >
            <SlidersHorizontal size={13} />
            Advanced Filters
            {showFilters ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>

        {showFilters && (
          <div className="flex gap-4 flex-wrap items-end">
            <FilterInput label="Min GPU RAM (GB)" value={draft.filters?.gpuRamGbMin ?? ''}
              onChange={(v) => updateFilter('gpuRamGbMin', v)} type="number" min={0} step={1} />
            <FilterInput label="Max GPU RAM (GB)" value={draft.filters?.gpuRamGbMax ?? ''}
              onChange={(v) => updateFilter('gpuRamGbMax', v)} type="number" min={0} step={1} />
            <FilterInput label="Max Price" value={draft.filters?.priceMax ?? ''}
              onChange={(v) => updateFilter('priceMax', v)} type="number" min={0} step={0.001} />
            <FilterInput label="Max Avg Latency (ms)" value={draft.filters?.maxAvgLatencyMs ?? ''}
              onChange={(v) => updateFilter('maxAvgLatencyMs', v)} type="number" min={0} />
            <FilterInput label="Max Swap Ratio" value={draft.filters?.maxSwapRatio ?? ''}
              onChange={(v) => updateFilter('maxSwapRatio', v)} type="number" min={0} max={1} step={0.01} />
          </div>
        )}
      </div>

      {/* Results Section */}
      <ResultsSection results={results} loading={resultsLoading} />

      {/* Endpoint & Integration */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Endpoint & Integration</span>
        </div>
        <EndpointGuide planId={plan.id} />
      </div>

      {/* Meta Footer */}
      {results && (
        <div className="flex items-center gap-4 text-[11px] text-text-muted border-t border-[var(--border-color)] pt-3">
          <span>Refresh interval: {(results.meta.refreshIntervalMs / 1000).toFixed(0)}s</span>
          <span>Cache age: {(results.meta.cacheAgeMs / 1000).toFixed(1)}s</span>
          <span>Total: {results.meta.totalOrchestrators} orchestrators</span>
          <span className="ml-auto">Refreshed {new Date(results.refreshedAt).toLocaleTimeString()}</span>
        </div>
      )}
    </div>
  );
};

/* Sub-components */

const ResultsSection: React.FC<{ results: import('../lib/api').PlanResults | null; loading: boolean }> = ({ results, loading }) => {
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

  if (loading) {
    return (
      <div className="glass-card overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border-color)]">
          <div className="h-4 bg-bg-tertiary rounded w-48 animate-pulse" />
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-6 px-4 py-3.5 border-b border-white/5 animate-pulse">
            <div className="h-3 bg-bg-tertiary/50 rounded w-6" />
            <div className="h-3 bg-bg-tertiary/50 rounded w-56" />
            <div className="h-3 bg-bg-tertiary/50 rounded w-20" />
            <div className="h-3 bg-bg-tertiary/50 rounded w-12 ml-auto" />
          </div>
        ))}
      </div>
    );
  }

  if (!results) return null;

  const capabilities = Object.entries(results.capabilities);
  if (capabilities.length === 0) {
    return (
      <div className="text-center py-10 glass-card">
        <Activity size={28} className="mx-auto text-text-muted mb-3" />
        <p className="text-sm text-text-secondary">No results available yet. Try adjusting the configuration.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {capabilities.map(([capability, rows]) => {
        const isCollapsed = collapsed[capability] ?? false;
        return (
          <div key={capability} className="glass-card overflow-hidden">
            <button
              onClick={() => setCollapsed((p) => ({ ...p, [capability]: !isCollapsed }))}
              className="w-full px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between hover:bg-bg-secondary transition-colors"
            >
              <span className="text-xs font-medium text-text-secondary">
                <span className="text-accent-blue">{capability}</span>
                {' '}&mdash; {rows.length} orchestrator{rows.length !== 1 ? 's' : ''}
              </span>
              {isCollapsed ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronUp size={14} className="text-text-muted" />}
            </button>
            {!isCollapsed && <OrchestratorTable rows={rows} />}
          </div>
        );
      })}
    </div>
  );
};

const OrchestratorTable: React.FC<{ rows: OrchestratorRow[] }> = ({ rows }) => {
  if (rows.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-sm text-text-muted">
        No orchestrators match the current criteria.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-[var(--border-color)] text-[11px] uppercase tracking-wider">
            <th className="px-4 py-2.5 text-left text-text-muted font-semibold w-10">#</th>
            <th className="px-4 py-2.5 text-left text-text-muted font-semibold">Orchestrator</th>
            <th className="px-4 py-2.5 text-left text-text-muted font-semibold">GPU</th>
            <th className="px-4 py-2.5 text-right text-text-muted font-semibold">VRAM</th>
            <th className="px-4 py-2.5 text-right text-text-muted font-semibold">Capacity</th>
            <th className="px-4 py-2.5 text-right text-text-muted font-semibold">Price</th>
            <th className="px-4 py-2.5 text-right text-text-muted font-semibold">Best Lat</th>
            <th className="px-4 py-2.5 text-right text-text-muted font-semibold">Swap</th>
            <th className="px-4 py-2.5 text-right text-text-muted font-semibold">SLA</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={`${row.orchUri || 'row'}-${i}`}
              className="border-b border-white/5 hover:bg-bg-secondary transition-colors"
            >
              <td className="px-4 py-3 text-text-muted font-mono text-xs">
                {i < 3 ? (
                  <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                    i === 0 ? 'bg-accent-amber/20 text-accent-amber' :
                    i === 1 ? 'bg-bg-tertiary text-text-secondary' :
                    'bg-accent-amber/10 text-accent-amber/70'
                  }`}>{i + 1}</span>
                ) : (
                  <span className="text-text-disabled">{i + 1}</span>
                )}
              </td>
              <td className="px-4 py-3 font-mono text-[11px] text-text-primary max-w-[260px] truncate" title={row.orchUri}>
                {row.orchUri}
              </td>
              <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-emerald/60" />
                  {row.gpuName}
                </span>
              </td>
              <td className="px-4 py-3 text-right text-text-secondary whitespace-nowrap">{row.gpuGb} GB</td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <span className="text-text-primary">{row.avail}</span>
                <span className="text-text-disabled">/{row.totalCap}</span>
              </td>
              <td className="px-4 py-3 text-right text-text-secondary whitespace-nowrap font-mono text-[11px]">{row.pricePerUnit}</td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <MetricBadge value={row.bestLatMs} suffix="ms" thresholds={[200, 500]} />
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <MetricBadge value={row.swapRatio} thresholds={[0.1, 0.3]} />
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                {row.slaScore != null ? (
                  <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                    row.slaScore >= 0.7 ? 'bg-accent-emerald/15 text-accent-emerald' :
                    row.slaScore >= 0.4 ? 'bg-accent-amber/15 text-accent-amber' :
                    'bg-accent-rose/15 text-accent-rose'
                  }`}>
                    {row.slaScore.toFixed(3)}
                  </span>
                ) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const MetricBadge: React.FC<{ value: number | null; suffix?: string; thresholds: [number, number] }> = ({ value, suffix = '', thresholds }) => {
  if (value == null) return <span className="text-text-disabled">—</span>;
  const color = value < thresholds[0] ? 'text-accent-emerald' : value < thresholds[1] ? 'text-accent-amber' : 'text-accent-rose';
  return <span className={`font-medium ${color}`}>{value}{suffix}</span>;
};

const WEIGHT_COLORS = {
  blue: { bar: 'bg-accent-blue/30', text: 'text-accent-blue' },
  amber: { bar: 'bg-accent-amber/30', text: 'text-accent-amber' },
  emerald: { bar: 'bg-accent-emerald/30', text: 'text-accent-emerald' },
};

const WeightSlider: React.FC<{
  label: string; value: number; onChange: (v: number) => void; color: keyof typeof WEIGHT_COLORS;
}> = ({ label, value, onChange, color }) => {
  const id = useId();
  const c = WEIGHT_COLORS[color];
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label htmlFor={id} className="text-xs font-medium text-text-secondary">{label}</label>
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

const FilterInput: React.FC<{
  label: string; value: string | number; onChange: (v: string) => void;
  type?: string; min?: number; max?: number; step?: number;
}> = ({ label, value, onChange, ...inputProps }) => {
  const id = useId();
  return (
    <div className="min-w-[130px]">
      <label htmlFor={id} className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">{label}</label>
      <input
        id={id}
        {...inputProps}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-bg-secondary border border-[var(--border-color)] rounded-lg text-text-primary text-sm focus:ring-2 focus:ring-accent-emerald/40 focus:border-accent-emerald/40 placeholder:text-text-disabled transition-all"
      />
    </div>
  );
};
