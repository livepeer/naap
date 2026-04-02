/**
 * useJobFeedStream Hook
 *
 * Discovers the live job feed channel from a provider plugin via the
 * event bus, then subscribes to receive real-time job events.
 *
 * Supports three modes:
 * 1. HTTP polling — provider returns a fetchUrl; hook polls it at pollInterval
 * 2. Ably channel (future) — provider returns a channel name
 * 3. Event bus fallback (local/dev) — provider emits events directly
 *
 * @example
 * ```tsx
 * const { jobs, connected, error } = useJobFeedStream({ maxItems: 8 });
 * ```
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useShell } from '@/contexts/shell-context';
import { DASHBOARD_JOB_FEED_EVENT, DASHBOARD_JOB_FEED_EMIT_EVENT } from './dashboard-constants';
import type { JobFeedSubscribeResponse, JobFeedEntry } from '@naap/plugin-sdk';
import type { DashboardError } from './useDashboardQuery';

// ============================================================================
// Types
// ============================================================================

export interface UseJobFeedStreamOptions {
  /** Maximum number of job entries to keep in the buffer (default: 8). */
  maxItems?: number;
  /** Timeout for the subscription discovery request in ms (default: 5000). */
  timeout?: number;
  /** Poll the fetchUrl every N ms. Set to 0 or omit to keep a single subscription. */
  pollInterval?: number;
  /** Whether to skip connecting (useful for conditional rendering). */
  skip?: boolean;
}

/** Mirrors `/api/v1/dashboard/job-feed` JSON; legacy flag names are kept for compatibility. */
export interface JobFeedConnectionMeta {
  clickhouseConfigured: boolean;
  queryFailed: boolean;
  /** True when fetch failed or response was not OK */
  fetchFailed?: boolean;
}

export interface UseJobFeedStreamResult {
  jobs: JobFeedEntry[];
  connected: boolean;
  error: DashboardError | null;
  /** Set after the first successful JSON parse from the job-feed API (HTTP polling mode). */
  feedMeta: JobFeedConnectionMeta | null;
}

// ============================================================================
// Helpers
// ============================================================================

interface ActiveStreamRow {
  id: string;
  pipeline: string;
  model?: string;
  gateway: string;
  orchestratorUrl: string;
  state: string;
  inputFps: number;
  outputFps: number;
  firstSeen: string;
  lastSeen: string;
  durationSeconds?: number;
  runningFor?: string;
}

const STATUS_RANK: Record<string, number> = {
  running: 3,
  online: 3,
  degraded_input: 2,
  degraded_inference: 2,
  degraded_output: 2,
  degraded: 2,
  completed: 1,
  failed: 0,
  offline: 0,
  error: 0,
};

function normalizeJobStatus(rawState: string | undefined): string {
  const state = rawState?.trim().toLowerCase() ?? '';
  return state || 'unknown';
}

function parseIsoMs(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function deriveDurationSeconds(row: ActiveStreamRow): number | undefined {
  if (Number.isFinite(row.durationSeconds)) {
    const val = Number(row.durationSeconds);
    return val >= 0 ? val : undefined;
  }
  const firstMs = parseIsoMs(row.firstSeen);
  const lastMs = parseIsoMs(row.lastSeen);
  if (firstMs == null || lastMs == null) return undefined;
  const diff = Math.max(0, Math.floor((lastMs - firstMs) / 1000));
  return diff;
}

function dedupeAndSortJobs(entries: JobFeedEntry[], maxItems: number): JobFeedEntry[] {
  const byId = new Map<string, JobFeedEntry>();
  for (const entry of entries) {
    if (!entry.id) continue;
    const existing = byId.get(entry.id);
    if (!existing) {
      byId.set(entry.id, entry);
      continue;
    }
    const prevTs = existing.lastSeen ?? existing.startedAt ?? '';
    const nextTs = entry.lastSeen ?? entry.startedAt ?? '';
    if (nextTs > prevTs) byId.set(entry.id, entry);
  }

  const sorted = Array.from(byId.values())
    .filter((entry) => (entry.pipeline ?? '').trim() !== '')
    .sort((a, b) => {
      const sa = STATUS_RANK[a.status] ?? -1;
      const sb = STATUS_RANK[b.status] ?? -1;
      if (sa !== sb) return sb - sa;
      const ta = a.lastSeen ?? a.startedAt ?? '';
      const tb = b.lastSeen ?? b.startedAt ?? '';
      if (ta === tb) return a.id.localeCompare(b.id);
      return tb.localeCompare(ta);
    });

  return sorted.slice(0, maxItems);
}

function streamToJobFeedEntry(row: ActiveStreamRow): JobFeedEntry {
  const status = normalizeJobStatus(row.state);
  const durationSeconds = deriveDurationSeconds(row);
  const runningFor = row.runningFor?.trim() || (durationSeconds != null ? formatDuration(durationSeconds) : undefined);
  return {
    id: row.id,
    pipeline: row.pipeline,
    model: row.model,
    status,
    startedAt: row.firstSeen,
    gateway: row.gateway,
    orchestratorUrl: row.orchestratorUrl,
    inputFps: row.inputFps,
    outputFps: row.outputFps,
    lastSeen: row.lastSeen,
    durationSeconds,
    runningFor,
  };
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Retry delays (ms) when the job feed provider hasn't loaded yet.
 * Background plugins need time to load their UMD bundle and mount —
 * we retry with increasing back-off so the feed connects once ready.
 */
const NO_PROVIDER_RETRY_DELAYS = [1000, 2000, 3000, 5000];

export function useJobFeedStream(
  options?: UseJobFeedStreamOptions
): UseJobFeedStreamResult {
  const { maxItems = 8, timeout = 5000, pollInterval: pollIntervalMs = 0, skip = false } = options ?? {};
  const shell = useShell();

  const [jobs, setJobs] = useState<JobFeedEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<DashboardError | null>(null);
  const [feedMeta, setFeedMeta] = useState<JobFeedConnectionMeta | null>(null);

  const mountedRef = useRef(true);
  const jobsRef = useRef<JobFeedEntry[]>([]);
  const maxItemsRef = useRef(maxItems);
  maxItemsRef.current = maxItems;
  const cleanupRef = useRef<(() => void) | null>(null);

  const addJob = useCallback((entry: JobFeedEntry) => {
    if (!mountedRef.current) return;
    const withoutDupe = jobsRef.current.filter((j) => j.id !== entry.id);
    const updated = [entry, ...withoutDupe].slice(0, maxItemsRef.current);
    jobsRef.current = updated;
    setJobs(updated);
  }, []);

  const replaceJobs = useCallback((entries: JobFeedEntry[]) => {
    if (!mountedRef.current) return;
    const limited = dedupeAndSortJobs(entries, maxItemsRef.current);
    jobsRef.current = limited;
    setJobs(limited);
  }, []);

  useEffect(() => {
    if (skip) return;

    mountedRef.current = true;
    let eventBusCleanup: (() => void) | null = null;
    let fetchPollTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    async function fetchJobFeed(fetchUrl: string) {
      try {
        const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(10_000) });
        let body = {} as {
          streams?: ActiveStreamRow[];
          clickhouseConfigured?: boolean;
          queryFailed?: boolean;
        };
        let jsonFailed = false;
        try {
          body = (await res.json()) as typeof body;
        } catch {
          jsonFailed = true;
        }
        if (!mountedRef.current) return;

        if (!res.ok) {
          console.warn('[useJobFeedStream] job-feed HTTP', res.status, fetchUrl);
          setFeedMeta({
            clickhouseConfigured: body.clickhouseConfigured ?? false,
            queryFailed: body.queryFailed ?? true,
            fetchFailed: true,
          });
          setError({
            type: 'unknown',
            message: `Could not load the job feed (HTTP ${res.status}). Check the network or try again.`,
          });
          return;
        }

        if (jsonFailed) {
          console.warn('[useJobFeedStream] job-feed 200 but invalid JSON', fetchUrl);
          setFeedMeta({
            clickhouseConfigured: false,
            queryFailed: true,
            fetchFailed: true,
          });
          setError({
            type: 'unknown',
            message: 'Job feed returned invalid data. Try again later.',
          });
          return;
        }

        const entries = (body.streams ?? []).map(streamToJobFeedEntry);
        replaceJobs(entries);
        setFeedMeta({
          clickhouseConfigured: body.clickhouseConfigured ?? true,
          queryFailed: body.queryFailed ?? false,
        });
        setError(null);
      } catch (e) {
        console.warn('[useJobFeedStream] job-feed fetch error', e);
        if (!mountedRef.current) return;
        setFeedMeta({
          clickhouseConfigured: false,
          queryFailed: true,
          fetchFailed: true,
        });
        setError({
          type: 'unknown',
          message: 'Could not reach the job feed. Check your network connection.',
        });
      }
    }

    async function connect(oldCleanup?: (() => void) | null) {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      try {
        const channelInfo = await shell.eventBus.request<
          undefined,
          JobFeedSubscribeResponse
        >(DASHBOARD_JOB_FEED_EVENT, undefined, { timeout });

        if (!mountedRef.current) return;

        retryCount = 0;

        let pollStopped = false;
        if (channelInfo.fetchUrl && (channelInfo.useEventBusFallback || !channelInfo.channelName)) {
          // HTTP polling mode — serialized: each poll waits for the previous fetch
          setConnected(true);
          setError(null);

          if (pollIntervalMs > 0) {
            async function poll() {
              await fetchJobFeed(channelInfo.fetchUrl!);
              if (!pollStopped && mountedRef.current) {
                fetchPollTimer = setTimeout(poll, pollIntervalMs);
              }
            }
            void poll();
          } else {
            void fetchJobFeed(channelInfo.fetchUrl);
          }

          // Also listen on the event bus so Ably pushes or manual
          // emissions still work alongside polling
          eventBusCleanup = shell.eventBus.on<JobFeedEntry>(
            DASHBOARD_JOB_FEED_EMIT_EVENT,
            (entry) => addJob(entry)
          );
        } else if (channelInfo.useEventBusFallback || !channelInfo.channelName) {
          // Event bus fallback mode — provider emits events directly
          eventBusCleanup = shell.eventBus.on<JobFeedEntry>(
            DASHBOARD_JOB_FEED_EMIT_EVENT,
            (entry) => addJob(entry)
          );
          setConnected(true);
          setError(null);

          // Re-run full connect() on an interval so we pick up a late-registered provider
          // (this is not HTTP polling — the provider pushes over the event bus).
          if (pollIntervalMs > 0 && mountedRef.current) {
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              if (!mountedRef.current) return;
              const prev = cleanupRef.current;
              void connect(prev);
            }, pollIntervalMs);
          }
        } else {
          // Ably mode — subscribe to the channel
          // When Ably integration is connected to the dashboard, this branch
          // will use the AblyRealtimeClient from realtime-context.
          eventBusCleanup = shell.eventBus.on<JobFeedEntry>(
            DASHBOARD_JOB_FEED_EMIT_EVENT,
            (entry) => addJob(entry)
          );
          setConnected(true);
          setError(null);
        }

        const snapshotBusCleanup = eventBusCleanup;
        const snapshotReconnectTimer = reconnectTimer;
        cleanupRef.current = () => {
          pollStopped = true;
          snapshotBusCleanup?.();
          if (fetchPollTimer) { clearTimeout(fetchPollTimer); fetchPollTimer = null; }
          if (snapshotReconnectTimer) clearTimeout(snapshotReconnectTimer);
        };
        if (oldCleanup && oldCleanup !== cleanupRef.current) {
          oldCleanup();
        }
      } catch (err: unknown) {
        if (!mountedRef.current) return;

        const code = (err as any)?.code;
        if (code === 'NO_HANDLER') {
          if (retryCount < NO_PROVIDER_RETRY_DELAYS.length) {
            const delay = NO_PROVIDER_RETRY_DELAYS[retryCount];
            retryCount++;
            console.log(
              `[useJobFeedStream] No provider yet, retry ${retryCount}/${NO_PROVIDER_RETRY_DELAYS.length} in ${delay}ms`
            );
            retryTimer = setTimeout(() => {
              if (mountedRef.current) connect();
            }, delay);
            return;
          }
          setError({
            type: 'no-provider',
            message: 'No job feed provider is registered',
          });
        } else if (code === 'TIMEOUT') {
          setError({
            type: 'timeout',
            message: 'Job feed provider did not respond in time',
          });
        } else {
          setError({
            type: 'unknown',
            message: (err as Error)?.message ?? 'Unknown error connecting to job feed',
          });
        }
        setConnected(false);
      }
    }

    connect();

    return () => {
      mountedRef.current = false;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      cleanupRef.current?.();
      cleanupRef.current = null;
      setConnected(false);
    };
  }, [shell.eventBus, timeout, pollIntervalMs, skip, addJob, replaceJobs]);

  return { jobs, connected, error, feedMeta };
}
