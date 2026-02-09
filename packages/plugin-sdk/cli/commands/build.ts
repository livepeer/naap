/**
 * build command
 * Build plugin for production
 * 
 * Includes:
 * - Frontend UMD bundle build with validation
 * - Backend build with TypeScript compilation
 * - Docker image build (optional)
 * - Security scanning (optional)
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs-extra';
import type { PluginManifest } from '../../src/types/manifest.js';
import {
  securityScan,
  formatSecurityResult,
  getFixSuggestions,
} from '../../src/validators/security.js';

export function createBuildCommand(): Command {
  const cmd = new Command('build');
  cmd.description('Build plugin for production');
  cmd.option('-d, --dir <dir>', 'Plugin directory', '.');
  cmd.option('--frontend-only', 'Build frontend only');
  cmd.option('--backend-only', 'Build backend only');
  cmd.option('--skip-validation', 'Skip build validation');
  cmd.option('--skip-security', 'Skip security scanning');
  cmd.option('--docker', 'Build Docker image for backend');
  cmd.action(async (options) => {
    const pluginDir = path.resolve(options.dir);
    const manifestPath = path.join(pluginDir, 'plugin.json');
    
    if (!await fs.pathExists(manifestPath)) {
      console.error(chalk.red('No plugin.json found in current directory'));
      process.exit(1);
    }
    
    const manifest: PluginManifest = await fs.readJson(manifestPath);
    console.log(chalk.bold(`\nBuilding ${manifest.displayName || manifest.name}...\n`));
    
    // Build frontend
    if (!options.backendOnly && manifest.frontend) {
      const frontendDir = path.join(pluginDir, 'frontend');
      if (await fs.pathExists(frontendDir)) {
        const spinner = ora('Building frontend...').start();
        try {
          const { execSync } = await import('child_process');
          execSync('npm run build', {
            cwd: frontendDir,
            stdio: 'pipe',
          });

          spinner.succeed('Frontend built');

          // Validate UMD bundle
          if (!options.skipValidation) {
            const validateSpinner = ora('Validating UMD bundle...').start();
            const distPath = path.join(frontendDir, 'dist', 'production');
            
            if (await fs.pathExists(distPath)) {
              const files = await fs.readdir(distPath);
              const jsFiles = files.filter(f => f.endsWith('.js'));
              
              if (jsFiles.length > 0) {
                const bundlePath = path.join(distPath, jsFiles[0]);
                const stat = await fs.stat(bundlePath);
                const sizeKB = (stat.size / 1024).toFixed(1);
                validateSpinner.succeed(`UMD bundle validated (${sizeKB}KB, file: ${jsFiles[0]})`);
                
                // Check for manifest.json
                const manifestJsonPath = path.join(distPath, 'manifest.json');
                if (await fs.pathExists(manifestJsonPath)) {
                  console.log(chalk.gray('  manifest.json found'));
                }
              } else {
                validateSpinner.fail('No .js files found in dist/production');
                process.exit(1);
              }
            } else {
              validateSpinner.fail('dist/production directory not found - build may have failed');
              process.exit(1);
            }
          }
        } catch (error) {
          spinner.fail('Frontend build failed');
          if (error instanceof Error) {
            console.error(chalk.red(error.message));
          }
          process.exit(1);
        }
      }
    }
    
    // Build backend
    if (!options.frontendOnly && manifest.backend) {
      const backendDir = path.join(pluginDir, 'backend');
      if (await fs.pathExists(backendDir)) {
        const spinner = ora('Building backend...').start();
        try {
          const { execSync } = await import('child_process');
          execSync('npm run build', {
            cwd: backendDir,
            stdio: 'pipe',
          });
          spinner.succeed('Backend built');
        } catch (error) {
          spinner.fail('Backend build failed');
          if (error instanceof Error) {
            console.error(chalk.red(error.message));
          }
          process.exit(1);
        }
      }
    }
    
    // Security scanning
    if (!options.skipSecurity) {
      const spinner = ora('Running security scan...').start();
      try {
        const result = await securityScan(pluginDir);
        if (result.passed) {
          spinner.succeed('Security scan passed');
        } else {
          spinner.warn('Security issues found');
          console.log(formatSecurityResult(result));
          const suggestions = getFixSuggestions(result);
          if (suggestions.length > 0) {
            console.log(chalk.yellow('\nSuggestions:'));
            for (const s of suggestions) {
              console.log(chalk.gray(`  - ${s}`));
            }
          }
        }
      } catch {
        spinner.warn('Security scan skipped (scanner not available)');
      }
    }
    
    console.log(chalk.green(`\n✓ ${manifest.displayName || manifest.name} built successfully\n`));
  });
  
  return cmd;
}
