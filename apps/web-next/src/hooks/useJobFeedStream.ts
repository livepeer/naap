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
import {
  DASHBOARD_JOB_FEED_EVENT,
  DASHBOARD_JOB_FEED_EMIT_EVENT,
  type JobFeedSubscribeResponse,
  type JobFeedEntry,
} from '@naap/plugin-sdk';
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

  // Add a new job to the rolling buffer
  const addJob = useCallback((entry: JobFeedEntry) => {
    if (!mountedRef.current) return;
    const updated = [entry, ...jobsRef.current].slice(0, maxItemsRef.current);
    jobsRef.current = updated;
    setJobs(updated);
  }, []);

  useEffect(() => {
    if (skip) return;

    mountedRef.current = true;
    let eventBusCleanup: (() => void) | null = null;

    async function connect() {
      try {
        // Discover the channel from the provider plugin
        const channelInfo = await shell.eventBus.request<
          undefined,
          JobFeedSubscribeResponse
        >(DASHBOARD_JOB_FEED_EVENT, undefined, { timeout });

        if (!mountedRef.current) return;

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
      if (eventBusCleanup) {
        eventBusCleanup();
        eventBusCleanup = null;
      }
      setConnected(false);
    };
  }, [shell.eventBus, timeout, skip, addJob]);

  return { jobs, connected, error };
}
