/**
 * dev command
 * Start development servers with hot reload
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs-extra';
import type { PluginManifest } from '../../src/types/manifest.js';

export const devCommand = new Command('dev')
  .description('Start development servers with hot reload')
  .option('-s, --shell <url>', 'Shell URL to connect to', 'http://localhost:3000')
  .option('--with-shell', 'Also start the NAAP shell and base services (single-command dev)')
  .option('--frontend-only', 'Only start frontend server')
  .option('--backend-only', 'Only start backend server')
  .option('-p, --port <port>', 'Frontend dev port')
  .option('-b, --backend-port <port>', 'Backend dev port')
  .option('-o, --open', 'Auto-open browser with plugin loaded', true)
  .option('--no-open', 'Do not auto-open browser')
  .action(async (options: {
    shell: string;
    withShell?: boolean;
    frontendOnly?: boolean;
    backendOnly?: boolean;
    port?: string;
    backendPort?: string;
    open?: boolean;
  }) => {
    const cwd = process.cwd();
    const manifestPath = path.join(cwd, 'plugin.json');

    // Check for plugin.json
    if (!await fs.pathExists(manifestPath)) {
      console.error(chalk.red('Error: plugin.json not found. Are you in a plugin directory?'));
      process.exit(1);
    }

    const manifest: PluginManifest = await fs.readJson(manifestPath);
    console.log(chalk.bold.blue(`\n🔧 Starting ${manifest.displayName} in dev mode\n`));

    // Read local config
    const configPath = path.join(cwd, '.naap', 'config.json');
    const config = await fs.pathExists(configPath) 
      ? await fs.readJson(configPath)
      : {};
    
    const shellUrl = options.shell || config.devShell || 'http://localhost:3000';

    const processes: { name: string; process: ReturnType<typeof import('execa')['execa']> }[] = [];

    try {
      const { execa } = await import('execa');

      // Phase 1: Start NAAP shell with --with-shell option
      // This provides a single-command dev experience
      if (options.withShell) {
        const shellSpinner = ora('Starting NAAP shell and services...').start();
        
        // Try to find the workspace root (where bin/start.sh is)
        let workspaceRoot = cwd;
        for (let i = 0; i < 5; i++) {
          const startScript = path.join(workspaceRoot, 'bin', 'start.sh');
          if (await fs.pathExists(startScript)) {
            break;
          }
          workspaceRoot = path.dirname(workspaceRoot);
        }
        
        const startScript = path.join(workspaceRoot, 'bin', 'start.sh');
        if (!await fs.pathExists(startScript)) {
          shellSpinner.fail('Could not find bin/start.sh. Are you in the NAAP workspace?');
          console.log(chalk.yellow('ℹ Tip: Use --with-shell only when developing inside the NAAP monorepo'));
          console.log(chalk.yellow('       Or start the shell manually: ./bin/start.sh --shell'));
        } else {
          // Start the shell with --shell-with-backends flag
          const shellProcess = execa('bash', [startScript, '--shell-with-backends'], {
            cwd: workspaceRoot,
            env: { ...process.env },
            stdio: 'pipe',
          });

          processes.push({ name: 'shell', process: shellProcess });

          shellProcess.stdout?.on('data', (data) => {
            const line = data.toString().trim();
            if ((line.includes('Shell') || line.includes('Next.js')) && line.includes('running')) {
              shellSpinner.succeed(`Shell: http://localhost:3000`);
            }
            // Log important output
            if (line.includes('[OK]') || line.includes('[ERROR]')) {
              console.log(chalk.gray(`[shell] ${line}`));
            }
          });

          shellProcess.stderr?.on('data', (data) => {
            const line = data.toString().trim();
            if (line && !line.includes('npm warn')) {
              console.log(chalk.yellow(`[shell] ${line}`));
            }
          });

          // Wait for shell to start before continuing
          await new Promise(resolve => setTimeout(resolve, 5000));
          console.log(chalk.green('✓ Shell services starting...'));
        }
      }

      // Start frontend dev server
      if (manifest.frontend && !options.backendOnly) {
        const frontendPort = options.port || manifest.frontend.devPort || 3010;
        const frontendSpinner = ora('Starting frontend server...').start();
        
        const frontendDir = path.join(cwd, 'frontend');
        if (!await fs.pathExists(frontendDir)) {
          frontendSpinner.fail('Frontend directory not found');
        } else {
          const frontendProcess = execa('npm', ['run', 'dev'], {
            cwd: frontendDir,
            env: { ...process.env, PORT: String(frontendPort) },
            stdio: 'pipe',
          });

          processes.push({ name: 'frontend', process: frontendProcess });

          frontendProcess.stdout?.on('data', (data) => {
            const line = data.toString().trim();
            if (line.includes('Local:') || line.includes('ready')) {
              frontendSpinner.succeed(`Frontend: http://localhost:${frontendPort}`);
            }
          });

          frontendProcess.stderr?.on('data', (data) => {
            const line = data.toString().trim();
            if (line && !line.includes('warning')) {
              console.log(chalk.yellow(`[frontend] ${line}`));
            }
          });
        }
      }

      // Start backend dev server
      if (manifest.backend && !options.frontendOnly) {
        const backendPort = options.backendPort || manifest.backend.devPort || 4010;
        const backendSpinner = ora('Starting backend server...').start();
        
        const backendDir = path.join(cwd, 'backend');
        if (!await fs.pathExists(backendDir)) {
          backendSpinner.fail('Backend directory not found');
        } else {
          // Check for .env file
          const envFile = path.join(backendDir, '.env');
          if (!await fs.pathExists(envFile)) {
            const envExample = path.join(backendDir, '.env.example');
            if (await fs.pathExists(envExample)) {
              await fs.copy(envExample, envFile);
              console.log(chalk.yellow('Created .env from .env.example'));
            }
          }

          const backendProcess = execa('npm', ['run', 'dev'], {
            cwd: backendDir,
            env: { ...process.env, PORT: String(backendPort) },
            stdio: 'pipe',
          });

          processes.push({ name: 'backend', process: backendProcess });

          backendProcess.stdout?.on('data', (data) => {
            const line = data.toString().trim();
            if (line.includes('running') || line.includes('listening')) {
              backendSpinner.succeed(`Backend: http://localhost:${backendPort}`);
            }
            if (line) {
              console.log(chalk.gray(`[backend] ${line}`));
            }
          });

          backendProcess.stderr?.on('data', (data) => {
            const line = data.toString().trim();
            if (line) {
              console.log(chalk.yellow(`[backend] ${line}`));
            }
          });
        }
      }

      // Check unified database is running (all plugins share one DB)
      if (manifest.database && !options.frontendOnly) {
        const dbSpinner = ora('Checking unified database...').start();
        try {
          const result = await execa('docker', ['ps', '-q', '-f', 'name=naap-db'], { 
            reject: false 
          });
          
          if (!result.stdout) {
            dbSpinner.text = 'Starting unified database via docker-compose...';
            await execa('docker-compose', ['up', '-d', 'database'], { reject: false });
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
          
          dbSpinner.succeed('Database: postgresql://postgres:postgres@localhost:5432/naap');
        } catch {
          dbSpinner.warn('Unified database not running - run: docker-compose up -d database');
        }
      }

      // Phase 0: Auto-register dev plugin via URL parameter
      // This eliminates the need for manual localStorage manipulation
      const frontendPort = options.port || manifest.frontend?.devPort || 3010;
      const routes = manifest.frontend?.routes || [`/${manifest.name}`];
      const devPluginUrl = `http://localhost:${frontendPort}/`;
      
      // Construct the full URL with dev-plugin parameter
      // The shell will automatically load the plugin from this URL
      const devUrl = `${shellUrl}/#${routes[0]}?dev-plugin=${encodeURIComponent(devPluginUrl)}`;
      
      console.log(chalk.cyan(`\n📦 Plugin will auto-register via URL parameter`));
      console.log(chalk.green(`\n✓ Routes: ${routes.join(', ')}`));
      console.log(chalk.bold(`\n🔗 Dev URL: ${devUrl}\n`));
      
      // Auto-open browser if --open flag is set (default: true)
      if (options.open !== false) {
        console.log(chalk.cyan('🌐 Opening browser...'));
        
        // Wait a moment for servers to start
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Open browser with the dev URL
        const openBrowser = async () => {
          const platform = process.platform;
          const { execa: exec } = await import('execa');
          
          try {
            if (platform === 'darwin') {
              await exec('open', [devUrl]);
            } else if (platform === 'win32') {
              await exec('cmd', ['/c', 'start', devUrl]);
            } else {
              await exec('xdg-open', [devUrl]);
            }
            console.log(chalk.green('✓ Browser opened with plugin auto-registered'));
          } catch (error) {
            console.log(chalk.yellow(`ℹ Could not auto-open browser. Open manually:`));
            console.log(chalk.cyan(`  ${devUrl}`));
          }
        };
        
        openBrowser();
      } else {
        console.log(chalk.yellow('ℹ To load your plugin, open:'));
        console.log(chalk.cyan(`  ${devUrl}`));
      }
      
      // Also try the API method as fallback
      console.log(chalk.cyan(`\nConnecting to shell at ${shellUrl}...`));
      
      try {
        const devPlugin = {
          name: manifest.name,
          displayName: manifest.displayName,
          devUrl: devPluginUrl,
          backendUrl: manifest.backend 
            ? `http://localhost:${manifest.backend.devPort || 4010}`
            : undefined,
          routes: routes,
          icon: manifest.frontend?.navigation?.icon,
        };

        // Try to register with shell API (optional, URL param is primary)
        const response = await fetch(`${shellUrl.replace('/#/', '/')}/api/dev-plugins`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(devPlugin),
        }).catch(() => null);

        if (response?.ok) {
          console.log(chalk.green('✓ Plugin also registered via API'));
        }
      } catch {
        // URL param method is primary, API is just a fallback
      }
      
      console.log(chalk.gray('\nWatching for changes...\n'));
      console.log(chalk.dim('━'.repeat(50)));
      console.log(chalk.dim('  Tip: Changes will hot-reload automatically'));
      console.log(chalk.dim('  Tip: Use --no-open to skip browser launch'));
      if (!options.withShell) {
        console.log(chalk.dim('  Tip: Use --with-shell to start shell + plugin in one command'));
      }
      console.log(chalk.dim('━'.repeat(50)) + '\n');

      // Handle shutdown
      const cleanup = () => {
        console.log(chalk.yellow('\nShutting down...'));
        processes.forEach(({ name, process }) => {
          console.log(chalk.gray(`Stopping ${name}...`));
          process.kill();
        });
        process.exit(0);
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      // Keep alive
      await Promise.all(processes.map(p => p.process));

    } catch (error) {
      console.error(chalk.red('Failed to start dev servers:'), error);
      processes.forEach(p => p.process.kill());
      process.exit(1);
    }
  });
