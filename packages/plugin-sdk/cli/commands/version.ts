/**
 * version command
 * Manage plugin versions
 */

import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs-extra';
import semver from 'semver';
import type { PluginManifest } from '../../src/types/manifest.js';

export const versionCommand = new Command('version')
  .description('Bump plugin version')
  .argument('<bump>', 'Version bump type (patch, minor, major, or explicit version)')
  .option('--no-git', 'Skip git commit and tag')
  .option('-m, --message <message>', 'Custom commit message')
  .action(async (bump: string, options: {
    git: boolean;
    message?: string;
  }) => {
    const cwd = process.cwd();
    const manifestPath = path.join(cwd, 'plugin.json');

    if (!await fs.pathExists(manifestPath)) {
      console.error(chalk.red('Error: plugin.json not found'));
      process.exit(1);
    }

    const manifest: PluginManifest = await fs.readJson(manifestPath);
    const currentVersion = manifest.version;

    // Calculate new version
    let newVersion: string | null;
    
    if (['patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease'].includes(bump)) {
      newVersion = semver.inc(currentVersion, bump as semver.ReleaseType);
    } else if (semver.valid(bump)) {
      newVersion = bump;
    } else {
      console.error(chalk.red(`Invalid version bump: ${bump}`));
      console.log(chalk.gray('Use: patch, minor, major, or explicit semver'));
      process.exit(1);
    }

    if (!newVersion) {
      console.error(chalk.red('Failed to calculate new version'));
      process.exit(1);
    }

    console.log(chalk.blue(`\nBumping version: ${currentVersion} → ${chalk.bold(newVersion)}\n`));

    try {
      // Update plugin.json
      manifest.version = newVersion;
      await fs.writeJson(manifestPath, manifest, { spaces: 2 });
      console.log(chalk.green('✓ Updated plugin.json'));

      // Update frontend package.json
      const frontendPkgPath = path.join(cwd, 'frontend', 'package.json');
      if (await fs.pathExists(frontendPkgPath)) {
        const frontendPkg = await fs.readJson(frontendPkgPath);
        frontendPkg.version = newVersion;
        await fs.writeJson(frontendPkgPath, frontendPkg, { spaces: 2 });
        console.log(chalk.green('✓ Updated frontend/package.json'));
      }

      // Update backend package.json
      const backendPkgPath = path.join(cwd, 'backend', 'package.json');
      if (await fs.pathExists(backendPkgPath)) {
        const backendPkg = await fs.readJson(backendPkgPath);
        backendPkg.version = newVersion;
        await fs.writeJson(backendPkgPath, backendPkg, { spaces: 2 });
        console.log(chalk.green('✓ Updated backend/package.json'));
      }

      // Update CHANGELOG
      const changelogPath = path.join(cwd, 'docs', 'CHANGELOG.md');
      if (await fs.pathExists(changelogPath)) {
        let changelog = await fs.readFile(changelogPath, 'utf-8');
        const today = new Date().toISOString().split('T')[0];
        const newEntry = `\n## [${newVersion}] - ${today}\n\n### Changed\n- Version bump\n`;
        
        // Insert after header
        const headerEnd = changelog.indexOf('\n## ');
        if (headerEnd !== -1) {
          changelog = changelog.slice(0, headerEnd) + newEntry + changelog.slice(headerEnd);
        } else {
          changelog += newEntry;
        }
        
        await fs.writeFile(changelogPath, changelog);
        console.log(chalk.green('✓ Updated CHANGELOG.md'));
      }

      // Git operations
      if (options.git) {
        const { execa } = await import('execa');
        
        try {
          // Check if in git repo
          await execa('git', ['rev-parse', '--git-dir'], { cwd });
          
          // Stage changes
          await execa('git', ['add', 'plugin.json', 'frontend/package.json', 'backend/package.json', 'docs/CHANGELOG.md'], { 
            cwd,
            reject: false,
          });
          
          // Commit
          const commitMessage = options.message || `chore: release v${newVersion}`;
          await execa('git', ['commit', '-m', commitMessage], { cwd });
          console.log(chalk.green(`✓ Created commit: ${commitMessage}`));
          
          // Tag
          await execa('git', ['tag', `v${newVersion}`], { cwd });
          console.log(chalk.green(`✓ Created tag: v${newVersion}`));
          
        } catch {
          console.log(chalk.yellow('⚠ Git operations skipped (not a git repository or no changes)'));
        }
      }

      console.log(chalk.green.bold(`\n✓ Version updated to ${newVersion}\n`));
      console.log(chalk.gray('Next steps:'));
      console.log(chalk.cyan('  naap-plugin build'));
      console.log(chalk.cyan('  naap-plugin package'));
      console.log(chalk.cyan('  naap-plugin publish'));
      console.log('');

    } catch (error) {
      console.error(chalk.red('Version bump failed:'), error);
      process.exit(1);
    }
  });
