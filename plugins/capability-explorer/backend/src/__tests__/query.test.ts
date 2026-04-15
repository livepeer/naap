import { describe, it, expect } from 'vitest';
import { buildCapabilitySummarySQL, buildLatencySQL, buildFiltersSQL, resolveClickhouseGatewayQueryUrl } from '../query.js';

describe('query', () => {
  describe('buildCapabilitySummarySQL', () => {
    it('generates valid SELECT query', () => {
      const sql = buildCapabilitySummarySQL();
      expect(sql).toMatch(/^SELECT/);
      expect(sql).toContain('semantic.network_capabilities');
      expect(sql).toContain('FORMAT JSON');
      expect(sql).toContain('capability_name');
      expect(sql).toContain('gpu_count');
      expect(sql).toContain('warm_bool = 1');
    });

    it('does not contain destructive keywords', () => {
      const sql = buildCapabilitySummarySQL();
      const forbidden = ['DROP', 'DELETE', 'INSERT', 'UPDATE', 'ALTER', 'TRUNCATE'];
      for (const word of forbidden) {
        expect(sql.toUpperCase()).not.toContain(word);
      }
    });
  });

  describe('buildLatencySQL', () => {
    it('joins capabilities with latency summary', () => {
      const sql = buildLatencySQL();
      expect(sql).toContain('semantic.network_capabilities');
      expect(sql).toContain('semantic.gateway_latency_summary');
      expect(sql).toContain('avg_latency');
      expect(sql).toContain('best_latency');
    });
  });

  describe('buildFiltersSQL', () => {
    it('returns distinct capability names', () => {
      const sql = buildFiltersSQL();
      expect(sql).toContain('DISTINCT capability_name');
      expect(sql).toContain('warm_bool = 1');
    });
  });

  describe('resolveClickhouseGatewayQueryUrl', () => {
    it('uses request URL origin when provided', () => {
      const url = resolveClickhouseGatewayQueryUrl('https://myapp.vercel.app/api/test');
      expect(url).toBe('https://myapp.vercel.app/api/v1/gw/clickhouse-query/query');
    });

    it('falls back to localhost', () => {
      const url = resolveClickhouseGatewayQueryUrl();
      expect(url).toContain('/api/v1/gw/clickhouse-query/query');
    });
  });
});
