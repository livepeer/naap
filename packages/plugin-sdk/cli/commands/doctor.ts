/**
 * doctor command
 * 
 * Diagnoses common plugin development issues and provides actionable suggestions.
 * 
 * Phase 3: Improves DevX by helping developers identify and fix common problems.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs-extra';
import type { PluginManifest } from '../../src/types/manifest.js';

interface DiagnosticResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  suggestion?: string;
}

export const doctorCommand = new Command('doctor')
  .description('Diagnose common plugin development issues')
  .option('-v, --verbose', 'Show detailed diagnostic output')
  .option('--fix', 'Attempt to fix issues automatically')
  .action(async (options: { verbose?: boolean; fix?: boolean }) => {
    console.log(chalk.bold.blue('\n🔍 NAAP Plugin Doctor\n'));
    console.log(chalk.dim('Diagnosing your plugin development environment...\n'));

    const results: DiagnosticResult[] = [];
    const cwd = process.cwd();

    // ============================================
    // Check 1: Node.js version
    // ============================================
    const nodeSpinner = ora('Checking Node.js version...').start();
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
    
    if (majorVersion >= 18) {
      nodeSpinner.succeed(`Node.js version: ${nodeVersion}`);
      results.push({ name: 'Node.js version', status: 'pass', message: nodeVersion });
    } else if (majorVersion >= 16) {
      nodeSpinner.warn(`Node.js version: ${nodeVersion} (recommended: 18+)`);
      results.push({
        name: 'Node.js version',
        status: 'warn',
        message: `${nodeVersion} (recommended: 18+)`,
        suggestion: 'Consider upgrading to Node.js 18 LTS for best compatibility',
      });
    } else {
      nodeSpinner.fail(`Node.js version: ${nodeVersion} (required: 18+)`);
      results.push({
        name: 'Node.js version',
        status: 'fail',
        message: `${nodeVersion} (required: 18+)`,
        suggestion: 'Please upgrade to Node.js 18 LTS: https://nodejs.org/',
      });
    }

    // ============================================
    // Check 2: npm/pnpm version
    // ============================================
    const pkgMgrSpinner = ora('Checking package manager...').start();
    try {
      const { execa } = await import('execa');
      
      // Try pnpm first
      let pkgManager = 'npm';
      let pkgVersion = '';
      
      try {
        const pnpmResult = await execa('pnpm', ['--version']);
        pkgManager = 'pnpm';
        pkgVersion = pnpmResult.stdout.trim();
      } catch {
        const npmResult = await execa('npm', ['--version']);
        pkgVersion = npmResult.stdout.trim();
      }
      
      pkgMgrSpinner.succeed(`Package manager: ${pkgManager} ${pkgVersion}`);
      results.push({ name: 'Package manager', status: 'pass', message: `${pkgManager} ${pkgVersion}` });
    } catch (error) {
      pkgMgrSpinner.fail('Could not detect package manager');
      results.push({
        name: 'Package manager',
        status: 'fail',
        message: 'Not detected',
        suggestion: 'Install npm or pnpm: npm install -g pnpm',
      });
    }

    // ============================================
    // Check 3: plugin.json exists and is valid
    // ============================================
    const manifestSpinner = ora('Checking plugin.json...').start();
    const manifestPath = path.join(cwd, 'plugin.json');
    
    if (await fs.pathExists(manifestPath)) {
      try {
        const manifest: PluginManifest = await fs.readJson(manifestPath);
        
        const issues: string[] = [];
        
        // Validate required fields
        if (!manifest.name || manifest.name.length < 3) {
          issues.push('name must be at least 3 characters');
        }
        if (!manifest.displayName) {
          issues.push('displayName is required');
        }
        if (!manifest.version || !/^\d+\.\d+\.\d+/.test(manifest.version)) {
          issues.push('version must be valid semver (e.g., 1.0.0)');
        }
        if (!manifest.frontend && !manifest.backend) {
          issues.push('either frontend or backend must be defined');
        }
        if (manifest.frontend && (!manifest.frontend.routes || manifest.frontend.routes.length === 0)) {
          issues.push('frontend.routes must have at least one route');
        }
        
        if (issues.length === 0) {
          manifestSpinner.succeed(`plugin.json valid: ${manifest.name}@${manifest.version}`);
          results.push({ name: 'plugin.json', status: 'pass', message: `${manifest.name}@${manifest.version}` });
        } else {
          manifestSpinner.warn(`plugin.json has issues: ${issues.join(', ')}`);
          results.push({
            name: 'plugin.json',
            status: 'warn',
            message: issues.join(', '),
            suggestion: 'See plugin manifest documentation for required fields',
          });
        }
      } catch (error) {
        manifestSpinner.fail('plugin.json is invalid JSON');
        results.push({
          name: 'plugin.json',
          status: 'fail',
          message: 'Invalid JSON format',
          suggestion: 'Check for syntax errors in plugin.json',
        });
      }
    } else {
      manifestSpinner.warn('plugin.json not found (are you in a plugin directory?)');
      results.push({
        name: 'plugin.json',
        status: 'warn',
        message: 'Not found',
        suggestion: 'Run naap-plugin create <name> to create a new plugin',
      });
    }

    // ============================================
    // Check 4: Port availability
    // ============================================
    const portsSpinner = ora('Checking port availability...').start();
    const portsToCheck = [3000, 3010, 4000, 4008, 4009, 4010];
    const busyPorts: number[] = [];
    
    for (const port of portsToCheck) {
      const busy = await isPortBusy(port);
      if (busy) {
        busyPorts.push(port);
      }
    }
    
    if (busyPorts.length === 0) {
      portsSpinner.succeed('All common ports available');
      results.push({ name: 'Port availability', status: 'pass', message: 'All ports available' });
    } else {
      portsSpinner.warn(`Busy ports: ${busyPorts.join(', ')}`);
      results.push({
        name: 'Port availability',
        status: 'warn',
        message: `Busy: ${busyPorts.join(', ')}`,
        suggestion: 'Some ports in use - use --port flag or stop conflicting processes',
      });
    }

    // ============================================
    // Check 5: Docker (optional)
    // ============================================
    const dockerSpinner = ora('Checking Docker...').start();
    try {
      const { execa } = await import('execa');
      const result = await execa('docker', ['--version'], { reject: false });
      
      if (result.exitCode === 0) {
        const version = result.stdout.split(' ')[2]?.replace(',', '') || 'unknown';
        dockerSpinner.succeed(`Docker: ${version}`);
        results.push({ name: 'Docker', status: 'pass', message: version });
      } else {
        dockerSpinner.warn('Docker not running');
        results.push({
          name: 'Docker',
          status: 'warn',
          message: 'Not running',
          suggestion: 'Start Docker for database plugins',
        });
      }
    } catch {
      dockerSpinner.warn('Docker not installed (optional)');
      results.push({
        name: 'Docker',
        status: 'warn',
        message: 'Not installed',
        suggestion: 'Install Docker for database plugins: https://docker.com',
      });
    }

    // ============================================
    // Check 6: Dependencies installed
    // ============================================
    const depsSpinner = ora('Checking dependencies...').start();
    const nodeModulesPath = path.join(cwd, 'node_modules');
    const frontendModulesPath = path.join(cwd, 'frontend', 'node_modules');
    const backendModulesPath = path.join(cwd, 'backend', 'node_modules');
    
    const missingDeps: string[] = [];
    
    if (await fs.pathExists(manifestPath)) {
      const manifest: PluginManifest = await fs.readJson(manifestPath);
      
      if (manifest.frontend && !await fs.pathExists(frontendModulesPath)) {
        missingDeps.push('frontend/node_modules');
      }
      if (manifest.backend && !await fs.pathExists(backendModulesPath)) {
        missingDeps.push('backend/node_modules');
      }
    }
    
    if (missingDeps.length === 0) {
      depsSpinner.succeed('Dependencies installed');
      results.push({ name: 'Dependencies', status: 'pass', message: 'Installed' });
    } else {
      depsSpinner.warn(`Missing: ${missingDeps.join(', ')}`);
      results.push({
        name: 'Dependencies',
        status: 'warn',
        message: `Missing: ${missingDeps.join(', ')}`,
        suggestion: 'Run npm install in the respective directories',
      });
      
      // Auto-fix if requested
      if (options.fix) {
        console.log(chalk.cyan('\nAttempting to install dependencies...'));
        const { execa } = await import('execa');
        
        for (const missing of missingDeps) {
          const dir = path.join(cwd, missing.replace('/node_modules', ''));
          try {
            await execa('npm', ['install'], { cwd: dir, stdio: 'inherit' });
            console.log(chalk.green(`✓ Installed dependencies in ${missing.replace('/node_modules', '')}`));
          } catch (error) {
            console.log(chalk.red(`✗ Failed to install in ${missing}`));
          }
        }
      }
    }

    // ============================================
    // Check 7: SDK version
    // ============================================
    const sdkSpinner = ora('Checking SDK version...').start();
    try {
      const sdkPkgPath = path.join(cwd, 'frontend', 'node_modules', '@naap', 'plugin-sdk', 'package.json');
      if (await fs.pathExists(sdkPkgPath)) {
        const sdkPkg = await fs.readJson(sdkPkgPath);
        sdkSpinner.succeed(`@naap/plugin-sdk: ${sdkPkg.version}`);
        results.push({ name: 'SDK version', status: 'pass', message: sdkPkg.version });
      } else {
        sdkSpinner.warn('@naap/plugin-sdk not found');
        results.push({
          name: 'SDK version',
          status: 'warn',
          message: 'Not found',
          suggestion: 'Run: cd frontend && npm install @naap/plugin-sdk',
        });
      }
    } catch {
      sdkSpinner.warn('Could not check SDK version');
      results.push({ name: 'SDK version', status: 'warn', message: 'Unknown' });
    }

    // ============================================
    // Check 8: TypeScript configuration
    // ============================================
    const tsSpinner = ora('Checking TypeScript...').start();
    const frontendTsConfig = path.join(cwd, 'frontend', 'tsconfig.json');
    
    if (await fs.pathExists(frontendTsConfig)) {
      try {
        const tsConfig = await fs.readJson(frontendTsConfig);
        const issues: string[] = [];
        
        if (!tsConfig.compilerOptions?.strict) {
          issues.push('strict mode disabled');
        }
        if (tsConfig.compilerOptions?.moduleResolution !== 'bundler' && 
            tsConfig.compilerOptions?.moduleResolution !== 'node16') {
          // This is just informational, not an error
        }
        
        if (issues.length === 0) {
          tsSpinner.succeed('TypeScript configured correctly');
          results.push({ name: 'TypeScript', status: 'pass', message: 'Configured' });
        } else {
          tsSpinner.warn(`TypeScript: ${issues.join(', ')}`);
          results.push({
            name: 'TypeScript',
            status: 'warn',
            message: issues.join(', '),
            suggestion: 'Consider enabling strict mode for better type safety',
          });
        }
      } catch {
        tsSpinner.warn('Could not parse tsconfig.json');
        results.push({ name: 'TypeScript', status: 'warn', message: 'Parse error' });
      }
    } else {
      tsSpinner.warn('tsconfig.json not found in frontend/');
      results.push({
        name: 'TypeScript',
        status: 'warn',
        message: 'Not found',
        suggestion: 'Add tsconfig.json to frontend/',
      });
    }

    // ============================================
    // Check 9: Shell compatibility (Phase 6d)
    // ============================================
    const shellSpinner = ora('Checking shell compatibility...').start();
    try {
      // Look for web-next in workspace (shell-web was retired in Phase 0)
      const webNextPkg = path.resolve(cwd, '..', '..', 'apps', 'web-next', 'package.json');

      let shellVersion = 'unknown';
      let shellType = 'not found';

      if (await fs.pathExists(webNextPkg)) {
        const pkg = await fs.readJson(webNextPkg);
        shellVersion = pkg.version || 'unknown';
        shellType = 'web-next (Next.js)';
      }

      if (shellType !== 'not found') {
        // Check SDK compatibility with shell
        const sdkManifest = await (async () => {
          try {
            const sdkPkgPath = path.join(cwd, 'frontend', 'node_modules', '@naap', 'plugin-sdk', 'package.json');
            if (await fs.pathExists(sdkPkgPath)) {
              return await fs.readJson(sdkPkgPath);
            }
          } catch { /* skip */ }
          return null;
        })();

        const sdkVersion = sdkManifest?.version || 'unknown';
        shellSpinner.succeed(`Shell: ${shellType} v${shellVersion} (SDK: ${sdkVersion})`);
        results.push({ name: 'Shell compatibility', status: 'pass', message: `${shellType} v${shellVersion}` });
      } else {
        shellSpinner.warn('Shell not found in workspace');
        results.push({
          name: 'Shell compatibility',
          status: 'warn',
          message: 'Shell not found',
          suggestion: 'Ensure you are developing within the NaaP monorepo, or set SHELL_URL env var',
        });
      }
    } catch {
      shellSpinner.warn('Could not check shell compatibility');
      results.push({ name: 'Shell compatibility', status: 'warn', message: 'Check failed' });
    }

    // ============================================
    // Check 10: Backend connectivity (Phase 6d)
    // ============================================
    const connectSpinner = ora('Checking backend connectivity...').start();
    const services = [
      { name: 'base-svc', port: 4000, path: '/healthz' },
      { name: 'plugin-server', port: 4008, path: '/healthz' },
    ];

    // Read manifest for backend port if present
    if (await fs.pathExists(manifestPath)) {
      try {
        const manifest: PluginManifest = await fs.readJson(manifestPath);
        if (manifest.backend?.port) {
          services.push({ name: `${manifest.name}-backend`, port: manifest.backend.port, path: '/healthz' });
        }
      } catch { /* ignore */ }
    }

    const unreachable: string[] = [];
    const reachable: string[] = [];

    for (const svc of services) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`http://localhost:${svc.port}${svc.path}`, {
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          reachable.push(`${svc.name}(:${svc.port})`);
        } else {
          unreachable.push(`${svc.name}(:${svc.port})`);
        }
      } catch {
        unreachable.push(`${svc.name}(:${svc.port})`);
      }
    }

    if (unreachable.length === 0) {
      connectSpinner.succeed(`Backend services reachable: ${reachable.join(', ')}`);
      results.push({ name: 'Backend connectivity', status: 'pass', message: reachable.join(', ') });
    } else if (reachable.length > 0) {
      connectSpinner.warn(`Some services unreachable: ${unreachable.join(', ')}`);
      results.push({
        name: 'Backend connectivity',
        status: 'warn',
        message: `Reachable: ${reachable.join(', ')}; Unreachable: ${unreachable.join(', ')}`,
        suggestion: 'Start backend services with: bin/start.sh or pnpm dev',
      });
    } else {
      connectSpinner.warn('No backend services reachable');
      results.push({
        name: 'Backend connectivity',
        status: 'warn',
        message: 'None reachable',
        suggestion: 'Start the platform with: bin/start.sh',
      });
    }

    // ============================================
    // Check 11: Capabilities detection (Phase 6d)
    // ============================================
    const capsSpinner = ora('Checking available capabilities...').start();
    const capabilities: string[] = [];

    // Check for web3 dependencies
    const web3PkgPath = path.join(cwd, 'frontend', 'node_modules', '@naap', 'web3', 'package.json');
    if (await fs.pathExists(web3PkgPath)) {
      capabilities.push('web3');
    }

    // Check for livepeer dependencies
    const livepeerPkgPath = path.join(cwd, 'frontend', 'node_modules', '@naap', 'livepeer-contracts', 'package.json');
    if (await fs.pathExists(livepeerPkgPath)) {
      capabilities.push('livepeer');
    }

    // Check for pipeline SDK
    const pipelinePkgPath = path.join(cwd, 'frontend', 'node_modules', '@naap', 'livepeer-pipeline', 'package.json');
    if (await fs.pathExists(pipelinePkgPath)) {
      capabilities.push('pipelines');
    }

    if (capabilities.length > 0) {
      capsSpinner.succeed(`Capabilities available: ${capabilities.join(', ')}`);
    } else {
      capsSpinner.info('No optional capabilities detected (web3, livepeer, pipelines)');
    }
    results.push({ name: 'Capabilities', status: 'pass', message: capabilities.join(', ') || 'standard' });

    // ============================================
    // Summary
    // ============================================
    console.log(chalk.bold('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold.blue('\n📋 Diagnostic Summary\n'));

    const passed = results.filter(r => r.status === 'pass').length;
    const warned = results.filter(r => r.status === 'warn').length;
    const failed = results.filter(r => r.status === 'fail').length;

    console.log(`  ${chalk.green('✓')} Passed: ${passed}`);
    console.log(`  ${chalk.yellow('!')} Warnings: ${warned}`);
    console.log(`  ${chalk.red('✗')} Failed: ${failed}`);

    // Show suggestions for issues
    const issues = results.filter(r => r.suggestion);
    if (issues.length > 0) {
      console.log(chalk.bold.yellow('\n💡 Suggestions:\n'));
      issues.forEach((issue, index) => {
        console.log(`  ${index + 1}. ${chalk.white(issue.name)}`);
        console.log(`     ${chalk.dim(issue.suggestion)}\n`);
      });
    }

    // Overall status
    if (failed > 0) {
      console.log(chalk.red('\n❌ Some critical issues found. Please fix them before continuing.\n'));
      process.exit(1);
    } else if (warned > 0) {
      console.log(chalk.yellow('\n⚠️ Some warnings found, but you can proceed with development.\n'));
    } else {
      console.log(chalk.green('\n✅ All checks passed! Your environment is ready.\n'));
    }

    // Show next steps
    console.log(chalk.dim('Run naap-plugin dev to start development.\n'));
  });

/**
 * Check if a port is in use
 */
async function isPortBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net');
    const server = net.createServer();
    
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    
    server.listen(port);
  });
}
