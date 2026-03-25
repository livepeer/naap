import { describe, it, expect } from 'vitest';
import {
  buildContiguousDemandHourlyBuckets,
  formatWindowStartUtc,
  utcHourStartMs,
} from '../hourly-buckets.js';
import type { NetworkDemandRow } from '../raw-data.js';

function row(
  windowStart: string,
  total_minutes: number,
  total_demand_sessions: number
): NetworkDemandRow {
  return {
    window_start: windowStart,
    gateway: 'g',
    region: null,
    pipeline_id: 'p',
    model_id: null,
    sessions_count: 0,
    avg_output_fps: 0,
    total_minutes,
    known_sessions_count: 0,
    served_sessions: 0,
    unserved_sessions: 0,
    total_demand_sessions,
    startup_unexcused_sessions: 0,
    confirmed_swapped_sessions: 0,
    inferred_swap_sessions: 0,
    total_swapped_sessions: 0,
    sessions_ending_in_error: 0,
    error_status_samples: 0,
    health_signal_coverage_ratio: 0,
    startup_success_rate: 0,
    effective_success_rate: 0,
    ticket_face_value_eth: 0,
  };
}

describe('buildContiguousDemandHourlyBuckets', () => {
  it('fills missing hours with zero and anchors to latest window_start', () => {
    const rows: NetworkDemandRow[] = [
      row('2026-03-25T11:00:00Z', 10, 2),
      row('2026-03-25T13:00:00Z', 5, 1),
    ];
    const mins = buildContiguousDemandHourlyBuckets(rows, 3, 'minutes');
    expect(mins).toHaveLength(3);
    expect(mins[0].hour).toBe('2026-03-25T11:00:00Z');
    expect(mins[0].value).toBe(10);
    expect(mins[1].hour).toBe('2026-03-25T12:00:00Z');
    expect(mins[1].value).toBe(0);
    expect(mins[2].hour).toBe('2026-03-25T13:00:00Z');
    expect(mins[2].value).toBe(5);

    const sess = buildContiguousDemandHourlyBuckets(rows, 3, 'sessions');
    expect(sess.map((b) => b.value)).toEqual([2, 0, 1]);
  });

  it('aggregates multiple rows in the same hour', () => {
    const rows: NetworkDemandRow[] = [
      row('2026-03-25T13:00:00Z', 1, 1),
      row('2026-03-25T13:00:00Z', 2, 3),
    ];
    const mins = buildContiguousDemandHourlyBuckets(rows, 1, 'minutes');
    expect(mins).toEqual([{ hour: '2026-03-25T13:00:00Z', value: 3 }]);
    const sess = buildContiguousDemandHourlyBuckets(rows, 1, 'sessions');
    expect(sess).toEqual([{ hour: '2026-03-25T13:00:00Z', value: 4 }]);
  });
});

describe('utcHourStartMs / formatWindowStartUtc', () => {
  it('round-trips leaderboard-style timestamps', () => {
    const ms = utcHourStartMs('2026-03-25T13:00:00Z');
    expect(ms).not.toBeNull();
    expect(formatWindowStartUtc(ms!)).toBe('2026-03-25T13:00:00Z');
  });

  it('returns null for invalid input', () => {
    expect(utcHourStartMs('not-a-date')).toBeNull();
  });
});
