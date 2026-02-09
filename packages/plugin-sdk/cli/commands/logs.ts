/**
 * logs command
 * Stream plugin logs
 *
 * Fetches and displays logs from deployed plugin backends,
 * with filtering and streaming capabilities.
 *
 * @example
 * # Show last 100 lines
 * naap-plugin logs
 *
 * # Follow logs in real-time
 * naap-plugin logs -f
 *
 * # Filter by log level
 * naap-plugin logs --level error
 *
 * # Show logs from specific time
 * naap-plugin logs --since 1h
 *
 * # Show logs from specific slot
 * naap-plugin logs --slot blue
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs-extra';
import type { PluginManifest } from '../../src/types/manifest.js';

const DEFAULT_REGISTRY = process.env.NAAP_REGISTRY_URL || 'https://plugins.naap.io';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogsOptions {
  registry: string;
  follow: boolean;
  lines: string;
  level?: LogLevel;
  since?: string;
  slot?: 'blue' | 'green';
  noColor: boolean;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  slot?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
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
 * Parse duration string (e.g., "1h", "30m", "2d") to milliseconds
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Use format like 1h, 30m, 2d`);
  }

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Invalid duration unit: ${unit}`);
  }
}

/**
 * Get log level color
 */
function getLevelColor(level: LogLevel, noColor: boolean): (text: string) => string {
  if (noColor) return (text: string) => text;

  switch (level) {
    case 'debug':
      return chalk.gray;
    case 'info':
      return chalk.blue;
    case 'warn':
      return chalk.yellow;
    case 'error':
      return chalk.red;
    default:
      return chalk.white;
  }
}

/**
 * Format timestamp
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toISOString().replace('T', ' ').substring(0, 23);
}

/**
 * Format log entry for display
 */
function formatLogEntry(log: LogEntry, noColor: boolean): string {
  const timestamp = noColor
    ? formatTimestamp(log.timestamp)
    : chalk.gray(formatTimestamp(log.timestamp));

  const levelColor = getLevelColor(log.level, noColor);
  const level = levelColor(log.level.toUpperCase().padEnd(5));

  const slot = log.slot ? (noColor ? `[${log.slot}]` : chalk.cyan(`[${log.slot}]`)) : '';

  const requestId = log.requestId
    ? (noColor ? `(${log.requestId.substring(0, 8)})` : chalk.gray(`(${log.requestId.substring(0, 8)})`))
    : '';

  const parts = [timestamp, level, slot, requestId, log.message].filter(Boolean);
  return parts.join(' ');
}

/**
 * Fetch logs (one-time)
 */
async function fetchLogs(
  registry: string,
  token: string,
  pluginName: string,
  options: {
    lines: number;
    level?: LogLevel;
    since?: number;
    slot?: string;
  }
): Promise<LogEntry[]> {
  const params = new URLSearchParams();
  params.set('lines', options.lines.toString());

  if (options.level) {
    params.set('level', options.level);
  }
  if (options.since) {
    params.set('since', new Date(Date.now() - options.since).toISOString());
  }
  if (options.slot) {
    params.set('slot', options.slot);
  }

  const response = await fetch(
    `${registry}/api/v1/plugins/${pluginName}/logs?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `Failed to fetch logs: ${response.status}`);
  }

  return response.json();
}

/**
 * Stream logs (Server-Sent Events simulation via polling)
 */
async function* streamLogs(
  registry: string,
  token: string,
  pluginName: string,
  options: {
    level?: LogLevel;
    slot?: string;
  }
): AsyncGenerator<LogEntry> {
  let lastTimestamp = new Date().toISOString();

  while (true) {
    try {
      const params = new URLSearchParams();
      params.set('since', lastTimestamp);
      params.set('lines', '100');

      if (options.level) {
        params.set('level', options.level);
      }
      if (options.slot) {
        params.set('slot', options.slot);
      }

      const response = await fetch(
        `${registry}/api/v1/plugins/${pluginName}/logs?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        const logs: LogEntry[] = await response.json();

        for (const log of logs) {
          yield log;
          lastTimestamp = log.timestamp;
        }
      }

      // Poll interval
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch {
      // Connection error, wait and retry
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

export const logsCommand = new Command('logs')
  .description('Stream plugin logs')
  .option('-r, --registry <url>', 'Registry URL', DEFAULT_REGISTRY)
  .option('-f, --follow', 'Follow log output', false)
  .option('-n, --lines <number>', 'Number of lines to show', '100')
  .option('--level <level>', 'Filter by log level (debug, info, warn, error)')
  .option('--since <duration>', 'Show logs since duration (e.g., 1h, 30m, 2d)')
  .option('--slot <slot>', 'Show logs from specific slot (blue, green)')
  .option('--no-color', 'Disable colored output')
  .action(async (options: LogsOptions) => {
    const cwd = process.cwd();
    const manifestPath = path.join(cwd, 'plugin.json');

    // Load manifest
    if (!await fs.pathExists(manifestPath)) {
      console.error(chalk.red('Error: plugin.json not found'));
      console.log(chalk.gray('Run this command from a plugin directory'));
      process.exit(1);
    }

    const manifest: PluginManifest = await fs.readJson(manifestPath);

    // Validate options
    if (options.level && !['debug', 'info', 'warn', 'error'].includes(options.level)) {
      console.error(chalk.red(`Invalid log level: ${options.level}`));
      console.log(chalk.gray('Valid levels: debug, info, warn, error'));
      process.exit(1);
    }

    if (options.slot && !['blue', 'green'].includes(options.slot)) {
      console.error(chalk.red(`Invalid slot: ${options.slot}`));
      console.log(chalk.gray('Valid slots: blue, green'));
      process.exit(1);
    }

    // Parse since duration
    let sinceDuration: number | undefined;
    if (options.since) {
      try {
        sinceDuration = parseDuration(options.since);
      } catch (error) {
        if (error instanceof Error) {
          console.error(chalk.red(error.message));
        }
        process.exit(1);
      }
    }

    // Get auth token
    const token = await getAuthToken(cwd);
    if (!token) {
      console.error(chalk.red('Error: Not authenticated'));
      console.log(chalk.yellow('Run: naap-plugin login'));
      process.exit(1);
    }

    if (options.follow) {
      // Follow mode
      console.log(
        chalk.cyan(`Streaming logs for ${manifest.name}`) +
          (options.slot ? chalk.gray(` (slot: ${options.slot})`) : '') +
          chalk.gray(' (Ctrl+C to exit)\n')
      );

      try {
        for await (const log of streamLogs(options.registry, token, manifest.name, {
          level: options.level as LogLevel,
          slot: options.slot,
        })) {
          console.log(formatLogEntry(log, options.noColor));
        }
      } catch (error) {
        if (error instanceof Error && error.message !== 'interrupted') {
          console.error(chalk.red(`\nError: ${error.message}`));
        }
      }

      // Handle Ctrl+C
      process.on('SIGINT', () => {
        console.log(chalk.gray('\nStopped streaming.'));
        process.exit(0);
      });
    } else {
      // One-time fetch
      const spinner = ora('Fetching logs...').start();

      try {
        const logs = await fetchLogs(options.registry, token, manifest.name, {
          lines: parseInt(options.lines),
          level: options.level as LogLevel,
          since: sinceDuration,
          slot: options.slot,
        });

        spinner.stop();

        if (logs.length === 0) {
          console.log(chalk.yellow('No logs found matching your criteria.\n'));

          if (options.level) {
            console.log(chalk.gray(`Tip: Try without --level filter to see all logs`));
          }
          if (options.since) {
            console.log(chalk.gray(`Tip: Try a longer --since duration`));
          }
          return;
        }

        // Display logs
        for (const log of logs) {
          console.log(formatLogEntry(log, options.noColor));
        }

        // Summary
        console.log('');
        console.log(chalk.gray(`Showing ${logs.length} log entries`));
        if (logs.length >= parseInt(options.lines)) {
          console.log(chalk.gray(`Use -n to show more lines, or -f to follow`));
        }
        console.log('');
      } catch (error) {
        spinner.fail('Failed to fetch logs');

        if (error instanceof Error) {
          if (error.message.includes('not found')) {
            console.log(chalk.yellow(`\nPlugin "${manifest.name}" is not deployed yet.\n`));
            console.log(chalk.gray('To deploy, run:'));
            console.log(chalk.cyan('  naap-plugin deploy\n'));
          } else if (error.message.includes('no backend')) {
            console.log(chalk.yellow(`\nThis plugin is frontend-only and has no logs.\n`));
          } else {
            console.error(chalk.red(`\nError: ${error.message}`));
          }
        }

        process.exit(1);
      }
    }
  });
