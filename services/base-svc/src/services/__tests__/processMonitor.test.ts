/**
 * Process Monitor Service Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ProcessMonitor } from '../processMonitor.js';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock the db module
vi.mock('../../db/client.js', () => ({
  db: {
    pluginPackage: {
      findUnique: vi.fn().mockResolvedValue({ id: '1', name: 'test-plugin' }),
    },
    pluginInstallation: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

describe('ProcessMonitor', () => {
  let monitor: ProcessMonitor;

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
    monitor = new ProcessMonitor({
      checkIntervalMs: 1000,
      maxFailedChecks: 2,
      healthTimeout: 100,
    });
  });

  afterEach(() => {
    monitor.stopAll();
    vi.useRealTimers();
  });

  it('should start monitoring a plugin', () => {
    monitor.startMonitoring('test-plugin', 4100);

    expect(monitor.getMonitoredCount()).toBe(1);
    
    const status = monitor.getStatus('test-plugin');
    expect(status).toBeDefined();
    expect(status?.pluginName).toBe('test-plugin');
    expect(status?.containerPort).toBe(4100);
    expect(status?.status).toBe('unknown');
  });

  it('should stop monitoring a plugin', () => {
    monitor.startMonitoring('test-plugin', 4100);
    expect(monitor.getMonitoredCount()).toBe(1);

    monitor.stopMonitoring('test-plugin');
    expect(monitor.getMonitoredCount()).toBe(0);
    expect(monitor.getStatus('test-plugin')).toBeUndefined();
  });

  it('should update status to healthy on successful check', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'healthy' }),
    });

    monitor.startMonitoring('test-plugin', 4100);
    
    await monitor.triggerCheck('test-plugin');

    const status = monitor.getStatus('test-plugin');
    expect(status?.status).toBe('healthy');
    expect(status?.failedChecks).toBe(0);
  });

  it('should increment failed checks on unhealthy response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    monitor.startMonitoring('test-plugin', 4100);
    
    await monitor.triggerCheck('test-plugin');

    const status = monitor.getStatus('test-plugin');
    expect(status?.status).toBe('unhealthy');
    expect(status?.failedChecks).toBe(1);
  });

  it('should handle network errors', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'));

    monitor.startMonitoring('test-plugin', 4100);
    
    await monitor.triggerCheck('test-plugin');

    const status = monitor.getStatus('test-plugin');
    expect(status?.status).toBe('unhealthy');
    expect(status?.failedChecks).toBe(1);
  });

  it('should get all monitored plugins', () => {
    monitor.startMonitoring('plugin-1', 4100);
    monitor.startMonitoring('plugin-2', 4101);
    monitor.startMonitoring('plugin-3', 4102);

    const all = monitor.getAllStatus();
    expect(all).toHaveLength(3);
  });

  it('should stop all monitoring', () => {
    monitor.startMonitoring('plugin-1', 4100);
    monitor.startMonitoring('plugin-2', 4101);
    
    expect(monitor.getMonitoredCount()).toBe(2);

    monitor.stopAll();
    
    expect(monitor.getMonitoredCount()).toBe(0);
  });

  it('should reset failed checks on healthy response', async () => {
    // First call fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    monitor.startMonitoring('test-plugin', 4100);
    await monitor.triggerCheck('test-plugin');
    
    expect(monitor.getStatus('test-plugin')?.failedChecks).toBe(1);

    // Second call succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: 'ok' }),
    });

    await monitor.triggerCheck('test-plugin');

    const status = monitor.getStatus('test-plugin');
    expect(status?.status).toBe('healthy');
    expect(status?.failedChecks).toBe(0);
  });
});
