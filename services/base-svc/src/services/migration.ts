/**
 * Plugin Migration Service
 * 
 * Handles database migrations for plugins during version upgrades.
 * Tracks migration status and supports rollback.
 */

import * as crypto from 'crypto';
import type { PrismaClient } from '@naap/database';

export interface MigrationDefinition {
  name: string;
  version: string;
  up: () => Promise<void>;
  down?: () => Promise<void>;
}

export interface MigrationResult {
  success: boolean;
  migrationsRun: string[];
  migrationsSkipped: string[];
  error?: string;
}

export function createMigrationService(prisma: PrismaClient) {
  /**
   * Generate checksum for migration content
   */
  function generateChecksum(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Get applied migrations for a plugin
   */
  async function getAppliedMigrations(pluginName: string): Promise<string[]> {
    const migrations = await prisma.pluginMigration.findMany({
      where: {
        pluginName,
        status: 'completed',
      },
      select: { migrationName: true },
      orderBy: { appliedAt: 'asc' },
    });
    
    return migrations.map(m => m.migrationName);
  }

  /**
   * Run a single migration
   */
  async function runMigration(
    pluginName: string,
    migration: MigrationDefinition
  ): Promise<{ success: boolean; error?: string }> {
    const checksum = generateChecksum(migration.up.toString());
    
    // Check if already applied
    const existing = await prisma.pluginMigration.findUnique({
      where: { pluginName_migrationName: { pluginName, migrationName: migration.name } },
    });
    
    if (existing?.status === 'completed') {
      return { success: true }; // Already applied
    }
    
    // Create or update migration record
    await prisma.pluginMigration.upsert({
      where: { pluginName_migrationName: { pluginName, migrationName: migration.name } },
      create: {
        pluginName,
        version: migration.version,
        migrationName: migration.name,
        status: 'running',
        appliedAt: new Date(),
        checksum,
      },
      update: {
        status: 'running',
        appliedAt: new Date(),
        error: null,
      },
    });
    
    try {
      // Run the migration
      await migration.up();
      
      // Mark as completed
      await prisma.pluginMigration.update({
        where: { pluginName_migrationName: { pluginName, migrationName: migration.name } },
        data: {
          status: 'completed',
          completedAt: new Date(),
        },
      });
      
      console.log(`Migration "${migration.name}" completed for plugin "${pluginName}"`);
      return { success: true };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Mark as failed
      await prisma.pluginMigration.update({
        where: { pluginName_migrationName: { pluginName, migrationName: migration.name } },
        data: {
          status: 'failed',
          error: errorMessage,
        },
      });
      
      console.error(`Migration "${migration.name}" failed for plugin "${pluginName}":`, error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Rollback a migration
   */
  async function rollbackMigration(
    pluginName: string,
    migration: MigrationDefinition
  ): Promise<{ success: boolean; error?: string }> {
    if (!migration.down) {
      return { success: false, error: 'Migration does not support rollback' };
    }
    
    const existing = await prisma.pluginMigration.findUnique({
      where: { pluginName_migrationName: { pluginName, migrationName: migration.name } },
    });
    
    if (!existing || existing.status !== 'completed') {
      return { success: false, error: 'Migration not applied' };
    }
    
    try {
      // Run rollback
      await migration.down();
      
      // Mark as rolled back
      await prisma.pluginMigration.update({
        where: { pluginName_migrationName: { pluginName, migrationName: migration.name } },
        data: {
          status: 'rolled_back',
          completedAt: new Date(),
        },
      });
      
      console.log(`Migration "${migration.name}" rolled back for plugin "${pluginName}"`);
      return { success: true };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      console.error(`Rollback of "${migration.name}" failed for plugin "${pluginName}":`, error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Run pending migrations for a plugin
   */
  async function runPendingMigrations(
    pluginName: string,
    migrations: MigrationDefinition[]
  ): Promise<MigrationResult> {
    const applied = await getAppliedMigrations(pluginName);
    const appliedSet = new Set(applied);
    
    const migrationsRun: string[] = [];
    const migrationsSkipped: string[] = [];
    
    // Sort migrations by version
    const sorted = [...migrations].sort((a, b) => a.version.localeCompare(b.version));
    
    for (const migration of sorted) {
      if (appliedSet.has(migration.name)) {
        migrationsSkipped.push(migration.name);
        continue;
      }
      
      const result = await runMigration(pluginName, migration);
      
      if (!result.success) {
        return {
          success: false,
          migrationsRun,
          migrationsSkipped,
          error: `Migration "${migration.name}" failed: ${result.error}`,
        };
      }
      
      migrationsRun.push(migration.name);
    }
    
    return {
      success: true,
      migrationsRun,
      migrationsSkipped,
    };
  }

  /**
   * Get migration status for a plugin
   */
  async function getMigrationStatus(pluginName: string) {
    const migrations = await prisma.pluginMigration.findMany({
      where: { pluginName },
      orderBy: { createdAt: 'asc' },
    });
    
    return {
      total: migrations.length,
      completed: migrations.filter(m => m.status === 'completed').length,
      pending: migrations.filter(m => m.status === 'pending').length,
      failed: migrations.filter(m => m.status === 'failed').length,
      migrations: migrations.map(m => ({
        name: m.migrationName,
        version: m.version,
        status: m.status,
        appliedAt: m.appliedAt,
        completedAt: m.completedAt,
        error: m.error,
      })),
    };
  }

  return {
    getAppliedMigrations,
    runMigration,
    rollbackMigration,
    runPendingMigrations,
    getMigrationStatus,
  };
}
