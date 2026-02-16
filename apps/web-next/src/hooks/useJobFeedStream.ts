/**
 * useJobFeedStream Hook
 *
 * Discovers the live job feed channel from a provider plugin via the
 * event bus, then subscribes to receive real-time job events.
 *
 * Supports two modes:
 * 1. Ably channel (production) — provider returns a channel name
 * 2. Event bus fallback (local/dev) — provider emits events directly
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
  /** Whether to skip connecting (useful for conditional rendering). */
  skip?: boolean;
}

export interface UseJobFeedStreamResult {
  jobs: JobFeedEntry[];
  connected: boolean;
  error: DashboardError | null;
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
  const { maxItems = 8, timeout = 5000, skip = false } = options ?? {};
  const shell = useShell();

  const [jobs, setJobs] = useState<JobFeedEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<DashboardError | null>(null);

  const mountedRef = useRef(true);
  const jobsRef = useRef<JobFeedEntry[]>([]);
  const maxItemsRef = useRef(maxItems);
  maxItemsRef.current = maxItems;

  // Add a new job to the rolling buffer (deduplicates by id)
  const addJob = useCallback((entry: JobFeedEntry) => {
    if (!mountedRef.current) return;
    const withoutDupe = jobsRef.current.filter((j) => j.id !== entry.id);
    const updated = [entry, ...withoutDupe].slice(0, maxItemsRef.current);
    jobsRef.current = updated;
    setJobs(updated);
  }, []);

  useEffect(() => {
    if (skip) return;

    mountedRef.current = true;
    let eventBusCleanup: (() => void) | null = null;
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      try {
        // Discover the channel from the provider plugin
        const channelInfo = await shell.eventBus.request<
          undefined,
          JobFeedSubscribeResponse
        >(DASHBOARD_JOB_FEED_EVENT, undefined, { timeout });

        if (!mountedRef.current) return;

        // Success — reset retry counter
        retryCount = 0;

        if (channelInfo.useEventBusFallback || !channelInfo.channelName) {
          // Event bus fallback mode — provider emits events directly
          eventBusCleanup = shell.eventBus.on<JobFeedEntry>(
            DASHBOARD_JOB_FEED_EMIT_EVENT,
            (entry) => {
              addJob(entry);
            }
          );
          setConnected(true);
          setError(null);
        } else {
          // Ably mode — subscribe to the channel
          // For now, fall back to event bus if Ably is not wired up at the core level.
          // When Ably integration is connected to the dashboard, this branch
          // will use the AblyRealtimeClient from realtime-context.
          eventBusCleanup = shell.eventBus.on<JobFeedEntry>(
            DASHBOARD_JOB_FEED_EMIT_EVENT,
            (entry) => {
              addJob(entry);
            }
          );
          setConnected(true);
          setError(null);
        }
      } catch (err: unknown) {
        if (!mountedRef.current) return;

        const code = (err as any)?.code;
        if (code === 'NO_HANDLER') {
          // Provider plugin may still be loading — schedule a retry
          if (retryCount < NO_PROVIDER_RETRY_DELAYS.length) {
            const delay = NO_PROVIDER_RETRY_DELAYS[retryCount];
            retryCount++;
            console.log(
              `[useJobFeedStream] No provider yet, retry ${retryCount}/${NO_PROVIDER_RETRY_DELAYS.length} in ${delay}ms`
            );
            retryTimer = setTimeout(() => {
              if (mountedRef.current) connect();
            }, delay);
            return; // Don't set error yet — still trying
          }
          // All retries exhausted
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
      if (eventBusCleanup) {
        eventBusCleanup();
        eventBusCleanup = null;
      }
      setConnected(false);
    };
  }, [shell.eventBus, timeout, skip, addJob]);

  return { jobs, connected, error };
}
