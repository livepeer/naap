import { afterEach, describe, it, expect } from 'vitest';
import {
  buildCapabilitySummarySQL,
  buildCapabilitySummaryWithoutLatencySQL,
  buildFiltersSQL,
  resolveClickhouseGatewayQueryUrl,
  resolveClickhouseQueryTarget,
} from '../query.js';

const ORIGINAL_CLICKHOUSE_ENV = {
  CLICKHOUSE_URL: process.env.CLICKHOUSE_URL,
  CLICKHOUSE_USER: process.env.CLICKHOUSE_USER,
  CLICKHOUSE_PASSWORD: process.env.CLICKHOUSE_PASSWORD,
};

function resetClickhouseEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_CLICKHOUSE_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe('query', () => {
  afterEach(() => {
    resetClickhouseEnv();
  });

  describe('buildCapabilitySummarySQL', () => {
    it('generates valid SELECT with joined latency', () => {
      const sql = buildCapabilitySummarySQL();
      expect(sql).toMatch(/^SELECT/);
      expect(sql).toContain('semantic.network_capabilities');
      expect(sql).toContain('semantic.gateway_latency_summary');
      expect(sql).toContain('FORMAT JSON');
      expect(sql).toContain('capability_name');
      expect(sql).toContain('gpus');
      expect(sql).toContain('orchestrators');
      expect(sql).toContain('avg_latency_ms');
    });

    it('does not contain destructive keywords', () => {
      const sql = buildCapabilitySummarySQL();
      const forbidden = ['DROP', 'DELETE', 'INSERT', 'UPDATE', 'ALTER', 'TRUNCATE'];
      for (const word of forbidden) {
        expect(sql.toUpperCase()).not.toContain(word);
      }
    });
  });

  describe('buildCapabilitySummaryWithoutLatencySQL', () => {
    it('keeps capability aggregation but avoids latency sources', () => {
      const sql = buildCapabilitySummaryWithoutLatencySQL();
      expect(sql).toMatch(/^SELECT/);
      expect(sql).toContain('semantic.network_capabilities');
      expect(sql).not.toContain('semantic.gateway_latency_summary');
      expect(sql).toContain('avg_latency_ms');
      expect(sql).toContain('FORMAT JSON');
    });
  });

  describe('buildFiltersSQL', () => {
    it('returns distinct capability names', () => {
      const sql = buildFiltersSQL();
      expect(sql).toContain('DISTINCT capability_name');
      expect(sql).toContain('total_capacity > 0');
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

  describe('resolveClickhouseQueryTarget', () => {
    it('uses direct ClickHouse env vars when configured', () => {
      process.env.CLICKHOUSE_URL = 'https://clickhouse.example.com:8443';
      process.env.CLICKHOUSE_USER = 'default';
      process.env.CLICKHOUSE_PASSWORD = 'secret';

      const target = resolveClickhouseQueryTarget('https://myapp.vercel.app/api/test');

      expect(target.mode).toBe('direct');
      expect(target.url).toBe('https://clickhouse.example.com:8443/');
      expect(target.headers.Authorization).toBe(`Basic ${Buffer.from('default:secret').toString('base64')}`);
    });

    it('uses the gateway when direct ClickHouse env vars are absent', () => {
      delete process.env.CLICKHOUSE_URL;
      delete process.env.CLICKHOUSE_USER;
      delete process.env.CLICKHOUSE_PASSWORD;

      const target = resolveClickhouseQueryTarget('https://myapp.vercel.app/api/test');

      expect(target.mode).toBe('gateway');
      expect(target.url).toBe('https://myapp.vercel.app/api/v1/gw/clickhouse-query/query');
      expect(target.headers.Authorization).toBeUndefined();
    });

    it('fails fast when direct ClickHouse env vars are partially configured', () => {
      process.env.CLICKHOUSE_URL = 'https://clickhouse.example.com:8443';
      delete process.env.CLICKHOUSE_USER;
      process.env.CLICKHOUSE_PASSWORD = 'secret';

      expect(() => resolveClickhouseQueryTarget()).toThrow(
        'CLICKHOUSE_URL, CLICKHOUSE_USER, and CLICKHOUSE_PASSWORD must all be set',
      );
    });
  });
});
