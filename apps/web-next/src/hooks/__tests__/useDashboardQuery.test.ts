/**
 * useDashboardQuery Hook Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { DASHBOARD_QUERY_EVENT } from '../dashboard-constants';

// ============================================================================
// Mocks
// ============================================================================

const mockEventBus = {
  emit: vi.fn(),
  on: vi.fn(() => vi.fn()),
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
import { useDashboardQuery } from '../useDashboardQuery';

// ============================================================================
// Tests
// ============================================================================

describe('useDashboardQuery', () => {
  const testQuery = '{ kpi { successRate { value delta } } }';
  const testData = {
    kpi: { successRate: { value: 97.3, delta: 1.2 } },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns loading=true initially, then data on success', async () => {
    mockEventBus.request.mockResolvedValueOnce({ data: testData, errors: undefined });

    const { result } = renderHook(() => useDashboardQuery(testQuery));

    // Initially loading
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(testData);
    expect(result.current.error).toBeNull();
  });

  it('returns error with type=no-provider when no handler registered', async () => {
    const noHandlerError = new Error('No handler registered for event: dashboard:query');
    (noHandlerError as any).code = 'NO_HANDLER';
    mockEventBus.request.mockRejectedValueOnce(noHandlerError);

    const { result } = renderHook(() => useDashboardQuery(testQuery));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeDefined();
    expect(result.current.error!.type).toBe('no-provider');
    expect(result.current.data).toBeNull();
  });

  it('returns error with type=timeout on timeout', async () => {
    const timeoutError = new Error('Request timeout');
    (timeoutError as any).code = 'TIMEOUT';
    mockEventBus.request.mockRejectedValueOnce(timeoutError);

    const { result } = renderHook(() => useDashboardQuery(testQuery));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeDefined();
    expect(result.current.error!.type).toBe('timeout');
  });

  it('refetch re-triggers the query', async () => {
    mockEventBus.request.mockResolvedValue({ data: testData, errors: undefined });

    const { result } = renderHook(() => useDashboardQuery(testQuery));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockEventBus.request).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(mockEventBus.request).toHaveBeenCalledTimes(2);
    });
  });

  it('handles GraphQL partial errors (data + errors both present)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockEventBus.request.mockResolvedValueOnce({
      data: testData,
      errors: [{ message: 'Field "protocol" failed', path: ['protocol'] }],
    });

    const { result } = renderHook(() => useDashboardQuery(testQuery));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Data should still be present
    expect(result.current.data).toEqual(testData);
    // No error set (partial errors logged as warning)
    expect(result.current.error).toBeNull();

    warnSpy.mockRestore();
  });

  it('skips query when skip=true', () => {
    const { result } = renderHook(() =>
      useDashboardQuery(testQuery, undefined, { skip: true })
    );

    expect(result.current.loading).toBe(false);
    expect(mockEventBus.request).not.toHaveBeenCalled();
  });

  it('sends correct event name and payload', async () => {
    mockEventBus.request.mockResolvedValueOnce({ data: testData, errors: undefined });

    renderHook(() => useDashboardQuery(testQuery, { days: 7 }, { timeout: 3000 }));

    await waitFor(() => {
      expect(mockEventBus.request).toHaveBeenCalledWith(
        DASHBOARD_QUERY_EVENT,
        { query: testQuery, variables: { days: 7 } },
        { timeout: 3000 }
      );
    });
  });
});
