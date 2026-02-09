/**
 * publish command
 * Publish plugin to registry
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs-extra';
import type { PluginManifest } from '../../src/types/manifest.js';

const DEFAULT_REGISTRY = process.env.NAAP_REGISTRY_URL || 'https://plugins.naap.io';

interface PublishOptions {
  registry: string;
  tag: string;
  dryRun?: boolean;
  verify?: boolean;
  access: string;
  fromGithub?: boolean;
  frontendUrl?: string;
  backendImage?: string;
  releaseNotes?: string;
  retries: number;
}

export const publishCommand = new Command('publish')
  .description('Publish plugin to registry')
  .option('-r, --registry <url>', 'Registry URL', DEFAULT_REGISTRY)
  .option('-t, --tag <tag>', 'Version tag (e.g., beta, latest)', 'latest')
  .option('--dry-run', 'Simulate publish without actually uploading')
  .option('--verify', 'Verify publish without uploading (runs all checks)')
  .option('--access <access>', 'Access level (public, private)', 'public')
  .option('--from-github', 'Publishing from GitHub Actions (uses GITHUB_* env vars)')
  .option('--frontend-url <url>', 'Pre-uploaded frontend URL')
  .option('--backend-image <image>', 'Pre-built Docker image reference')
  .option('--release-notes <notes>', 'Release notes (markdown)')
  .option('--retries <n>', 'Number of retries on failure', '3')
  .action(async (options: PublishOptions) => {
    const cwd = process.cwd();
    const manifestPath = path.join(cwd, 'plugin.json');

    if (!await fs.pathExists(manifestPath)) {
      console.error(chalk.red('Error: plugin.json not found'));
      process.exit(1);
    }

    const manifest: PluginManifest = await fs.readJson(manifestPath);
    console.log(chalk.bold.blue(`\n🚀 Publishing ${manifest.displayName} v${manifest.version}\n`));

    // GitHub Actions context
    if (options.fromGithub) {
      console.log(chalk.gray('Running in GitHub Actions context'));
      console.log(chalk.gray(`  Repository: ${process.env.GITHUB_REPOSITORY}`));
      console.log(chalk.gray(`  Ref: ${process.env.GITHUB_REF}`));
      console.log(chalk.gray(`  SHA: ${process.env.GITHUB_SHA?.substring(0, 7)}`));
    }

    // Get credentials
    let token: string | undefined;
    
    // Check environment first (GitHub Actions, CI)
    token = process.env.NAAP_REGISTRY_TOKEN;
    
    // Then check local credentials
    if (!token) {
      const credentialsPath = path.join(cwd, '.naap', 'credentials.json');
      if (await fs.pathExists(credentialsPath)) {
        const credentials = await fs.readJson(credentialsPath);
        token = credentials.token;
      }
    }

    if (!token && !options.dryRun && !options.verify) {
      console.error(chalk.red('Error: Not authenticated'));
      console.log(chalk.yellow('Run: naap-plugin login'));
      console.log(chalk.gray('Or set NAAP_REGISTRY_TOKEN environment variable'));
      process.exit(1);
    }

    try {
      // Pre-publish checks
      const checksSpinner = ora('Running pre-publish checks...').start();
      const checks: { name: string; passed: boolean; message?: string }[] = [];

      // 1. Validate manifest
      if (!manifest.name || !manifest.version) {
        checks.push({ name: 'Manifest validation', passed: false, message: 'Missing name or version' });
      } else {
        checks.push({ name: 'Manifest validation', passed: true });
      }

      // 2. Check version format (semver)
      const semverRegex = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
      if (!semverRegex.test(manifest.version)) {
        checks.push({ name: 'Version format', passed: false, message: 'Must be valid semver' });
      } else {
        checks.push({ name: 'Version format', passed: true });
      }

      // 3. Check if version already exists
      try {
        const response = await fetch(
          `${options.registry}/api/v1/registry/packages/${manifest.name}/${manifest.version}`,
          { method: 'HEAD' }
        );
        
        if (response.ok) {
          checks.push({ name: 'Version availability', passed: false, message: 'Version already published' });
        } else {
          checks.push({ name: 'Version availability', passed: true });
        }
      } catch {
        checks.push({ name: 'Version availability', passed: true, message: 'Registry check skipped' });
      }

      // 4. Check for build artifacts
      const distPath = path.join(cwd, 'frontend', 'dist');
      const hasLocalBuild = await fs.pathExists(distPath);
      const productionDir = path.join(distPath, 'production');
      const hasBuild = hasLocalBuild && await fs.pathExists(productionDir);
      
      if (options.frontendUrl) {
        checks.push({ name: 'Frontend artifacts', passed: true, message: 'Pre-uploaded' });
      } else if (hasBuild) {
        checks.push({ name: 'Frontend artifacts', passed: true });
      } else if (manifest.frontend) {
        checks.push({ name: 'Frontend artifacts', passed: false, message: 'UMD bundle not found in dist/production' });
      } else {
        checks.push({ name: 'Frontend artifacts', passed: true, message: 'No frontend' });
      }

      // 5. Check Docker image if backend exists
      if (options.backendImage) {
        checks.push({ name: 'Backend image', passed: true, message: 'Pre-built' });
      } else if (manifest.backend) {
        const dockerfilePath = path.join(cwd, 'backend', 'Dockerfile');
        if (await fs.pathExists(dockerfilePath)) {
          checks.push({ name: 'Backend image', passed: true, message: 'Dockerfile found' });
        } else {
          checks.push({ name: 'Backend image', passed: false, message: 'Dockerfile not found' });
        }
      } else {
        checks.push({ name: 'Backend image', passed: true, message: 'No backend' });
      }

      // Display check results
      const failedChecks = checks.filter(c => !c.passed);
      
      if (failedChecks.length > 0) {
        checksSpinner.fail('Pre-publish checks failed');
        console.log('');
        for (const check of checks) {
          const icon = check.passed ? chalk.green('✓') : chalk.red('✗');
          const msg = check.message ? chalk.gray(` (${check.message})`) : '';
          console.log(`  ${icon} ${check.name}${msg}`);
        }
        console.log('');
        process.exit(1);
      }
      
      checksSpinner.succeed('Pre-publish checks passed');

      // Verify mode - exit after checks
      if (options.verify) {
        console.log(chalk.green('\n✓ Verification complete - ready to publish\n'));
        return;
      }

      // Dry run mode
      if (options.dryRun) {
        console.log(chalk.yellow('\n[DRY RUN] Would publish:'));
        console.log(chalk.gray(`  Plugin: ${manifest.name}@${manifest.version}`));
        console.log(chalk.gray(`  Registry: ${options.registry}`));
        console.log(chalk.gray(`  Tag: ${options.tag}`));
        console.log(chalk.gray(`  Access: ${options.access}`));
        if (options.frontendUrl) {
          console.log(chalk.gray(`  Frontend URL: ${options.frontendUrl}`));
        }
        if (options.backendImage) {
          console.log(chalk.gray(`  Backend Image: ${options.backendImage}`));
        }
        console.log(chalk.green('\n✓ Dry run complete\n'));
        return;
      }

      // Publish with retries
      const maxRetries = parseInt(options.retries.toString()) || 3;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          if (attempt > 1) {
            console.log(chalk.yellow(`Retry attempt ${attempt}/${maxRetries}...`));
            await sleep(1000 * attempt); // Exponential backoff
          }

          const publishSpinner = ora('Publishing to registry...').start();

          // Prepare publish payload
          const publishPayload = {
            manifest,
            frontendUrl: options.frontendUrl,
            backendImage: options.backendImage,
            releaseNotes: options.releaseNotes || await getReleaseNotes(cwd, manifest.version),
            tag: options.tag,
          };

          const response = await fetch(`${options.registry}/api/v1/registry/publish`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(publishPayload),
          });

          if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Publish failed' }));
            throw new Error(error.error || error.message || 'Publish failed');
          }

          const result = await response.json();
          publishSpinner.succeed('Published to registry');

          console.log(chalk.green.bold('\n✓ Published successfully!\n'));
          console.log(`Plugin: ${chalk.cyan(`${manifest.name}@${manifest.version}`)}`);
          console.log(`Registry: ${chalk.cyan(options.registry)}`);
          
          if (result.package?.id) {
            console.log(`Package ID: ${chalk.gray(result.package.id)}`);
          }

          console.log(`\nInstall with: ${chalk.cyan(`naap-plugin install ${manifest.name}`)}\n`);
          
          return; // Success!

        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          
          if (attempt < maxRetries) {
            console.log(chalk.yellow(`Attempt ${attempt} failed: ${lastError.message}`));
          }
        }
      }

      // All retries failed
      throw lastError;

    } catch (error) {
      console.error(chalk.red('\nPublish failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

/**
 * Helper to get release notes from CHANGELOG.md
 */
async function getReleaseNotes(cwd: string, version: string): Promise<string | undefined> {
  const changelogPath = path.join(cwd, 'CHANGELOG.md');
  
  if (!await fs.pathExists(changelogPath)) {
    return undefined;
  }

  try {
    const content = await fs.readFile(changelogPath, 'utf-8');
    
    // Try to extract notes for this version
    // Common format: ## [1.0.0] - 2024-01-01
    const versionHeader = new RegExp(`## \\[?${version}\\]?.*\\n([\\s\\S]*?)(?=## \\[|$)`, 'm');
    const match = content.match(versionHeader);
    
    if (match) {
      return match[1].trim();
    }
  } catch {
    // Ignore errors
  }

  return undefined;
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
