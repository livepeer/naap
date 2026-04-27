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
import { mapApiRowToJobFeedEntry } from '@/lib/facade/map-job-feed-entry';
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
  /** True until the first HTTP job-feed response finishes (or non-HTTP mode is ready). */
  jobFeedLoading: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

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

/** Adds `pollMs` for CDN/browser cache keying; keeps relative `/api/...` paths relative. */
function appendJobFeedPollQuery(fetchUrl: string, pollMs: number, bustCache = false): string {
  const ms = pollMs >= 1000 ? Math.round(pollMs) : 30_000;
  try {
    const origin =
      typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const u = new URL(fetchUrl, origin);
    u.searchParams.set('pollMs', String(ms));
    if (bustCache) {
      u.searchParams.set('refresh', '1');
    }
    if (/^https?:\/\//i.test(fetchUrl)) {
      return u.toString();
    }
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    const sep = fetchUrl.includes('?') ? '&' : '?';
    return `${fetchUrl}${sep}pollMs=${encodeURIComponent(String(ms))}`;
  }
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

// ============================================================================
// Hook
// ============================================================================

/**
 * Retry delays (ms) when the job feed provider hasn't loaded yet.
 * Background plugins need time to load their UMD bundle and mount —
 * we retry with increasing back-off so the feed connects once ready.
 */
const NO_PROVIDER_RETRY_DELAYS = [1000, 2000, 3000, 5000];
/**
 * When the upstream briefly errors on first load, retry quickly before falling
 * back to the steady poll interval.
 */
const JOB_FEED_RECOVERY_RETRY_DELAYS = [1000, 2000, 5000, 10000, 15000, 30000];

export function useJobFeedStream(
  options?: UseJobFeedStreamOptions
): UseJobFeedStreamResult {
  const { maxItems = 8, timeout = 5000, pollInterval: pollIntervalMs = 0, skip = false } = options ?? {};
  const shell = useShell();

  const [jobs, setJobs] = useState<JobFeedEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<DashboardError | null>(null);
  const [feedMeta, setFeedMeta] = useState<JobFeedConnectionMeta | null>(null);
  const [jobFeedLoading, setJobFeedLoading] = useState(!skip);

  const mountedRef = useRef(true);
  const initialHttpFetchDoneRef = useRef(false);
  const jobsRef = useRef<JobFeedEntry[]>([]);
  const maxItemsRef = useRef(maxItems);
  maxItemsRef.current = maxItems;
  const cleanupRef = useRef<(() => void) | null>(null);
  const generationRef = useRef(0);

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
    const currentGeneration = ++generationRef.current;
    const isCurrentRun = () => mountedRef.current && generationRef.current === currentGeneration;

    if (skip) {
      mountedRef.current = false;
      setJobFeedLoading(false);
      return;
    }

    mountedRef.current = true;
    initialHttpFetchDoneRef.current = false;
    setJobFeedLoading(true);
    let eventBusCleanup: (() => void) | null = null;
    let fetchPollTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    async function fetchJobFeed(fetchUrl: string, options?: { bustCache?: boolean }): Promise<boolean> {
      const requestUrl = options?.bustCache
        ? appendJobFeedPollQuery(fetchUrl, pollIntervalMs, true)
        : fetchUrl;
      try {
        const res = await fetch(requestUrl, { signal: AbortSignal.timeout(20_000) });
        let body = {} as {
          streams?: unknown[];
          clickhouseConfigured?: boolean;
          queryFailed?: boolean;
        };
        let jsonFailed = false;
        try {
          body = (await res.json()) as typeof body;
        } catch {
          jsonFailed = true;
        }
        if (!isCurrentRun()) return false;

        if (!res.ok) {
          console.warn('[useJobFeedStream] job-feed HTTP', res.status, requestUrl);
          setFeedMeta({
            clickhouseConfigured: body.clickhouseConfigured ?? false,
            queryFailed: body.queryFailed ?? true,
            fetchFailed: true,
          });
          setError({
            type: 'unknown',
            message: `Could not load the job feed (HTTP ${res.status}). Check the network or try again.`,
          });
          return false;
        }

        if (jsonFailed) {
          console.warn('[useJobFeedStream] job-feed 200 but invalid JSON', requestUrl);
          setFeedMeta({
            clickhouseConfigured: false,
            queryFailed: true,
            fetchFailed: true,
          });
          setError({
            type: 'unknown',
            message: 'Job feed returned invalid data. Try again later.',
          });
          return false;
        }

        const entries = (body.streams ?? [])
          .map((row) => mapApiRowToJobFeedEntry(row))
          .filter((e): e is JobFeedEntry => e != null);
        replaceJobs(entries);
        setFeedMeta({
          clickhouseConfigured: body.clickhouseConfigured ?? true,
          queryFailed: body.queryFailed ?? false,
        });
        setError(null);
        return !(body.queryFailed ?? false);
      } catch (e) {
        console.warn('[useJobFeedStream] job-feed fetch error', e);
        if (!isCurrentRun()) return false;
        setFeedMeta({
          clickhouseConfigured: false,
          queryFailed: true,
          fetchFailed: true,
        });
        setError({
          type: 'unknown',
          message: 'Could not reach the job feed. Check your network connection.',
        });
        return false;
      } finally {
        if (isCurrentRun() && !initialHttpFetchDoneRef.current) {
          initialHttpFetchDoneRef.current = true;
          setJobFeedLoading(false);
        }
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

        if (!isCurrentRun()) return;

        retryCount = 0;
        const normalizedPollIntervalMs =
          pollIntervalMs > 0 && pollIntervalMs < 1000 ? 30_000 : pollIntervalMs;

        let pollStopped = false;
        if (channelInfo.fetchUrl && (channelInfo.useEventBusFallback || !channelInfo.channelName)) {
          // HTTP polling mode — serialized: each poll waits for the previous fetch
          setConnected(true);
          setError(null);

          const feedUrl = appendJobFeedPollQuery(channelInfo.fetchUrl, normalizedPollIntervalMs);
          let feedFailureStreak = 0;

          if (normalizedPollIntervalMs > 0) {
            async function poll() {
              const shouldBustCache = feedFailureStreak > 0;
              const healthy = await fetchJobFeed(feedUrl, { bustCache: shouldBustCache });
              feedFailureStreak = healthy ? 0 : feedFailureStreak + 1;
              if (!pollStopped && isCurrentRun()) {
                const retryIndex = Math.min(
                  Math.max(feedFailureStreak - 1, 0),
                  JOB_FEED_RECOVERY_RETRY_DELAYS.length - 1,
                );
                const retryDelayMs = JOB_FEED_RECOVERY_RETRY_DELAYS[retryIndex];
                const nextDelayMs = feedFailureStreak > 0
                  ? Math.min(normalizedPollIntervalMs, retryDelayMs)
                  : normalizedPollIntervalMs;
                fetchPollTimer = setTimeout(poll, nextDelayMs);
              }
            }
            void poll();
          } else {
            void fetchJobFeed(feedUrl);
          }

          // Also listen on the event bus so Ably pushes or manual
          // emissions still work alongside polling
          if (!isCurrentRun()) return;
          eventBusCleanup = shell.eventBus.on<JobFeedEntry>(
            DASHBOARD_JOB_FEED_EMIT_EVENT,
            (entry) => {
              if (!isCurrentRun()) return;
              addJob(entry);
            }
          );
        } else if (channelInfo.useEventBusFallback || !channelInfo.channelName) {
          // Event bus fallback mode — provider emits events directly
          if (!isCurrentRun()) return;
          eventBusCleanup = shell.eventBus.on<JobFeedEntry>(
            DASHBOARD_JOB_FEED_EMIT_EVENT,
            (entry) => {
              if (!isCurrentRun()) return;
              addJob(entry);
            }
          );
          setConnected(true);
          setError(null);
          initialHttpFetchDoneRef.current = true;
          setJobFeedLoading(false);

          // Re-run full connect() on an interval so we pick up a late-registered provider
          // (this is not HTTP polling — the provider pushes over the event bus).
          if (normalizedPollIntervalMs > 0 && isCurrentRun()) {
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              if (!isCurrentRun()) return;
              const prev = cleanupRef.current;
              void connect(prev);
            }, normalizedPollIntervalMs);
          }
        } else {
          // Ably mode — subscribe to the channel
          // When Ably integration is connected to the dashboard, this branch
          // will use the AblyRealtimeClient from realtime-context.
          if (!isCurrentRun()) return;
          eventBusCleanup = shell.eventBus.on<JobFeedEntry>(
            DASHBOARD_JOB_FEED_EMIT_EVENT,
            (entry) => {
              if (!isCurrentRun()) return;
              addJob(entry);
            }
          );
          setConnected(true);
          setError(null);
          initialHttpFetchDoneRef.current = true;
          setJobFeedLoading(false);
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
        if (!isCurrentRun()) return;

        const code = (err as any)?.code;
        if (code === 'NO_HANDLER') {
          if (retryCount < NO_PROVIDER_RETRY_DELAYS.length) {
            const delay = NO_PROVIDER_RETRY_DELAYS[retryCount];
            retryCount++;
            console.log(
              `[useJobFeedStream] No provider yet, retry ${retryCount}/${NO_PROVIDER_RETRY_DELAYS.length} in ${delay}ms`
            );
            retryTimer = setTimeout(() => {
              if (isCurrentRun()) void connect();
            }, delay);
            return;
          }
          setError({
            type: 'no-provider',
            message: 'No job feed provider is registered',
          });
          setJobFeedLoading(false);
        } else if (code === 'TIMEOUT') {
          setError({
            type: 'timeout',
            message: 'Job feed provider did not respond in time',
          });
          setJobFeedLoading(false);
        } else {
          setError({
            type: 'unknown',
            message: (err as Error)?.message ?? 'Unknown error connecting to job feed',
          });
          setJobFeedLoading(false);
        }
        setConnected(false);
      }
    }

    connect();

    return () => {
      if (generationRef.current === currentGeneration) {
        mountedRef.current = false;
      }
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      cleanupRef.current?.();
      cleanupRef.current = null;
      setConnected(false);
    };
  }, [shell.eventBus, timeout, pollIntervalMs, skip, addJob, replaceJobs]);

  return { jobs, connected, error, feedMeta, jobFeedLoading };
}
