'use client';

import { useEffect, useState } from 'react';
import {
  Layers,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import type {
  JobModelPerformance,
  AIBatchJobSummary,
  AIBatchJobRecord,
  AIBatchLLMSummary,
  BYOCJobSummary,
  BYOCJobRecord,
  BYOCWorkerSummary,
  BYOCAuthSummary,
} from '@/lib/facade';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type WindowOption = { label: string; value: string; hours: number };

const WINDOW_OPTIONS: WindowOption[] = [
  { label: '24h', value: '24h', hours: 24 },
  { label: '7d', value: '168h', hours: 168 },
  { label: '30d', value: '720h', hours: 720 },
];

function windowToDateRange(hours: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtMs(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 60_000) return `${(n / 60_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}s`;
  return `${Math.round(n)}ms`;
}

function fmtNum(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Generic fetch hook
// ---------------------------------------------------------------------------

function useFetch<T>(url: string | null): { data: T | null; loading: boolean; error: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<T>;
      })
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [url]);

  return { data, loading, error };
}

// ---------------------------------------------------------------------------
// UI primitives
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold text-foreground mb-3">{children}</h2>;
}

function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
      <Loader2 size={16} className="animate-spin" />
      <span className="text-sm">Loading…</span>
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
      <AlertCircle size={16} />
      <span className="text-sm">{message}</span>
    </div>
  );
}

function EmptyRow({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-10 text-muted-foreground">
      <span className="text-sm">{message}</span>
    </div>
  );
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 border-b border-border/50 ${className}`}>{children}</td>;
}

function SuccessBadge({ rate }: { rate: number }) {
  const pct = rate * 100;
  const color = pct >= 95 ? 'text-green-500' : pct >= 80 ? 'text-yellow-500' : 'text-red-500';
  return <span className={`font-medium ${color}`}>{fmtPct(rate)}</span>;
}

// ---------------------------------------------------------------------------
// Tab: Overview (jobs/by-model)
// ---------------------------------------------------------------------------

type JobTypeFilter = 'all' | 'ai-batch' | 'byoc';

function OverviewTab({ window }: { window: string }) {
  const [jobType, setJobType] = useState<JobTypeFilter>('all');
  const qs = new URLSearchParams({ window });
  if (jobType !== 'all') qs.set('job_type', jobType);
  const { data, loading, error } = useFetch<JobModelPerformance[]>(`/api/v1/jobs/by-model?${qs}`);

  return (
    <div className="space-y-6">
      {/* Filter row */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Type:</span>
        {(['all', 'ai-batch', 'byoc'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setJobType(t)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              jobType === t
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted/50 text-muted-foreground hover:bg-muted'
            }`}
          >
            {t === 'all' ? 'All' : t === 'ai-batch' ? 'AI Batch' : 'BYOC'}
          </button>
        ))}
      </div>

      <div>
        <SectionTitle>Performance by Model</SectionTitle>
        {loading && <LoadingRow />}
        {error && <ErrorRow message="Could not load job performance data" />}
        {!loading && !error && (
          <Table headers={['Pipeline', 'Model', 'Type', 'Jobs', 'Orchestrators', 'Avg Duration', 'P50', 'P99']}>
            {(!data || data.length === 0) ? (
              <tr><td colSpan={8}><EmptyRow message="No job data for this window" /></td></tr>
            ) : data.map((row, i) => (
              <tr key={i} className="hover:bg-muted/20 transition-colors">
                <Td><span className="font-medium">{row.pipeline}</span></Td>
                <Td className="text-muted-foreground font-mono text-xs">{row.model_id}</Td>
                <Td>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    row.job_type === 'ai-batch'
                      ? 'bg-blue-500/10 text-blue-400'
                      : 'bg-purple-500/10 text-purple-400'
                  }`}>
                    {row.job_type}
                  </span>
                </Td>
                <Td>{fmtNum(row.job_count)}</Td>
                <Td>{fmtNum(row.warm_orch_count)}</Td>
                <Td>{fmtMs(row.avg_duration_ms)}</Td>
                <Td>{fmtMs(row.p50_duration_ms)}</Td>
                <Td>{fmtMs(row.p99_duration_ms)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: AI Batch
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

function AIBatchTab({ start, end }: { start: string; end: string }) {
  const [page, setPage] = useState(0);
  const qs = `start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const { data: summary, loading: sumLoading, error: sumError } = useFetch<AIBatchJobSummary[]>(`/api/v1/ai-batch/summary?${qs}`);
  const { data: llm, loading: llmLoading, error: llmError } = useFetch<AIBatchLLMSummary[]>(`/api/v1/ai-batch/llm/summary?${qs}`);
  const jobsQs = `${qs}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
  const { data: jobs, loading: jobsLoading, error: jobsError } = useFetch<AIBatchJobRecord[]>(`/api/v1/ai-batch/jobs?${jobsQs}`);

  // Aggregate summary totals
  const totalJobs = summary?.reduce((s, r) => s + r.total_jobs, 0) ?? 0;
  const avgSuccess = summary && summary.length > 0
    ? summary.reduce((s, r) => s + r.success_rate * r.total_jobs, 0) / Math.max(totalJobs, 1)
    : null;
  const avgDuration = summary && summary.length > 0
    ? summary.reduce((s, r) => s + r.avg_duration_ms * r.total_jobs, 0) / Math.max(totalJobs, 1)
    : null;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Jobs" value={sumLoading ? '…' : fmtNum(totalJobs)} />
        <StatCard label="Success Rate" value={sumLoading ? '…' : avgSuccess != null ? fmtPct(avgSuccess) : '—'} />
        <StatCard label="Avg Duration" value={sumLoading ? '…' : fmtMs(avgDuration)} />
      </div>

      {/* By pipeline */}
      {!sumLoading && !sumError && summary && summary.length > 0 && (
        <div>
          <SectionTitle>By Pipeline</SectionTitle>
          <Table headers={['Pipeline', 'Jobs', 'Success Rate', 'Avg Duration', 'Latency Score']}>
            {summary.map((row, i) => (
              <tr key={i} className="hover:bg-muted/20 transition-colors">
                <Td><span className="font-medium">{row.pipeline}</span></Td>
                <Td>{fmtNum(row.total_jobs)}</Td>
                <Td><SuccessBadge rate={row.success_rate} /></Td>
                <Td>{fmtMs(row.avg_duration_ms)}</Td>
                <Td>{row.avg_latency_score.toFixed(2)}</Td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      {sumError && <ErrorRow message="Could not load AI batch summary" />}

      {/* LLM summary */}
      {!llmLoading && !llmError && llm && llm.length > 0 && (
        <div>
          <SectionTitle>LLM Performance</SectionTitle>
          <Table headers={['Model', 'Requests', 'Success Rate', 'Tokens/sec', 'TTFT', 'Avg Tokens']}>
            {llm.map((row, i) => (
              <tr key={i} className="hover:bg-muted/20 transition-colors">
                <Td className="font-mono text-xs">{row.model}</Td>
                <Td>{fmtNum(row.total_requests)}</Td>
                <Td><SuccessBadge rate={row.success_rate} /></Td>
                <Td>{row.avg_tokens_per_sec.toFixed(1)}</Td>
                <Td>{fmtMs(row.avg_ttft_ms)}</Td>
                <Td>{fmtNum(row.avg_total_tokens)}</Td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      {llmError && <ErrorRow message="Could not load LLM summary" />}

      {/* Job records */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <SectionTitle>Job Records</SectionTitle>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs text-muted-foreground">Page {page + 1}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!jobs || jobs.length < PAGE_SIZE}
              className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        {jobsLoading && <LoadingRow />}
        {jobsError && <ErrorRow message="Could not load job records" />}
        {!jobsLoading && !jobsError && (
          <Table headers={['Request ID', 'Pipeline', 'Model', 'Completed', 'Duration', 'Status', 'Tries']}>
            {(!jobs || jobs.length === 0) ? (
              <tr><td colSpan={7}><EmptyRow message="No job records for this range" /></td></tr>
            ) : jobs.map((row, i) => (
              <tr key={i} className="hover:bg-muted/20 transition-colors">
                <Td className="font-mono text-xs max-w-[120px] truncate">{row.request_id}</Td>
                <Td>{row.pipeline}</Td>
                <Td className="font-mono text-xs">{row.model_id ?? '—'}</Td>
                <Td className="text-xs">{fmtDate(row.completed_at)}</Td>
                <Td>{fmtMs(row.duration_ms)}</Td>
                <Td>
                  {row.success == null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : row.success ? (
                    <CheckCircle2 size={14} className="text-green-500" />
                  ) : (
                    <XCircle size={14} className="text-red-500" />
                  )}
                </Td>
                <Td>{row.tries ?? '—'}</Td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: BYOC
// ---------------------------------------------------------------------------

function BYOCTab({ start, end }: { start: string; end: string }) {
  const [page, setPage] = useState(0);
  const qs = `start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const { data: summary, loading: sumLoading, error: sumError } = useFetch<BYOCJobSummary[]>(`/api/v1/byoc/summary?${qs}`);
  const { data: workers, loading: workersLoading, error: workersError } = useFetch<BYOCWorkerSummary[]>(`/api/v1/byoc/workers?${qs}`);
  const { data: auth, loading: authLoading, error: authError } = useFetch<BYOCAuthSummary[]>(`/api/v1/byoc/auth?${qs}`);
  const jobsQs = `${qs}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
  const { data: jobs, loading: jobsLoading, error: jobsError } = useFetch<BYOCJobRecord[]>(`/api/v1/byoc/jobs?${jobsQs}`);

  const totalJobs = summary?.reduce((s, r) => s + r.total_jobs, 0) ?? 0;
  const avgSuccess = summary && summary.length > 0
    ? summary.reduce((s, r) => s + r.success_rate * r.total_jobs, 0) / Math.max(totalJobs, 1)
    : null;
  const avgDuration = summary && summary.length > 0
    ? summary.reduce((s, r) => s + r.avg_duration_ms * r.total_jobs, 0) / Math.max(totalJobs, 1)
    : null;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Jobs" value={sumLoading ? '…' : fmtNum(totalJobs)} />
        <StatCard label="Success Rate" value={sumLoading ? '…' : avgSuccess != null ? fmtPct(avgSuccess) : '—'} />
        <StatCard label="Avg Duration" value={sumLoading ? '…' : fmtMs(avgDuration)} />
      </div>

      {/* By capability */}
      {!sumLoading && !sumError && summary && summary.length > 0 && (
        <div>
          <SectionTitle>By Capability</SectionTitle>
          <Table headers={['Capability', 'Jobs', 'Success Rate', 'Avg Duration']}>
            {summary.map((row, i) => (
              <tr key={i} className="hover:bg-muted/20 transition-colors">
                <Td><span className="font-medium">{row.capability}</span></Td>
                <Td>{fmtNum(row.total_jobs)}</Td>
                <Td><SuccessBadge rate={row.success_rate} /></Td>
                <Td>{fmtMs(row.avg_duration_ms)}</Td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      {sumError && <ErrorRow message="Could not load BYOC summary" />}

      {/* Workers */}
      {!workersLoading && !workersError && workers && workers.length > 0 && (
        <div>
          <SectionTitle>Workers</SectionTitle>
          <Table headers={['Capability', 'Workers', 'Models', 'Avg Price/Unit']}>
            {workers.map((row, i) => (
              <tr key={i} className="hover:bg-muted/20 transition-colors">
                <Td><span className="font-medium">{row.capability}</span></Td>
                <Td>{row.worker_count}</Td>
                <Td className="text-xs text-muted-foreground">{row.models.join(', ') || '—'}</Td>
                <Td>{row.avg_price_per_unit.toExponential(3)}</Td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      {workersError && <ErrorRow message="Could not load workers data" />}

      {/* Auth */}
      {!authLoading && !authError && auth && auth.length > 0 && (
        <div>
          <SectionTitle>Auth Events</SectionTitle>
          <Table headers={['Capability', 'Events', 'Success Rate', 'Failures']}>
            {auth.map((row, i) => (
              <tr key={i} className="hover:bg-muted/20 transition-colors">
                <Td><span className="font-medium">{row.capability}</span></Td>
                <Td>{fmtNum(row.total_events)}</Td>
                <Td><SuccessBadge rate={row.success_rate} /></Td>
                <Td className="text-red-400">{fmtNum(row.failure_count)}</Td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      {authError && <ErrorRow message="Could not load auth data" />}

      {/* Job records */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <SectionTitle>Job Records</SectionTitle>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs text-muted-foreground">Page {page + 1}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!jobs || jobs.length < PAGE_SIZE}
              className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        {jobsLoading && <LoadingRow />}
        {jobsError && <ErrorRow message="Could not load job records" />}
        {!jobsLoading && !jobsError && (
          <Table headers={['Request ID', 'Capability', 'Completed', 'Duration', 'Status', 'HTTP', 'Orchestrator']}>
            {(!jobs || jobs.length === 0) ? (
              <tr><td colSpan={7}><EmptyRow message="No job records for this range" /></td></tr>
            ) : jobs.map((row, i) => (
              <tr key={i} className="hover:bg-muted/20 transition-colors">
                <Td className="font-mono text-xs max-w-[120px] truncate">{row.request_id}</Td>
                <Td>{row.capability}</Td>
                <Td className="text-xs">{fmtDate(row.completed_at)}</Td>
                <Td>{fmtMs(row.duration_ms)}</Td>
                <Td>
                  {row.success == null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : row.success ? (
                    <CheckCircle2 size={14} className="text-green-500" />
                  ) : (
                    <XCircle size={14} className="text-red-500" />
                  )}
                </Td>
                <Td className="text-xs">{row.http_status ?? '—'}</Td>
                <Td className="font-mono text-xs max-w-[100px] truncate">{row.orch_address ?? '—'}</Td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Tab = 'overview' | 'ai-batch' | 'byoc';

export default function JobsPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [windowOpt, setWindowOpt] = useState<WindowOption>(WINDOW_OPTIONS[0]);
  const { start, end } = windowToDateRange(windowOpt.hours);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'ai-batch', label: 'AI Batch' },
    { id: 'byoc', label: 'BYOC' },
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers size={20} className="text-muted-foreground" />
          <h1 className="text-lg font-semibold">Jobs</h1>
        </div>
        {/* Window selector */}
        <div className="flex items-center gap-1 bg-muted/30 rounded-lg p-1">
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setWindowOpt(opt)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                windowOpt.value === opt.value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && <OverviewTab window={windowOpt.value} />}
      {tab === 'ai-batch' && <AIBatchTab start={start} end={end} />}
      {tab === 'byoc' && <BYOCTab start={start} end={end} />}
    </div>
  );
}
