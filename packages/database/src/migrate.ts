/**
 * Migration runner for Prisma migrations
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import type { MigrationOptions, SeedOptions } from './types';

/**
 * Runs Prisma migrations for a service
 */
export function runMigrations(options: MigrationOptions = {}): void {
  const { service, createOnly = false, reset = false } = options;

  if (service) {
    runServiceMigrations(service, createOnly, reset);
  } else {
    // Run migrations for all services
    const services = findServicesWithPrisma();
    services.forEach((svc) => runServiceMigrations(svc, createOnly, reset));
  }
}

function runServiceMigrations(
  service: string,
  createOnly: boolean,
  reset: boolean
): void {
  const servicePath = getServicePath(service);
  const schemaPath = join(servicePath, 'prisma', 'schema.prisma');

  if (!existsSync(schemaPath)) {
    console.warn(`⚠️  No Prisma schema found for ${service}, skipping...`);
    return;
  }

  console.log(`🔄 Running migrations for ${service}...`);

  try {
    if (reset) {
      execSync('npx prisma migrate reset --force', {
        cwd: servicePath,
        stdio: 'inherit',
        env: { ...process.env },
      });
    } else if (createOnly) {
      execSync('npx prisma migrate dev --create-only', {
        cwd: servicePath,
        stdio: 'inherit',
        env: { ...process.env },
      });
    } else {
      execSync('npx prisma migrate deploy', {
        cwd: servicePath,
        stdio: 'inherit',
        env: { ...process.env },
      });
    }
    console.log(`✅ Migrations completed for ${service}`);
  } catch (error) {
    console.error(`❌ Migration failed for ${service}:`, error);
    throw error;
  }
}

/**
 * Runs seed script for a service
 */
export function runSeed(options: SeedOptions = {}): void {
  const { service, reset = false } = options;

  if (service) {
    runServiceSeed(service, reset);
  } else {
    // Run seeds for all services
    const services = findServicesWithPrisma();
    services.forEach((svc) => runServiceSeed(svc, reset));
  }
}

function runServiceSeed(service: string, reset: boolean): void {
  const servicePath = getServicePath(service);
  const seedPath = join(servicePath, 'prisma', 'seed.ts');

  if (!existsSync(seedPath)) {
    console.warn(`⚠️  No seed script found for ${service}, skipping...`);
    return;
  }

  console.log(`🌱 Seeding database for ${service}...`);

  try {
    if (reset) {
      execSync('npx prisma migrate reset --force', {
        cwd: servicePath,
        stdio: 'inherit',
        env: { ...process.env },
      });
    } else {
      execSync('npx tsx prisma/seed.ts', {
        cwd: servicePath,
        stdio: 'inherit',
        env: { ...process.env },
      });
    }
    console.log(`✅ Seeding completed for ${service}`);
  } catch (error) {
    console.error(`❌ Seeding failed for ${service}:`, error);
    throw error;
  }
}

/**
 * Validates migration state for a service
 */
export function validateMigrations(service: string): boolean {
  const servicePath = getServicePath(service);
  const schemaPath = join(servicePath, 'prisma', 'schema.prisma');

  if (!existsSync(schemaPath)) {
    console.warn(`⚠️  No Prisma schema found for ${service}`);
    return false;
  }

  try {
    execSync('npx prisma migrate status', {
      cwd: servicePath,
      stdio: 'pipe',
      env: { ...process.env },
    });
    return true;
  } catch (error) {
    console.error(`❌ Migration validation failed for ${service}`);
    return false;
  }
}

function getServicePath(service: string): string {
  // Handle base-svc
  if (service === 'base-svc' || service === 'base') {
    return join(process.cwd(), 'services', 'base-svc');
  }

  // Handle workflow services
  const workflowName = service.replace('-svc', '');
  return join(process.cwd(), 'services', 'workflows', `${workflowName}-svc`);
}

function findServicesWithPrisma(): string[] {
  const services: string[] = [];
  const { readdirSync, existsSync } = require('fs');
  const { join } = require('path');

  // Check base-svc
  const baseSvcPath = join(process.cwd(), 'services', 'base-svc');
  if (existsSync(join(baseSvcPath, 'prisma', 'schema.prisma'))) {
    services.push('base-svc');
  }

  // Check workflow services
  const workflowsPath = join(process.cwd(), 'services', 'workflows');
  if (existsSync(workflowsPath)) {
    const workflowDirs = readdirSync(workflowsPath, { withFileTypes: true })
      .filter((dirent: any) => dirent.isDirectory())
      .map((dirent: any) => dirent.name);

    workflowDirs.forEach((dir: string) => {
      const schemaPath = join(workflowsPath, dir, 'prisma', 'schema.prisma');
      if (existsSync(schemaPath)) {
        services.push(dir);
      }
    });
  }

  return services;
}
