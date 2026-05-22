import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getCached, setCached, clearCache, getCacheStats } from '../cache';
import type { ClickHouseLeaderboardRow } from '../types';

function makeRow(overrides: Partial<ClickHouseLeaderboardRow> = {}): ClickHouseLeaderboardRow {
  return {
    orch_uri: 'https://orch-1.example.com',
    gpu_name: 'RTX 4090',
    gpu_gb: 24,
    avail: 3,
    total_cap: 4,
    price_per_unit: 100,
    best_lat_ms: 50,
    avg_lat_ms: 80,
    swap_ratio: 0.05,
    avg_avail: 3.2,
    ...overrides,
  };
}

describe('Leaderboard Cache', () => {
  beforeEach(() => {
    clearCache();
  });

  it('returns null for unknown capability (miss)', () => {
    expect(getCached('unknown')).toBeNull();
  });

  it('returns stored rows after setCached (hit)', () => {
    const rows = [makeRow()];
    setCached('streamdiffusion-sdxl', rows);
    const result = getCached('streamdiffusion-sdxl');
    expect(result).not.toBeNull();
    expect(result!.rows).toEqual(rows);
    expect(result!.cachedAt).toBeGreaterThan(0);
  });

  it('expires entries after TTL', async () => {
    vi.useFakeTimers();
    const rows = [makeRow()];
    setCached('test-cap', rows, 100);

    expect(getCached('test-cap')).not.toBeNull();

    await vi.advanceTimersByTimeAsync(150);

    expect(getCached('test-cap')).toBeNull();
    vi.useRealTimers();
  });

  it('isolates entries by capability', () => {
    setCached('cap-a', [makeRow({ orch_uri: 'a' })]);
    setCached('cap-b', [makeRow({ orch_uri: 'b' })]);

    const a = getCached('cap-a');
    const b = getCached('cap-b');
    expect(a!.rows[0].orch_uri).toBe('a');
    expect(b!.rows[0].orch_uri).toBe('b');
  });

  it('clearCache empties all entries', () => {
    setCached('a', [makeRow()]);
    setCached('b', [makeRow()]);
    expect(getCacheStats().size).toBe(2);

    clearCache();
    expect(getCacheStats().size).toBe(0);
    expect(getCached('a')).toBeNull();
  });

  it('evicts oldest entry when at max capacity', () => {
    for (let i = 0; i < 51; i++) {
      setCached(`cap-${i}`, [makeRow()]);
    }
    expect(getCacheStats().size).toBeLessThanOrEqual(50);
  });

  it('tracks hits and misses accurately', () => {
    clearCache();
    setCached('test', [makeRow()]);

    getCached('test');
    getCached('test');
    getCached('unknown');

    const stats = getCacheStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
  });
});
