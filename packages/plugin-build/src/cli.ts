#!/usr/bin/env node

/**
 * Plugin Build CLI
 *
 * Command-line interface for building NAAP plugins.
 */

import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { buildPlugin, buildAllPlugins } from './build.js';
import { validatePluginBundle } from './validate.js';
import { loadPluginConfig, type PluginBuildConfig } from './config.js';
import { collectManifests, generateCombinedManifest } from './manifest.js';

program
  .name('naap-plugin-build')
  .description('Build NAAP plugins as UMD bundles for CDN deployment')
  .version('0.1.0');

/**
 * Build a single plugin
 */
program
  .command('build')
  .description('Build a plugin')
  .argument('[path]', 'Path to plugin directory', '.')
  .option('-w, --watch', 'Watch for changes', false)
  .option('--no-minify', 'Disable minification')
  .option('--no-sourcemap', 'Disable source maps')
  .option('--no-validate', 'Skip output validation')
  .action(async (path, options) => {
    const pluginDir = resolve(process.cwd(), path);
    const spinner = ora('Loading plugin configuration...').start();

    try {
      // Check if this is a plugin directory or frontend directory
      const frontendDir = existsSync(join(pluginDir, 'frontend'))
        ? join(pluginDir, 'frontend')
        : pluginDir;

      // Load config from plugin.json in parent directory if exists
      const configDir = existsSync(join(pluginDir, 'plugin.json'))
        ? pluginDir
        : existsSync(join(pluginDir, '..', 'plugin.json'))
        ? join(pluginDir, '..')
        : pluginDir;

      const config = await loadPluginConfig(configDir);

      // Apply CLI options
      const buildConfig: PluginBuildConfig = {
        ...config,
        minify: options.minify,
        sourcemap: options.sourcemap,
        validateOutput: options.validate,
      };

      spinner.text = `Building ${chalk.cyan(config.name)}...`;

      const result = await buildPlugin(buildConfig, frontendDir);

      spinner.succeed(
        `Built ${chalk.cyan(config.name)} in ${chalk.green(result.duration + 'ms')}`
      );

      console.log(chalk.dim(`  Bundle: ${result.bundlePath}`));
      console.log(
        chalk.dim(`  Size: ${(result.manifest.bundleSize / 1024).toFixed(1)} KB`)
      );

      if (result.stylesPath) {
        console.log(chalk.dim(`  Styles: ${result.stylesPath}`));
      }

      if (result.warnings.length > 0) {
        console.log(chalk.yellow('\nWarnings:'));
        result.warnings.forEach((w) => console.log(chalk.yellow(`  - ${w}`)));
      }
    } catch (error) {
      spinner.fail(chalk.red('Build failed'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

/**
 * Build all plugins
 */
program
  .command('build-all')
  .description('Build all plugins in a directory')
  .argument('[path]', 'Path to plugins directory', 'plugins')
  .option('-p, --parallel', 'Build plugins in parallel', false)
  .option('-f, --filter <plugins>', 'Comma-separated list of plugins to build')
  .action(async (path, options) => {
    const pluginsDir = resolve(process.cwd(), path);
    const spinner = ora('Building all plugins...').start();

    try {
      const filter = options.filter ? options.filter.split(',') : undefined;

      const results = await buildAllPlugins(pluginsDir, {
        parallel: options.parallel,
        filter,
      });

      spinner.stop();

      let successCount = 0;
      let failCount = 0;

      for (const [name, result] of results) {
        if (result instanceof Error) {
          console.log(chalk.red(`✗ ${name}: ${result.message}`));
          failCount++;
        } else {
          console.log(
            chalk.green(`✓ ${name}`) +
              chalk.dim(
                ` (${result.duration}ms, ${(result.manifest.bundleSize / 1024).toFixed(1)} KB)`
              )
          );
          successCount++;
        }
      }

      console.log('');
      console.log(
        `Built ${chalk.green(successCount)} plugins` +
          (failCount > 0 ? `, ${chalk.red(failCount)} failed` : '')
      );

      if (failCount > 0) {
        process.exit(1);
      }
    } catch (error) {
      spinner.fail(chalk.red('Build failed'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

/**
 * Validate a plugin bundle
 */
program
  .command('validate')
  .description('Validate a built plugin bundle')
  .argument('<path>', 'Path to bundle file or plugin directory')
  .action(async (path) => {
    const spinner = ora('Validating bundle...').start();

    try {
      const resolvedPath = resolve(process.cwd(), path);
      let bundlePath: string;
      let manifestPath: string | undefined;

      // Check if path is a bundle or a directory
      if (resolvedPath.endsWith('.js')) {
        bundlePath = resolvedPath;
      } else {
        // Find bundle in production directory
        const productionDir = join(resolvedPath, 'dist', 'production');
        const { readdir } = await import('fs/promises');
        const files = await readdir(productionDir);
        const bundleFile = files.find((f) => f.endsWith('.js') && !f.endsWith('.map'));
        if (!bundleFile) {
          throw new Error('No bundle found in production directory');
        }
        bundlePath = join(productionDir, bundleFile);
        manifestPath = join(productionDir, 'manifest.json');
      }

      const result = await validatePluginBundle(bundlePath, manifestPath);

      spinner.stop();

      if (result.valid) {
        console.log(chalk.green('✓ Bundle is valid'));
      } else {
        console.log(chalk.red('✗ Bundle validation failed'));
      }

      if (result.errors.length > 0) {
        console.log(chalk.red('\nErrors:'));
        result.errors.forEach((e) => console.log(chalk.red(`  - ${e}`)));
      }

      if (result.warnings.length > 0) {
        console.log(chalk.yellow('\nWarnings:'));
        result.warnings.forEach((w) => console.log(chalk.yellow(`  - ${w}`)));
      }

      if (result.analysis) {
        console.log(chalk.dim('\nAnalysis:'));
        console.log(chalk.dim(`  Size: ${(result.analysis.bundleSize / 1024).toFixed(1)} KB`));
        console.log(chalk.dim(`  Minified: ${result.analysis.isMinified ? 'Yes' : 'No'}`));
        console.log(chalk.dim(`  Strict Mode: ${result.analysis.usesStrictMode ? 'Yes' : 'No'}`));
        console.log(chalk.dim(`  Exports: ${result.analysis.exports.join(', ')}`));
        console.log(chalk.dim(`  Externals: ${result.analysis.externals.join(', ')}`));
      }

      if (!result.valid) {
        process.exit(1);
      }
    } catch (error) {
      spinner.fail(chalk.red('Validation failed'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

/**
 * List all plugin manifests
 */
program
  .command('list')
  .description('List all built plugins')
  .argument('[path]', 'Path to plugins directory', 'plugins')
  .option('--json', 'Output as JSON')
  .action(async (path, options) => {
    const pluginsDir = resolve(process.cwd(), path);

    try {
      const manifests = await collectManifests(pluginsDir);

      if (options.json) {
        const output: Record<string, any> = {};
        for (const [name, manifest] of manifests) {
          output[name] = manifest;
        }
        console.log(JSON.stringify(output, null, 2));
      } else {
        console.log(chalk.bold(`\nBuilt plugins in ${path}:\n`));

        for (const [name, manifest] of manifests) {
          console.log(
            `${chalk.cyan(name)} ${chalk.dim('v' + manifest.version)}` +
              chalk.dim(` (${(manifest.bundleSize / 1024).toFixed(1)} KB)`)
          );
        }

        console.log(chalk.dim(`\n${manifests.size} plugins found`));
      }
    } catch (error) {
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

/**
 * Generate combined manifest
 */
program
  .command('manifest')
  .description('Generate combined manifest for all plugins')
  .argument('[path]', 'Path to plugins directory', 'plugins')
  .option('-u, --cdn-url <url>', 'CDN base URL', 'https://cdn.naap.io/plugins')
  .option('-o, --output <file>', 'Output file', 'plugins-manifest.json')
  .action(async (path, options) => {
    const pluginsDir = resolve(process.cwd(), path);
    const spinner = ora('Generating combined manifest...').start();

    try {
      const combined = await generateCombinedManifest(pluginsDir, options.cdnUrl);

      const { writeFile } = await import('fs/promises');
      await writeFile(options.output, JSON.stringify(combined, null, 2));

      spinner.succeed(`Generated manifest: ${options.output}`);
      console.log(chalk.dim(`  ${Object.keys(combined).length} plugins`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to generate manifest'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

program.parse();
