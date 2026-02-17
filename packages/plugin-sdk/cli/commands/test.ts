/**
 * test command
 * Run plugin tests
 */

import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs-extra';
import type { PluginManifest } from '../../src/types/manifest.js';

export const testCommand = new Command('test')
  .description('Run plugin tests')
  .option('--unit', 'Run only unit tests')
  .option('--e2e', 'Run only e2e tests')
  .option('--integration', 'Run only integration tests')
  .option('--coverage', 'Generate coverage report')
  .option('--watch', 'Watch mode')
  .action(async (options: {
    unit?: boolean;
    e2e?: boolean;
    integration?: boolean;
    coverage?: boolean;
    watch?: boolean;
  }) => {
    const cwd = process.cwd();
    const manifestPath = path.join(cwd, 'plugin.json');

    if (!await fs.pathExists(manifestPath)) {
      console.error(chalk.red('Error: plugin.json not found'));
      process.exit(1);
    }

    const manifest: PluginManifest = await fs.readJson(manifestPath);
    console.log(chalk.bold.blue(`\n🧪 Testing ${manifest.displayName}\n`));

    try {
      const { execa } = await import('execa');
      let exitCode = 0;

      // Determine which tests to run
      const runAll = !options.unit && !options.e2e && !options.integration;

      // Frontend unit tests
      if ((runAll || options.unit) && manifest.frontend) {
        const frontendDir = path.join(cwd, 'frontend');
        if (await fs.pathExists(frontendDir)) {
          console.log(chalk.cyan('\nFrontend Tests (Vitest)\n'));
          
          const args = ['run', 'test'];
          if (options.coverage) args.push('--', '--coverage');
          if (options.watch) args.push('--', '--watch');

          try {
            await execa('npm', args, {
              cwd: frontendDir,
              stdio: 'inherit',
            });
            console.log(chalk.green('✓ Frontend tests passed'));
          } catch {
            console.log(chalk.red('✗ Frontend tests failed'));
            exitCode = 1;
          }
        }
      }

      // Backend unit tests
      if ((runAll || options.unit) && manifest.backend) {
        const backendDir = path.join(cwd, 'backend');
        if (await fs.pathExists(backendDir)) {
          console.log(chalk.cyan('\nBackend Tests (Vitest)\n'));
          
          const args = ['run', 'test'];
          if (options.coverage) args.push('--', '--coverage');
          if (options.watch) args.push('--', '--watch');

          try {
            await execa('npm', args, {
              cwd: backendDir,
              stdio: 'inherit',
            });
            console.log(chalk.green('✓ Backend tests passed'));
          } catch {
            console.log(chalk.red('✗ Backend tests failed'));
            exitCode = 1;
          }
        }
      }

      // E2E tests
      if ((runAll || options.e2e) && manifest.frontend) {
        const e2eDir = path.join(cwd, 'frontend', 'tests', 'e2e');
        if (await fs.pathExists(e2eDir)) {
          console.log(chalk.cyan('\nE2E Tests (Playwright)\n'));
          
          try {
            await execa('npx', ['playwright', 'test'], {
              cwd: path.join(cwd, 'frontend'),
              stdio: 'inherit',
            });
            console.log(chalk.green('✓ E2E tests passed'));
          } catch {
            console.log(chalk.red('✗ E2E tests failed'));
            exitCode = 1;
          }
        }
      }

      // Integration tests
      if (options.integration) {
        console.log(chalk.cyan('\nIntegration Tests\n'));
        console.log(chalk.yellow('Integration tests require the shell to be running.'));

        const shellUrl = process.env.NAAP_SHELL_URL || 'http://localhost:3000';
        console.log(chalk.gray(`Shell URL: ${shellUrl}`));

        // Verify shell is reachable before running
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          const healthRes = await fetch(`${shellUrl}/api/health`, {
            signal: controller.signal,
          }).catch(() => null);
          clearTimeout(timeoutId);

          if (!healthRes || !healthRes.ok) {
            console.log(chalk.red('Shell is not reachable. Start it first:'));
            console.log(chalk.gray('  naap-plugin dev --shell ' + shellUrl));
            exitCode = 1;
          } else {
            console.log(chalk.green('Shell reachable'));

            // Run integration test suite via Vitest with integration filter
            const integrationDir = path.join(cwd, 'tests', 'integration');
            const frontendIntDir = path.join(cwd, 'frontend', 'tests', 'integration');
            const testDir = (await fs.pathExists(integrationDir))
              ? integrationDir
              : (await fs.pathExists(frontendIntDir))
                ? frontendIntDir
                : null;

            if (testDir) {
              try {
                await execa('npx', ['vitest', 'run', '--dir', testDir], {
                  cwd,
                  stdio: 'inherit',
                  env: { ...process.env, NAAP_SHELL_URL: shellUrl },
                });
                console.log(chalk.green('✓ Integration tests passed'));
              } catch {
                console.log(chalk.red('✗ Integration tests failed'));
                exitCode = 1;
              }
            } else {
              console.log(chalk.yellow('No integration test directory found.'));
              console.log(chalk.gray('  Expected: tests/integration/ or frontend/tests/integration/'));
            }
          }
        } catch (err) {
          console.log(chalk.red('Failed to check shell health:'), err);
          exitCode = 1;
        }
      }

      console.log('');
      if (exitCode === 0) {
        console.log(chalk.green.bold('All tests passed! ✓\n'));
      } else {
        console.log(chalk.red.bold('Some tests failed! ✗\n'));
        process.exit(exitCode);
      }

    } catch (error) {
      console.error(chalk.red('Test error:'), error);
      process.exit(1);
    }
  });
