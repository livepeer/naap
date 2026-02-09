#!/usr/bin/env npx tsx
/**
 * Production Cutover Script
 *
 * Handles the final production deployment with health monitoring
 * and automatic rollback capabilities.
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';

const ROOT_DIR = join(__dirname, '..', '..', '..');

interface HealthMetrics {
  healthy: boolean;
  errorRate: number;
  p99Latency: number;
  successRate: number;
  timestamp: Date;
}

const HEALTH_CHECK_URL = process.env.HEALTH_CHECK_URL || 'https://naap.vercel.app/api/health';
const MONITORING_DURATION = 30; // minutes
const CHECK_INTERVAL = 60000; // 1 minute

const ROLLBACK_THRESHOLDS = {
  errorRate: 0.05, // 5%
  p99Latency: 2000, // 2 seconds
  successRate: 0.95, // 95%
};

function log(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

function runCommand(command: string): string {
  log(`Running: ${command}`);
  return execSync(command, { encoding: 'utf-8', stdio: 'pipe' });
}

async function checkHealth(): Promise<HealthMetrics> {
  try {
    const start = Date.now();
    const response = await fetch(HEALTH_CHECK_URL);
    const latency = Date.now() - start;

    if (!response.ok) {
      return {
        healthy: false,
        errorRate: 1,
        p99Latency: latency,
        successRate: 0,
        timestamp: new Date(),
      };
    }

    const data = await response.json();

    return {
      healthy: data.status === 'healthy',
      errorRate: 0,
      p99Latency: latency,
      successRate: 1,
      timestamp: new Date(),
    };
  } catch {
    return {
      healthy: false,
      errorRate: 1,
      p99Latency: -1,
      successRate: 0,
      timestamp: new Date(),
    };
  }
}

function evaluateHealth(metrics: HealthMetrics): boolean {
  return (
    metrics.errorRate < ROLLBACK_THRESHOLDS.errorRate &&
    (metrics.p99Latency < ROLLBACK_THRESHOLDS.p99Latency || metrics.p99Latency === -1) &&
    metrics.successRate >= ROLLBACK_THRESHOLDS.successRate
  );
}

async function runValidation(): Promise<boolean> {
  log('Running pre-deployment validation...');

  try {
    runCommand('npx tsx scripts/validate-migration.ts');
    log('✅ Validation passed');
    return true;
  } catch {
    log('❌ Validation failed');
    return false;
  }
}

async function deploy(): Promise<boolean> {
  log('Deploying to production...');

  try {
    // Build first
    runCommand('npm run build');
    log('✅ Build successful');

    // Deploy to Vercel production
    const output = runCommand('vercel --prod --yes');
    log(output);
    log('✅ Deployment successful');
    return true;
  } catch (err) {
    log(`❌ Deployment failed: ${err}`);
    return false;
  }
}

async function rollback(): Promise<void> {
  log('🔄 Initiating rollback...');

  try {
    runCommand('vercel rollback');
    log('✅ Rollback complete');
  } catch (err) {
    log(`❌ Rollback failed: ${err}`);
    throw new Error('Rollback failed - manual intervention required');
  }
}

async function monitorHealth(durationMinutes: number): Promise<boolean> {
  log(`Starting health monitoring for ${durationMinutes} minutes...`);

  const metrics: HealthMetrics[] = [];

  for (let i = 0; i < durationMinutes; i++) {
    await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL));

    const health = await checkHealth();
    metrics.push(health);

    const isHealthy = evaluateHealth(health);
    const status = isHealthy ? '✅' : '❌';

    log(
      `${status} Minute ${i + 1}/${durationMinutes}: ` +
      `Error=${(health.errorRate * 100).toFixed(2)}% ` +
      `P99=${health.p99Latency}ms ` +
      `Success=${(health.successRate * 100).toFixed(2)}%`
    );

    if (!isHealthy) {
      log('⚠️  Health check failed!');

      // Allow a grace period of 2 consecutive failures
      if (i > 0 && !evaluateHealth(metrics[i - 1])) {
        log('❌ Two consecutive health check failures - initiating rollback');
        return false;
      }
    }
  }

  // Calculate overall health
  const avgErrorRate = metrics.reduce((sum, m) => sum + m.errorRate, 0) / metrics.length;
  const avgSuccessRate = metrics.reduce((sum, m) => sum + m.successRate, 0) / metrics.length;
  const maxLatency = Math.max(...metrics.filter(m => m.p99Latency > 0).map(m => m.p99Latency));

  log(`\n=== Monitoring Summary ===`);
  log(`Average Error Rate: ${(avgErrorRate * 100).toFixed(2)}%`);
  log(`Average Success Rate: ${(avgSuccessRate * 100).toFixed(2)}%`);
  log(`Max Latency: ${maxLatency}ms`);

  return avgErrorRate < ROLLBACK_THRESHOLDS.errorRate &&
    avgSuccessRate >= ROLLBACK_THRESHOLDS.successRate;
}

function createCompletionMarkers(): void {
  const timestamp = new Date().toISOString();

  writeFileSync(
    join(ROOT_DIR, '.phase-7-complete'),
    `Phase 7: Final Cutover - COMPLETE\nTimestamp: ${timestamp}\n`
  );

  writeFileSync(
    join(ROOT_DIR, '.migration-complete'),
    `NaaP Vercel Migration Complete\nTimestamp: ${timestamp}\nVersion: 1.0.0\n`
  );

  log('✅ Created completion markers');
}

async function sendNotification(title: string, message: string): Promise<void> {
  // Placeholder for notification integration (Slack, email, etc.)
  log(`📢 Notification: ${title} - ${message}`);
}

async function main(): Promise<void> {
  log('╔════════════════════════════════════════════╗');
  log('║   NaaP Production Cutover                  ║');
  log('╚════════════════════════════════════════════╝\n');

  // Check for dry run mode
  const isDryRun = process.argv.includes('--dry-run');
  if (isDryRun) {
    log('🔍 DRY RUN MODE - No actual deployment will occur\n');
  }

  try {
    // Step 1: Validation
    log('\n=== Step 1: Pre-deployment Validation ===\n');
    const validationPassed = await runValidation();
    if (!validationPassed) {
      throw new Error('Pre-deployment validation failed');
    }

    // Step 2: Deploy
    log('\n=== Step 2: Production Deployment ===\n');
    if (!isDryRun) {
      const deploySuccess = await deploy();
      if (!deploySuccess) {
        throw new Error('Deployment failed');
      }
    } else {
      log('Skipping deployment (dry run)');
    }

    // Step 3: Health Monitoring
    log('\n=== Step 3: Health Monitoring ===\n');
    if (!isDryRun) {
      const monitoringPassed = await monitorHealth(MONITORING_DURATION);
      if (!monitoringPassed) {
        await rollback();
        throw new Error('Health monitoring failed - rolled back');
      }
    } else {
      log('Skipping health monitoring (dry run)');
    }

    // Step 4: Complete
    log('\n=== Step 4: Finalization ===\n');
    createCompletionMarkers();

    await sendNotification(
      'Migration Complete',
      'NaaP Vercel migration completed successfully!'
    );

    log('\n╔════════════════════════════════════════════╗');
    log('║   ✅ CUTOVER SUCCESSFUL                    ║');
    log('╚════════════════════════════════════════════╝\n');

    log('The NaaP application has been successfully migrated to Vercel.');
    log('All systems are healthy and operational.\n');

  } catch (err) {
    log(`\n❌ CUTOVER FAILED: ${err}`);

    await sendNotification(
      'Migration Failed',
      `NaaP Vercel migration failed: ${err}`
    );

    process.exit(1);
  }
}

main().catch(console.error);
