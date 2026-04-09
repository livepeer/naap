'use client';

import { useMemo, useState } from 'react';
import type {
  DashboardOrchestrator,
  DashboardPipelineCatalogEntry,
  DashboardPipelinePricing,
} from '@naap/plugin-sdk';
import { useClipboardFlash } from '@/hooks/useClipboardFlash';
import { Check, ChevronDown, ChevronUp, ChevronsUpDown, Copy, Server } from 'lucide-react';
import { PIPELINE_COLOR } from '@/lib/dashboard/pipeline-config';

// ============================================================================
// Shared display helpers (mirrors overview-content — not exported there)
// ============================================================================

const MODEL_BADGE_COLORS = [
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
  'bg-lime-100 text-lime-800 dark:bg-lime-900/40 dark:text-lime-200',
  'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-200',
  'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200',
] as const;

const MODEL_HEX_TO_BADGE_CLASSES: Record<string, string> = {
  '#9f1239': 'bg-rose-100    text-rose-800    dark:bg-rose-900/40    dark:text-rose-200',
  '#10b981': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  '#8b5cf6': 'bg-violet-100  text-violet-800  dark:bg-violet-900/40  dark:text-violet-200',
  '#3b82f6': 'bg-sky-100     text-sky-800     dark:bg-sky-900/40     dark:text-sky-200',
  '#f59e0b': 'bg-amber-100   text-amber-800   dark:bg-amber-900/40   dark:text-amber-200',
  '#84cc16': 'bg-lime-100    text-lime-800    dark:bg-lime-900/40    dark:text-lime-200',
  '#a855f7': 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-200',
  '#06b6d4': 'bg-cyan-100    text-cyan-800    dark:bg-cyan-900/40    dark:text-cyan-200',
  '#ec4899': 'bg-pink-100    text-pink-800    dark:bg-pink-900/40    dark:text-pink-200',
  '#f97316': 'bg-orange-100  text-orange-800  dark:bg-orange-900/40  dark:text-orange-200',
  '#14b8a6': 'bg-teal-100    text-teal-800    dark:bg-teal-900/40    dark:text-teal-200',
  '#6366f1': 'bg-indigo-100  text-indigo-800  dark:bg-indigo-900/40  dark:text-indigo-200',
};

function hashModelId(modelId: string): number {
  let n = 0;
  for (let i = 0; i < modelId.length; i++) n += modelId.charCodeAt(i);
  return Math.abs(n) % MODEL_BADGE_COLORS.length;
}

function modelBadgeColor(modelId: string, fallbackPipelineId?: string): string {
  const hex = PIPELINE_COLOR[modelId];
  if (hex) return MODEL_HEX_TO_BADGE_CLASSES[hex] ?? MODEL_BADGE_COLORS[hashModelId(modelId)];
  const fallbackHex = fallbackPipelineId ? PIPELINE_COLOR[fallbackPipelineId] : undefined;
  if (fallbackHex) return MODEL_HEX_TO_BADGE_CLASSES[fallbackHex] ?? MODEL_BADGE_COLORS[hashModelId(modelId)];
  return MODEL_BADGE_COLORS[hashModelId(modelId)];
}

function avgWeiBigIntForPricingRow(p: DashboardPipelinePricing | undefined): bigint | null {
  if (!p) return null;
  const s = p.avgWeiPerUnit?.trim();
  if (s && /^\d+$/.test(s)) {
    try {
      const v = BigInt(s);
      if (v > 0n) return v;
    } catch {
      /* ignore invalid bigint */
    }
  }
  if (p.price > 0 && Number.isFinite(p.price)) {
    const r = Math.round(p.price * 1e12);
    if (r > 0 && Number.isFinite(r)) return BigInt(r);
  }
  return null;
}

function copyInlineHoverCls(): string {
  return 'rounded p-0.5 shrink-0 text-muted-foreground hover:text-foreground opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card group-hover:opacity-100 group-focus-within:opacity-100';
}

function CopyButton({
  copied,
  onCopy,
  title,
  ariaLabel,
}: {
  copied: boolean;
  onCopy: () => void | Promise<void>;
  title: string;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      className={`${copyInlineHoverCls()}${copied ? ' !opacity-100' : ''}`.trim()}
      title={title}
      aria-label={ariaLabel}
    >
      {copied ? <Check className="w-3 h-3 text-primary" aria-hidden /> : <Copy className="w-3 h-3" aria-hidden />}
    </button>
  );
}

// ============================================================================
// Orchestrator-specific helpers
// ============================================================================

function formatPipelineLabel(
  pipelineId: string,
  catalog: DashboardPipelineCatalogEntry[] | null | undefined,
  modelIds?: string[] | null,
): string {
  const entry = catalog?.find((p) => p.id === pipelineId);
  const name = entry?.name ?? pipelineId;
  if (modelIds?.length) return `${name} (${modelIds.join(', ')})`;
  return name;
}

function stripOrchestratorServiceUri(uri: string): string {
  return uri.replace(/^https?:\/\//, '');
}

function formatOrchestratorLastSeenForTooltip(iso: string | null | undefined): string {
  if (!iso?.trim()) return 'Last seen: —';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return `Last seen: ${iso}`;
  return `Last seen: ${new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

function orchestratorModelPriceForTooltip(
  pricing: DashboardPipelinePricing | undefined,
  modelLabel: string,
): string {
  if (modelLabel === '—') return 'Price: —';
  const wei = avgWeiBigIntForPricingRow(pricing);
  if (wei != null) return `Price: ${wei.toLocaleString('en-US')} wei/${pricing?.unit ?? 'unit'}`;
  return 'Price: —';
}

function orchestratorModelTagTooltip(
  pipelineName: string,
  modelLabel: string,
  uris: string[],
  opts: { lastSeen?: string | null; pricing?: DashboardPipelinePricing },
): string {
  const lines = [
    `Model: ${modelLabel}`,
    `Pipeline: ${pipelineName}`,
    formatOrchestratorLastSeenForTooltip(opts.lastSeen),
    orchestratorModelPriceForTooltip(opts.pricing, modelLabel),
  ];
  if (uris.length === 1) {
    lines.push(`Service URI: ${stripOrchestratorServiceUri(uris[0])}`);
  } else if (uris.length > 1) {
    lines.push(
      'Models are aggregated per orchestrator address (not per URI). Service URIs:',
      ...uris.map((u) => `· ${stripOrchestratorServiceUri(u)}`),
    );
  }
  return lines.join('\n');
}

// ============================================================================
// OrchestratorTableCard
// ============================================================================

type OrchestratorSortCol = 'uri' | 'knownSessions' | 'successRatio' | 'effectiveSuccessRate' | 'slaScore' | 'gpuCount';

export function OrchestratorTableCard({
  data,
  catalog,
  pricing,
}: {
  data: DashboardOrchestrator[];
  catalog?: DashboardPipelineCatalogEntry[] | null;
  pricing: DashboardPipelinePricing[];
}) {
  const [sortCol, setSortCol] = useState<OrchestratorSortCol>('knownSessions');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filter, setFilter] = useState('');
  const { copiedId, copyToClipboard } = useClipboardFlash();

  const formatURI = (uri?: string) => {
    if (!uri) return '—';
    return stripOrchestratorServiceUri(uri);
  };

  const toggleSort = (col: OrchestratorSortCol) => {
    if (sortCol === col) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); }
    else { setSortCol(col); setSortDir('desc'); }
  };

  const SortIcon = ({ col }: { col: OrchestratorSortCol }) => {
    if (sortCol !== col) return <ChevronsUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  const sorted = useMemo(() => {
    let rows = [...data];
    if (filter) {
      const q = filter.toLowerCase();
      rows = rows.filter((r) => {
        if (r.address.toLowerCase().includes(q)) return true;
        if (r.uris.some(u => u.toLowerCase().includes(q))) return true;
        return r.pipelines.some((p) => {
          const offer = r.pipelineModels?.find((o) => o.pipelineId === p);
          const label = formatPipelineLabel(p, catalog, offer?.modelIds);
          return label.toLowerCase().includes(q) || p.toLowerCase().includes(q);
        });
      });
    }
    rows.sort((a, b) => {
      const av = sortCol === 'uri' ? (a.uris[0] ?? '') : (a[sortCol] ?? 0);
      const bv = sortCol === 'uri' ? (b.uris[0] ?? '') : (b[sortCol] ?? 0);
      if (typeof av === 'string' && typeof bv === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return rows;
  }, [data, sortCol, sortDir, filter, catalog]);

  const ariaSortValue = (col: OrchestratorSortCol): 'ascending' | 'descending' | 'none' =>
    sortCol !== col ? 'none' : sortDir === 'asc' ? 'ascending' : 'descending';

  const TH = ({ col, label, right, className = '' }: { col: OrchestratorSortCol; label: string; right?: boolean; className?: string }) => (
    <th className={`pb-2 font-medium ${right ? 'text-right' : 'text-left'} ${className}`.trim()} aria-sort={ariaSortValue(col)}>
      <button type="button" onClick={() => toggleSort(col)} className={`inline-flex items-center gap-1 select-none hover:text-foreground transition-colors ${right ? 'flex-row-reverse' : ''}`} aria-label={`Sort by ${label}`}>
        {label}
        <SortIcon col={col} />
      </button>
    </th>
  );

  const totalGPUsInList = useMemo(() => sorted.reduce((sum, r) => sum + (r.gpuCount ?? 0), 0), [sorted]);

  const pricingByKey = useMemo(
    () => new Map(pricing.map((p) => [`${p.pipeline}:${p.model ?? ''}`, p])),
    [pricing],
  );

  return (
    <div className="p-3 rounded-lg bg-card border border-border min-w-0 sm:p-4">
      <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="p-1 rounded-md bg-muted text-muted-foreground shrink-0"><Server className="w-3.5 h-3.5" /></div>
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider leading-snug sm:text-[11px]">
            Orchestrators ({sorted.length}{filter ? ` of ${data.length}` : ''}) · {totalGPUsInList} GPUs
          </span>
        </div>
        <input
          id="orchestrator-filter"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter URI / pipeline…"
          aria-label="Filter orchestrators by URI, address, or pipeline"
          className="w-full min-w-0 px-2 py-1.5 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground sm:max-w-xs sm:py-0.5"
        />
      </div>
      <div className="max-h-[min(70vh,640px)] min-w-0 overflow-x-auto overflow-y-auto overscroll-x-contain">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="sticky top-0 bg-card text-muted-foreground border-b border-border">
            <tr>
              <TH col="uri" label="URI" />
              <TH col="knownSessions" label="Sessions" right />
              <TH col="successRatio" label="Startup %" right />
              <TH col="effectiveSuccessRate" label="Effective %" right />
              <TH col="slaScore" label="SLA" right />
              <TH col="gpuCount" label="GPUs" right className="pr-5" />
              <th className="pb-2 pl-2 font-medium text-left">Models</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.address} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors group">
                <td className="py-1.5 min-w-0 align-top" title={row.uris.length ? row.uris.join('\n') : row.address}>
                  <div className="flex min-w-0 w-full flex-col gap-1">
                    {row.uris.length > 0 ? (
                      row.uris.map((uri, i) => (
                        <div key={`${row.address}:uri:${i}`} className="flex w-full min-w-0 items-center justify-start gap-1">
                          <span className="min-w-0 max-w-[calc(100%-2rem)] shrink truncate font-mono text-foreground" title={stripOrchestratorServiceUri(uri)}>
                            {formatURI(uri)}
                          </span>
                          <CopyButton
                            copied={copiedId === `orch:${row.address}:uri:${i}`}
                            onCopy={() => copyToClipboard(`orch:${row.address}:uri:${i}`, uri)}
                            title="Copy this service URI"
                            ariaLabel={`Copy service URI ${uri}`}
                          />
                        </div>
                      ))
                    ) : (
                      <div className="flex min-w-0 items-center gap-1">
                        <span className="font-mono text-muted-foreground">—</span>
                        {row.address ? (
                          <CopyButton
                            copied={copiedId === `orch:${row.address}`}
                            onCopy={() => copyToClipboard(`orch:${row.address}`, row.address)}
                            title="Copy orchestrator address"
                            ariaLabel={`Copy address ${row.address}`}
                          />
                        ) : null}
                      </div>
                    )}
                  </div>
                </td>
                <td className="py-1.5 text-right font-mono">{row.knownSessions.toLocaleString()}</td>
                <td className="py-1.5 text-right font-mono">{row.successRatio}%</td>
                <td className="py-1.5 text-right font-mono">{row.effectiveSuccessRate != null ? `${row.effectiveSuccessRate}%` : '—'}</td>
                <td className="py-1.5 text-right font-mono">{row.slaScore ?? '—'}</td>
                <td className="py-1.5 pr-5 text-right font-mono">{row.gpuCount}</td>
                <td className="py-1.5 pl-2 max-w-[180px]">
                  <div className="flex flex-wrap gap-1">
                    {row.pipelines.length === 0 && '—'}
                    {row.pipelines.map((p) => {
                      const offer = row.pipelineModels?.find((o) => o.pipelineId === p);
                      const modelIds = offer?.modelIds ?? [];
                      const entry = catalog?.find((c) => c.id === p);
                      const pipelineName = entry?.name ?? p;
                      return modelIds.length > 0 ? (
                        modelIds.map((modelId) => (
                          <span
                            key={`${p}:${modelId}`}
                            className={`inline-flex max-w-full cursor-default items-center rounded px-2 py-0.5 text-[10px] font-medium ${modelBadgeColor(modelId, p)}`}
                            title={orchestratorModelTagTooltip(pipelineName, modelId, row.uris, {
                              lastSeen: row.lastSeen,
                              pricing: pricingByKey.get(`${p}:${modelId}`),
                            })}
                          >
                            <span className="truncate">{modelId}</span>
                          </span>
                        ))
                      ) : (
                        <span
                          key={p}
                          className="inline-flex max-w-full cursor-default items-center rounded px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground"
                          title={orchestratorModelTagTooltip(pipelineName, '—', row.uris, { lastSeen: row.lastSeen })}
                        >
                          —
                        </span>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={7} className="py-4 text-center text-muted-foreground">{filter ? 'No orchestrators match the filter' : 'No orchestrator data'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
