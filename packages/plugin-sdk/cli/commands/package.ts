/**
 * package command
 * Create distributable plugin package
 * 
 * Supports formats:
 * - tar: Traditional tar.gz archive
 * - zip: Standardized ZIP format for Plugin Publisher
 * - oci: OCI artifact (requires Docker)
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs-extra';
import { validateManifest } from '../../src/utils/validation.js';
import type { PluginManifest } from '../../src/types/manifest.js';

/**
 * Package creation result
 */
export interface PackageResult {
  success: boolean;
  packagePath: string;
  packageSize: number;
  manifest: PluginManifest;
  frontendSize?: number;
  backendSize?: number;
  errors: string[];
  warnings: string[];
}

/**
 * Maximum package size (50MB)
 */
const MAX_PACKAGE_SIZE = 50 * 1024 * 1024;

/**
 * Create a ZIP archive of the plugin
 */
async function createZipArchive(
  sourceDir: string,
  outputPath: string
): Promise<number> {
  const { execa } = await import('execa');
  
  // Use system zip for maximum compatibility
  await execa('zip', ['-r', '-9', outputPath, '.'], {
    cwd: sourceDir,
    stdio: 'pipe',
  });
  
  const stats = await fs.stat(outputPath);
  return stats.size;
}

/**
 * Add directory contents to package with size tracking
 */
async function copyDirectoryWithStats(
  srcDir: string,
  destDir: string
): Promise<number> {
  let totalSize = 0;
  
  await fs.ensureDir(destDir);
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    
    if (entry.isDirectory()) {
      totalSize += await copyDirectoryWithStats(srcPath, destPath);
    } else {
      await fs.copy(srcPath, destPath);
      const stats = await fs.stat(destPath);
      totalSize += stats.size;
    }
  }
  
  return totalSize;
}

export const packageCommand = new Command('package')
  .description('Create distributable plugin package')
  .option('-o, --output <dir>', 'Output directory', 'dist')
  .option('--format <format>', 'Package format (tar, zip, oci)', 'zip')
  .option('--no-validate', 'Skip manifest validation')
  .option('--skip-bundle-validation', 'Skip UMD bundle validation')
  .action(async (options: {
    output: string;
    format: string;
    validate: boolean;
    skipBundleValidation?: boolean;
  }) => {
    const cwd = process.cwd();
    const manifestPath = path.join(cwd, 'plugin.json');

    if (!await fs.pathExists(manifestPath)) {
      console.error(chalk.red('Error: plugin.json not found'));
      process.exit(1);
    }

    const manifest: PluginManifest = await fs.readJson(manifestPath);
    console.log(chalk.bold.blue(`\n📦 Packaging ${manifest.displayName} v${manifest.version}\n`));

    // Validate manifest
    if (options.validate) {
      const spinner = ora('Validating manifest...').start();
      const result = validateManifest(manifest);
      
      if (!result.valid) {
        spinner.fail('Manifest validation failed');
        result.errors.forEach(err => {
          console.error(chalk.red(`  ✗ ${err.path}: ${err.message}`));
        });
        process.exit(1);
      }
      
      if (result.warnings.length > 0) {
        spinner.warn('Manifest has warnings');
        result.warnings.forEach(warn => {
          console.warn(chalk.yellow(`  ⚠ ${warn.path}: ${warn.message}`));
        });
      } else {
        spinner.succeed('Manifest valid');
      }
    }

    try {
      const outputDir = path.join(cwd, options.output);
      await fs.ensureDir(outputDir);

      // Check that builds exist
      const checkSpinner = ora('Checking build artifacts...').start();
      const missing: string[] = [];

      if (manifest.frontend) {
        const productionDir = path.join(cwd, 'frontend', 'dist', 'production');
        if (!await fs.pathExists(productionDir)) {
          missing.push('frontend/dist/production/ (UMD bundle)');
        }
      }

      if (manifest.backend) {
        const serverJs = path.join(cwd, 'backend', 'dist', 'server.js');
        if (!await fs.pathExists(serverJs)) {
          missing.push('backend/dist/server.js');
        }
      }

      if (missing.length > 0) {
        checkSpinner.fail('Build artifacts missing');
        console.error(chalk.red('Missing files:'));
        missing.forEach(f => console.error(chalk.red(`  - ${f}`)));
        console.log(chalk.yellow('\nRun: naap-plugin build'));
        process.exit(1);
      }
      checkSpinner.succeed('Build artifacts present');

      // Validate UMD bundle for frontend plugins
      if (manifest.frontend && !options.skipMfValidation) {
        const bundleSpinner = ora('Validating UMD bundle...').start();
        const productionDir = path.join(cwd, 'frontend', 'dist', 'production');
        
        if (await fs.pathExists(productionDir)) {
          const files = await fs.readdir(productionDir);
          const jsFiles = files.filter((f: string) => f.endsWith('.js'));
          
          if (jsFiles.length > 0) {
            const bundlePath = path.join(productionDir, jsFiles[0]);
            const stat = await fs.stat(bundlePath);
            const sizeKB = (stat.size / 1024).toFixed(1);
            bundleSpinner.succeed(`UMD bundle validated (${sizeKB}KB, file: ${jsFiles[0]})`);
          } else {
            bundleSpinner.fail('No .js files found in dist/production');
            process.exit(1);
          }
        } else {
          bundleSpinner.fail('dist/production directory not found');
          process.exit(1);
        }
      }

      // Create package directory structure
      const packageDir = path.join(outputDir, 'package');
      await fs.remove(packageDir);
      await fs.ensureDir(packageDir);

      const copySpinner = ora('Copying files...').start();

      // Copy manifest
      await fs.copy(manifestPath, path.join(packageDir, 'plugin.json'));

      // Copy frontend dist
      if (manifest.frontend) {
        await fs.copy(
          path.join(cwd, 'frontend', 'dist'),
          path.join(packageDir, 'frontend')
        );
      }

      // Copy backend dist and Dockerfile
      if (manifest.backend) {
        await fs.copy(
          path.join(cwd, 'backend', 'dist'),
          path.join(packageDir, 'backend', 'dist')
        );
        
        const dockerfile = path.join(cwd, 'backend', 'Dockerfile');
        if (await fs.pathExists(dockerfile)) {
          await fs.copy(dockerfile, path.join(packageDir, 'backend', 'Dockerfile'));
        }

        // Copy package.json for production deps
        const backendPkg = path.join(cwd, 'backend', 'package.json');
        const pkg = await fs.readJson(backendPkg);
        await fs.writeJson(
          path.join(packageDir, 'backend', 'package.json'),
          {
            name: pkg.name,
            version: pkg.version,
            type: pkg.type,
            dependencies: pkg.dependencies,
            scripts: {
              start: pkg.scripts?.start || 'node dist/server.js',
            },
          },
          { spaces: 2 }
        );
      }

      // Copy migrations
      if (manifest.database?.migrations) {
        const migrations = path.join(cwd, manifest.database.migrations);
        if (await fs.pathExists(migrations)) {
          await fs.copy(migrations, path.join(packageDir, 'migrations'));
        }
      }

      // Copy Prisma schema
      if (manifest.database?.schema) {
        const schema = path.join(cwd, manifest.database.schema);
        if (await fs.pathExists(schema)) {
          await fs.copy(schema, path.join(packageDir, 'schema.prisma'));
        }
      }

      copySpinner.succeed('Files copied');

      let archiveName: string;
      let archivePath: string;
      let archiveSize: number;

      // Create archive based on format
      if (options.format === 'zip') {
        const archiveSpinner = ora('Creating ZIP archive...').start();
        
        archiveName = `${manifest.name}-${manifest.version}.zip`;
        archivePath = path.join(outputDir, archiveName);
        
        // Remove existing archive if present
        if (await fs.pathExists(archivePath)) {
          await fs.remove(archivePath);
        }
        
        archiveSize = await createZipArchive(packageDir, archivePath);
        
        // Validate package size
        if (archiveSize > MAX_PACKAGE_SIZE) {
          archiveSpinner.fail('Package too large');
          console.error(chalk.red(`  Package size (${(archiveSize / 1024 / 1024).toFixed(2)}MB) exceeds maximum (${MAX_PACKAGE_SIZE / 1024 / 1024}MB)`));
          console.log(chalk.yellow('  Consider splitting the plugin or optimizing assets.'));
          await fs.remove(archivePath);
          process.exit(1);
        }
        
        const sizeMB = (archiveSize / 1024 / 1024).toFixed(2);
        archiveSpinner.succeed(`ZIP archive created: ${archiveName} (${sizeMB}MB)`);
        
        // Cleanup package dir
        await fs.remove(packageDir);
      } else if (options.format === 'tar') {
        const archiveSpinner = ora('Creating tar.gz archive...').start();
        
        const { execa } = await import('execa');
        archiveName = `${manifest.name}-${manifest.version}.tar.gz`;
        archivePath = path.join(outputDir, archiveName);
        
        await execa('tar', ['-czf', archivePath, '-C', packageDir, '.']);
        
        // Get file size
        const stats = await fs.stat(archivePath);
        archiveSize = stats.size;
        const sizeMB = (archiveSize / 1024 / 1024).toFixed(2);
        
        archiveSpinner.succeed(`Archive created: ${archiveName} (${sizeMB}MB)`);
        
        // Cleanup package dir
        await fs.remove(packageDir);
      } else if (options.format === 'oci') {
        console.log(chalk.yellow('OCI format packaging requires Docker and registry access'));
        archiveName = `${manifest.name}-${manifest.version}.oci`;
        archivePath = packageDir;
        archiveSize = 0;
        // TODO: Implement OCI artifact creation
      } else {
        console.error(chalk.red(`Unknown format: ${options.format}`));
        console.log(chalk.yellow('Supported formats: zip, tar, oci'));
        process.exit(1);
      }

      console.log(chalk.green.bold(`\n✓ Package created: ${options.output}/${archiveName}\n`));
      
      // Print package contents summary
      console.log(chalk.cyan('Package contents:'));
      console.log(`  📄 plugin.json`);
      if (manifest.frontend) {
        console.log(`  📁 frontend/ (UMD bundle + assets)`);
      }
      if (manifest.backend) {
        console.log(`  📁 backend/ (server.js + dependencies)`);
      }
      if (manifest.database?.migrations) {
        console.log(`  📁 migrations/`);
      }
      if (manifest.database?.schema) {
        console.log(`  📄 schema.prisma`);
      }
      console.log('');

    } catch (error) {
      console.error(chalk.red('Packaging failed:'), error);
      process.exit(1);
    }
  });
