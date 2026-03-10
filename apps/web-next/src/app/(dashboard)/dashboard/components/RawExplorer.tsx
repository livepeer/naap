'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useDashboardQuery } from '@/hooks/useDashboardQuery';
import type {
  RawNetworkDemandRow,
  RawGPUMetricRow,
  RawSLAComplianceRow,
  DashboardPipelineCatalogEntry,
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
} from 'lucide-react';

type Dataset = 'orchestrators' | 'hardware' | 'demand' | 'capabilities';

const EXPLORER_PREFIX = 'exp_';

const DATASET_CONFIG = {
  orchestrators: { label: 'Orchestrators', icon: Server },
  hardware: { label: 'Hardware', icon: Cpu },
  demand: { label: 'Demand', icon: Activity },
  capabilities: { label: 'Capabilities', icon: Layers },
} as const;

interface ExplorerFilters {
  pipelineId?: string;
  modelId?: string;
  region?: string;
  orchestratorAddress?: string;
  gpuModelName?: string;
  search?: string;
}

const SLA_QUERY = /* GraphQL */ `
  query RawSLA($period: String, $orchestratorAddress: String, $pipelineId: String, $modelId: String, $region: String) {
    slaCompliance(period: $period, orchestratorAddress: $orchestratorAddress, pipelineId: $pipelineId, modelId: $modelId, region: $region) {
      windowStart orchestratorAddress pipelineId modelId gpuId region
      knownSessionsCount startupSuccessSessions startupExcusedSessions startupUnexcusedSessions
      confirmedSwappedSessions inferredSwapSessions totalSwappedSessions sessionsEndingInError
      errorStatusSamples healthSignalCoverageRatio startupSuccessRate effectiveSuccessRate noSwapRate slaScore
    }
    pipelineCatalog { id name models regions }
  }
`;

const GPU_QUERY = /* GraphQL */ `
  query RawGPU($timeRange: String, $orchestratorAddress: String, $pipelineId: String, $modelId: String, $region: String, $gpuModelName: String) {
    gpuMetrics(timeRange: $timeRange, orchestratorAddress: $orchestratorAddress, pipelineId: $pipelineId, modelId: $modelId, region: $region, gpuModelName: $gpuModelName) {
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

function FilterBar({
  filters,
  onChange,
  catalog,
  showOrchestrator,
  showGpuModel,
  period,
  onPeriodChange,
}: {
  filters: ExplorerFilters;
  onChange: (f: ExplorerFilters) => void;
  catalog: DashboardPipelineCatalogEntry[];
  showOrchestrator?: boolean;
  showGpuModel?: boolean;
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
        className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary"
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
          placeholder="Search..."
          value={filters.search ?? ''}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="pl-8 pr-3 py-1.5 text-xs rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary w-40"
        />
      </div>
      <select
        value={filters.pipelineId ?? ''}
        onChange={(e) => onChange({ ...filters, pipelineId: e.target.value || undefined })}
        className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary"
      >
        <option value="">All Pipelines</option>
        {pipelines.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      <select
        value={filters.modelId ?? ''}
        onChange={(e) => onChange({ ...filters, modelId: e.target.value || undefined })}
        className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary"
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
          className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary"
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
          className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary w-32"
        />
      )}
      {showGpuModel && (
        <input
          type="text"
          placeholder="GPU Model..."
          value={filters.gpuModelName ?? ''}
          onChange={(e) => onChange({ ...filters, gpuModelName: e.target.value || undefined })}
          className="px-2 py-1.5 text-xs rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary w-28"
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

  const handleSort = (key: keyof RawSLAComplianceRow) => {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'desc' ? 'asc' : s.dir === 'asc' ? null : 'desc' }
        : { key, dir: 'desc' }
    );
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
          {filtered.slice(0, 100).map((row, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
              <td className="py-1.5 px-2 font-mono text-[11px]">{truncateAddress(row.orchestratorAddress)}</td>
              <td className="py-1.5 px-2">{row.pipelineId}</td>
              <td className="py-1.5 px-2 text-muted-foreground">{row.modelId ?? '—'}</td>
              <td className="py-1.5 px-2 text-muted-foreground">{row.region ?? '—'}</td>
              <td className="py-1.5 px-2 text-right">{formatNumber(row.knownSessionsCount)}</td>
              <td className="py-1.5 px-2 text-right">{formatPercent(row.startupSuccessRate)}</td>
              <td className="py-1.5 px-2 text-right">{formatPercent(row.effectiveSuccessRate)}</td>
              <td className="py-1.5 px-2 text-right">{formatPercent(row.noSwapRate)}</td>
              <td className="py-1.5 px-2 text-right">{row.slaScore != null ? `${(row.slaScore * 100).toFixed(0)}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length > 100 && (
        <p className="text-xs text-muted-foreground mt-2 px-2">Showing 100 of {filtered.length} rows</p>
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

  const handleSort = (key: keyof RawGPUMetricRow) => {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'desc' ? 'asc' : s.dir === 'asc' ? null : 'desc' }
        : { key, dir: 'desc' }
    );
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
            <th className="py-2 px-2 text-left font-medium">Version</th>
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, 100).map((row, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
              <td className="py-1.5 px-2 font-mono text-[11px]">{truncateAddress(row.orchestratorAddress)}</td>
              <td className="py-1.5 px-2">{row.gpuModelName ?? '—'}</td>
              <td className="py-1.5 px-2">{row.pipelineId}</td>
              <td className="py-1.5 px-2 text-muted-foreground">{row.region ?? '—'}</td>
              <td className="py-1.5 px-2 text-right">{row.avgOutputFps?.toFixed(1) ?? '—'}</td>
              <td className="py-1.5 px-2 text-right">{row.p95OutputFps?.toFixed(1) ?? '—'}</td>
              <td className="py-1.5 px-2 text-right">{formatNumber(row.knownSessionsCount)}</td>
              <td className="py-1.5 px-2 text-right">{formatPercent(row.swapRate)}</td>
              <td className="py-1.5 px-2 text-muted-foreground text-[10px]">{row.runnerVersion ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length > 100 && (
        <p className="text-xs text-muted-foreground mt-2 px-2">Showing 100 of {filtered.length} rows</p>
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

  const handleSort = (key: keyof RawNetworkDemandRow) => {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'desc' ? 'asc' : s.dir === 'asc' ? null : 'desc' }
        : { key, dir: 'desc' }
    );
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
          {filtered.slice(0, 100).map((row, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
              <td className="py-1.5 px-2">{row.gateway}</td>
              <td className="py-1.5 px-2">{row.pipelineId}</td>
              <td className="py-1.5 px-2 text-muted-foreground">{row.modelId ?? '—'}</td>
              <td className="py-1.5 px-2 text-muted-foreground">{row.region ?? '—'}</td>
              <td className="py-1.5 px-2 text-right">{formatNumber(row.sessionsCount)}</td>
              <td className="py-1.5 px-2 text-right">{row.totalMinutes?.toFixed(1) ?? '—'}</td>
              <td className="py-1.5 px-2 text-right">{formatNumber(row.servedSessions)}</td>
              <td className="py-1.5 px-2 text-right">{formatPercent(row.startupSuccessRate)}</td>
              <td className="py-1.5 px-2 text-right font-mono">{row.ticketFaceValueEth?.toFixed(4) ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length > 100 && (
        <p className="text-xs text-muted-foreground mt-2 px-2">Showing 100 of {filtered.length} rows</p>
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
              <td className="py-1.5 px-2 font-mono text-[11px]">{row.id}</td>
              <td className="py-1.5 px-2">{row.name}</td>
              <td className="py-1.5 px-2">
                <div className="flex flex-wrap gap-1">
                  {row.models?.slice(0, 5).map((m) => (
                    <span key={m} className="px-1.5 py-0.5 rounded bg-muted/70 text-[10px]">{m}</span>
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
                      <span key={r} className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[10px]">{r}</span>
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

function parseFiltersFromParams(params: URLSearchParams): ExplorerFilters {
  return {
    pipelineId: params.get(`${EXPLORER_PREFIX}pipelineId`) || undefined,
    modelId: params.get(`${EXPLORER_PREFIX}modelId`) || undefined,
    region: params.get(`${EXPLORER_PREFIX}region`) || undefined,
    orchestratorAddress: params.get(`${EXPLORER_PREFIX}orch`) || undefined,
    gpuModelName: params.get(`${EXPLORER_PREFIX}gpu`) || undefined,
    search: params.get(`${EXPLORER_PREFIX}q`) || undefined,
  };
}

function filtersToParams(filters: ExplorerFilters, dataset: Dataset, period: string): URLSearchParams {
  const params = new URLSearchParams();
  params.set(`${EXPLORER_PREFIX}ds`, dataset);
  params.set(`${EXPLORER_PREFIX}period`, period);
  if (filters.pipelineId) params.set(`${EXPLORER_PREFIX}pipelineId`, filters.pipelineId);
  if (filters.modelId) params.set(`${EXPLORER_PREFIX}modelId`, filters.modelId);
  if (filters.region) params.set(`${EXPLORER_PREFIX}region`, filters.region);
  if (filters.orchestratorAddress) params.set(`${EXPLORER_PREFIX}orch`, filters.orchestratorAddress);
  if (filters.gpuModelName) params.set(`${EXPLORER_PREFIX}gpu`, filters.gpuModelName);
  if (filters.search) params.set(`${EXPLORER_PREFIX}q`, filters.search);
  return params;
}

export function RawExplorer() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const initialDataset = (searchParams.get(`${EXPLORER_PREFIX}ds`) as Dataset) || 'orchestrators';
  const initialPeriod = searchParams.get(`${EXPLORER_PREFIX}period`) || '24h';
  const initialFilters = parseFiltersFromParams(searchParams);

  const [dataset, setDataset] = useState<Dataset>(initialDataset);
  const [filters, setFilters] = useState<ExplorerFilters>(initialFilters);
  const [period, setPeriod] = useState(initialPeriod);

  const updateUrl = useCallback(
    (newFilters: ExplorerFilters, newDataset: Dataset, newPeriod: string) => {
      const params = filtersToParams(newFilters, newDataset, newPeriod);
      const existing = new URLSearchParams(searchParams.toString());
      existing.forEach((_, key) => {
        if (key.startsWith(EXPLORER_PREFIX)) existing.delete(key);
      });
      params.forEach((value, key) => existing.set(key, value));
      router.replace(`${pathname}?${existing.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
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
    region: filters.region,
  };

  // GPU metrics API only supports '1h' and '24h' for time_range; map period accordingly
  const gpuTimeRange = period === '1h' ? '1h' : '24h';
  const gpuVars = {
    timeRange: gpuTimeRange,
    orchestratorAddress: filters.orchestratorAddress,
    pipelineId: filters.pipelineId,
    modelId: filters.modelId,
    region: filters.region,
    gpuModelName: filters.gpuModelName,
  };

  // Map period to demand interval (API uses interval*12 for lookback window)
  const demandInterval = period === '1h' ? '5m' : period === '6h' ? '30m' : period === '24h' ? '2h' : '6h';
  const demandVars = {
    interval: demandInterval,
    pipelineId: filters.pipelineId,
    modelId: filters.modelId,
    region: filters.region,
  };

  const { data: slaData, loading: slaLoading, error: slaError } = useDashboardQuery<{
    slaCompliance: RawSLAComplianceRow[];
    pipelineCatalog: DashboardPipelineCatalogEntry[];
  }>(SLA_QUERY, slaVars, { pollInterval: 0 });

  const { data: gpuData, loading: gpuLoading, error: gpuError } = useDashboardQuery<{
    gpuMetrics: RawGPUMetricRow[];
    pipelineCatalog: DashboardPipelineCatalogEntry[];
  }>(GPU_QUERY, gpuVars, { pollInterval: 0 });

  const { data: demandData, loading: demandLoading, error: demandError } = useDashboardQuery<{
    networkDemand: RawNetworkDemandRow[];
    pipelineCatalog: DashboardPipelineCatalogEntry[];
  }>(DEMAND_QUERY, demandVars, { pollInterval: 0 });

  const catalog = slaData?.pipelineCatalog ?? gpuData?.pipelineCatalog ?? demandData?.pipelineCatalog ?? [];

  const loading = dataset === 'orchestrators' ? slaLoading
    : dataset === 'hardware' ? gpuLoading
    : dataset === 'demand' ? demandLoading
    : slaLoading; // capabilities uses catalog from any query
  const error = dataset === 'orchestrators' ? slaError
    : dataset === 'hardware' ? gpuError
    : dataset === 'demand' ? demandError
    : slaError;

  return (
    <div className="rounded-lg border border-border bg-card/50 overflow-hidden">
      <div className="p-3 border-b border-border bg-muted/30 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Filter className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">Raw Metrics Explorer</span>
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
          showGpuModel={dataset === 'hardware'}
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
            {dataset === 'capabilities' && catalog.length > 0 && (
              <CapabilitiesTable data={catalog} search={filters.search} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
