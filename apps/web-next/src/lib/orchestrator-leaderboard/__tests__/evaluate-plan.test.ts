import { describe, it, expect } from 'vitest';
import { evaluatePlan } from '../ranking';
import type { ClickHouseLeaderboardRow, DiscoveryPlan } from '../types';

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

type PlanParams = Pick<DiscoveryPlan, 'filters' | 'slaWeights' | 'slaMinScore' | 'sortBy' | 'topN'>;

describe('evaluatePlan', () => {
  const rows: ClickHouseLeaderboardRow[] = [
    makeRow({ orch_uri: 'fast', best_lat_ms: 30, swap_ratio: 0.01, price_per_unit: 50, avail: 5 }),
    makeRow({ orch_uri: 'mid', best_lat_ms: 200, swap_ratio: 0.1, price_per_unit: 200, avail: 3 }),
    makeRow({ orch_uri: 'slow', best_lat_ms: 500, swap_ratio: 0.5, price_per_unit: 500, avail: 1 }),
    makeRow({ orch_uri: 'cheap', best_lat_ms: 300, swap_ratio: 0.2, price_per_unit: 10, avail: 2 }),
  ];

  it('applies filters before ranking', () => {
    const plan: PlanParams = {
      filters: { priceMax: 200 },
      slaWeights: null,
      slaMinScore: null,
      sortBy: null,
      topN: 10,
    };
    const result = evaluatePlan(rows, plan);
    expect(result.every((r) => r.pricePerUnit <= 200)).toBe(true);
  });

  it('respects topN limit', () => {
    const plan: PlanParams = {
      filters: null,
      slaWeights: null,
      slaMinScore: null,
      sortBy: null,
      topN: 2,
    };
    const result = evaluatePlan(rows, plan);
    expect(result).toHaveLength(2);
  });

  it('applies SLA scoring when slaWeights provided', () => {
    const plan: PlanParams = {
      filters: null,
      slaWeights: { latency: 0.5, swapRate: 0.3, price: 0.2 },
      slaMinScore: null,
      sortBy: null,
      topN: 10,
    };
    const result = evaluatePlan(rows, plan);
    expect(result[0].slaScore).toBeDefined();
    expect(result[0].orchUri).toBe('fast');
  });

  it('applies slaMinScore gate', () => {
    const plan: PlanParams = {
      filters: null,
      slaWeights: { latency: 0.4, swapRate: 0.3, price: 0.3 },
      slaMinScore: 0.8,
      sortBy: null,
      topN: 10,
    };
    const result = evaluatePlan(rows, plan);
    expect(result.every((r) => (r.slaScore ?? 0) >= 0.8)).toBe(true);
    expect(result.length).toBeLessThan(rows.length);
  });

  it('sorts by latency when sortBy=latency', () => {
    const plan: PlanParams = {
      filters: null,
      slaWeights: null,
      slaMinScore: null,
      sortBy: 'latency',
      topN: 10,
    };
    const result = evaluatePlan(rows, plan);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].bestLatMs! <= result[i].bestLatMs!).toBe(true);
    }
  });

  it('sorts by price when sortBy=price', () => {
    const plan: PlanParams = {
      filters: null,
      slaWeights: null,
      slaMinScore: null,
      sortBy: 'price',
      topN: 10,
    };
    const result = evaluatePlan(rows, plan);
    expect(result[0].orchUri).toBe('cheap');
  });

  it('sorts by avail descending when sortBy=avail', () => {
    const plan: PlanParams = {
      filters: null,
      slaWeights: null,
      slaMinScore: null,
      sortBy: 'avail',
      topN: 10,
    };
    const result = evaluatePlan(rows, plan);
    expect(result[0].orchUri).toBe('fast');
    expect(result[0].avail).toBe(5);
  });

  it('combines filters + SLA + gate + sort + topN', () => {
    const plan: PlanParams = {
      filters: { priceMax: 500 },
      slaWeights: { latency: 0.4, swapRate: 0.3, price: 0.3 },
      slaMinScore: 0.3,
      sortBy: 'slaScore',
      topN: 2,
    };
    const result = evaluatePlan(rows, plan);
    expect(result.length).toBeLessThanOrEqual(2);
    expect(result.every((r) => r.pricePerUnit <= 500)).toBe(true);
    expect(result.every((r) => (r.slaScore ?? 0) >= 0.3)).toBe(true);
  });

  it('returns empty array when all rows filtered out', () => {
    const plan: PlanParams = {
      filters: { priceMax: 1 },
      slaWeights: null,
      slaMinScore: null,
      sortBy: null,
      topN: 10,
    };
    const result = evaluatePlan(rows, plan);
    expect(result).toHaveLength(0);
  });
});
