import { describe, it, expect, afterEach } from 'vitest';
import {
  buildLeaderboardSQL,
  validateCapability,
  validateTopN,
  resolveClickhouseGatewayQueryUrl,
  resolveClickhouseQueryTarget,
  buildOrchestratorClickhouseFetchParams,
} from '../query';

describe('validateCapability', () => {
  it('accepts valid capability names', () => {
    expect(() => validateCapability('streamdiffusion-sdxl')).not.toThrow();
    expect(() => validateCapability('noop')).not.toThrow();
    expect(() => validateCapability('stream_diffusion_v2')).not.toThrow();
    expect(() => validateCapability('abc-123_XYZ')).not.toThrow();
  });

  it('rejects empty string', () => {
    expect(() => validateCapability('')).toThrow('capability is required');
  });

  it('rejects non-string values', () => {
    expect(() => validateCapability(null as any)).toThrow('capability is required');
    expect(() => validateCapability(undefined as any)).toThrow('capability is required');
  });

  it('rejects SQL injection attempts', () => {
    expect(() => validateCapability("'; DROP TABLE --")).toThrow();
    expect(() => validateCapability('" OR 1=1')).toThrow();
    expect(() => validateCapability('foo; DELETE')).toThrow();
    expect(() => validateCapability("a' OR 'x'='x")).toThrow();
  });

  it('rejects special characters', () => {
    expect(() => validateCapability('foo bar')).toThrow();
    expect(() => validateCapability('foo.bar')).toThrow();
    expect(() => validateCapability('foo/bar')).toThrow();
    expect(() => validateCapability('foo@bar')).toThrow();
  });

  it('rejects overly long names', () => {
    expect(() => validateCapability('a'.repeat(129))).toThrow('128 characters');
  });
});

describe('validateTopN', () => {
  it('accepts valid integers', () => {
    expect(validateTopN(5)).toBe(5);
    expect(validateTopN(10)).toBe(10);
    expect(validateTopN(100)).toBe(100);
    expect(validateTopN(1)).toBe(1);
    expect(validateTopN(1000)).toBe(1000);
  });

  it('rejects zero and negative', () => {
    expect(() => validateTopN(0)).toThrow();
    expect(() => validateTopN(-1)).toThrow();
  });

  it('rejects non-integers', () => {
    expect(() => validateTopN(1.5)).toThrow();
    expect(() => validateTopN('abc')).toThrow();
    expect(() => validateTopN(NaN)).toThrow();
  });

  it('rejects values over 1000', () => {
    expect(() => validateTopN(1001)).toThrow();
  });
});

describe('resolveClickhouseQueryTarget', () => {
  const prevUrl = process.env.CLICKHOUSE_URL;
  const prevUser = process.env.CLICKHOUSE_USER;
  const prevPassword = process.env.CLICKHOUSE_PASSWORD;
  const prevPublic = process.env.NEXT_PUBLIC_APP_URL;
  const prevVercel = process.env.VERCEL_URL;

  afterEach(() => {
    if (prevUrl === undefined) delete process.env.CLICKHOUSE_URL;
    else process.env.CLICKHOUSE_URL = prevUrl;
    if (prevUser === undefined) delete process.env.CLICKHOUSE_USER;
    else process.env.CLICKHOUSE_USER = prevUser;
    if (prevPassword === undefined) delete process.env.CLICKHOUSE_PASSWORD;
    else process.env.CLICKHOUSE_PASSWORD = prevPassword;
    if (prevPublic === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prevPublic;
    if (prevVercel === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = prevVercel;
  });

  it('uses direct ClickHouse when all three env vars are set', () => {
    process.env.CLICKHOUSE_URL = 'https://ch.example.com:8443/';
    process.env.CLICKHOUSE_USER = 'u';
    process.env.CLICKHOUSE_PASSWORD = 'p';
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;

    const t = resolveClickhouseQueryTarget();
    expect(t.mode).toBe('direct');
    expect(t.url).toBe('https://ch.example.com:8443/');
    expect(t.headers['Content-Type']).toBe('text/plain');
    expect(t.headers.Authorization).toMatch(/^Basic /);
  });

  it('throws when only some direct env vars are set', () => {
    process.env.CLICKHOUSE_URL = 'https://ch.example.com/';
    delete process.env.CLICKHOUSE_USER;
    delete process.env.CLICKHOUSE_PASSWORD;
    expect(() => resolveClickhouseQueryTarget()).toThrow(
      'CLICKHOUSE_URL, CLICKHOUSE_USER, and CLICKHOUSE_PASSWORD must all be set',
    );
  });

  it('falls back to gateway when direct env is unset', () => {
    delete process.env.CLICKHOUSE_URL;
    delete process.env.CLICKHOUSE_USER;
    delete process.env.CLICKHOUSE_PASSWORD;
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';

    const t = resolveClickhouseQueryTarget('http://localhost:3030/api/foo');
    expect(t.mode).toBe('gateway');
    expect(t.url).toBe('http://localhost:3030/api/v1/gw/clickhouse-query/query');
    expect(t.headers).toEqual({ 'Content-Type': 'text/plain' });
  });
});

describe('buildOrchestratorClickhouseFetchParams', () => {
  const prevUrl = process.env.CLICKHOUSE_URL;
  const prevUser = process.env.CLICKHOUSE_USER;
  const prevPassword = process.env.CLICKHOUSE_PASSWORD;
  const prevPublic = process.env.NEXT_PUBLIC_APP_URL;

  afterEach(() => {
    if (prevUrl === undefined) delete process.env.CLICKHOUSE_URL;
    else process.env.CLICKHOUSE_URL = prevUrl;
    if (prevUser === undefined) delete process.env.CLICKHOUSE_USER;
    else process.env.CLICKHOUSE_USER = prevUser;
    if (prevPassword === undefined) delete process.env.CLICKHOUSE_PASSWORD;
    else process.env.CLICKHOUSE_PASSWORD = prevPassword;
    if (prevPublic === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prevPublic;
  });

  it('does not add Bearer in direct mode', () => {
    process.env.CLICKHOUSE_URL = 'https://ch.example.com/';
    process.env.CLICKHOUSE_USER = 'alice';
    process.env.CLICKHOUSE_PASSWORD = 'secret';
    const { headers } = buildOrchestratorClickhouseFetchParams('jwt-should-be-ignored');
    expect(headers.Authorization).toMatch(/^Basic /);
    expect(headers.Authorization).not.toContain('jwt-should-be-ignored');
  });

  it('adds Bearer in gateway mode', () => {
    delete process.env.CLICKHOUSE_URL;
    delete process.env.CLICKHOUSE_USER;
    delete process.env.CLICKHOUSE_PASSWORD;
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
    const { headers } = buildOrchestratorClickhouseFetchParams('the-token', undefined, 'a=b');
    expect(headers.Authorization).toBe('Bearer the-token');
    expect(headers.cookie).toBe('a=b');
  });
});

describe('resolveClickhouseGatewayQueryUrl', () => {
  const prevPublic = process.env.NEXT_PUBLIC_APP_URL;
  const prevVercel = process.env.VERCEL_URL;

  afterEach(() => {
    if (prevPublic === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prevPublic;
    if (prevVercel === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = prevVercel;
  });

  it('uses request origin when provided', () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;
    expect(
      resolveClickhouseGatewayQueryUrl('http://localhost:3030/api/v1/orchestrator-leaderboard/rank'),
    ).toBe('http://localhost:3030/api/v1/gw/clickhouse-query/query');
  });

  it('prefers request origin over NEXT_PUBLIC_APP_URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    expect(
      resolveClickhouseGatewayQueryUrl('http://localhost:3030/api/v1/orchestrator-leaderboard/rank'),
    ).toBe('http://localhost:3030/api/v1/gw/clickhouse-query/query');
  });

  it('falls back to NEXT_PUBLIC_APP_URL without request', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
    expect(resolveClickhouseGatewayQueryUrl()).toBe(
      'https://app.example.com/api/v1/gw/clickhouse-query/query',
    );
  });

  it('falls back to VERCEL_URL when no request and no public URL', () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL_URL = 'my-app.vercel.app';
    expect(resolveClickhouseGatewayQueryUrl()).toBe(
      'https://my-app.vercel.app/api/v1/gw/clickhouse-query/query',
    );
  });
});

describe('buildLeaderboardSQL', () => {
  it('generates valid SQL with correct substitutions', () => {
    const sql = buildLeaderboardSQL('streamdiffusion-sdxl', 10);
    expect(sql).toContain("capability_name = 'streamdiffusion-sdxl'");
    expect(sql).toContain('LIMIT 10');
    expect(sql).toContain('FORMAT JSON');
  });

  it('replaces capability placeholder in all subqueries', () => {
    const sql = buildLeaderboardSQL('noop', 5);
    const matches = sql.match(/capability_name = 'noop'/g);
    expect(matches).toHaveLength(2);
  });

  it('throws on invalid capability', () => {
    expect(() => buildLeaderboardSQL("'; DROP TABLE --", 10)).toThrow();
  });

  it('throws on invalid topN', () => {
    expect(() => buildLeaderboardSQL('noop', 0)).toThrow();
    expect(() => buildLeaderboardSQL('noop', -5)).toThrow();
  });

  it('includes semantic table references', () => {
    const sql = buildLeaderboardSQL('noop', 5);
    expect(sql).toContain('semantic.network_capabilities');
    expect(sql).toContain('semantic.gateway_latency_summary');
  });

  it('includes ORDER BY clause', () => {
    const sql = buildLeaderboardSQL('noop', 5);
    expect(sql).toContain('ORDER BY');
    expect(sql).toContain('best_latency ASC NULLS LAST');
    expect(sql).toContain('swing_ratio ASC NULLS LAST');
    expect(sql).toContain('price_per_unit ASC');
  });
});
