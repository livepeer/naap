/**
 * GitHub Integration Commands
 * Setup and manage GitHub Actions for plugin publishing
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs-extra';
import { input, confirm, select } from '@inquirer/prompts';

const WORKFLOW_TEMPLATE_URL = 'https://raw.githubusercontent.com/naap-platform/plugin-sdk/main/templates';

export const githubCommand = new Command('github')
  .description('GitHub integration commands');

/**
 * Setup GitHub Actions for plugin publishing
 */
githubCommand
  .command('setup')
  .description('Setup GitHub Actions workflow for publishing')
  .option('--type <type>', 'Plugin type (full-stack, frontend-only, backend-only)')
  .option('--force', 'Overwrite existing workflow')
  .action(async (options: { type?: string; force?: boolean }) => {
    const cwd = process.cwd();
    const manifestPath = path.join(cwd, 'plugin.json');

    // Check for plugin.json
    if (!await fs.pathExists(manifestPath)) {
      console.error(chalk.red('Error: plugin.json not found'));
      console.log(chalk.yellow('Run this command from your plugin directory'));
      process.exit(1);
    }

    const manifest = await fs.readJson(manifestPath);
    console.log(chalk.bold.blue(`\n🔧 Setting up GitHub Actions for ${manifest.displayName}\n`));

    // Detect plugin type
    let pluginType = options.type;
    
    if (!pluginType) {
      const hasFrontend = await fs.pathExists(path.join(cwd, 'frontend'));
      const hasBackend = await fs.pathExists(path.join(cwd, 'backend'));
      
      if (hasFrontend && hasBackend) {
        pluginType = 'full-stack';
      } else if (hasFrontend) {
        pluginType = 'frontend-only';
      } else if (hasBackend) {
        pluginType = 'backend-only';
      } else {
        pluginType = await select({
          message: 'Select plugin type:',
          choices: [
            { name: 'Full Stack (Frontend + Backend)', value: 'full-stack' },
            { name: 'Frontend Only', value: 'frontend-only' },
            { name: 'Backend Only', value: 'backend-only' },
          ],
        });
      }
    }

    console.log(chalk.gray(`Plugin type: ${pluginType}`));

    // Check for existing workflow
    const workflowDir = path.join(cwd, '.github', 'workflows');
    const workflowPath = path.join(workflowDir, 'publish-plugin.yml');

    if (await fs.pathExists(workflowPath) && !options.force) {
      const overwrite = await confirm({
        message: 'Workflow already exists. Overwrite?',
        default: false,
      });
      
      if (!overwrite) {
        console.log(chalk.yellow('Setup cancelled'));
        return;
      }
    }

    // Create workflow directory
    await fs.ensureDir(workflowDir);

    // Generate workflow content based on type
    const spinner = ora('Generating workflow...').start();
    
    const workflowContent = generateWorkflow(pluginType || 'full-stack', manifest);
    await fs.writeFile(workflowPath, workflowContent);
    
    spinner.succeed('Workflow created');

    // Print next steps
    console.log(chalk.green.bold('\n✓ GitHub Actions setup complete!\n'));
    console.log(chalk.bold('Next steps:'));
    console.log('');
    console.log(`  ${chalk.cyan('1.')} Add secrets to your GitHub repository:`);
    console.log(`     ${chalk.gray('Settings → Secrets → Actions')}`);
    console.log(`     • ${chalk.yellow('NAAP_REGISTRY_TOKEN')} - Your NAAP registry API token`);
    
    if (pluginType !== 'frontend-only') {
      console.log(`     • ${chalk.yellow('DOCKER_USERNAME')} - Docker Hub username (optional)`);
      console.log(`     • ${chalk.yellow('DOCKER_TOKEN')} - Docker Hub access token (optional)`);
    }
    
    console.log('');
    console.log(`  ${chalk.cyan('2.')} Commit and push the workflow:`);
    console.log(`     ${chalk.gray('git add .github/workflows/publish-plugin.yml')}`);
    console.log(`     ${chalk.gray('git commit -m "Add plugin publishing workflow"')}`);
    console.log(`     ${chalk.gray('git push')}`);
    console.log('');
    console.log(`  ${chalk.cyan('3.')} Create a GitHub release to trigger publishing:`);
    console.log(`     ${chalk.gray('git tag v' + manifest.version)}`);
    console.log(`     ${chalk.gray('git push --tags')}`);
    console.log(`     ${chalk.gray('Then create a release from the tag on GitHub')}`);
    console.log('');
  });

/**
 * Verify GitHub integration
 */
githubCommand
  .command('verify')
  .description('Verify GitHub Actions configuration')
  .action(async () => {
    const cwd = process.cwd();
    
    console.log(chalk.bold.blue('\n🔍 Verifying GitHub integration\n'));

    const checks: { name: string; passed: boolean; message?: string }[] = [];

    // 1. Check for workflow file
    const workflowPath = path.join(cwd, '.github', 'workflows', 'publish-plugin.yml');
    if (await fs.pathExists(workflowPath)) {
      checks.push({ name: 'Workflow file', passed: true });
    } else {
      checks.push({ name: 'Workflow file', passed: false, message: 'Run: naap-plugin github setup' });
    }

    // 2. Check for plugin.json
    const manifestPath = path.join(cwd, 'plugin.json');
    if (await fs.pathExists(manifestPath)) {
      const manifest = await fs.readJson(manifestPath);
      if (manifest.name && manifest.version) {
        checks.push({ name: 'Plugin manifest', passed: true });
      } else {
        checks.push({ name: 'Plugin manifest', passed: false, message: 'Missing name or version' });
      }
    } else {
      checks.push({ name: 'Plugin manifest', passed: false, message: 'plugin.json not found' });
    }

    // 3. Check for .gitignore
    const gitignorePath = path.join(cwd, '.gitignore');
    if (await fs.pathExists(gitignorePath)) {
      const content = await fs.readFile(gitignorePath, 'utf-8');
      if (content.includes('.naap') || content.includes('credentials')) {
        checks.push({ name: 'Secrets protected', passed: true });
      } else {
        checks.push({ name: 'Secrets protected', passed: false, message: 'Add .naap/ to .gitignore' });
      }
    } else {
      checks.push({ name: 'Secrets protected', passed: false, message: 'No .gitignore file' });
    }

    // 4. Check for CHANGELOG.md
    const changelogPath = path.join(cwd, 'CHANGELOG.md');
    if (await fs.pathExists(changelogPath)) {
      checks.push({ name: 'Changelog', passed: true });
    } else {
      checks.push({ name: 'Changelog', passed: true, message: 'Optional: add CHANGELOG.md' });
    }

    // 5. Check environment variables (for local testing)
    if (process.env.NAAP_REGISTRY_TOKEN) {
      checks.push({ name: 'Registry token', passed: true });
    } else {
      checks.push({ name: 'Registry token', passed: true, message: 'Set in GitHub Secrets' });
    }

    // Display results
    console.log('');
    for (const check of checks) {
      const icon = check.passed ? chalk.green('✓') : chalk.red('✗');
      const msg = check.message ? chalk.gray(` (${check.message})`) : '';
      console.log(`  ${icon} ${check.name}${msg}`);
    }
    console.log('');

    const allPassed = checks.every(c => c.passed);
    if (allPassed) {
      console.log(chalk.green.bold('✓ All checks passed!\n'));
    } else {
      console.log(chalk.yellow('⚠ Some checks need attention\n'));
    }
  });

/**
 * Manage GitHub tokens
 */
githubCommand
  .command('token')
  .description('Manage NAAP registry tokens')
  .option('--show', 'Show current token (masked)')
  .option('--set', 'Set a new token')
  .option('--clear', 'Clear stored token')
  .action(async (options: { show?: boolean; set?: boolean; clear?: boolean }) => {
    const cwd = process.cwd();
    const credentialsPath = path.join(cwd, '.naap', 'credentials.json');

    if (options.clear) {
      if (await fs.pathExists(credentialsPath)) {
        await fs.remove(credentialsPath);
        console.log(chalk.green('Token cleared'));
      } else {
        console.log(chalk.yellow('No token stored'));
      }
      return;
    }

    if (options.set) {
      const token = await input({
        message: 'Enter your NAAP registry token:',
        transformer: (value: string) => '*'.repeat(value.length),
      });

      await fs.ensureDir(path.dirname(credentialsPath));
      await fs.writeJson(credentialsPath, { token }, { spaces: 2 });
      
      // Ensure .naap is in .gitignore
      const gitignorePath = path.join(cwd, '.gitignore');
      if (await fs.pathExists(gitignorePath)) {
        const content = await fs.readFile(gitignorePath, 'utf-8');
        if (!content.includes('.naap')) {
          await fs.appendFile(gitignorePath, '\n.naap/\n');
        }
      } else {
        await fs.writeFile(gitignorePath, '.naap/\n');
      }

      console.log(chalk.green('Token saved'));
      console.log(chalk.gray('Note: .naap/ has been added to .gitignore'));
      return;
    }

    if (options.show) {
      if (process.env.NAAP_REGISTRY_TOKEN) {
        const token = process.env.NAAP_REGISTRY_TOKEN;
        console.log(`Environment: ${token.substring(0, 8)}${'*'.repeat(20)}`);
      }

      if (await fs.pathExists(credentialsPath)) {
        const creds = await fs.readJson(credentialsPath);
        if (creds.token) {
          console.log(`Local: ${creds.token.substring(0, 8)}${'*'.repeat(20)}`);
        }
      }

      if (!process.env.NAAP_REGISTRY_TOKEN && !await fs.pathExists(credentialsPath)) {
        console.log(chalk.yellow('No token configured'));
      }
      return;
    }

    // Default: show help
    console.log('Usage: naap-plugin github token [options]');
    console.log('');
    console.log('Options:');
    console.log('  --show   Show current token (masked)');
    console.log('  --set    Set a new token');
    console.log('  --clear  Clear stored token');
  });

/**
 * Generate workflow content
 */
function generateWorkflow(type: string, manifest: { name: string; version: string }): string {
  const baseWorkflow = `# NAAP Plugin Publishing Workflow
# Automatically builds and publishes your plugin on GitHub releases
# Generated by naap-plugin github setup

name: Publish Plugin

on:
  release:
    types: [published]
  workflow_dispatch:
    inputs:
      version:
        description: 'Version to publish (e.g., 1.0.0)'
        required: true
      skip_tests:
        description: 'Skip tests'
        type: boolean
        default: false

env:
  NODE_VERSION: '20'
  REGISTRY_URL: \${{ secrets.NAAP_REGISTRY_URL || 'https://plugins.naap.io' }}

`;

  if (type === 'frontend-only') {
    return baseWorkflow + `jobs:
  build-and-publish:
    name: Build & Publish
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: \${{ env.NODE_VERSION }}
          cache: 'npm'

      - name: Get version
        id: version
        run: |
          if [ "\${{ github.event_name }}" = "release" ]; then
            VERSION="\${{ github.event.release.tag_name }}"
            VERSION="\${VERSION#v}"
          else
            VERSION="\${{ github.event.inputs.version }}"
          fi
          echo "version=$VERSION" >> $GITHUB_OUTPUT

      - name: Install dependencies
        run: npm ci

      - name: Run linting
        run: npm run lint --if-present

      - name: Run tests
        if: \${{ github.event.inputs.skip_tests != 'true' }}
        run: npm test --if-present

      - name: Build
        run: npm run build

      - name: Install NAAP CLI
        run: npm install -g @naap/plugin-sdk

      - name: Publish to registry
        env:
          NAAP_REGISTRY_TOKEN: \${{ secrets.NAAP_REGISTRY_TOKEN }}
          NAAP_REGISTRY_URL: \${{ env.REGISTRY_URL }}
        run: |
          naap-plugin publish \\
            --from-github \\
            --release-notes "\${{ github.event.release.body }}"
`;
  }

  // Full-stack workflow
  return baseWorkflow + `jobs:
  build:
    name: Build & Test
    runs-on: ubuntu-latest
    outputs:
      version: \${{ steps.version.outputs.version }}
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: \${{ env.NODE_VERSION }}
          cache: 'npm'

      - name: Get version
        id: version
        run: |
          if [ "\${{ github.event_name }}" = "release" ]; then
            VERSION="\${{ github.event.release.tag_name }}"
            VERSION="\${VERSION#v}"
          else
            VERSION="\${{ github.event.inputs.version }}"
          fi
          echo "version=$VERSION" >> $GITHUB_OUTPUT

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        if: \${{ github.event.inputs.skip_tests != 'true' }}
        run: npm test --if-present

      - name: Build frontend
        run: |
          cd frontend
          npm ci
          npm run build

      - name: Upload frontend artifacts
        uses: actions/upload-artifact@v4
        with:
          name: frontend-bundle
          path: frontend/dist/
          retention-days: 1

  docker:
    name: Build Docker Image
    needs: build
    runs-on: ubuntu-latest
    outputs:
      image: \${{ steps.meta.outputs.tags }}
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}

      - name: Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/\${{ github.repository }}-backend
          tags: |
            type=semver,pattern={{version}},value=\${{ needs.build.outputs.version }}
            type=raw,value=latest,enable=\${{ !contains(needs.build.outputs.version, '-') }}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: backend
          push: true
          tags: \${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  publish:
    name: Publish to Registry
    needs: [build, docker]
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Download frontend artifacts
        uses: actions/download-artifact@v4
        with:
          name: frontend-bundle
          path: frontend/dist/

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: \${{ env.NODE_VERSION }}

      - name: Install NAAP CLI
        run: npm install -g @naap/plugin-sdk

      - name: Publish to registry
        env:
          NAAP_REGISTRY_TOKEN: \${{ secrets.NAAP_REGISTRY_TOKEN }}
          NAAP_REGISTRY_URL: \${{ env.REGISTRY_URL }}
        run: |
          naap-plugin publish \\
            --from-github \\
            --backend-image "\${{ needs.docker.outputs.image }}" \\
            --release-notes "\${{ github.event.release.body }}"
`;
}
