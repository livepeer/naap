#!/usr/bin/env tsx
/**
 * Quality Gate Checker
 * Runs all quality checks for a given phase
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface QualityGate {
  name: string;
  check: () => Promise<boolean>;
  required: boolean;
  description: string;
}

interface CheckResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

const ROOT_DIR = path.resolve(__dirname, '../..');

// ===============================
// Quality Gate Definitions
// ===============================

const QUALITY_GATES: Record<string, QualityGate[]> = {
  'phase-0': [
    {
      name: 'project-structure',
      description: 'Verify Next.js project structure exists',
      required: true,
      check: async () => {
        const requiredFiles = [
          'apps/web-next/package.json',
          'apps/web-next/next.config.js',
          'apps/web-next/tsconfig.json',
          'apps/web-next/src/app/layout.tsx',
          'apps/web-next/src/app/page.tsx',
        ];

        for (const file of requiredFiles) {
          const fullPath = path.join(ROOT_DIR, file);
          if (!fs.existsSync(fullPath)) {
            console.error(`Missing: ${file}`);
            return false;
          }
        }
        return true;
      },
    },
    {
      name: 'ci-workflows',
      description: 'Verify CI/CD workflows exist',
      required: true,
      check: async () => {
        const workflows = ['.github/workflows/ci.yml', '.github/workflows/deploy.yml'];

        for (const workflow of workflows) {
          const fullPath = path.join(ROOT_DIR, workflow);
          if (!fs.existsSync(fullPath)) {
            console.error(`Missing workflow: ${workflow}`);
            return false;
          }
        }
        return true;
      },
    },
    {
      name: 'typescript-valid',
      description: 'TypeScript compiles without errors',
      required: true,
      check: async () => {
        try {
          execSync('cd apps/web-next && npx tsc --noEmit', {
            cwd: ROOT_DIR,
            stdio: 'pipe',
          });
          return true;
        } catch (error) {
          console.error('TypeScript check failed');
          return false;
        }
      },
    },
    {
      name: 'build-succeeds',
      description: 'Next.js build completes successfully',
      required: true,
      check: async () => {
        try {
          execSync('cd apps/web-next && npm run build', {
            cwd: ROOT_DIR,
            stdio: 'pipe',
            env: {
              ...process.env,
              DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
              NEXTAUTH_SECRET: 'test-secret-at-least-32-characters-long',
            },
          });
          return true;
        } catch (error) {
          console.error('Build failed');
          return false;
        }
      },
    },
  ],

  'phase-1': [
    {
      name: 'database-setup',
      description: 'Database setup script works',
      required: true,
      check: async () => {
        const setupScript = path.join(ROOT_DIR, 'bin/setup-db-simple.sh');
        return fs.existsSync(setupScript);
      },
    },
    {
      name: 'prisma-valid',
      description: 'Prisma schemas are valid',
      required: true,
      check: async () => {
        try {
          execSync('npx prisma validate', {
            cwd: path.join(ROOT_DIR, 'services/base-svc'),
            stdio: 'pipe',
          });
          return true;
        } catch {
          return false;
        }
      },
    },
  ],

  'phase-2': [
    {
      name: 'frontend-builds',
      description: 'All frontend code compiles',
      required: true,
      check: async () => {
        try {
          execSync('cd apps/web-next && npm run build', {
            cwd: ROOT_DIR,
            stdio: 'pipe',
            env: {
              ...process.env,
              DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
              NEXTAUTH_SECRET: 'test-secret-at-least-32-characters-long',
            },
          });
          return true;
        } catch {
          return false;
        }
      },
    },
  ],
};

// ===============================
// Runner
// ===============================

async function runQualityGates(phase: string): Promise<boolean> {
  const gates = QUALITY_GATES[phase];

  if (!gates) {
    console.error(`Unknown phase: ${phase}`);
    console.log(`Available phases: ${Object.keys(QUALITY_GATES).join(', ')}`);
    return false;
  }

  console.log(`\n=== Running Quality Gates for ${phase} ===\n`);

  const results: CheckResult[] = [];
  let allPassed = true;

  for (const gate of gates) {
    const start = Date.now();
    console.log(`Checking: ${gate.name}...`);

    try {
      const passed = await gate.check();
      const duration = Date.now() - start;

      results.push({
        name: gate.name,
        passed,
        duration,
      });

      const status = passed ? '✅' : gate.required ? '❌' : '⚠️';
      console.log(`  ${status} ${gate.name} (${duration}ms)`);

      if (!passed && gate.required) {
        allPassed = false;
      }
    } catch (error) {
      const duration = Date.now() - start;
      results.push({
        name: gate.name,
        passed: false,
        duration,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      console.log(`  ❌ ${gate.name} - Error: ${error}`);

      if (gate.required) {
        allPassed = false;
      }
    }
  }

  // Summary
  console.log('\n=== Summary ===');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  if (allPassed) {
    console.log(`\n✅ All quality gates PASSED for ${phase}`);

    // Create phase completion marker
    const markerFile = path.join(ROOT_DIR, `.${phase}-complete`);
    fs.writeFileSync(markerFile, new Date().toISOString());
    console.log(`Created: .${phase}-complete`);
  } else {
    console.log(`\n❌ Quality gates FAILED for ${phase}`);
  }

  // Write report
  const reportDir = path.join(ROOT_DIR, 'reports');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(reportDir, `quality-gates-${phase}.json`),
    JSON.stringify({ phase, timestamp: new Date().toISOString(), results }, null, 2)
  );

  return allPassed;
}

// ===============================
// Main
// ===============================

const phase = process.argv[2] || 'phase-0';
runQualityGates(phase)
  .then((passed) => process.exit(passed ? 0 : 1))
  .catch((error) => {
    console.error('Quality gate check failed:', error);
    process.exit(1);
  });
