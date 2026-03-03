import { Client, type ConnectConfig } from 'ssh2';
import { AuthenticationError, ConnectionError } from './errors.js';
import { logInfo, logError } from './audit.js';

export interface PoolConfig {
  maxConnectionsPerHost: number;
  maxTotalConnections: number;
  idleTTLMs: number;
  connectTimeoutMs: number;
}

interface PoolEntry {
  client: Client;
  key: string;
  createdAt: number;
  lastUsedAt: number;
  inUse: boolean;
}

const DEFAULT_CONFIG: PoolConfig = {
  maxConnectionsPerHost: 5,
  maxTotalConnections: 20,
  idleTTLMs: 300_000,
  connectTimeoutMs: 10_000,
};

export class SSHConnectionPool {
  private pool = new Map<string, PoolEntry[]>();
  private config: PoolConfig;
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(config: Partial<PoolConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cleanupInterval = setInterval(() => this.evictIdle(), 30_000);
  }

  private makeKey(host: string, port: number, username: string): string {
    return `${username}@${host}:${port}`;
  }

  private getTotalCount(): number {
    let count = 0;
    for (const entries of this.pool.values()) {
      count += entries.length;
    }
    return count;
  }

  async acquire(
    host: string,
    port: number,
    username: string,
    privateKey?: string,
    passphrase?: string,
  ): Promise<Client> {
    const key = this.makeKey(host, port, username);
    const entries = this.pool.get(key) || [];

    const reusable = entries.find((e) => !e.inUse && this.isAlive(e));
    if (reusable) {
      reusable.inUse = true;
      reusable.lastUsedAt = Date.now();
      return reusable.client;
    }

    if (entries.length >= this.config.maxConnectionsPerHost) {
      throw new ConnectionError(host, `Max connections per host (${this.config.maxConnectionsPerHost}) reached`);
    }
    if (this.getTotalCount() >= this.config.maxTotalConnections) {
      throw new ConnectionError(host, `Max total connections (${this.config.maxTotalConnections}) reached`);
    }

    const client = await this.connect(host, port, username, privateKey, passphrase);
    const entry: PoolEntry = {
      client,
      key,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      inUse: true,
    };

    if (!this.pool.has(key)) this.pool.set(key, []);
    this.pool.get(key)!.push(entry);

    client.on('error', () => this.removeEntry(entry));
    client.on('close', () => this.removeEntry(entry));

    return client;
  }

  release(client: Client): void {
    for (const entries of this.pool.values()) {
      const entry = entries.find((e) => e.client === client);
      if (entry) {
        entry.inUse = false;
        entry.lastUsedAt = Date.now();
        return;
      }
    }
  }

  destroy(client: Client): void {
    for (const entries of this.pool.values()) {
      const entry = entries.find((e) => e.client === client);
      if (entry) {
        this.removeEntry(entry);
        return;
      }
    }
  }

  private removeEntry(entry: PoolEntry): void {
    try { entry.client.end(); } catch { /* ignore */ }
    const entries = this.pool.get(entry.key);
    if (entries) {
      const idx = entries.indexOf(entry);
      if (idx !== -1) entries.splice(idx, 1);
      if (entries.length === 0) this.pool.delete(entry.key);
    }
  }

  private isAlive(entry: PoolEntry): boolean {
    const age = Date.now() - entry.lastUsedAt;
    return age < this.config.idleTTLMs;
  }

  private evictIdle(): void {
    for (const [key, entries] of this.pool.entries()) {
      const stale = entries.filter((e) => !e.inUse && !this.isAlive(e));
      for (const entry of stale) {
        logInfo('pool.evict', { key, age: Date.now() - entry.lastUsedAt });
        this.removeEntry(entry);
      }
    }
  }

  private connect(
    host: string,
    port: number,
    username: string,
    privateKey?: string,
    passphrase?: string,
  ): Promise<Client> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      const timer = setTimeout(() => {
        client.end();
        reject(new ConnectionError(host, `Connection timed out after ${this.config.connectTimeoutMs}ms`));
      }, this.config.connectTimeoutMs);

      const connectConfig: ConnectConfig = {
        host,
        port,
        username,
        readyTimeout: this.config.connectTimeoutMs,
      };
      if (privateKey) {
        connectConfig.privateKey = privateKey;
        if (passphrase) connectConfig.passphrase = passphrase;
      }

      client
        .on('ready', () => {
          clearTimeout(timer);
          logInfo('pool.connect', { host, port, username });
          resolve(client);
        })
        .on('error', (err) => {
          clearTimeout(timer);
          if (err.message.includes('authentication') || err.message.includes('auth')) {
            reject(new AuthenticationError(host));
          } else {
            reject(new ConnectionError(host, err.message));
          }
        })
        .connect(connectConfig);
    });
  }

  async drain(): Promise<void> {
    clearInterval(this.cleanupInterval);
    const allEntries: PoolEntry[] = [];
    for (const entries of this.pool.values()) {
      allEntries.push(...entries);
    }
    for (const entry of allEntries) {
      try { entry.client.end(); } catch { /* ignore */ }
    }
    this.pool.clear();
    logInfo('pool.drained', { count: allEntries.length });
  }

  stats(): { totalConnections: number; activeConnections: number; hosts: number } {
    let total = 0;
    let active = 0;
    for (const entries of this.pool.values()) {
      total += entries.length;
      active += entries.filter((e) => e.inUse).length;
    }
    return { totalConnections: total, activeConnections: active, hosts: this.pool.size };
  }
}
