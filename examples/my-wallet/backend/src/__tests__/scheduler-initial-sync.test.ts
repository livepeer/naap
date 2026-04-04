import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../jobs/snapshotStaking.js', () => ({ snapshotStaking: vi.fn() }));
vi.mock('../jobs/fetchPrices.js', () => ({ fetchPrices: vi.fn() }));
vi.mock('../jobs/checkAlerts.js', () => ({ checkAlerts: vi.fn() }));
vi.mock('../jobs/updateUnbonding.js', () => ({ updateUnbonding: vi.fn() }));
vi.mock('../jobs/syncOrchestrators.js', () => ({ syncOrchestrators: vi.fn() }));
vi.mock('../jobs/syncNetworkSnapshot.js', () => ({ syncNetworkSnapshot: vi.fn() }));
vi.mock('../jobs/syncCapabilities.js', () => ({ syncCapabilities: vi.fn() }));
vi.mock('../jobs/monthlySnapshot.js', () => ({ monthlySnapshot: vi.fn() }));
vi.mock('../jobs/confirmTransactions.js', () => ({ confirmTransactions: vi.fn() }));

import { startScheduler, stopScheduler } from '../jobs/scheduler.js';
import { monthlySnapshot } from '../jobs/monthlySnapshot.js';
import { syncOrchestrators } from '../jobs/syncOrchestrators.js';

const monthlyMock = monthlySnapshot as ReturnType<typeof vi.fn>;
const syncOrchMock = syncOrchestrators as ReturnType<typeof vi.fn>;

describe('scheduler initial sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopScheduler();
    vi.useRealTimers();
  });

  it('calls monthlySnapshot in the initial sync block', async () => {
    monthlyMock.mockResolvedValue(undefined);
    syncOrchMock.mockResolvedValue(undefined);

    startScheduler();

    // Advance past the 10s initial delay
    await vi.advanceTimersByTimeAsync(11000);

    expect(monthlyMock).toHaveBeenCalledTimes(1);
  });

  it('does not crash when monthlySnapshot throws', async () => {
    monthlyMock.mockRejectedValue(new Error('snapshot failed'));
    syncOrchMock.mockResolvedValue(undefined);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    startScheduler();
    await vi.advanceTimersByTimeAsync(11000);

    expect(consoleSpy).toHaveBeenCalledWith(
      '[scheduler] initial monthlySnapshot error:',
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });
});
