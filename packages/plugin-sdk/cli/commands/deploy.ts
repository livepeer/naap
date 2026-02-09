/**
 * deploy command
 * Deploy plugin to production with various strategies
 *
 * Supports:
 * - Immediate deployment (full traffic switch)
 * - Blue-green deployment (zero-downtime switch)
 * - Canary deployment (gradual traffic shift)
 * - Automatic rollback on failure
 *
 * @example
 * # Deploy with default blue-green strategy
 * naap-plugin deploy
 *
 * # Deploy with canary strategy
 * naap-plugin deploy --strategy canary --canary-percent 5 --canary-increment 25
 *
 * # Dry run to see what would happen
 * naap-plugin deploy --dry-run
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora, { Ora } from 'ora';
import path from 'path';
import fs from 'fs-extra';
import type { PluginManifest } from '../../src/types/manifest.js';

const DEFAULT_REGISTRY = process.env.NAAP_REGISTRY_URL || 'https://plugins.naap.io';

type DeploymentStrategy = 'immediate' | 'blue-green' | 'canary';

interface DeployOptions {
  registry: string;
  strategy: DeploymentStrategy;
  canaryPercent: string;
  canaryIncrement: string;
  canaryInterval: string;
  autoRollback: boolean;
  skipHealthCheck: boolean;
  dryRun: boolean;
  watch: boolean;
  timeout: string;
}

interface DeploymentEvent {
  type: string;
  status: string;
  slot?: string;
  version?: string;
  trafficPercent?: number;
  error?: string;
  timestamp: string;
}

/**
 * Create a progress bar string
 */
function createProgressBar(percent: number, width: number = 20): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return bar;
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Get authentication token
 */
async function getAuthToken(cwd: string): Promise<string | undefined> {
  // Check environment first (CI/CD)
  let token = process.env.NAAP_REGISTRY_TOKEN;

  // Then check local credentials
  if (!token) {
    const credentialsPath = path.join(cwd, '.naap', 'credentials.json');
    if (await fs.pathExists(credentialsPath)) {
      const credentials = await fs.readJson(credentialsPath);
      token = credentials.token;
    }
  }

  return token;
}

/**
 * Start deployment via registry API
 */
async function startDeployment(
  registry: string,
  token: string,
  manifest: PluginManifest,
  options: DeployOptions
): Promise<{ deploymentId: string; streamUrl: string }> {
  const response = await fetch(`${registry}/api/v1/plugins/${manifest.name}/deploy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      version: manifest.version,
      strategy: {
        type: options.strategy,
        canary: options.strategy === 'canary' ? {
          initialPercent: parseInt(options.canaryPercent),
          incrementPercent: parseInt(options.canaryIncrement),
          intervalSeconds: parseInt(options.canaryInterval) * 60,
          successThreshold: 0.95,
        } : undefined,
        healthCheck: options.skipHealthCheck ? undefined : {
          endpoint: '/healthz',
          intervalSeconds: 10,
          timeoutSeconds: 5,
          unhealthyThreshold: 3,
        },
        rollback: {
          onErrorRate: 0.05,
          onLatencyP99: 5000,
          onHealthCheckFail: options.autoRollback,
        },
      },
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `Deployment failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Stream deployment events
 */
async function* streamDeploymentEvents(
  streamUrl: string,
  token: string,
  timeoutMs: number
): AsyncGenerator<DeploymentEvent> {
  const startTime = Date.now();
  let lastEventId = '';

  while (Date.now() - startTime < timeoutMs) {
    try {
      const url = new URL(streamUrl);
      if (lastEventId) {
        url.searchParams.set('after', lastEventId);
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Stream error: ${response.status}`);
      }

      const events: DeploymentEvent[] = await response.json();

      for (const event of events) {
        yield event;
        lastEventId = event.timestamp;

        // Check for terminal states
        if (event.type === 'deploy_complete' || event.type === 'rollback') {
          return;
        }
      }

      // Poll interval
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      // Connection error, retry after delay
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  throw new Error('Deployment timed out');
}

/**
 * Display deployment event
 */
function displayEvent(event: DeploymentEvent, spinner: Ora): void {
  switch (event.type) {
    case 'deploy_start':
      spinner.text = `Deploying to ${event.slot} slot...`;
      break;

    case 'health_check':
      if (event.status === 'success') {
        spinner.text = chalk.green('✓') + ' Health check passed';
      } else {
        spinner.text = chalk.yellow('⚠') + ' Health check: ' + (event.error || 'checking...');
      }
      break;

    case 'traffic_shift':
      const bar = createProgressBar(event.trafficPercent || 0);
      spinner.text = `Traffic: ${chalk.cyan(bar)} ${event.trafficPercent}%`;
      break;

    case 'deploy_complete':
      spinner.succeed(chalk.green.bold('Deployment complete!'));
      console.log(chalk.gray(`  Version: ${event.version}`));
      console.log(chalk.gray(`  Slot: ${event.slot}`));
      break;

    case 'rollback':
      spinner.fail(chalk.red('Deployment failed, rolled back'));
      if (event.error) {
        console.log(chalk.red(`  Error: ${event.error}`));
      }
      console.log(chalk.gray(`  Rolled back to: ${event.version}`));
      break;

    case 'failure':
      spinner.fail(chalk.red('Deployment failed'));
      if (event.error) {
        console.log(chalk.red(`  Error: ${event.error}`));
      }
      break;

    default:
      spinner.text = event.type;
  }
}

export const deployCommand = new Command('deploy')
  .description('Deploy plugin to production')
  .option('-r, --registry <url>', 'Registry URL', DEFAULT_REGISTRY)
  .option(
    '-s, --strategy <strategy>',
    'Deployment strategy (immediate, blue-green, canary)',
    'blue-green'
  )
  .option(
    '--canary-percent <percent>',
    'Initial canary traffic percentage',
    '5'
  )
  .option(
    '--canary-increment <percent>',
    'Canary traffic increment percentage',
    '25'
  )
  .option(
    '--canary-interval <minutes>',
    'Canary interval between increments in minutes',
    '5'
  )
  .option(
    '--auto-rollback',
    'Enable automatic rollback on failure',
    true
  )
  .option(
    '--no-auto-rollback',
    'Disable automatic rollback'
  )
  .option(
    '--skip-health-check',
    'Skip health checks (not recommended)'
  )
  .option(
    '--dry-run',
    'Show what would be deployed without actually deploying'
  )
  .option(
    '-w, --watch',
    'Watch deployment progress in real-time',
    true
  )
  .option(
    '--timeout <minutes>',
    'Deployment timeout in minutes',
    '30'
  )
  .action(async (options: DeployOptions) => {
    const cwd = process.cwd();
    const manifestPath = path.join(cwd, 'plugin.json');

    // Load manifest
    if (!await fs.pathExists(manifestPath)) {
      console.error(chalk.red('Error: plugin.json not found'));
      console.log(chalk.gray('Run this command from a plugin directory'));
      process.exit(1);
    }

    const manifest: PluginManifest = await fs.readJson(manifestPath);

    // Display header
    console.log(chalk.bold.blue(`\n🚀 Deploying ${manifest.displayName} v${manifest.version}\n`));

    // Show strategy info
    console.log(chalk.gray('Strategy:'), chalk.cyan(options.strategy));
    if (options.strategy === 'canary') {
      console.log(chalk.gray('  Initial:'), `${options.canaryPercent}%`);
      console.log(chalk.gray('  Increment:'), `${options.canaryIncrement}%`);
      console.log(chalk.gray('  Interval:'), `${options.canaryInterval} min`);
    }
    console.log(chalk.gray('Auto-rollback:'), options.autoRollback ? 'enabled' : 'disabled');
    console.log('');

    // Dry run mode
    if (options.dryRun) {
      console.log(chalk.yellow('DRY RUN - No changes will be made\n'));
      console.log(chalk.cyan('Would deploy:'));
      console.log(chalk.gray(`  Plugin: ${manifest.name}`));
      console.log(chalk.gray(`  Version: ${manifest.version}`));
      console.log(chalk.gray(`  Strategy: ${options.strategy}`));
      console.log(chalk.gray(`  Registry: ${options.registry}`));

      if (manifest.frontend) {
        console.log(chalk.gray(`  Frontend: ${manifest.frontend.entry || 'default entry'}`));
      }
      if (manifest.backend) {
        console.log(chalk.gray(`  Backend: port ${manifest.backend.port || 'auto'}`));
      }

      console.log(chalk.green('\n✓ Dry run complete\n'));
      return;
    }

    // Get auth token
    const token = await getAuthToken(cwd);
    if (!token) {
      console.error(chalk.red('Error: Not authenticated'));
      console.log(chalk.yellow('Run: naap-plugin login'));
      console.log(chalk.gray('Or set NAAP_REGISTRY_TOKEN environment variable'));
      process.exit(1);
    }

    const spinner = ora('Starting deployment...').start();
    const startTime = Date.now();

    try {
      // Start deployment
      const { deploymentId, streamUrl } = await startDeployment(
        options.registry,
        token,
        manifest,
        options
      );

      spinner.text = `Deployment started (ID: ${deploymentId.substring(0, 8)})`;

      // Stream deployment events
      const timeoutMs = parseInt(options.timeout) * 60 * 1000;

      for await (const event of streamDeploymentEvents(streamUrl, token, timeoutMs)) {
        displayEvent(event, spinner);

        if (event.type === 'deploy_complete') {
          const duration = Date.now() - startTime;
          console.log(chalk.gray(`  Duration: ${formatDuration(duration)}`));
          console.log(chalk.green('\n✓ Plugin deployed successfully!\n'));
          return;
        }

        if (event.type === 'rollback' || event.type === 'failure') {
          process.exit(1);
        }
      }

    } catch (error) {
      spinner.fail('Deployment failed');

      if (error instanceof Error) {
        console.error(chalk.red(`\nError: ${error.message}`));

        if (error.message.includes('not found')) {
          console.log(chalk.yellow('\nTip: Make sure the plugin is published first'));
          console.log(chalk.gray('Run: naap-plugin publish'));
        }

        if (error.message.includes('unauthorized') || error.message.includes('401')) {
          console.log(chalk.yellow('\nTip: Your session may have expired'));
          console.log(chalk.gray('Run: naap-plugin login'));
        }
      }

      process.exit(1);
    }
  });
