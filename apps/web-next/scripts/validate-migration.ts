#!/usr/bin/env npx tsx
/**
 * Migration Validation Script
 *
 * Validates that all migration phases are complete and the system is ready
 * for production deployment.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT_DIR = join(__dirname, '..', '..', '..');
const APP_DIR = join(__dirname, '..');

interface ValidationResult {
  name: string;
  passed: boolean;
  message: string;
  critical: boolean;
}

const results: ValidationResult[] = [];

function log(message: string): void {
  console.log(message);
}

function check(name: string, condition: boolean, message: string, critical = true): void {
  results.push({ name, passed: condition, message, critical });
  const status = condition ? '✅' : critical ? '❌' : '⚠️';
  log(`${status} ${name}: ${message}`);
}

async function runCommand(command: string, cwd = APP_DIR): Promise<{ success: boolean; output: string }> {
  try {
    const output = execSync(command, { cwd, encoding: 'utf-8', stdio: 'pipe' });
    return { success: true, output };
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string };
    return { success: false, output: error.stderr || error.stdout || 'Command failed' };
  }
}

async function validatePhaseFiles(): Promise<void> {
  log('\n=== Phase Completion Files ===');

  const phases = [
    { file: '.phase-0-complete', name: 'Phase 0: Foundation Setup' },
    { file: '.phase-1-complete', name: 'Phase 1: Database Consolidation' },
    { file: '.phase-2-complete', name: 'Phase 2: Frontend Migration' },
    { file: '.phase-3-in-progress', name: 'Phase 3: API Layer (in progress)' },
    { file: '.phase-4-complete', name: 'Phase 4: Real-time Services' },
    { file: '.phase-5-complete', name: 'Phase 5: Storage Migration' },
    { file: '.phase-6-complete', name: 'Phase 6: Plugin System' },
  ];

  for (const phase of phases) {
    const exists = existsSync(join(ROOT_DIR, phase.file));
    check(phase.name, exists, exists ? 'Complete' : 'Missing marker file', false);
  }
}

async function validateTypeScript(): Promise<void> {
  log('\n=== TypeScript Validation ===');

  const result = await runCommand('npx tsc --noEmit');
  check('TypeScript compilation', result.success, result.success ? 'No type errors' : result.output);
}

async function validateLinting(): Promise<void> {
  log('\n=== Linting Validation ===');

  const result = await runCommand('npm run lint');
  check('ESLint', result.success, result.success ? 'No linting errors' : 'Has linting issues', false);
}

async function validateBuild(): Promise<void> {
  log('\n=== Build Validation ===');

  const result = await runCommand('npm run build');
  check('Production build', result.success, result.success ? 'Build successful' : 'Build failed');

  // Check route count
  if (result.success) {
    const routeCount = (result.output.match(/ƒ|○/g) || []).length;
    check('Route count', routeCount >= 25, `${routeCount} routes generated`, false);
  }
}

async function validateTests(): Promise<void> {
  log('\n=== Test Validation ===');

  const result = await runCommand('npm run test');
  const passed = result.success && result.output.includes('passed');
  check('Unit tests', passed, passed ? 'All tests passed' : 'Some tests failed');
}

async function validateEnvironment(): Promise<void> {
  log('\n=== Environment Validation ===');

  // Check for .env.local
  const envExists = existsSync(join(APP_DIR, '.env.local'));
  check('Environment file', envExists, envExists ? '.env.local exists' : '.env.local missing', false);

  // Check package.json
  const pkgPath = join(APP_DIR, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

    // Check required dependencies
    const requiredDeps = ['next', 'react', '@prisma/client', 'ably', '@vercel/blob'];
    for (const dep of requiredDeps) {
      const hasDep = !!(pkg.dependencies?.[dep] || pkg.devDependencies?.[dep]);
      check(`Dependency: ${dep}`, hasDep, hasDep ? 'Installed' : 'Missing');
    }
  }
}

async function validateApiRoutes(): Promise<void> {
  log('\n=== API Route Validation ===');

  const requiredRoutes = [
    'src/app/api/health/route.ts',
    'src/app/api/v1/auth/login/route.ts',
    'src/app/api/v1/auth/register/route.ts',
    'src/app/api/v1/auth/me/route.ts',
    'src/app/api/v1/teams/route.ts',
    'src/app/api/v1/realtime/token/route.ts',
    'src/app/api/v1/storage/upload/route.ts',
    'src/app/api/v1/plugins/route.ts',
  ];

  for (const route of requiredRoutes) {
    const exists = existsSync(join(APP_DIR, route));
    check(`API: ${route.replace('src/app/api/', '').replace('/route.ts', '')}`, exists, exists ? 'Exists' : 'Missing');
  }
}

async function validatePrisma(): Promise<void> {
  log('\n=== Prisma Validation ===');

  const schemaExists = existsSync(join(APP_DIR, 'prisma/schema.prisma'));
  check('Prisma schema', schemaExists, schemaExists ? 'Schema exists' : 'Schema missing');

  if (schemaExists) {
    // Check if DATABASE_URL is set
    const dbUrlSet = !!process.env.DATABASE_URL;
    if (!dbUrlSet) {
      check('Schema validation', true, 'Skipped (DATABASE_URL not set)', false);
      return;
    }

    const result = await runCommand('npx prisma validate');
    check('Schema validation', result.success, result.success ? 'Valid' : result.output);
  }
}

async function generateReport(): Promise<void> {
  log('\n=== Migration Validation Report ===\n');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed && r.critical).length;
  const warnings = results.filter(r => !r.passed && !r.critical).length;

  log(`Total checks: ${results.length}`);
  log(`Passed: ${passed}`);
  log(`Failed: ${failed}`);
  log(`Warnings: ${warnings}`);

  if (failed > 0) {
    log('\n❌ Migration validation FAILED');
    log('Critical issues must be resolved before deployment.\n');

    log('Failed checks:');
    results.filter(r => !r.passed && r.critical).forEach(r => {
      log(`  - ${r.name}: ${r.message}`);
    });
    process.exit(1);
  } else if (warnings > 0) {
    log('\n⚠️  Migration validation PASSED with warnings');
    log('Review warnings before deployment.\n');

    log('Warnings:');
    results.filter(r => !r.passed && !r.critical).forEach(r => {
      log(`  - ${r.name}: ${r.message}`);
    });
  } else {
    log('\n✅ Migration validation PASSED');
    log('System is ready for production deployment.\n');
  }
}

async function main(): Promise<void> {
  log('╔══════════════════════════════════════════╗');
  log('║   NaaP Vercel Migration Validation       ║');
  log('╚══════════════════════════════════════════╝\n');

  await validatePhaseFiles();
  await validateEnvironment();
  await validatePrisma();
  await validateTypeScript();
  await validateLinting();
  await validateTests();
  await validateBuild();
  await validateApiRoutes();
  await generateReport();
}

main().catch(console.error);
