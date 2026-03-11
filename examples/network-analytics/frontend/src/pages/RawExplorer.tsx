/**
 * Network Analytics
 *
 * Displays SLA compliance, GPU metrics, network demand, and aggregated model metrics
 * from the dashboard data provider. Uses the event bus to query data.
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePluginEvent, DASHBOARD_QUERY_EVENT } from '@naap/plugin-sdk';
import type {
  RawNetworkDemandRow,
  RawGPUMetricRow,
  RawSLAComplianceRow,
  DashboardPipelineCatalogEntry,
  DashboardQueryRequest,
  DashboardQueryResponse,
} from '@naap/plugin-sdk';
import {
  Search, ChevronUp, ChevronDown, ChevronsUpDown,
  Server, Cpu, Activity, Filter, Loader2, AlertCircle, Layers, BarChart3,
} from 'lucide-react';

// ─── Types & constants ───────────────────────────────────────────────────────

type Dataset = 'orchestrators' | 'hardware' | 'demand' | 'models' | 'capabilities';
type SortDir = 'asc' | 'desc' | null;
interface SortState<T> { key: keyof T | null; dir: SortDir; }

const EXPLORER_PREFIX = 'exp_';
const ROWS_PER_PAGE = 100;

const DATASET_CONFIG = {
  orchestrators: { label: 'Orchestrators', icon: Server },
  hardware:      { label: 'Hardware',      icon: Cpu },
  demand:        { label: 'Demand',        icon: Activity },
  models:        { label: 'By model',      icon: BarChart3 },
  capabilities:  { label: 'Capabilities',  icon: Layers },
} as const;

interface ExplorerFilters {
  pipelineId?: string; modelId?: string; region?: string;
  orchestratorAddress?: string; gateway?: string; gpuId?: string;
  gpuModelName?: string; cudaVersion?: string; runnerVersion?: string;
  search?: string;
}

const FILTER_PARAM_MAP: Array<[keyof ExplorerFilters, string]> = [
  ['pipelineId',          `${EXPLORER_PREFIX}pipelineId`],
  ['modelId',             `${EXPLORER_PREFIX}modelId`],
  ['region',              `${EXPLORER_PREFIX}region`],
  ['orchestratorAddress', `${EXPLORER_PREFIX}orch`],
  ['gateway',             `${EXPLORER_PREFIX}gateway`],
  ['gpuId',               `${EXPLORER_PREFIX}gpuId`],
  ['gpuModelName',        `${EXPLORER_PREFIX}gpu`],
  ['cudaVersion',         `${EXPLORER_PREFIX}cudaVer`],
  ['runnerVersion',       `${EXPLORER_PREFIX}runnerVer`],
  ['search',              `${EXPLORER_PREFIX}q`],
];

const PERIOD_OPTIONS = [
  { value: '1h', label: '1 hour' },
  { value: '6h', label: '6 hours' },
  { value: '24h', label: '24 hours' },
  { value: '72h', label: '72 hours' },
];

// ─── GraphQL queries ─────────────────────────────────────────────────────────

const SLA_QUERY = /* GraphQL */ `
  query RawSLA($period: String, $orchestratorAddress: String, $pipelineId: String, $modelId: String, $gpuId: String, $region: String) {
    slaCompliance(period: $period, orchestratorAddress: $orchestratorAddress, pipelineId: $pipelineId, modelId: $modelId, gpuId: $gpuId, region: $region) {
      windowStart orchestratorAddress pipelineId modelId gpuId region
      knownSessionsCount startupSuccessSessions startupExcusedSessions startupUnexcusedSessions
      confirmedSwappedSessions inferredSwapSessions totalSwappedSessions sessionsEndingInError
      errorStatusSamples healthSignalCoverageRatio startupSuccessRate effectiveSuccessRate noSwapRate slaScore
    }
    pipelineCatalog { id name models regions }
  }
`;

const GPU_QUERY = /* GraphQL */ `
  query RawGPU($timeRange: String, $orchestratorAddress: String, $pipelineId: String, $modelId: String, $gpuId: String, $region: String, $gpuModelName: String, $runnerVersion: String, $cudaVersion: String) {
    gpuMetrics(timeRange: $timeRange, orchestratorAddress: $orchestratorAddress, pipelineId: $pipelineId, modelId: $modelId, gpuId: $gpuId, region: $region, gpuModelName: $gpuModelName, runnerVersion: $runnerVersion, cudaVersion: $cudaVersion) {
      windowStart orchestratorAddress pipelineId modelId gpuId region gpuModelName gpuMemoryBytesTotal runnerVersion cudaVersion
      avgOutputFps p95OutputFps avgPromptToFirstFrameMs avgStartupLatencyMs avgE2eLatencyMs
      knownSessionsCount startupSuccessSessions startupUnexcusedSessions totalSwappedSessions
      healthSignalCoverageRatio startupUnexcusedRate swapRate
    }
    pipelineCatalog { id name models regions }
  }
`;

const DEMAND_QUERY = /* GraphQL */ `
  query RawDemand($interval: String, $gateway: String, $region: String, $pipelineId: String, $modelId: String) {
    networkDemand(interval: $interval, gateway: $gateway, region: $region, pipelineId: $pipelineId, modelId: $modelId) {
      windowStart gateway region pipelineId modelId
      sessionsCount totalMinutes knownSessionsCount servedSessions unservedSessions totalDemandSessions
      startupUnexcusedSessions totalSwappedSessions sessionsEndingInError
      healthSignalCoverageRatio startupSuccessRate effectiveSuccessRate ticketFaceValueEth
    }
    pipelineCatalog { id name models regions }
  }
`;

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatPercent(v: number | null | undefined) {
  if (v == null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function formatNumber(n: number | null | undefined) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function truncateAddress(addr: string) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// ─── useSortedPaginated ───────────────────────────────────────────────────────

/** Generic sort + search + pagination hook shared by all data tables. */
function useSortedPaginated<T>(
  data: T[],
  matcher: (row: T, query: string) => boolean,
  search: string | undefined,
  initialSortKey: keyof T,
) {
  const [sort, setSort] = useState<SortState<T>>({ key: initialSortKey, dir: 'desc' });
  const [page, setPage] = useState(1);

  const handleSort = (key: keyof T) => {
    setSort((s) => s.key === key
      ? { key, dir: s.dir === 'desc' ? 'asc' : s.dir === 'asc' ? null : 'desc' }
      : { key, dir: 'desc' });
    setPage(1);
  };

  const filtered = useMemo(() => {
    let rows = data;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => matcher(r, q));
    }
    if (sort.key && sort.dir) {
      const k = sort.key;
      const dir = sort.dir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const av = a[k], bv = b[k];
        if (av == null && bv == null) return 0;
        if (av == null) return dir;
        if (bv == null) return -dir;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (av as any) < (bv as any) ? -dir : (av as any) > (bv as any) ? dir : 0;
      });
    }
    return rows;
  // matcher is module-level and stable; excluding from deps is intentional
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, search, sort]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
    if (page > maxPage) setPage(1);
  }, [filtered.length, page]);

  const paginated = useMemo(
    () => filtered.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE),
    [filtered, page],
  );

  return { sort, handleSort, filtered, paginated, page, setPage };
}

// ─── Shared UI primitives ─────────────────────────────────────────────────────

const INPUT_CLS = 'px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground';
const SELECT_CLS = 'px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground';

function FilterInput({ value, onChange, placeholder, className = '' }: {
  value?: string; onChange: (v: string | undefined) => void;
  placeholder: string; className?: string;
}) {
  return (
    <input
      type="text"
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      className={`${INPUT_CLS}${className ? ` ${className}` : ''}`}
    />
  );
}

function FilterSelect({ value, onChange, placeholder, options }: {
  value?: string; onChange: (v: string | undefined) => void;
  placeholder: string; options: string[];
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      className={SELECT_CLS}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function SortableHeader<T>({ label, sortKey, sortState, onSort }: {
  label: string; sortKey: keyof T; sortState: SortState<T>; onSort: (key: keyof T) => void;
}) {
  const active = sortState.key === sortKey;
  return (
    <button onClick={() => onSort(sortKey)} className="flex items-center gap-1 text-left hover:text-foreground transition-colors">
      <span>{label}</span>
      {active && sortState.dir === 'asc'  && <ChevronUp   className="w-3 h-3" />}
      {active && sortState.dir === 'desc' && <ChevronDown  className="w-3 h-3" />}
      {!active && <ChevronsUpDown className="w-3 h-3 opacity-40" />}
    </button>
  );
}

function TablePagination({ page, totalRows, rowsPerPage, onPageChange }: {
  page: number; totalRows: number; rowsPerPage: number; onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalRows / rowsPerPage));
  const start = totalRows === 0 ? 0 : (page - 1) * rowsPerPage + 1;
  const end = Math.min(page * rowsPerPage, totalRows);
  const btnCls = 'px-2 py-1 text-xs rounded border border-border bg-muted/30 text-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-muted/50';
  return (
    <div className="flex items-center justify-between gap-4 mt-2 px-2">
      <p className="text-xs text-muted-foreground">Showing {start}–{end} of {totalRows} rows</p>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1} className={btnCls}>Previous</button>
          <span className="text-xs text-muted-foreground px-1">Page {page} of {totalPages}</span>
          <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} className={btnCls}>Next</button>
        </div>
      )}
    </div>
  );
}

// ─── FilterBar ────────────────────────────────────────────────────────────────

function FilterBar({ filters, onChange, catalog, showOrchestrator, showGateway,
  showGpuId, showGpuModel, showCudaVersion, showRunnerVersion, period, onPeriodChange }: {
  filters: ExplorerFilters; onChange: (f: ExplorerFilters) => void;
  catalog: DashboardPipelineCatalogEntry[]; showOrchestrator?: boolean;
  showGateway?: boolean; showGpuId?: boolean; showGpuModel?: boolean;
  showCudaVersion?: boolean; showRunnerVersion?: boolean;
  period: string; onPeriodChange: (p: string) => void;
}) {
  const pipelines = catalog.map((p) => p.id).sort();
  const allModels = [...new Set(catalog.flatMap((p) => p.models))].sort();
  const allRegions = [...new Set(catalog.flatMap((p) => p.regions))].filter(Boolean).sort();
  const set = (patch: Partial<ExplorerFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={period} onChange={(e) => onPeriodChange(e.target.value)} className={SELECT_CLS}>
        {PERIOD_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
      <div className="w-px h-4 bg-border" />
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          type="text" placeholder="Search table..." value={filters.search ?? ''}
          onChange={(e) => set({ search: e.target.value || undefined })}
          className={`${INPUT_CLS} pl-8 w-40`}
        />
      </div>
      <FilterSelect value={filters.pipelineId} onChange={(v) => set({ pipelineId: v })} placeholder="All Pipelines" options={pipelines} />
      <FilterSelect value={filters.modelId}    onChange={(v) => set({ modelId: v })}    placeholder="All Models"    options={allModels} />
      {allRegions.length > 0 && (
        <FilterSelect value={filters.region} onChange={(v) => set({ region: v })} placeholder="All Regions" options={allRegions} />
      )}
      {showOrchestrator && <FilterInput value={filters.orchestratorAddress} onChange={(v) => set({ orchestratorAddress: v })} placeholder="Orchestrator 0x..." className="w-32" />}
      {showGateway      && <FilterInput value={filters.gateway}             onChange={(v) => set({ gateway: v })}             placeholder="Gateway..."          className="w-28" />}
      {showGpuId        && <FilterInput value={filters.gpuId}               onChange={(v) => set({ gpuId: v })}               placeholder="GPU ID..."            className="w-24" />}
      {showGpuModel     && <FilterInput value={filters.gpuModelName}        onChange={(v) => set({ gpuModelName: v })}        placeholder="GPU Model..."         className="w-28" />}
      {showCudaVersion  && <FilterInput value={filters.cudaVersion}         onChange={(v) => set({ cudaVersion: v })}         placeholder="CUDA version..."      className="w-28" />}
      {showRunnerVersion && <FilterInput value={filters.runnerVersion}      onChange={(v) => set({ runnerVersion: v })}       placeholder="Runner version..."    className="w-28" />}
    </div>
  );
}

// ─── Table row matchers (module-level = stable refs) ─────────────────────────

const matchSla  = (r: RawSLAComplianceRow, q: string) =>
  [r.orchestratorAddress, r.pipelineId, r.modelId, r.region].some(v => v?.toLowerCase().includes(q));

const matchGpu  = (r: RawGPUMetricRow, q: string) =>
  [r.orchestratorAddress, r.gpuModelName, r.pipelineId, r.region, r.cudaVersion, r.runnerVersion].some(v => v?.toLowerCase().includes(q));

const matchDemand = (r: RawNetworkDemandRow, q: string) =>
  [r.gateway, r.pipelineId, r.modelId, r.region].some(v => v?.toLowerCase().includes(q));

const matchModel  = (r: ModelMetricsRow, q: string) =>
  [r.pipelineId, r.modelId ?? ''].some(v => v.toLowerCase().includes(q));

// ─── Table components ─────────────────────────────────────────────────────────

function OrchestratorsTable({ data, search }: { data: RawSLAComplianceRow[]; search?: string }) {
  const { sort, handleSort, filtered, paginated, page, setPage } = useSortedPaginated(data, matchSla, search, 'knownSessionsCount');
  const H = <K extends keyof RawSLAComplianceRow>(label: string, k: K) =>
    <SortableHeader label={label} sortKey={k} sortState={sort} onSort={handleSort} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2 px-2 text-left font-medium">{H('Orchestrator', 'orchestratorAddress')}</th>
            <th className="py-2 px-2 text-left font-medium">Pipeline</th>
            <th className="py-2 px-2 text-left font-medium">Model</th>
            <th className="py-2 px-2 text-left font-medium">Region</th>
            <th className="py-2 px-2 text-right font-medium">{H('Sessions', 'knownSessionsCount')}</th>
            <th className="py-2 px-2 text-right font-medium">{H('Success',   'startupSuccessRate')}</th>
            <th className="py-2 px-2 text-right font-medium">{H('Effective', 'effectiveSuccessRate')}</th>
            <th className="py-2 px-2 text-right font-medium">{H('No-Swap',   'noSwapRate')}</th>
            <th className="py-2 px-2 text-right font-medium">{H('SLA',       'slaScore')}</th>
          </tr>
        </thead>
        <tbody>
          {paginated.map((row, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
              <td className="py-1.5 px-2 font-mono text-[11px] text-foreground">{truncateAddress(row.orchestratorAddress)}</td>
              <td className="py-1.5 px-2 text-foreground">{row.pipelineId}</td>
              <td className="py-1.5 px-2 text-muted-foreground">{row.modelId ?? '—'}</td>
              <td className="py-1.5 px-2 text-muted-foreground">{row.region ?? '—'}</td>
              <td className="py-1.5 px-2 text-right text-foreground">{formatNumber(row.knownSessionsCount)}</td>
              <td className="py-1.5 px-2 text-right text-foreground">{formatPercent(row.startupSuccessRate)}</td>
              <td className="py-1.5 px-2 text-right text-foreground">{formatPercent(row.effectiveSuccessRate)}</td>
              <td className="py-1.5 px-2 text-right text-foreground">{formatPercent(row.noSwapRate)}</td>
              <td className="py-1.5 px-2 text-right text-foreground">{row.slaScore != null ? `${(row.slaScore * 100).toFixed(0)}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(filtered.length > ROWS_PER_PAGE || page > 1) && (
        <TablePagination page={page} totalRows={filtered.length} rowsPerPage={ROWS_PER_PAGE} onPageChange={setPage} />
      )}
    </div>
  );
}

function HardwareTable({ data, search }: { data: RawGPUMetricRow[]; search?: string }) {
  const { sort, handleSort, filtered, paginated, page, setPage } = useSortedPaginated(data, matchGpu, search, 'knownSessionsCount');
  const H = <K extends keyof RawGPUMetricRow>(label: string, k: K) =>
    <SortableHeader label={label} sortKey={k} sortState={sort} onSort={handleSort} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2 px-2 text-left font-medium">Orchestrator</th>
            <th className="py-2 px-2 text-left font-medium">{H('GPU Model', 'gpuModelName')}</th>
            <th className="py-2 px-2 text-left font-medium">Pipeline</th>
            <th className="py-2 px-2 text-left font-medium">Model</th>
            <th className="py-2 px-2 text-left font-medium">Region</th>
            <th className="py-2 px-2 text-right font-medium">{H('Avg FPS',  'avgOutputFps')}</th>
            <th className="py-2 px-2 text-right font-medium">{H('P95 FPS',  'p95OutputFps')}</th>
            <th className="py-2 px-2 text-right font-medium">{H('Sessions', 'knownSessionsCount')}</th>
            <th className="py-2 px-2 text-right font-medium">{H('Swap Rate','swapRate')}</th>
            <th className="py-2 px-2 text-left font-medium">Runner</th>
            <th className="py-2 px-2 text-left font-medium">CUDA</th>
          </tr>
        </thead>
        <tbody>
          {paginated.map((row, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
              <td className="py-1.5 px-2 font-mono text-[11px] text-foreground">{truncateAddress(row.orchestratorAddress)}</td>
              <td className="py-1.5 px-2 text-foreground">{row.gpuModelName ?? '—'}</td>
              <td className="py-1.5 px-2 text-foreground">{row.pipelineId}</td>
              <td className="py-1.5 px-2 text-muted-foreground">{row.modelId ?? '—'}</td>
              <td className="py-1.5 px-2 text-muted-foreground">{row.region ?? '—'}</td>
              <td className="py-1.5 px-2 text-right text-foreground">{row.avgOutputFps?.toFixed(1) ?? '—'}</td>
              <td className="py-1.5 px-2 text-right text-foreground">{row.p95OutputFps?.toFixed(1) ?? '—'}</td>
              <td className="py-1.5 px-2 text-right text-foreground">{formatNumber(row.knownSessionsCount)}</td>
              <td className="py-1.5 px-2 text-right text-foreground">{formatPercent(row.swapRate)}</td>
              <td className="py-1.5 px-2 text-muted-foreground text-[10px]">{row.runnerVersion ?? '—'}</td>
              <td className="py-1.5 px-2 text-muted-foreground text-[10px]">{row.cudaVersion ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(filtered.length > ROWS_PER_PAGE || page > 1) && (
        <TablePagination page={page} totalRows={filtered.length} rowsPerPage={ROWS_PER_PAGE} onPageChange={setPage} />
      )}
    </div>
  );
}

function DemandTable({ data, search }: { data: RawNetworkDemandRow[]; search?: string }) {
  const { sort, handleSort, filtered, paginated, page, setPage } = useSortedPaginated(data, matchDemand, search, 'sessionsCount');
  const H = <K extends keyof RawNetworkDemandRow>(label: string, k: K) =>
    <SortableHeader label={label} sortKey={k} sortState={sort} onSort={handleSort} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2 px-2 text-left font-medium">Gateway</th>
            <th className="py-2 px-2 text-left font-medium">Pipeline</th>
            <th className="py-2 px-2 text-left font-medium">Model</th>
            <th className="py-2 px-2 text-left font-medium">Region</th>
            <th className="py-2 px-2 text-right font-medium">{H('Sessions', 'sessionsCount')}</th>
            <th className="py-2 px-2 text-right font-medium">{H('Minutes',  'totalMinutes')}</th>
            <th className="py-2 px-2 text-right font-medium">{H('Served',   'servedSessions')}</th>
            <th className="py-2 px-2 text-right font-medium">{H('Success',  'startupSuccessRate')}</th>
            <th className="py-2 px-2 text-right font-medium">{H('ETH',      'ticketFaceValueEth')}</th>
          </tr>
        </thead>
        <tbody>
          {paginated.map((row, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
              <td className="py-1.5 px-2 text-foreground">{row.gateway}</td>
              <td className="py-1.5 px-2 text-foreground">{row.pipelineId}</td>
              <td className="py-1.5 px-2 text-muted-foreground">{row.modelId ?? '—'}</td>
              <td className="py-1.5 px-2 text-muted-foreground">{row.region ?? '—'}</td>
              <td className="py-1.5 px-2 text-right text-foreground">{formatNumber(row.sessionsCount)}</td>
              <td className="py-1.5 px-2 text-right text-foreground">{row.totalMinutes?.toFixed(1) ?? '—'}</td>
              <td className="py-1.5 px-2 text-right text-foreground">{formatNumber(row.servedSessions)}</td>
              <td className="py-1.5 px-2 text-right text-foreground">{formatPercent(row.startupSuccessRate)}</td>
              <td className="py-1.5 px-2 text-right font-mono text-foreground">{row.ticketFaceValueEth?.toFixed(4) ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(filtered.length > ROWS_PER_PAGE || page > 1) && (
        <TablePagination page={page} totalRows={filtered.length} rowsPerPage={ROWS_PER_PAGE} onPageChange={setPage} />
      )}
    </div>
  );
}

function CapabilitiesTable({ data, search }: { data: DashboardPipelineCatalogEntry[]; search?: string }) {
  const filtered = useMemo(() => {
    if (!search) return data;
    const q = search.toLowerCase();
    return data.filter((r) =>
      r.id?.toLowerCase().includes(q) || r.name?.toLowerCase().includes(q) ||
      r.models?.some((m: string) => m.toLowerCase().includes(q)) ||
      r.regions?.some((reg: string) => reg.toLowerCase().includes(q))
    );
  }, [data, search]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2 px-2 text-left font-medium">Pipeline ID</th>
            <th className="py-2 px-2 text-left font-medium">Name</th>
            <th className="py-2 px-2 text-left font-medium">Models</th>
            <th className="py-2 px-2 text-left font-medium">Regions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((row, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
              <td className="py-1.5 px-2 font-mono text-[11px] text-foreground">{row.id}</td>
              <td className="py-1.5 px-2 text-foreground">{row.name}</td>
              <td className="py-1.5 px-2">
                <div className="flex flex-wrap gap-1">
                  {row.models?.slice(0, 5).map((m: string) => (
                    <span key={m} className="px-1.5 py-0.5 rounded bg-muted/70 text-[10px] text-foreground">{m}</span>
                  ))}
                  {row.models?.length > 5 && (
                    <span className="px-1.5 py-0.5 rounded bg-muted/50 text-[10px] text-muted-foreground">+{row.models.length - 5} more</span>
                  )}
                </div>
              </td>
              <td className="py-1.5 px-2">
                <div className="flex flex-wrap gap-1">
                  {row.regions?.length > 0
                    ? row.regions.slice(0, 5).map((reg: string) => (
                        <span key={reg} className="px-1.5 py-0.5 rounded bg-accent-blue/10 text-accent-blue text-[10px]">{reg}</span>
                      ))
                    : <span className="text-muted-foreground">—</span>}
                  {row.regions?.length > 5 && (
                    <span className="px-1.5 py-0.5 rounded bg-muted/50 text-[10px] text-muted-foreground">+{row.regions.length - 5} more</span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.length === 0 && (
        <p className="text-xs text-muted-foreground mt-4 text-center">No pipeline capabilities found</p>
      )}
    </div>
  );
}

// ─── By-model aggregation ─────────────────────────────────────────────────────

interface ModelMetricsRow {
  pipelineId: string; modelId: string | null;
  avgFps: number | null; p95Fps: number | null;
  swapRate: number | null; successRate: number | null;
  sessionsCount: number;
}

function aggregateByModel(gpuRows: RawGPUMetricRow[], slaRows: RawSLAComplianceRow[]): ModelMetricsRow[] {
  const key = (p: string, m: string | null) => `${p}\0${m ?? ''}`;
  const gpuByKey = new Map<string, { totalFps: number; totalP95: number; totalSwap: number; weight: number }>();
  for (const r of gpuRows) {
    const k = key(r.pipelineId, r.modelId), w = r.knownSessionsCount ?? 0;
    const cur = gpuByKey.get(k);
    if (cur) { cur.totalFps += (r.avgOutputFps ?? 0) * w; cur.totalP95 += (r.p95OutputFps ?? 0) * w; cur.totalSwap += (r.swapRate ?? 0) * w; cur.weight += w; }
    else gpuByKey.set(k, { totalFps: (r.avgOutputFps ?? 0) * w, totalP95: (r.p95OutputFps ?? 0) * w, totalSwap: (r.swapRate ?? 0) * w, weight: w });
  }
  const slaByKey = new Map<string, { totalSuccess: number; weight: number }>();
  for (const r of slaRows) {
    const k = key(r.pipelineId, r.modelId), w = r.knownSessionsCount ?? 0;
    const rate = r.effectiveSuccessRate ?? r.startupSuccessRate ?? null;
    if (rate == null) continue;
    const cur = slaByKey.get(k);
    if (cur) { cur.totalSuccess += rate * w; cur.weight += w; }
    else slaByKey.set(k, { totalSuccess: rate * w, weight: w });
  }
  const rows: ModelMetricsRow[] = [];
  for (const k of new Set([...gpuByKey.keys(), ...slaByKey.keys()])) {
    const [pipelineId, modelIdStr] = k.split('\0');
    const gpu = gpuByKey.get(k), sla = slaByKey.get(k);
    const gw = gpu?.weight ?? 0, sw = sla?.weight ?? 0;
    rows.push({
      pipelineId, modelId: modelIdStr || null,
      avgFps:      gw > 0 && gpu ? gpu.totalFps  / gw : null,
      p95Fps:      gw > 0 && gpu ? gpu.totalP95  / gw : null,
      swapRate:    gw > 0 && gpu ? gpu.totalSwap / gw : null,
      successRate: sw > 0 && sla ? sla.totalSuccess / sla.weight : null,
      sessionsCount: Math.max(gw, sw),
    });
  }
  return rows.sort((a, b) => b.sessionsCount - a.sessionsCount);
}

function ModelsTable({ data, search }: { data: ModelMetricsRow[]; search?: string }) {
  const { sort, handleSort, filtered, paginated, page, setPage } = useSortedPaginated(data, matchModel, search, 'sessionsCount');
  const H = <K extends keyof ModelMetricsRow>(label: string, k: K) =>
    <SortableHeader label={label} sortKey={k} sortState={sort} onSort={handleSort} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2 px-2 text-left font-medium">Pipeline</th>
            <th className="py-2 px-2 text-left font-medium">Model</th>
            <th className="py-2 px-2 text-right font-medium">{H('Avg FPS',      'avgFps')}</th>
            <th className="py-2 px-2 text-right font-medium">{H('P95 FPS',      'p95Fps')}</th>
            <th className="py-2 px-2 text-right font-medium">{H('Swap rate',    'swapRate')}</th>
            <th className="py-2 px-2 text-right font-medium">{H('Success rate', 'successRate')}</th>
            <th className="py-2 px-2 text-right font-medium">{H('Sessions',     'sessionsCount')}</th>
          </tr>
        </thead>
        <tbody>
          {paginated.map((row, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
              <td className="py-1.5 px-2 text-foreground">{row.pipelineId}</td>
              <td className="py-1.5 px-2 text-muted-foreground">{row.modelId ?? '—'}</td>
              <td className="py-1.5 px-2 text-right text-foreground">{row.avgFps != null ? row.avgFps.toFixed(1) : '—'}</td>
              <td className="py-1.5 px-2 text-right text-foreground">{row.p95Fps != null ? row.p95Fps.toFixed(1) : '—'}</td>
              <td className="py-1.5 px-2 text-right text-foreground">{formatPercent(row.swapRate)}</td>
              <td className="py-1.5 px-2 text-right text-foreground">{formatPercent(row.successRate)}</td>
              <td className="py-1.5 px-2 text-right text-foreground">{formatNumber(row.sessionsCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.length === 0 && (
        <p className="text-xs text-muted-foreground mt-4 text-center">No metrics by model in this period. Try Orchestrators or Hardware for raw rows.</p>
      )}
      {(filtered.length > ROWS_PER_PAGE || page > 1) && (
        <TablePagination page={page} totalRows={filtered.length} rowsPerPage={ROWS_PER_PAGE} onPageChange={setPage} />
      )}
    </div>
  );
}

// ─── useDashboardQuery ────────────────────────────────────────────────────────

interface DashboardError { type: string; message: string; }
interface QueryState<T> { data: T | null; loading: boolean; error: DashboardError | null; }

const NO_PROVIDER_RETRY_DELAYS = [1000, 2000, 3000, 5000];

function useDashboardQuery<T>(query: string, variables?: Record<string, unknown>): QueryState<T> & { refetch: () => void } {
  const { request } = usePluginEvent();
  const [state, setState] = useState<QueryState<T>>({ data: null, loading: true, error: null });
  const mountedRef = useRef(true);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const variablesKey = variables ? JSON.stringify(variables) : '';

  const fetchData = useCallback(async () => {
    if (!mountedRef.current) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const response = await request<DashboardQueryRequest, DashboardQueryResponse>(
        DASHBOARD_QUERY_EVENT, { query, variables }, { timeout: 8000 }
      );
      if (!mountedRef.current) return;
      retryCountRef.current = 0;
      if (response.errors?.length && !response.data) {
        setState({ data: null, loading: false, error: { type: 'query-error', message: response.errors.map((e: { message: string }) => e.message).join('; ') } });
      } else {
        setState({ data: (response.data as T) ?? null, loading: false, error: null });
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const code = (err as any)?.code;
      if (code === 'NO_HANDLER') {
        const idx = retryCountRef.current;
        if (idx < NO_PROVIDER_RETRY_DELAYS.length) {
          retryCountRef.current = idx + 1;
          retryTimerRef.current = setTimeout(() => { if (mountedRef.current) fetchData(); }, NO_PROVIDER_RETRY_DELAYS[idx]);
          return;
        }
        setState({ data: null, loading: false, error: { type: 'no-provider', message: 'No dashboard data provider is registered' } });
      } else if (code === 'TIMEOUT') {
        setState({ data: null, loading: false, error: { type: 'timeout', message: 'Dashboard data provider did not respond in time' } });
      } else {
        setState({ data: null, loading: false, error: { type: 'unknown', message: (err as Error)?.message ?? 'Unknown error' } });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, query, variablesKey]);

  useEffect(() => {
    mountedRef.current = true;
    retryCountRef.current = 0;
    fetchData();
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    };
  }, [fetchData]);

  return { ...state, refetch: fetchData };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export const RawExplorerPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const initialDataset = (searchParams.get(`${EXPLORER_PREFIX}ds`) as Dataset) || 'orchestrators';
  const initialPeriod  = searchParams.get(`${EXPLORER_PREFIX}period`) || '24h';
  const initialFilters = useMemo(() => {
    const out: ExplorerFilters = {};
    FILTER_PARAM_MAP.forEach(([key, param]) => { const v = searchParams.get(param); if (v) out[key] = v; });
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [dataset, setDataset] = useState<Dataset>(initialDataset);
  const [filters, setFilters] = useState<ExplorerFilters>(initialFilters);
  const [period,  setPeriod]  = useState(initialPeriod);

  const updateUrl = useCallback((f: ExplorerFilters, ds: Dataset, p: string) => {
    const params = new URLSearchParams();
    params.set(`${EXPLORER_PREFIX}ds`, ds);
    params.set(`${EXPLORER_PREFIX}period`, p);
    FILTER_PARAM_MAP.forEach(([key, param]) => { if (f[key]) params.set(param, f[key]!); });
    setSearchParams(params, { replace: true });
  }, [setSearchParams]);

  const handleFiltersChange = useCallback((f: ExplorerFilters) => { setFilters(f); updateUrl(f, dataset, period); }, [dataset, period, updateUrl]);
  const handleDatasetChange = useCallback((ds: Dataset)        => { setDataset(ds); updateUrl(filters, ds, period); }, [filters, period, updateUrl]);
  const handlePeriodChange  = useCallback((p: string)          => { setPeriod(p);  updateUrl(filters, dataset, p); }, [dataset, filters, updateUrl]);

  const gpuTimeRange   = period === '1h' ? '1h' : '24h';
  const demandInterval = period === '1h' ? '5m' : period === '6h' ? '30m' : period === '24h' ? '2h' : '6h';

  const slaVars    = { period, orchestratorAddress: filters.orchestratorAddress, pipelineId: filters.pipelineId, modelId: filters.modelId, gpuId: filters.gpuId, region: filters.region };
  const gpuVars    = { timeRange: gpuTimeRange, ...slaVars, gpuModelName: filters.gpuModelName, runnerVersion: filters.runnerVersion, cudaVersion: filters.cudaVersion };
  const demandVars = { interval: demandInterval, gateway: filters.gateway, pipelineId: filters.pipelineId, modelId: filters.modelId, region: filters.region };

  const { data: slaData,    loading: slaLoading,    error: slaError    } = useDashboardQuery<{ slaCompliance: RawSLAComplianceRow[];   pipelineCatalog: DashboardPipelineCatalogEntry[] }>(SLA_QUERY,    slaVars);
  const { data: gpuData,    loading: gpuLoading,    error: gpuError    } = useDashboardQuery<{ gpuMetrics:    RawGPUMetricRow[];        pipelineCatalog: DashboardPipelineCatalogEntry[] }>(GPU_QUERY,    gpuVars);
  const { data: demandData, loading: demandLoading, error: demandError } = useDashboardQuery<{ networkDemand: RawNetworkDemandRow[];     pipelineCatalog: DashboardPipelineCatalogEntry[] }>(DEMAND_QUERY, demandVars);

  const catalog    = slaData?.pipelineCatalog ?? gpuData?.pipelineCatalog ?? demandData?.pipelineCatalog ?? [];
  const modelsData = useMemo(() => gpuData?.gpuMetrics && slaData?.slaCompliance ? aggregateByModel(gpuData.gpuMetrics, slaData.slaCompliance) : [], [gpuData?.gpuMetrics, slaData?.slaCompliance]);

  const loading = dataset === 'demand' ? demandLoading : dataset === 'hardware' ? gpuLoading : dataset === 'models' ? slaLoading || gpuLoading : slaLoading;
  const error   = dataset === 'demand' ? demandError   : dataset === 'hardware' ? gpuError   : dataset === 'models' ? slaError ?? gpuError   : slaError;

  return (
    <div className="space-y-6 max-w-[1440px] mx-auto">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Network Analytics</h1>
        <p className="text-[13px] text-muted-foreground mt-0.5">SLA compliance, GPU metrics, demand, and metrics by model with server-side filters</p>
      </div>

      <div className="rounded-lg border border-border bg-card/50 overflow-hidden">
        <div className="p-3 border-b border-border bg-muted/30 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Filter className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Filters</span>
            </div>
            <div className="flex items-center gap-1 rounded-md border border-border bg-muted/50 p-0.5">
              {(Object.entries(DATASET_CONFIG) as [Dataset, typeof DATASET_CONFIG[Dataset]][]).map(([key, cfg]) => {
                const Icon = cfg.icon;
                return (
                  <button key={key} onClick={() => handleDatasetChange(key)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors ${
                      dataset === key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon className="w-3 h-3" />{cfg.label}
                  </button>
                );
              })}
            </div>
          </div>
          <FilterBar
            filters={filters} onChange={handleFiltersChange} catalog={catalog}
            showOrchestrator={dataset === 'orchestrators' || dataset === 'hardware'}
            showGateway={dataset === 'demand'}
            showGpuId={dataset === 'orchestrators' || dataset === 'hardware'}
            showGpuModel={dataset === 'hardware'} showCudaVersion={dataset === 'hardware'} showRunnerVersion={dataset === 'hardware'}
            period={period} onPeriodChange={handlePeriodChange}
          />
        </div>

        <div className="p-3 min-h-[200px]">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading {DATASET_CONFIG[dataset].label.toLowerCase()}...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center gap-2 py-12 text-amber-500">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{error.message}</span>
            </div>
          ) : (
            <>
              {dataset === 'orchestrators' && slaData?.slaCompliance    && <OrchestratorsTable data={slaData.slaCompliance}    search={filters.search} />}
              {dataset === 'hardware'      && gpuData?.gpuMetrics        && <HardwareTable      data={gpuData.gpuMetrics}        search={filters.search} />}
              {dataset === 'demand'        && demandData?.networkDemand  && <DemandTable        data={demandData.networkDemand}  search={filters.search} />}
              {dataset === 'models'                                       && <ModelsTable        data={modelsData}                search={filters.search} />}
              {dataset === 'capabilities' && catalog.length > 0          && <CapabilitiesTable  data={catalog}                  search={filters.search} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default RawExplorerPage;
