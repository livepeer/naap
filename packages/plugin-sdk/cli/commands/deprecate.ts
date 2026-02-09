/**
 * deprecate command
 * Mark plugin versions as deprecated
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs-extra';
import type { PluginManifest } from '../../src/types/manifest.js';

const DEFAULT_REGISTRY = 'https://plugins.naap.io';

export const deprecateCommand = new Command('deprecate')
  .description('Deprecate a plugin version')
  .option('-v, --version <version>', 'Specific version to deprecate')
  .option('-m, --message <message>', 'Deprecation message', 'This version is deprecated')
  .option('-r, --registry <url>', 'Registry URL', DEFAULT_REGISTRY)
  .option('--unpublish', 'Completely remove the version (irreversible)')
  .action(async (options: {
    version?: string;
    message: string;
    registry: string;
    unpublish?: boolean;
  }) => {
    const cwd = process.cwd();
    const manifestPath = path.join(cwd, 'plugin.json');

    if (!await fs.pathExists(manifestPath)) {
      console.error(chalk.red('Error: plugin.json not found'));
      process.exit(1);
    }

    const manifest: PluginManifest = await fs.readJson(manifestPath);
    const targetVersion = options.version || manifest.version;

    if (options.unpublish) {
      console.log(chalk.bold.red(`\n⚠️  Unpublishing ${manifest.name}@${targetVersion}\n`));
      console.log(chalk.yellow('This action is IRREVERSIBLE!'));
    } else {
      console.log(chalk.bold.yellow(`\n⚠️  Deprecating ${manifest.name}@${targetVersion}\n`));
    }

    // Check for credentials
    const credentialsPath = path.join(cwd, '.naap', 'credentials.json');
    let token: string | undefined;

    if (await fs.pathExists(credentialsPath)) {
      const credentials = await fs.readJson(credentialsPath);
      token = credentials.token;
    }

    if (!token) {
      token = process.env.NAAP_REGISTRY_TOKEN;
    }

    if (!token) {
      console.error(chalk.red('Error: Not authenticated'));
      process.exit(1);
    }

    try {
      if (options.unpublish) {
        // Unpublish (remove) version
        const spinner = ora('Unpublishing version...').start();
        
        const response = await fetch(
          `${options.registry}/api/packages/${manifest.name}/${targetVersion}`,
          {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          }
        );

        if (!response.ok) {
          const error = await response.json().catch(() => ({ message: 'Unpublish failed' }));
          throw new Error(error.message);
        }

        spinner.succeed(`Version ${targetVersion} unpublished`);
        console.log(chalk.red('\nThis version has been permanently removed.\n'));

      } else {
        // Deprecate version
        const spinner = ora('Marking version as deprecated...').start();
        
        const response = await fetch(
          `${options.registry}/api/packages/${manifest.name}/${targetVersion}/deprecate`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              message: options.message,
            }),
          }
        );

        if (!response.ok) {
          const error = await response.json().catch(() => ({ message: 'Deprecation failed' }));
          throw new Error(error.message);
        }

        const result = await response.json();
        spinner.succeed(`Version ${targetVersion} deprecated`);

        if (result.affectedInstallations > 0) {
          console.log(chalk.yellow(`\nNotification sent to ${result.affectedInstallations} installations`));
        }

        console.log(chalk.gray('\nUsers will see:'));
        console.log(chalk.yellow(`  ⚠ ${manifest.name}@${targetVersion} is deprecated: ${options.message}`));
        console.log(chalk.gray('\nThis version will be hidden from new installs.'));
        
        console.log(chalk.gray('\nTo fully remove this version:'));
        console.log(chalk.cyan(`  naap-plugin deprecate -v ${targetVersion} --unpublish\n`));
      }

    } catch (error) {
      console.error(chalk.red('Operation failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
