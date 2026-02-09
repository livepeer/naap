/**
 * Database abstraction types and interfaces
 */

export interface DatabaseConfig {
  service: string;
  schemaPath: string;
  connectionString?: string;
  logLevel?: 'info' | 'warn' | 'error' | 'query';
}

export interface MigrationOptions {
  service?: string;
  createOnly?: boolean;
  reset?: boolean;
}

export interface SeedOptions {
  service?: string;
  reset?: boolean;
}

export interface DatabaseHealth {
  status: 'healthy' | 'unhealthy';
  service: string;
  connected: boolean;
  latency?: number;
  error?: string;
}

export interface ServiceDatabaseConfig {
  service: string;
  database: string;
  port: number;
  user: string;
  password: string;
  host?: string;
}
