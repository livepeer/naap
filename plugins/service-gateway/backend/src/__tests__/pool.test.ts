import { describe, it, expect } from 'vitest';
import { SSHConnectionPool } from '../lib/pool.js';

describe('SSHConnectionPool', () => {
  it('initializes with default config', () => {
    const pool = new SSHConnectionPool();
    const stats = pool.stats();
    expect(stats.totalConnections).toBe(0);
    expect(stats.activeConnections).toBe(0);
    expect(stats.hosts).toBe(0);
  });

  it('initializes with custom config', () => {
    const pool = new SSHConnectionPool({
      maxConnectionsPerHost: 3,
      maxTotalConnections: 10,
      idleTTLMs: 60_000,
      connectTimeoutMs: 5_000,
    });
    const stats = pool.stats();
    expect(stats.totalConnections).toBe(0);
  });

  it('drains cleanly when empty', async () => {
    const pool = new SSHConnectionPool();
    await pool.drain();
    expect(pool.stats().totalConnections).toBe(0);
  });
});
