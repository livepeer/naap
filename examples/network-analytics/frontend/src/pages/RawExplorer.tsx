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
  Search,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Server,
  Cpu,
  Activity,
  Filter,
  Loader2,
  AlertCircle,
  Layers,
  BarChart3,
} from 'lucide-react';

type Dataset = 'orchestrators' | 'hardware' | 'demand' | 'models' | 'capabilities';

const EXPLORER_PREFIX = 'exp_';

const DATASET_CONFIG = {
  orchestrators: { label: 'Orchestrators', icon: Server },
  hardware: { label: 'Hardware', icon: Cpu },
  demand: { label: 'Demand', icon: Activity },
  models: { label: 'By model', icon: BarChart3 },
  capabilities: { label: 'Capabilities', icon: Layers },
} as const;

interface ExplorerFilters {
  pipelineId?: string;
  modelId?: string;
  region?: string;
  orchestratorAddress?: string;
  gateway?: string;
  gpuId?: string;
  gpuModelName?: string;
  cudaVersion?: string;
  runnerVersion?: string;
  search?: string;
}

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

function formatPercent(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function formatNumber(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function truncateAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

type SortDir = 'asc' | 'desc' | null;

interface SortState<T> {
  key: keyof T | null;
  dir: SortDir;
}

function SortableHeader<T>({
  label,
  sortKey,
  sortState,
  onSort,
}: {
  label: string;
  sortKey: keyof T;
  sortState: SortState<T>;
  onSort: (key: keyof T) => void;
}) {
  const active = sortState.key === sortKey;
  return (
    <button
      onClick={() => onSort(sortKey)}
      className="flex items-center gap-1 text-left hover:text-foreground transition-colors"
    >
      <span>{label}</span>
      {active && sortState.dir === 'asc' && <ChevronUp className="w-3 h-3" />}
      {active && sortState.dir === 'desc' && <ChevronDown className="w-3 h-3" />}
      {!active && <ChevronsUpDown className="w-3 h-3 opacity-40" />}
    </button>
  );
}

const PERIOD_OPTIONS = [
  { value: '1h', label: '1 hour' },
  { value: '6h', label: '6 hours' },
  { value: '24h', label: '24 hours' },
  { value: '72h', label: '72 hours' },
];

const ROWS_PER_PAGE = 100;

function TablePagination({
  page,
  totalRows,
  rowsPerPage,
  onPageChange,
}: {
  page: number;
  totalRows: number;
  rowsPerPage: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalRows / rowsPerPage));
  const start = totalRows === 0 ? 0 : (page - 1) * rowsPerPage + 1;
  const end = Math.min(page * rowsPerPage, totalRows);
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="flex items-center justify-between gap-4 mt-2 px-2">
      <p className="text-xs text-muted-foreground">
        Showing {start}–{end} of {totalRows} rows
      </p>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={!canPrev}
            className="px-2 py-1 text-xs rounded border border-border bg-muted/30 text-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-muted/50"
          >
            Previous
          </button>
          <span className="text-xs text-muted-foreground px-1">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={!canNext}
            className="px-2 py-1 text-xs rounded border border-border bg-muted/30 text-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-muted/50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function FilterBar({
  filters,
  onChange,
  catalog,
  showOrchestrator,
  showGateway,
  showGpuId,
  showGpuModel,
  showCudaVersion,
  showRunnerVersion,
  period,
  onPeriodChange,
}: {
  filters: ExplorerFilters;
  onChange: (f: ExplorerFilters) => void;
  catalog: DashboardPipelineCatalogEntry[];
  showOrchestrator?: boolean;
  showGateway?: boolean;
  showGpuId?: boolean;
  showGpuModel?: boolean;
  showCudaVersion?: boolean;
  showRunnerVersion?: boolean;
  period: string;
  onPeriodChange: (p: string) => void;
}) {
  const pipelines = catalog.map((p) => p.id).sort();
  const allModels = [...new Set(catalog.flatMap((p) => p.models))].sort();
  const allRegions = [...new Set(catalog.flatMap((p) => p.regions))].filter(Boolean).sort();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={period}
        onChange={(e) => onPeriodChange(e.target.value)}
        className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
      >
        {PERIOD_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <div className="w-px h-4 bg-border" />
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search table..."
          value={filters.search ?? ''}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="pl-8 pr-3 py-1.5 text-xs rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary w-40 text-foreground placeholder:text-muted-foreground"
        />
      </div>
      <select
        value={filters.pipelineId ?? ''}
        onChange={(e) => onChange({ ...filters, pipelineId: e.target.value || undefined })}
        className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
      >
        <option value="">All Pipelines</option>
        {pipelines.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      <select
        value={filters.modelId ?? ''}
        onChange={(e) => onChange({ ...filters, modelId: e.target.value || undefined })}
        className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
      >
        <option value="">All Models</option>
        {allModels.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      {allRegions.length > 0 && (
        <select
          value={filters.region ?? ''}
          onChange={(e) => onChange({ ...filters, region: e.target.value || undefined })}
          className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
        >
          <option value="">All Regions</option>
          {allRegions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      )}
      {showOrchestrator && (
        <input
          type="text"
          placeholder="Orchestrator 0x..."
          value={filters.orchestratorAddress ?? ''}
          onChange={(e) => onChange({ ...filters, orchestratorAddress: e.target.value || undefined })}
          className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary w-32 text-foreground placeholder:text-muted-foreground"
        />
      )}
      {showGateway && (
        <input
          type="text"
          placeholder="Gateway..."
          value={filters.gateway ?? ''}
          onChange={(e) => onChange({ ...filters, gateway: e.target.value || undefined })}
          className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary w-28 text-foreground placeholder:text-muted-foreground"
        />
      )}
      {showGpuId && (
        <input
          type="text"
          placeholder="GPU ID..."
          value={filters.gpuId ?? ''}
          onChange={(e) => onChange({ ...filters, gpuId: e.target.value || undefined })}
          className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary w-24 text-foreground placeholder:text-muted-foreground"
        />
      )}
      {showGpuModel && (
        <input
          type="text"
          placeholder="GPU Model..."
          value={filters.gpuModelName ?? ''}
          onChange={(e) => onChange({ ...filters, gpuModelName: e.target.value || undefined })}
          className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary w-28 text-foreground placeholder:text-muted-foreground"
        />
      )}
      {showCudaVersion && (
        <input
          type="text"
          placeholder="CUDA version..."
          value={filters.cudaVersion ?? ''}
          onChange={(e) => onChange({ ...filters, cudaVersion: e.target.value || undefined })}
          className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary w-28 text-foreground placeholder:text-muted-foreground"
        />
      )}
      {showRunnerVersion && (
        <input
          type="text"
          placeholder="Runner version..."
          value={filters.runnerVersion ?? ''}
          onChange={(e) => onChange({ ...filters, runnerVersion: e.target.value || undefined })}
          className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary w-28 text-foreground placeholder:text-muted-foreground"
        />
      )}
    </div>
  );
}

function OrchestratorsTable({
  data,
  search,
}: {
  data: RawSLAComplianceRow[];
  search?: string;
}) {
  const [sort, setSort] = useState<SortState<RawSLAComplianceRow>>({ key: 'knownSessionsCount', dir: 'desc' });
  const [page, setPage] = useState(1);

  const handleSort = (key: keyof RawSLAComplianceRow) => {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'desc' ? 'asc' : s.dir === 'asc' ? null : 'desc' }
        : { key, dir: 'desc' }
    );
    setPage(1);
  };

  const filtered = useMemo(() => {
    let rows = data;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.orchestratorAddress?.toLowerCase().includes(q) ||
          r.pipelineId?.toLowerCase().includes(q) ||
          r.modelId?.toLowerCase().includes(q) ||
          r.region?.toLowerCase().includes(q)
      );
    }
    if (sort.key && sort.dir) {
      const k = sort.key;
      const dir = sort.dir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const av = a[k];
        const bv = b[k];
        if (av == null && bv == null) return 0;
        if (av == null) return dir;
        if (bv == null) return -dir;
        return av < bv ? -dir : av > bv ? dir : 0;
      });
    }
    return rows;
  }, [data, search, sort]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
    if (page > maxPage) setPage(1);
  }, [filtered.length, page]);

  const paginated = useMemo(
    () => filtered.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE),
    [filtered, page]
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2 px-2 text-left font-medium">
              <SortableHeader label="Orchestrator" sortKey="orchestratorAddress" sortState={sort} onSort={handleSort} />
            </th>
            <th className="py-2 px-2 text-left font-medium">Pipeline</th>
            <th className="py-2 px-2 text-left font-medium">Model</th>
            <th className="py-2 px-2 text-left font-medium">Region</th>
            <th className="py-2 px-2 text-right font-medium">
              <SortableHeader label="Sessions" sortKey="knownSessionsCount" sortState={sort} onSort={handleSort} />
            </th>
            <th className="py-2 px-2 text-right font-medium">
              <SortableHeader label="Success" sortKey="startupSuccessRate" sortState={sort} onSort={handleSort} />
            </th>
            <th className="py-2 px-2 text-right font-medium">
              <SortableHeader label="Effective" sortKey="effectiveSuccessRate" sortState={sort} onSort={handleSort} />
            </th>
            <th className="py-2 px-2 text-right font-medium">
              <SortableHeader label="No-Swap" sortKey="noSwapRate" sortState={sort} onSort={handleSort} />
            </th>
            <th className="py-2 px-2 text-right font-medium">
              <SortableHeader label="SLA" sortKey="slaScore" sortState={sort} onSort={handleSort} />
            </th>
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
        <TablePagination
          page={page}
          totalRows={filtered.length}
          rowsPerPage={ROWS_PER_PAGE}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}

function HardwareTable({
  data,
  search,
}: {
  data: RawGPUMetricRow[];
  search?: string;
}) {
  const [sort, setSort] = useState<SortState<RawGPUMetricRow>>({ key: 'knownSessionsCount', dir: 'desc' });
  const [page, setPage] = useState(1);

  const handleSort = (key: keyof RawGPUMetricRow) => {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'desc' ? 'asc' : s.dir === 'asc' ? null : 'desc' }
        : { key, dir: 'desc' }
    );
    setPage(1);
  };

  const filtered = useMemo(() => {
    let rows = data;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.orchestratorAddress?.toLowerCase().includes(q) ||
          r.gpuModelName?.toLowerCase().includes(q) ||
          r.pipelineId?.toLowerCase().includes(q) ||
          r.region?.toLowerCase().includes(q) ||
          r.cudaVersion?.toLowerCase().includes(q) ||
          r.runnerVersion?.toLowerCase().includes(q)
      );
    }
    if (sort.key && sort.dir) {
      const k = sort.key;
      const dir = sort.dir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const av = a[k];
        const bv = b[k];
        if (av == null && bv == null) return 0;
        if (av == null) return dir;
        if (bv == null) return -dir;
        return av < bv ? -dir : av > bv ? dir : 0;
      });
    }
    return rows;
  }, [data, search, sort]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
    if (page > maxPage) setPage(1);
  }, [filtered.length, page]);

  const paginated = useMemo(
    () => filtered.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE),
    [filtered, page]
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2 px-2 text-left font-medium">Orchestrator</th>
            <th className="py-2 px-2 text-left font-medium">
              <SortableHeader label="GPU Model" sortKey="gpuModelName" sortState={sort} onSort={handleSort} />
            </th>
            <th className="py-2 px-2 text-left font-medium">Pipeline</th>
            <th className="py-2 px-2 text-left font-medium">Region</th>
            <th className="py-2 px-2 text-right font-medium">
              <SortableHeader label="Avg FPS" sortKey="avgOutputFps" sortState={sort} onSort={handleSort} />
            </th>
            <th className="py-2 px-2 text-right font-medium">
              <SortableHeader label="P95 FPS" sortKey="p95OutputFps" sortState={sort} onSort={handleSort} />
            </th>
            <th className="py-2 px-2 text-right font-medium">
              <SortableHeader label="Sessions" sortKey="knownSessionsCount" sortState={sort} onSort={handleSort} />
            </th>
            <th className="py-2 px-2 text-right font-medium">
              <SortableHeader label="Swap Rate" sortKey="swapRate" sortState={sort} onSort={handleSort} />
            </th>
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
        <TablePagination
          page={page}
          totalRows={filtered.length}
          rowsPerPage={ROWS_PER_PAGE}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}

function DemandTable({
  data,
  search,
}: {
  data: RawNetworkDemandRow[];
  search?: string;
}) {
  const [sort, setSort] = useState<SortState<RawNetworkDemandRow>>({ key: 'sessionsCount', dir: 'desc' });
  const [page, setPage] = useState(1);

  const handleSort = (key: keyof RawNetworkDemandRow) => {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'desc' ? 'asc' : s.dir === 'asc' ? null : 'desc' }
        : { key, dir: 'desc' }
    );
    setPage(1);
  };

  const filtered = useMemo(() => {
    let rows = data;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.gateway?.toLowerCase().includes(q) ||
          r.pipelineId?.toLowerCase().includes(q) ||
          r.modelId?.toLowerCase().includes(q) ||
          r.region?.toLowerCase().includes(q)
      );
    }
    if (sort.key && sort.dir) {
      const k = sort.key;
      const dir = sort.dir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const av = a[k];
        const bv = b[k];
        if (av == null && bv == null) return 0;
        if (av == null) return dir;
        if (bv == null) return -dir;
        return av < bv ? -dir : av > bv ? dir : 0;
      });
    }
    return rows;
  }, [data, search, sort]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
    if (page > maxPage) setPage(1);
  }, [filtered.length, page]);

  const paginated = useMemo(
    () => filtered.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE),
    [filtered, page]
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2 px-2 text-left font-medium">Gateway</th>
            <th className="py-2 px-2 text-left font-medium">Pipeline</th>
            <th className="py-2 px-2 text-left font-medium">Model</th>
            <th className="py-2 px-2 text-left font-medium">Region</th>
            <th className="py-2 px-2 text-right font-medium">
              <SortableHeader label="Sessions" sortKey="sessionsCount" sortState={sort} onSort={handleSort} />
            </th>
            <th className="py-2 px-2 text-right font-medium">
              <SortableHeader label="Minutes" sortKey="totalMinutes" sortState={sort} onSort={handleSort} />
            </th>
            <th className="py-2 px-2 text-right font-medium">
              <SortableHeader label="Served" sortKey="servedSessions" sortState={sort} onSort={handleSort} />
            </th>
            <th className="py-2 px-2 text-right font-medium">
              <SortableHeader label="Success" sortKey="startupSuccessRate" sortState={sort} onSort={handleSort} />
            </th>
            <th className="py-2 px-2 text-right font-medium">
              <SortableHeader label="ETH" sortKey="ticketFaceValueEth" sortState={sort} onSort={handleSort} />
            </th>
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
        <TablePagination
          page={page}
          totalRows={filtered.length}
          rowsPerPage={ROWS_PER_PAGE}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}

function CapabilitiesTable({
  data,
  search,
}: {
  data: DashboardPipelineCatalogEntry[];
  search?: string;
}) {
  const filtered = useMemo(() => {
    let rows = data;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.id?.toLowerCase().includes(q) ||
          r.name?.toLowerCase().includes(q) ||
          r.models?.some((m) => m.toLowerCase().includes(q)) ||
          r.regions?.some((reg) => reg.toLowerCase().includes(q))
      );
    }
    return rows;
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
                  {row.models?.slice(0, 5).map((m) => (
                    <span key={m} className="px-1.5 py-0.5 rounded bg-muted/70 text-[10px] text-foreground">{m}</span>
                  ))}
                  {row.models?.length > 5 && (
                    <span className="px-1.5 py-0.5 rounded bg-muted/50 text-[10px] text-muted-foreground">
                      +{row.models.length - 5} more
                    </span>
                  )}
                </div>
              </td>
              <td className="py-1.5 px-2">
                <div className="flex flex-wrap gap-1">
                  {row.regions?.length > 0 ? (
                    row.regions.slice(0, 5).map((r) => (
                      <span key={r} className="px-1.5 py-0.5 rounded bg-accent-blue/10 text-accent-blue text-[10px]">{r}</span>
                    ))
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                  {row.regions?.length > 5 && (
                    <span className="px-1.5 py-0.5 rounded bg-muted/50 text-[10px] text-muted-foreground">
                      +{row.regions.length - 5} more
                    </span>
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

interface ModelMetricsRow {
  pipelineId: string;
  modelId: string | null;
  avgFps: number | null;
  p95Fps: number | null;
  swapRate: number | null;
  successRate: number | null;
  sessionsCount: number;
}

function aggregateByModel(
  gpuRows: RawGPUMetricRow[],
  slaRows: RawSLAComplianceRow[]
): ModelMetricsRow[] {
  const key = (p: string, m: string | null) => `${p}\0${m ?? ''}`;
  const gpuByKey = new Map<string, { totalFps: number; totalP95: number; totalSwap: number; weight: number }>();
  for (const r of gpuRows) {
    const k = key(r.pipelineId, r.modelId);
    const w = r.knownSessionsCount ?? 0;
    const cur = gpuByKey.get(k);
    if (cur) {
      cur.totalFps += (r.avgOutputFps ?? 0) * w;
      cur.totalP95 += (r.p95OutputFps ?? 0) * w;
      cur.totalSwap += (r.swapRate ?? 0) * w;
      cur.weight += w;
    } else {
      gpuByKey.set(k, {
        totalFps: (r.avgOutputFps ?? 0) * w,
        totalP95: (r.p95OutputFps ?? 0) * w,
        totalSwap: (r.swapRate ?? 0) * w,
        weight: w,
      });
    }
  }
  const slaByKey = new Map<string, { totalSuccess: number; weight: number }>();
  for (const r of slaRows) {
    const k = key(r.pipelineId, r.modelId);
    const w = r.knownSessionsCount ?? 0;
    const rate = r.effectiveSuccessRate ?? r.startupSuccessRate ?? null;
    if (rate == null) continue;
    const cur = slaByKey.get(k);
    if (cur) {
      cur.totalSuccess += rate * w;
      cur.weight += w;
    } else {
      slaByKey.set(k, { totalSuccess: rate * w, weight: w });
    }
  }
  const keys = new Set([...gpuByKey.keys(), ...slaByKey.keys()]);
  const rows: ModelMetricsRow[] = [];
  for (const k of keys) {
    const [pipelineId, modelIdStr] = k.split('\0');
    const modelId = modelIdStr || null;
    const gpu = gpuByKey.get(k);
    const sla = slaByKey.get(k);
    const gpuWeight = gpu?.weight ?? 0;
    const slaWeight = sla?.weight ?? 0;
    rows.push({
      pipelineId,
      modelId: modelId || null,
      avgFps: gpuWeight > 0 && gpu ? gpu.totalFps / gpuWeight : null,
      p95Fps: gpuWeight > 0 && gpu ? gpu.totalP95 / gpuWeight : null,
      swapRate: gpuWeight > 0 && gpu ? gpu.totalSwap / gpuWeight : null,
      successRate: slaWeight > 0 && sla ? sla.totalSuccess / sla.weight : null,
      sessionsCount: Math.max(gpuWeight, slaWeight),
    });
  }
  return rows.sort((a, b) => b.sessionsCount - a.sessionsCount);
}

function ModelsTable({
  data,
  search,
}: {
  data: ModelMetricsRow[];
  search?: string;
}) {
  const [sort, setSort] = useState<SortState<ModelMetricsRow>>({ key: 'sessionsCount', dir: 'desc' });
  const [page, setPage] = useState(1);

  const handleSort = (key: keyof ModelMetricsRow) => {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'desc' ? 'asc' : s.dir === 'asc' ? null : 'desc' }
        : { key, dir: 'desc' }
    );
    setPage(1);
  };

  const filtered = useMemo(() => {
    let rows = data;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.pipelineId?.toLowerCase().includes(q) ||
          (r.modelId ?? '').toLowerCase().includes(q)
      );
    }
    if (sort.key && sort.dir) {
      const k = sort.key;
      const dir = sort.dir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const av = a[k];
        const bv = b[k];
        if (av == null && bv == null) return 0;
        if (av == null) return dir;
        if (bv == null) return -dir;
        return av < bv ? -dir : av > bv ? dir : 0;
      });
    }
    return rows;
  }, [data, search, sort]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
    if (page > maxPage) setPage(1);
  }, [filtered.length, page]);

  const paginated = useMemo(
    () => filtered.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE),
    [filtered, page]
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2 px-2 text-left font-medium">Pipeline</th>
            <th className="py-2 px-2 text-left font-medium">Model</th>
            <th className="py-2 px-2 text-right font-medium">
              <SortableHeader label="Avg FPS" sortKey="avgFps" sortState={sort} onSort={handleSort} />
            </th>
            <th className="py-2 px-2 text-right font-medium">
              <SortableHeader label="P95 FPS" sortKey="p95Fps" sortState={sort} onSort={handleSort} />
            </th>
            <th className="py-2 px-2 text-right font-medium">
              <SortableHeader label="Swap rate" sortKey="swapRate" sortState={sort} onSort={handleSort} />
            </th>
            <th className="py-2 px-2 text-right font-medium">
              <SortableHeader label="Success rate" sortKey="successRate" sortState={sort} onSort={handleSort} />
            </th>
            <th className="py-2 px-2 text-right font-medium">
              <SortableHeader label="Sessions" sortKey="sessionsCount" sortState={sort} onSort={handleSort} />
            </th>
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
        <TablePagination
          page={page}
          totalRows={filtered.length}
          rowsPerPage={ROWS_PER_PAGE}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}

function parseFiltersFromParams(params: URLSearchParams): ExplorerFilters {
  return {
    pipelineId: params.get(`${EXPLORER_PREFIX}pipelineId`) || undefined,
    modelId: params.get(`${EXPLORER_PREFIX}modelId`) || undefined,
    region: params.get(`${EXPLORER_PREFIX}region`) || undefined,
    orchestratorAddress: params.get(`${EXPLORER_PREFIX}orch`) || undefined,
    gateway: params.get(`${EXPLORER_PREFIX}gateway`) || undefined,
    gpuId: params.get(`${EXPLORER_PREFIX}gpuId`) || undefined,
    gpuModelName: params.get(`${EXPLORER_PREFIX}gpu`) || undefined,
    cudaVersion: params.get(`${EXPLORER_PREFIX}cudaVer`) || undefined,
    runnerVersion: params.get(`${EXPLORER_PREFIX}runnerVer`) || undefined,
    search: params.get(`${EXPLORER_PREFIX}q`) || undefined,
  };
}

interface DashboardError {
  type: string;
  message: string;
}

interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: DashboardError | null;
}

const NO_PROVIDER_RETRY_DELAYS = [1000, 2000, 3000, 5000];

function useDashboardQuery<T>(
  query: string,
  variables?: Record<string, unknown>
): QueryState<T> & { refetch: () => void } {
  const { request } = usePluginEvent();
  const [state, setState] = useState<QueryState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  const mountedRef = useRef(true);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const variablesKey = variables ? JSON.stringify(variables) : '';

  const fetchData = useCallback(async () => {
    if (!mountedRef.current) return;
    setState((s) => ({ ...s, loading: true }));

    try {
      const response = await request<DashboardQueryRequest, DashboardQueryResponse>(
        DASHBOARD_QUERY_EVENT,
        { query, variables },
        { timeout: 8000 }
      );

      if (!mountedRef.current) return;
      retryCountRef.current = 0;

      if (response.errors && response.errors.length > 0 && !response.data) {
        setState({
          data: null,
          loading: false,
          error: {
            type: 'query-error',
            message: response.errors.map((e) => e.message).join('; '),
          },
        });
      } else {
        setState({
          data: (response.data as T) ?? null,
          loading: false,
          error: null,
        });
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;

      const code = (err as any)?.code;
      if (code === 'NO_HANDLER') {
        const retryIndex = retryCountRef.current;
        if (retryIndex < NO_PROVIDER_RETRY_DELAYS.length) {
          const delay = NO_PROVIDER_RETRY_DELAYS[retryIndex];
          retryCountRef.current = retryIndex + 1;
          retryTimerRef.current = setTimeout(() => {
            if (mountedRef.current) fetchData();
          }, delay);
          return;
        }
        setState({
          data: null,
          loading: false,
          error: { type: 'no-provider', message: 'No dashboard data provider is registered' },
        });
      } else if (code === 'TIMEOUT') {
        setState({
          data: null,
          loading: false,
          error: { type: 'timeout', message: 'Dashboard data provider did not respond in time' },
        });
      } else {
        setState({
          data: null,
          loading: false,
          error: {
            type: 'unknown',
            message: (err as Error)?.message ?? 'Unknown error fetching dashboard data',
          },
        });
      }
    }
  }, [request, query, variablesKey]);

  useEffect(() => {
    mountedRef.current = true;
    retryCountRef.current = 0;
    fetchData();
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [fetchData]);

  return { ...state, refetch: fetchData };
}

export const RawExplorerPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const initialDataset = (searchParams.get(`${EXPLORER_PREFIX}ds`) as Dataset) || 'orchestrators';
  const initialPeriod = searchParams.get(`${EXPLORER_PREFIX}period`) || '24h';
  const initialFilters = parseFiltersFromParams(searchParams);

  const [dataset, setDataset] = useState<Dataset>(initialDataset);
  const [filters, setFilters] = useState<ExplorerFilters>(initialFilters);
  const [period, setPeriod] = useState(initialPeriod);

  const updateUrl = useCallback(
    (newFilters: ExplorerFilters, newDataset: Dataset, newPeriod: string) => {
      const params = new URLSearchParams();
      params.set(`${EXPLORER_PREFIX}ds`, newDataset);
      params.set(`${EXPLORER_PREFIX}period`, newPeriod);
      if (newFilters.pipelineId) params.set(`${EXPLORER_PREFIX}pipelineId`, newFilters.pipelineId);
      if (newFilters.modelId) params.set(`${EXPLORER_PREFIX}modelId`, newFilters.modelId);
      if (newFilters.region) params.set(`${EXPLORER_PREFIX}region`, newFilters.region);
      if (newFilters.orchestratorAddress) params.set(`${EXPLORER_PREFIX}orch`, newFilters.orchestratorAddress);
      if (newFilters.gateway) params.set(`${EXPLORER_PREFIX}gateway`, newFilters.gateway);
      if (newFilters.gpuId) params.set(`${EXPLORER_PREFIX}gpuId`, newFilters.gpuId);
      if (newFilters.gpuModelName) params.set(`${EXPLORER_PREFIX}gpu`, newFilters.gpuModelName);
      if (newFilters.cudaVersion) params.set(`${EXPLORER_PREFIX}cudaVer`, newFilters.cudaVersion);
      if (newFilters.runnerVersion) params.set(`${EXPLORER_PREFIX}runnerVer`, newFilters.runnerVersion);
      if (newFilters.search) params.set(`${EXPLORER_PREFIX}q`, newFilters.search);
      setSearchParams(params, { replace: true });
    },
    [setSearchParams]
  );

  const handleFiltersChange = useCallback(
    (newFilters: ExplorerFilters) => {
      setFilters(newFilters);
      updateUrl(newFilters, dataset, period);
    },
    [dataset, period, updateUrl]
  );

  const handleDatasetChange = useCallback(
    (newDataset: Dataset) => {
      setDataset(newDataset);
      updateUrl(filters, newDataset, period);
    },
    [filters, period, updateUrl]
  );

  const handlePeriodChange = useCallback(
    (newPeriod: string) => {
      setPeriod(newPeriod);
      updateUrl(filters, dataset, newPeriod);
    },
    [dataset, filters, updateUrl]
  );

  const slaVars = {
    period,
    orchestratorAddress: filters.orchestratorAddress,
    pipelineId: filters.pipelineId,
    modelId: filters.modelId,
    gpuId: filters.gpuId,
    region: filters.region,
  };

  const gpuTimeRange = period === '1h' ? '1h' : '24h';
  const gpuVars = {
    timeRange: gpuTimeRange,
    orchestratorAddress: filters.orchestratorAddress,
    pipelineId: filters.pipelineId,
    modelId: filters.modelId,
    gpuId: filters.gpuId,
    region: filters.region,
    gpuModelName: filters.gpuModelName,
    runnerVersion: filters.runnerVersion,
    cudaVersion: filters.cudaVersion,
  };

  const demandInterval = period === '1h' ? '5m' : period === '6h' ? '30m' : period === '24h' ? '2h' : '6h';
  const demandVars = {
    interval: demandInterval,
    gateway: filters.gateway,
    pipelineId: filters.pipelineId,
    modelId: filters.modelId,
    region: filters.region,
  };

  const { data: slaData, loading: slaLoading, error: slaError } = useDashboardQuery<{
    slaCompliance: RawSLAComplianceRow[];
    pipelineCatalog: DashboardPipelineCatalogEntry[];
  }>(SLA_QUERY, slaVars);

  const { data: gpuData, loading: gpuLoading, error: gpuError } = useDashboardQuery<{
    gpuMetrics: RawGPUMetricRow[];
    pipelineCatalog: DashboardPipelineCatalogEntry[];
  }>(GPU_QUERY, gpuVars);

  const { data: demandData, loading: demandLoading, error: demandError } = useDashboardQuery<{
    networkDemand: RawNetworkDemandRow[];
    pipelineCatalog: DashboardPipelineCatalogEntry[];
  }>(DEMAND_QUERY, demandVars);

  const catalog = slaData?.pipelineCatalog ?? gpuData?.pipelineCatalog ?? demandData?.pipelineCatalog ?? [];

  const modelsData = useMemo(() => {
    if (!gpuData?.gpuMetrics || !slaData?.slaCompliance) return [];
    return aggregateByModel(gpuData.gpuMetrics, slaData.slaCompliance);
  }, [gpuData?.gpuMetrics, slaData?.slaCompliance]);

  const loading = dataset === 'orchestrators' ? slaLoading
    : dataset === 'hardware' ? gpuLoading
    : dataset === 'demand' ? demandLoading
    : dataset === 'models' ? slaLoading || gpuLoading
    : slaLoading;
  const error = dataset === 'orchestrators' ? slaError
    : dataset === 'hardware' ? gpuError
    : dataset === 'demand' ? demandError
    : dataset === 'models' ? slaError ?? gpuError
    : slaError;

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
                  <button
                    key={key}
                    onClick={() => handleDatasetChange(key)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors ${
                      dataset === key
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>
          <FilterBar
            filters={filters}
            onChange={handleFiltersChange}
            catalog={catalog}
            showOrchestrator={dataset === 'orchestrators' || dataset === 'hardware'}
            showGateway={dataset === 'demand'}
            showGpuId={dataset === 'orchestrators' || dataset === 'hardware'}
            showGpuModel={dataset === 'hardware'}
            showCudaVersion={dataset === 'hardware'}
            showRunnerVersion={dataset === 'hardware'}
            period={period}
            onPeriodChange={handlePeriodChange}
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
              {dataset === 'orchestrators' && slaData?.slaCompliance && (
                <OrchestratorsTable data={slaData.slaCompliance} search={filters.search} />
              )}
              {dataset === 'hardware' && gpuData?.gpuMetrics && (
                <HardwareTable data={gpuData.gpuMetrics} search={filters.search} />
              )}
              {dataset === 'demand' && demandData?.networkDemand && (
                <DemandTable data={demandData.networkDemand} search={filters.search} />
              )}
              {dataset === 'models' && (
                <ModelsTable data={modelsData} search={filters.search} />
              )}
              {dataset === 'capabilities' && catalog.length > 0 && (
                <CapabilitiesTable data={catalog} search={filters.search} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default RawExplorerPage;
