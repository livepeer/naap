/**
 * useJobFeedStream Hook Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { DASHBOARD_JOB_FEED_EVENT, DASHBOARD_JOB_FEED_EMIT_EVENT } from '../dashboard-constants';
import type { JobFeedEntry, JobFeedSubscribeResponse } from '@naap/plugin-sdk';

// ============================================================================
// Mocks
// ============================================================================

let onCallbacks: Map<string, (data: any) => void>;
let onCleanups: (() => void)[];

const mockEventBus = {
  emit: vi.fn(),
  on: vi.fn((event: string, callback: (data: any) => void) => {
    onCallbacks.set(event, callback);
    const cleanup = vi.fn(() => {
      onCallbacks.delete(event);
    });
    onCleanups.push(cleanup);
    return cleanup;
  }),
  off: vi.fn(),
  once: vi.fn(() => vi.fn()),
  request: vi.fn(),
  handleRequest: vi.fn(() => vi.fn()),
};

const mockShell = {
  auth: {} as any,
  navigate: vi.fn(),
  eventBus: mockEventBus,
  theme: {} as any,
  notifications: {} as any,
  integrations: {} as any,
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
  permissions: {} as any,
  version: '1.0.0',
  isSidebarOpen: true,
  toggleSidebar: vi.fn(),
  installedPlugins: [],
  pluginConfig: {},
};

vi.mock('@/contexts/shell-context', () => ({
  useShell: () => mockShell,
}));

// Import after mocks
import { useJobFeedStream } from '../useJobFeedStream';

// ============================================================================
// Tests
// ============================================================================

describe('useJobFeedStream', () => {
  const mockChannelInfo: JobFeedSubscribeResponse = {
    channelName: null,
    eventName: 'job',
    useEventBusFallback: true,
  };

  const mockJob: JobFeedEntry = {
    id: 'job_abc123',
    pipeline: 'Text-to-Image',
    status: 'running',
    startedAt: '2026-02-09T12:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    onCallbacks = new Map();
    onCleanups = [];
  });

  it('discovers channel info from event bus', async () => {
    mockEventBus.request.mockResolvedValueOnce(mockChannelInfo);

    renderHook(() => useJobFeedStream());

    await waitFor(() => {
      expect(mockEventBus.request).toHaveBeenCalledWith(
        DASHBOARD_JOB_FEED_EVENT,
        undefined,
        { timeout: 5000 }
      );
    });
  });

  it('subscribes to event bus fallback when useEventBusFallback=true', async () => {
    mockEventBus.request.mockResolvedValueOnce(mockChannelInfo);

    const { result } = renderHook(() => useJobFeedStream());

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    expect(mockEventBus.on).toHaveBeenCalledWith(
      DASHBOARD_JOB_FEED_EMIT_EVENT,
      expect.any(Function)
    );
    expect(result.current.error).toBeNull();
  });

  it('receives and buffers job events', async () => {
    mockEventBus.request.mockResolvedValueOnce(mockChannelInfo);

    const { result } = renderHook(() => useJobFeedStream({ maxItems: 3 }));

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    // Simulate job events
    const callback = onCallbacks.get(DASHBOARD_JOB_FEED_EMIT_EVENT);
    expect(callback).toBeDefined();

    act(() => {
      callback!(mockJob);
    });

    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.jobs[0].id).toBe('job_abc123');

    // Add more jobs
    act(() => {
      callback!({ ...mockJob, id: 'job_def456' });
      callback!({ ...mockJob, id: 'job_ghi789' });
      callback!({ ...mockJob, id: 'job_jkl012' });
    });

    // Should be capped at maxItems=3
    expect(result.current.jobs).toHaveLength(3);
    // Most recent first
    expect(result.current.jobs[0].id).toBe('job_jkl012');
  });

  it('returns error when no provider registered', async () => {
    vi.useFakeTimers();
    const noHandlerError = new Error('No handler');
    (noHandlerError as any).code = 'NO_HANDLER';
    // Reject all retry attempts (initial + 4 retries)
    mockEventBus.request.mockRejectedValue(noHandlerError);

    const { result } = renderHook(() => useJobFeedStream());

    // Flush all retry timers (1000, 2000, 3000, 5000ms)
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
    }

    expect(result.current.error).not.toBeNull();
    expect(result.current.error!.type).toBe('no-provider');
    expect(result.current.connected).toBe(false);

    vi.useRealTimers();
  });

  it('cleans up subscriptions on unmount', async () => {
    mockEventBus.request.mockResolvedValueOnce(mockChannelInfo);

    const { result, unmount } = renderHook(() => useJobFeedStream());

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    unmount();

    // The cleanup function from eventBus.on should have been called
    expect(onCleanups.length).toBeGreaterThan(0);
  });

  it('skips connection when skip=true', async () => {
    const { result } = renderHook(() => useJobFeedStream({ skip: true }));

    expect(mockEventBus.request).not.toHaveBeenCalled();
    expect(result.current.connected).toBe(false);
    expect(result.current.jobs).toEqual([]);
  });
});
