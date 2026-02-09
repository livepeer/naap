/**
 * status command
 * Show plugin deployment status
 *
 * Displays current deployment state, health status, metrics,
 * and slot information for a plugin.
 *
 * @example
 * # Show current status
 * naap-plugin status
 *
 * # Watch status in real-time
 * naap-plugin status --watch
 *
 * # Output as JSON
 * naap-plugin status --json
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs-extra';
import type { PluginManifest } from '../../src/types/manifest.js';

const DEFAULT_REGISTRY = process.env.NAAP_REGISTRY_URL || 'https://plugins.naap.io';

interface StatusOptions {
  registry: string;
  watch: boolean;
  json: boolean;
  interval: string;
}

interface SlotInfo {
  slot: string;
  version: string;
  status: string;
  trafficPercent: number;
  healthStatus: string | null;
  frontendUrl: string | null;
  backendUrl: string | null;
  deployedAt: string | null;
}

interface MetricsInfo {
  requestCount: number;
  errorCount: number;
  errorRate: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  activeUsers: number;
}

interface AlertInfo {
  name: string;
  severity: string;
  message: string;
  triggeredAt: string;
}

interface DeploymentStatus {
  deploymentId: string;
  pluginName: string;
  displayName: string;
  activeSlot: string | null;
  activeVersion: string | null;
  healthStatus: string;
  deployedAt: string | null;
  slots: SlotInfo[];
  metrics: MetricsInfo;
  activeAlerts: AlertInfo[];
  isDeploying: boolean;
}

/**
 * Get authentication token
 */
async function getAuthToken(cwd: string): Promise<string | undefined> {
  let token = process.env.NAAP_REGISTRY_TOKEN;

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
 * Fetch deployment status
 */
async function fetchStatus(
  registry: string,
  token: string,
  pluginName: string
): Promise<DeploymentStatus> {
  const response = await fetch(`${registry}/api/v1/plugins/${pluginName}/deployment/status`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `Failed to get status: ${response.status}`);
  }

  return response.json();
}

/**
 * Format relative time
 */
function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'never';

  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < 60000) return 'just now';
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
  return `${Math.floor(diffMs / 86400000)}d ago`;
}

/**
 * Format number with commas
 */
function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Get status badge with color
 */
function getStatusBadge(status: string): string {
  switch (status.toLowerCase()) {
    case 'healthy':
      return chalk.green('●') + ' Healthy';
    case 'unhealthy':
      return chalk.red('●') + ' Unhealthy';
    case 'deploying':
      return chalk.yellow('◐') + ' Deploying';
    case 'active':
      return chalk.green('●') + ' Active';
    case 'inactive':
      return chalk.gray('○') + ' Inactive';
    case 'failed':
      return chalk.red('●') + ' Failed';
    case 'draining':
      return chalk.yellow('◐') + ' Draining';
    default:
      return chalk.gray('?') + ` ${status}`;
  }
}

/**
 * Get severity color
 */
function getSeverityColor(severity: string): typeof chalk {
  switch (severity.toLowerCase()) {
    case 'critical':
      return chalk.red;
    case 'warning':
      return chalk.yellow;
    case 'info':
      return chalk.blue;
    default:
      return chalk.gray;
  }
}

/**
 * Create progress bar for traffic
 */
function createTrafficBar(percent: number): string {
  const width = 20;
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return chalk.cyan('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

/**
 * Display status in terminal
 */
function displayStatus(status: DeploymentStatus, clearScreen: boolean = false): void {
  if (clearScreen) {
    console.clear();
  }

  // Header
  console.log(chalk.bold.blue(`\n📊 ${status.displayName} Status\n`));

  // Basic info
  console.log(chalk.gray('Version:'), chalk.cyan(status.activeVersion || 'none'));
  console.log(chalk.gray('Status:'), getStatusBadge(status.healthStatus));
  console.log(chalk.gray('Deployed:'), formatRelativeTime(status.deployedAt));

  if (status.isDeploying) {
    console.log(chalk.yellow('\n⏳ Deployment in progress...'));
  }

  // Slots
  console.log(chalk.bold('\n📦 Deployment Slots:'));
  for (const slot of status.slots) {
    const trafficBar = createTrafficBar(slot.trafficPercent);
    const isActive = slot.trafficPercent > 0;

    console.log(`  ${isActive ? chalk.green('●') : chalk.gray('○')} ${slot.slot.toUpperCase()}`);
    console.log(chalk.gray(`    Version: ${slot.version}`));
    console.log(chalk.gray(`    Status: ${getStatusBadge(slot.status)}`));
    console.log(`    Traffic: ${trafficBar} ${slot.trafficPercent}%`);

    if (slot.healthStatus) {
      console.log(chalk.gray(`    Health: ${getStatusBadge(slot.healthStatus)}`));
    }
  }

  // Metrics
  console.log(chalk.bold('\n📈 Metrics (last 24h):'));
  console.log(
    chalk.gray('  Requests:'),
    formatNumber(status.metrics.requestCount)
  );
  console.log(
    chalk.gray('  Errors:'),
    `${status.metrics.errorCount} (${(status.metrics.errorRate * 100).toFixed(2)}%)`
  );
  console.log(
    chalk.gray('  Latency:'),
    `p50=${status.metrics.latencyP50}ms p95=${status.metrics.latencyP95}ms p99=${status.metrics.latencyP99}ms`
  );
  console.log(
    chalk.gray('  Active Users:'),
    formatNumber(status.metrics.activeUsers)
  );

  // Alerts
  if (status.activeAlerts.length > 0) {
    console.log(chalk.bold.red('\n⚠️  Active Alerts:'));
    for (const alert of status.activeAlerts) {
      const colorFn = getSeverityColor(alert.severity);
      console.log(`  ${colorFn('●')} ${alert.name}`);
      console.log(chalk.gray(`    ${alert.message}`));
      console.log(chalk.gray(`    Triggered: ${formatRelativeTime(alert.triggeredAt)}`));
    }
  }

  console.log('');
}

export const statusCommand = new Command('status')
  .description('Show plugin deployment status')
  .option('-r, --registry <url>', 'Registry URL', DEFAULT_REGISTRY)
  .option('-w, --watch', 'Watch status in real-time', false)
  .option('--json', 'Output as JSON', false)
  .option('-i, --interval <seconds>', 'Watch interval in seconds', '5')
  .action(async (options: StatusOptions) => {
    const cwd = process.cwd();
    const manifestPath = path.join(cwd, 'plugin.json');

    // Load manifest
    if (!await fs.pathExists(manifestPath)) {
      console.error(chalk.red('Error: plugin.json not found'));
      console.log(chalk.gray('Run this command from a plugin directory'));
      process.exit(1);
    }

    const manifest: PluginManifest = await fs.readJson(manifestPath);

    // Get auth token
    const token = await getAuthToken(cwd);
    if (!token) {
      console.error(chalk.red('Error: Not authenticated'));
      console.log(chalk.yellow('Run: naap-plugin login'));
      process.exit(1);
    }

    const fetchAndDisplay = async (clearScreen: boolean = false): Promise<void> => {
      try {
        const status = await fetchStatus(options.registry, token, manifest.name);

        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
          return;
        }

        displayStatus(status, clearScreen);
      } catch (error) {
        if (error instanceof Error) {
          if (error.message.includes('not found')) {
            console.log(chalk.yellow(`\nPlugin "${manifest.name}" is not deployed yet.\n`));
            console.log(chalk.gray('To deploy, run:'));
            console.log(chalk.cyan('  naap-plugin deploy\n'));
          } else {
            console.error(chalk.red(`\nError: ${error.message}`));
          }
        }
        process.exit(1);
      }
    };

    if (options.watch) {
      // Watch mode
      console.log(chalk.gray(`Watching status (refresh every ${options.interval}s, Ctrl+C to exit)\n`));

      const intervalMs = parseInt(options.interval) * 1000;
      await fetchAndDisplay(true);

      setInterval(async () => {
        await fetchAndDisplay(true);
      }, intervalMs);

      // Keep process running
      process.on('SIGINT', () => {
        console.log(chalk.gray('\nStopped watching.'));
        process.exit(0);
      });
    } else {
      // Single fetch
      const spinner = ora('Fetching status...').start();

      try {
        const status = await fetchStatus(options.registry, token, manifest.name);
        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
        } else {
          displayStatus(status);
        }
      } catch (error) {
        spinner.fail('Failed to fetch status');

        if (error instanceof Error) {
          if (error.message.includes('not found')) {
            console.log(chalk.yellow(`\nPlugin "${manifest.name}" is not deployed yet.\n`));
            console.log(chalk.gray('To deploy, run:'));
            console.log(chalk.cyan('  naap-plugin deploy\n'));
          } else {
            console.error(chalk.red(`\nError: ${error.message}`));
          }
        }

        process.exit(1);
      }
    }
  });
