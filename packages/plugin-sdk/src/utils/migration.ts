/**
 * Plugin Migration Utilities
 * 
 * Provides utilities for defining and managing plugin data migrations.
 * Use these to ensure smooth upgrades between plugin versions.
 */

export interface MigrationDefinition {
  /** Unique name for this migration */
  name: string;
  /** Version this migration is associated with */
  version: string;
  /** Function to apply the migration */
  up: () => Promise<void>;
  /** Optional function to rollback the migration */
  down?: () => Promise<void>;
  /** Optional description */
  description?: string;
}

/**
 * Registry of migrations for a plugin
 */
export class MigrationRegistry {
  private migrations: MigrationDefinition[] = [];
  private readonly _pluginName: string;

  constructor(pluginName: string) {
    this._pluginName = pluginName;
  }

  /**
   * Get the plugin name this registry is for
   */
  getPluginName(): string {
    return this._pluginName;
  }

  /**
   * Register a migration
   */
  register(migration: MigrationDefinition): this {
    // Validate migration name format
    if (!/^[a-z0-9_-]+$/i.test(migration.name)) {
      throw new Error(
        `Invalid migration name "${migration.name}". Use alphanumeric, underscore, or hyphen.`
      );
    }

    // Check for duplicates
    if (this.migrations.some(m => m.name === migration.name)) {
      throw new Error(`Migration "${migration.name}" already registered`);
    }

    this.migrations.push(migration);
    return this;
  }

  /**
   * Get all registered migrations
   */
  getMigrations(): MigrationDefinition[] {
    return [...this.migrations];
  }

  /**
   * Get migrations sorted by version
   */
  getSortedMigrations(): MigrationDefinition[] {
    return [...this.migrations].sort((a, b) => a.version.localeCompare(b.version));
  }

  /**
   * Get migrations for a specific version
   */
  getMigrationsForVersion(version: string): MigrationDefinition[] {
    return this.migrations.filter(m => m.version === version);
  }

  /**
   * Get migrations between two versions (exclusive of from, inclusive of to)
   */
  getMigrationsBetween(fromVersion: string, toVersion: string): MigrationDefinition[] {
    return this.getSortedMigrations().filter(m => 
      m.version.localeCompare(fromVersion) > 0 && 
      m.version.localeCompare(toVersion) <= 0
    );
  }

  /**
   * Create a migration builder for fluent API
   */
  static create(pluginName: string): MigrationRegistry {
    return new MigrationRegistry(pluginName);
  }
}

/**
 * Helper to create a timestamped migration name
 */
export function createMigrationName(description: string): string {
  const timestamp = new Date().toISOString().replace(/[:.T-]/g, '').slice(0, 14);
  const slug = description.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 50);
  return `${timestamp}_${slug}`;
}

/**
 * Run pending migrations via API
 * Call this from your plugin's initialization code
 */
export async function runPluginMigrations(
  pluginName: string,
  migrations: MigrationDefinition[],
  apiBaseUrl: string = ''
): Promise<{ success: boolean; migrationsRun: string[]; error?: string }> {
  const url = `${apiBaseUrl}/api/v1/plugins/${pluginName}/migrate`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        migrations: migrations.map(m => ({
          name: m.name,
          version: m.version,
          description: m.description,
        })),
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, migrationsRun: [], error: error.message };
    }

    const result = await response.json();
    return {
      success: result.success,
      migrationsRun: result.migrationsRun || [],
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      migrationsRun: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get migration status via API
 */
export async function getPluginMigrationStatus(
  pluginName: string,
  apiBaseUrl: string = ''
): Promise<{
  total: number;
  completed: number;
  pending: number;
  failed: number;
  migrations: Array<{
    name: string;
    version: string;
    status: string;
    appliedAt?: string;
    error?: string;
  }>;
} | null> {
  const url = `${apiBaseUrl}/api/v1/plugins/${pluginName}/migrations`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

// Example usage:
// 
// const migrations = MigrationRegistry.create('my-plugin')
//   .register({
//     name: '001_add_user_preferences',
//     version: '1.0.0',
//     up: async () => {
//       // Migration logic
//     },
//     down: async () => {
//       // Rollback logic
//     },
//   })
//   .register({
//     name: '002_add_notifications_table',
//     version: '1.1.0',
//     up: async () => {
//       // Migration logic
//     },
//   });
//
// await runPluginMigrations('my-plugin', migrations.getMigrations());
