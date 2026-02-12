/**
 * Database Manager
 * Provisions and manages PostgreSQL databases for plugins
 */

import crypto from 'crypto';
import path from 'path';
import { Client } from 'pg';

export interface DatabaseConfig {
  name: string;
  user?: string;
  password?: string;
}

export interface DatabaseInfo {
  name: string;
  host: string;
  port: number;
  user: string;
  exists: boolean;
  sizeBytes?: number;
}

export class DatabaseManager {
  private adminClient: Client | null = null;
  private connected = false;
  
  private readonly adminHost = process.env.DB_HOST || 'localhost';
  private readonly adminPort = parseInt(process.env.DB_PORT || '5432');
  private readonly adminUser = process.env.DB_ADMIN_USER || 'postgres';
  private readonly adminPassword = process.env.DB_ADMIN_PASSWORD || 'postgres';

  async connect(): Promise<void> {
    this.adminClient = new Client({
      host: this.adminHost,
      port: this.adminPort,
      user: this.adminUser,
      password: this.adminPassword,
      database: 'postgres',
    });

    await this.adminClient.connect();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.adminClient) {
      await this.adminClient.end();
      this.adminClient = null;
    }
    this.connected = false;
  }

  async isConnected(): Promise<boolean> {
    if (!this.connected || !this.adminClient) return false;
    try {
      await this.adminClient.query('SELECT 1');
      return true;
    } catch {
      this.connected = false;
      return false;
    }
  }

  /**
   * Create a new database for a plugin
   */
  async createDatabase(config: DatabaseConfig): Promise<DatabaseInfo> {
    if (!this.adminClient) {
      throw new Error('Database manager not connected');
    }

    const dbName = this.sanitizeName(config.name);
    const dbUser = this.validateIdentifier(config.user || `${dbName}_user`);
    const dbPassword = config.password || this.generatePassword();
    const escapedPassword = dbPassword.replace(/'/g, "''");

    // Check if database exists
    const existsResult = await this.adminClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName]
    );

    if (existsResult.rows.length > 0) {
      return {
        name: dbName,
        host: this.adminHost,
        port: this.adminPort,
        user: dbUser,
        exists: true,
      };
    }

    // Create user if doesn't exist
    try {
      await this.adminClient.query(
        `CREATE USER ${dbUser} WITH PASSWORD '${escapedPassword}'`
      );
    } catch (error) {
      // User might already exist
      if (!(error instanceof Error && error.message.includes('already exists'))) {
        console.warn('User creation warning:', error);
      }
    }

    // Create database
    await this.adminClient.query(
      `CREATE DATABASE ${dbName} OWNER ${dbUser}`
    );

    // Grant privileges
    await this.adminClient.query(
      `GRANT ALL PRIVILEGES ON DATABASE ${dbName} TO ${dbUser}`
    );

    return {
      name: dbName,
      host: this.adminHost,
      port: this.adminPort,
      user: dbUser,
      exists: false,
    };
  }

  /**
   * Run migrations on a plugin database
   */
  async runMigrations(
    dbName: string, 
    migrationsPath: string,
    connectionString: string
  ): Promise<void> {
    // Validate path to prevent path traversal attacks
    const resolvedPath = path.resolve(migrationsPath);
    const allowedBase = path.resolve(process.cwd());
    if (!resolvedPath.startsWith(allowedBase + path.sep) && resolvedPath !== allowedBase) {
      throw new Error('Invalid migrations path: must be within the project directory');
    }

    // Use Prisma CLI to run migrations
    const { execa } = await import('execa');
    
    await execa('npx', ['prisma', 'migrate', 'deploy'], {
      env: {
        ...process.env,
        DATABASE_URL: connectionString,
      },
      cwd: resolvedPath,
    });
  }

  /**
   * Run seed script on a plugin database
   */
  async runSeed(
    seedPath: string,
    connectionString: string
  ): Promise<void> {
    const { execa } = await import('execa');
    
    await execa('npx', ['tsx', seedPath], {
      env: {
        ...process.env,
        DATABASE_URL: connectionString,
      },
    });
  }

  /**
   * Delete a plugin database
   */
  async deleteDatabase(name: string): Promise<void> {
    if (!this.adminClient) {
      throw new Error('Database manager not connected');
    }

    const dbName = this.sanitizeName(name);

    // Terminate existing connections
    await this.adminClient.query(`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = $1
      AND pid <> pg_backend_pid()
    `, [dbName]);

    // Drop database
    await this.adminClient.query(`DROP DATABASE IF EXISTS ${this.validateIdentifier(dbName)}`);

    // Drop user
    const userName = this.validateIdentifier(`${dbName}_user`);
    await this.adminClient.query(`DROP USER IF EXISTS ${userName}`);
  }

  /**
   * Get database info
   */
  async getDatabaseInfo(name: string): Promise<DatabaseInfo | null> {
    if (!this.adminClient) {
      throw new Error('Database manager not connected');
    }

    const dbName = this.sanitizeName(name);

    const result = await this.adminClient.query(`
      SELECT 
        pg_database.datname as name,
        pg_database_size(pg_database.datname) as size_bytes,
        pg_roles.rolname as owner
      FROM pg_database
      LEFT JOIN pg_roles ON pg_database.datdba = pg_roles.oid
      WHERE pg_database.datname = $1
    `, [dbName]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      name: row.name,
      host: this.adminHost,
      port: this.adminPort,
      user: row.owner,
      exists: true,
      sizeBytes: parseInt(row.size_bytes),
    };
  }

  /**
   * List all plugin databases
   */
  async listPluginDatabases(): Promise<DatabaseInfo[]> {
    if (!this.adminClient) {
      throw new Error('Database manager not connected');
    }

    const result = await this.adminClient.query(`
      SELECT 
        pg_database.datname as name,
        pg_database_size(pg_database.datname) as size_bytes,
        pg_roles.rolname as owner
      FROM pg_database
      LEFT JOIN pg_roles ON pg_database.datdba = pg_roles.oid
      WHERE pg_database.datname LIKE 'naap_plugin_%'
    `);

    return result.rows.map(row => ({
      name: row.name,
      host: this.adminHost,
      port: this.adminPort,
      user: row.owner,
      exists: true,
      sizeBytes: parseInt(row.size_bytes),
    }));
  }

  /**
   * Build connection string for a database
   */
  buildConnectionString(dbName: string, user: string, password: string): string {
    return `postgresql://${user}:${password}@${this.adminHost}:${this.adminPort}/${dbName}`;
  }

  private validateIdentifier(identifier: string): string {
    if (!/^[a-zA-Z0-9_]+$/.test(identifier)) {
      throw new Error(`Invalid SQL identifier: "${identifier}" contains disallowed characters`);
    }
    return identifier;
  }

  private sanitizeName(name: string): string {
    const sanitized = `naap_plugin_${name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()}`;
    return this.validateIdentifier(sanitized);
  }

  private generatePassword(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let password = '';
    for (let i = 0; i < 24; i++) {
      password += chars[crypto.randomInt(chars.length)];
    }
    return password;
  }
}
