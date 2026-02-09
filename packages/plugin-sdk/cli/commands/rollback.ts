/**
 * rollback command
 * Rollback plugin to previous version
 *
 * Quickly reverts to the previous deployment slot, restoring
 * the last known good version.
 *
 * @example
 * # Rollback to previous version (interactive confirmation)
 * naap-plugin rollback
 *
 * # Force rollback without confirmation
 * naap-plugin rollback --force
 *
 * # Rollback to a specific version
 * naap-plugin rollback --version 1.2.3
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs-extra';
import type { PluginManifest } from '../../src/types/manifest.js';

const DEFAULT_REGISTRY = process.env.NAAP_REGISTRY_URL || 'https://plugins.naap.io';

interface RollbackOptions {
  registry: string;
  version?: string;
  force: boolean;
  reason?: string;
}

interface DeploymentStatus {
  deploymentId: string;
  activeSlot: string | null;
  activeVersion: string | null;
  slots: {
    slot: string;
    version: string;
    status: string;
    trafficPercent: number;
    healthStatus: string | null;
  }[];
}

interface RollbackResult {
  success: boolean;
  rolledBackTo: string;
  version: string;
  previousVersion: string;
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
 * Get current deployment status
 */
async function getDeploymentStatus(
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
 * Execute rollback
 */
async function executeRollback(
  registry: string,
  token: string,
  pluginName: string,
  options: { version?: string; reason?: string }
): Promise<RollbackResult> {
  const response = await fetch(`${registry}/api/v1/plugins/${pluginName}/deployment/rollback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      targetVersion: options.version,
      reason: options.reason || 'Manual rollback via CLI',
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `Rollback failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Prompt for confirmation (simple stdin-based)
 */
async function confirmRollback(currentVersion: string, targetVersion: string): Promise<boolean> {
  return new Promise((resolve) => {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log('');
    console.log(chalk.yellow('⚠️  Rollback Confirmation'));
    console.log(chalk.gray(`  Current version: ${currentVersion}`));
    console.log(chalk.gray(`  Target version: ${targetVersion}`));
    console.log('');

    rl.question(chalk.cyan('Proceed with rollback? (y/N): '), (answer: string) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

export const rollbackCommand = new Command('rollback')
  .description('Rollback plugin to previous version')
  .option('-r, --registry <url>', 'Registry URL', DEFAULT_REGISTRY)
  .option('-v, --version <version>', 'Specific version to rollback to')
  .option('-f, --force', 'Force rollback without confirmation', false)
  .option('--reason <reason>', 'Reason for rollback (for audit log)')
  .action(async (options: RollbackOptions) => {
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
    console.log(chalk.bold.yellow(`\n⚠️  Rolling back ${manifest.displayName}\n`));

    // Get auth token
    const token = await getAuthToken(cwd);
    if (!token) {
      console.error(chalk.red('Error: Not authenticated'));
      console.log(chalk.yellow('Run: naap-plugin login'));
      process.exit(1);
    }

    const spinner = ora('Fetching deployment status...').start();

    try {
      // Get current status
      const status = await getDeploymentStatus(options.registry, token, manifest.name);

      spinner.stop();

      // Display current state
      console.log(chalk.gray('Current state:'));

      if (!status.activeSlot) {
        console.log(chalk.red('  No active deployment found'));
        process.exit(1);
      }

      // Find active and inactive slots
      const activeSlot = status.slots.find(s => s.slot === status.activeSlot);
      const inactiveSlot = status.slots.find(s => s.slot !== status.activeSlot);

      console.log(chalk.gray(`  Active slot: ${status.activeSlot}`));
      console.log(chalk.gray(`  Current version: ${activeSlot?.version || 'unknown'}`));

      if (!inactiveSlot) {
        console.log(chalk.red('\nError: No previous version available for rollback'));
        console.log(chalk.gray('This may be the first deployment of this plugin'));
        process.exit(1);
      }

      const targetVersion = options.version || inactiveSlot.version;
      console.log(chalk.gray(`  Rollback target: ${inactiveSlot.slot}`));
      console.log(chalk.gray(`  Target version: ${targetVersion}`));

      // Check if target slot is healthy
      if (inactiveSlot.healthStatus === 'unhealthy') {
        console.log(chalk.yellow('\n⚠️  Warning: Target slot is marked as unhealthy'));
        console.log(chalk.gray('  Health status: ' + inactiveSlot.healthStatus));
      }

      // Confirm unless --force
      if (!options.force) {
        const confirmed = await confirmRollback(
          activeSlot?.version || 'unknown',
          targetVersion
        );

        if (!confirmed) {
          console.log(chalk.yellow('\nRollback cancelled'));
          process.exit(0);
        }
      }

      // Execute rollback
      const rollbackSpinner = ora('Rolling back...').start();

      const result = await executeRollback(options.registry, token, manifest.name, {
        version: options.version,
        reason: options.reason,
      });

      rollbackSpinner.succeed('Rollback complete');

      // Display result
      console.log(chalk.green('\n✓ Rollback successful!\n'));
      console.log(chalk.gray(`  Rolled back to: ${result.rolledBackTo}`));
      console.log(chalk.gray(`  Version: ${result.version}`));
      console.log(chalk.gray(`  Previous version: ${result.previousVersion}`));

      // Suggestion
      console.log(chalk.cyan('\nTip:'));
      console.log(chalk.gray('  Check status: naap-plugin status'));
      console.log(chalk.gray('  View logs: naap-plugin logs'));
      console.log('');

    } catch (error) {
      spinner.fail('Rollback failed');

      if (error instanceof Error) {
        console.error(chalk.red(`\nError: ${error.message}`));

        if (error.message.includes('not found')) {
          console.log(chalk.yellow('\nTip: Make sure the plugin is deployed'));
          console.log(chalk.gray('Run: naap-plugin deploy'));
        }
      }

      process.exit(1);
    }
  });
