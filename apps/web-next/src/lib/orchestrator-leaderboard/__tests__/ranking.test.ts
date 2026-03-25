import { describe, it, expect } from 'vitest';
import { applyFilters, rerank, computeSLAScore, mapRow } from '../ranking';
import type { ClickHouseLeaderboardRow } from '../types';

function makeRow(overrides: Partial<ClickHouseLeaderboardRow> = {}): ClickHouseLeaderboardRow {
  return {
    orch_uri: 'https://orch.example.com',
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

describe('mapRow', () => {
  it('maps ClickHouse snake_case to camelCase', () => {
    const row = makeRow({ orch_uri: 'https://test.com', gpu_name: 'A100' });
    const mapped = mapRow(row);
    expect(mapped.orchUri).toBe('https://test.com');
    expect(mapped.gpuName).toBe('A100');
    expect(mapped.gpuGb).toBe(24);
    expect(mapped.bestLatMs).toBe(50);
  });
});

describe('applyFilters', () => {
  const rows = [
    makeRow({ gpu_gb: 8, price_per_unit: 50, avg_lat_ms: 100, swap_ratio: 0.1 }),
    makeRow({ gpu_gb: 16, price_per_unit: 200, avg_lat_ms: 300, swap_ratio: 0.3 }),
    makeRow({ gpu_gb: 24, price_per_unit: 500, avg_lat_ms: 500, swap_ratio: 0.6 }),
    makeRow({ gpu_gb: 48, price_per_unit: 1000, avg_lat_ms: null, swap_ratio: null }),
  ];

  it('returns all rows when no filters', () => {
    expect(applyFilters(rows)).toHaveLength(4);
    expect(applyFilters(rows, {})).toHaveLength(4);
  });

  it('filters by gpuRamGbMin', () => {
    const result = applyFilters(rows, { gpuRamGbMin: 16 });
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.gpu_gb >= 16)).toBe(true);
  });

  it('filters by gpuRamGbMax', () => {
    const result = applyFilters(rows, { gpuRamGbMax: 24 });
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.gpu_gb <= 24)).toBe(true);
  });

  it('filters by priceMax', () => {
    const result = applyFilters(rows, { priceMax: 200 });
    expect(result).toHaveLength(2);
  });

  it('filters by maxAvgLatencyMs', () => {
    const result = applyFilters(rows, { maxAvgLatencyMs: 300 });
    expect(result).toHaveLength(3);
  });

  it('passes rows with null latency when maxAvgLatencyMs is set', () => {
    const result = applyFilters(rows, { maxAvgLatencyMs: 100 });
    const nullRow = result.find((r) => r.avg_lat_ms === null);
    expect(nullRow).toBeDefined();
  });

  it('filters by maxSwapRatio', () => {
    const result = applyFilters(rows, { maxSwapRatio: 0.3 });
    expect(result).toHaveLength(3);
  });

  it('passes rows with null swapRatio when maxSwapRatio is set', () => {
    const result = applyFilters(rows, { maxSwapRatio: 0.1 });
    const nullRow = result.find((r) => r.swap_ratio === null);
    expect(nullRow).toBeDefined();
  });

  it('combines multiple filters', () => {
    const result = applyFilters(rows, { gpuRamGbMin: 16, priceMax: 200 });
    expect(result).toHaveLength(1);
    expect(result[0].gpu_gb).toBe(16);
  });
});

describe('computeSLAScore', () => {
  const mm = {
    minLat: 50, maxLat: 500,
    minSwap: 0.05, maxSwap: 0.6,
    minPrice: 50, maxPrice: 1000,
  };
  const weights = { latency: 0.4, swapRate: 0.3, price: 0.3 };

  it('returns highest score for best values', () => {
    const bestRow = makeRow({ best_lat_ms: 50, swap_ratio: 0.05, price_per_unit: 50 });
    const score = computeSLAScore(bestRow, weights, mm);
    expect(score).toBeCloseTo(1.0, 2);
  });

  it('returns lowest score for worst values', () => {
    const worstRow = makeRow({ best_lat_ms: 500, swap_ratio: 0.6, price_per_unit: 1000 });
    const score = computeSLAScore(worstRow, weights, mm);
    expect(score).toBeCloseTo(0.0, 2);
  });

  it('handles null latency with neutral score', () => {
    const row = makeRow({ best_lat_ms: null, swap_ratio: 0.05, price_per_unit: 50 });
    const score = computeSLAScore(row, weights, mm);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('handles equal min/max (all same values)', () => {
    const equalMm = { minLat: 100, maxLat: 100, minSwap: 0.1, maxSwap: 0.1, minPrice: 200, maxPrice: 200 };
    const row = makeRow({ best_lat_ms: 100, swap_ratio: 0.1, price_per_unit: 200 });
    const score = computeSLAScore(row, weights, equalMm);
    expect(score).toBe(1.0);
  });
});

describe('rerank', () => {
  it('sorts by SLA score descending', () => {
    const rows = [
      makeRow({ orch_uri: 'slow', best_lat_ms: 500, swap_ratio: 0.6, price_per_unit: 1000 }),
      makeRow({ orch_uri: 'fast', best_lat_ms: 50, swap_ratio: 0.05, price_per_unit: 50 }),
      makeRow({ orch_uri: 'mid', best_lat_ms: 200, swap_ratio: 0.2, price_per_unit: 300 }),
    ];

    const ranked = rerank(rows);
    expect(ranked[0].orchUri).toBe('fast');
    expect(ranked[ranked.length - 1].orchUri).toBe('slow');
    expect(ranked.every((r) => r.slaScore !== undefined)).toBe(true);
  });

  it('attaches slaScore to each row', () => {
    const rows = [makeRow()];
    const ranked = rerank(rows);
    expect(ranked[0].slaScore).toBeDefined();
    expect(typeof ranked[0].slaScore).toBe('number');
  });

  it('auto-normalizes weights', () => {
    const rows = [
      makeRow({ orch_uri: 'a', best_lat_ms: 100, swap_ratio: 0.1, price_per_unit: 100 }),
      makeRow({ orch_uri: 'b', best_lat_ms: 200, swap_ratio: 0.2, price_per_unit: 200 }),
    ];

    const ranked1 = rerank(rows, { latency: 0.4, swapRate: 0.3, price: 0.3 });
    const ranked2 = rerank(rows, { latency: 4, swapRate: 3, price: 3 });

    expect(ranked1[0].orchUri).toBe(ranked2[0].orchUri);
    expect(ranked1[0].slaScore).toBeCloseTo(ranked2[0].slaScore!, 2);
  });

  it('handles single row', () => {
    const rows = [makeRow()];
    const ranked = rerank(rows);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].slaScore).toBeDefined();
  });

  it('uses custom weights to change ordering', () => {
    const rows = [
      makeRow({ orch_uri: 'low-lat', best_lat_ms: 10, swap_ratio: 0.9, price_per_unit: 900 }),
      makeRow({ orch_uri: 'low-price', best_lat_ms: 900, swap_ratio: 0.9, price_per_unit: 10 }),
    ];

    const latencyFirst = rerank(rows, { latency: 1, swapRate: 0, price: 0 });
    expect(latencyFirst[0].orchUri).toBe('low-lat');

    const priceFirst = rerank(rows, { latency: 0, swapRate: 0, price: 1 });
    expect(priceFirst[0].orchUri).toBe('low-price');
  });
});
