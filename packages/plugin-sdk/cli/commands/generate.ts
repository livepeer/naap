/**
 * generate command
 * AI-assisted plugin code generation from plugin.md specification
 *
 * Usage:
 *   naap-plugin generate [spec-file] [options]
 *
 * Examples:
 *   naap-plugin generate plugin.md
 *   naap-plugin generate plugin.md --output ./my-plugin
 *   naap-plugin generate plugin.md --dry-run
 *   naap-plugin generate plugin.md --skip-tests --skip-backend
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs-extra';
import {
  SpecParser,
  CodeGenerator,
  createCodeGenerator,
  type PluginSpec,
  type GeneratedFile,
  type LLMConfig,
} from '../../src/ai/index.js';

export const generateCommand = new Command('generate')
  .description('Generate plugin code from a plugin.md specification')
  .argument('[spec-file]', 'Path to plugin.md specification file', 'plugin.md')
  .option('-o, --output <dir>', 'Output directory for generated code')
  .option('--dry-run', 'Preview generated files without writing')
  .option('--skip-tests', 'Skip test file generation')
  .option('--skip-backend', 'Skip backend code generation')
  .option('--skip-docs', 'Skip documentation generation')
  .option('--api-key <key>', 'Anthropic API key (or set ANTHROPIC_API_KEY env)')
  .option('--model <model>', 'LLM model to use', 'claude-sonnet-4-20250514')
  .option('--interactive', 'Enable interactive mode for reviewing each file')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (specFile: string, options: {
    output?: string;
    dryRun?: boolean;
    skipTests?: boolean;
    skipBackend?: boolean;
    skipDocs?: boolean;
    apiKey?: string;
    model?: string;
    interactive?: boolean;
    verbose?: boolean;
  }) => {
    const cwd = process.cwd();
    const specPath = path.isAbsolute(specFile) ? specFile : path.join(cwd, specFile);

    console.log(chalk.bold.blue('\n🤖 NAAP Plugin Generator\n'));

    // Check if spec file exists
    if (!await fs.pathExists(specPath)) {
      console.error(chalk.red(`Error: Specification file not found: ${specPath}`));
      console.log(chalk.gray('\nCreate a plugin.md file with your plugin specification.'));
      console.log(chalk.gray('See: https://docs.naap.dev/ai-generation/spec-format\n'));
      process.exit(1);
    }

    try {
      // Parse specification
      const parseSpinner = ora('Parsing plugin specification...').start();
      const markdown = await fs.readFile(specPath, 'utf-8');
      const parser = new SpecParser();
      const spec = parser.parse(markdown);

      // Validate specification
      const validation = parser.validate(spec);
      if (!validation.valid) {
        parseSpinner.fail('Specification validation failed');
        console.log(chalk.red('\nErrors:'));
        validation.errors.forEach(err => console.log(chalk.red(`  • ${err}`)));
        process.exit(1);
      }

      parseSpinner.succeed(`Parsed specification: ${spec.displayName} v${spec.version}`);

      // Show warnings
      if (validation.warnings.length > 0) {
        console.log(chalk.yellow('\nWarnings:'));
        validation.warnings.forEach(warn => console.log(chalk.yellow(`  ⚠️  ${warn}`)));
      }

      // Show spec summary
      if (options.verbose) {
        console.log(chalk.gray('\nSpecification Summary:'));
        console.log(chalk.gray(`  Name: ${spec.name}`));
        console.log(chalk.gray(`  User Stories: ${spec.userStories.length}`));
        console.log(chalk.gray(`  Data Models: ${spec.dataModel.length}`));
        console.log(chalk.gray(`  Permissions: ${spec.permissions.length}`));
        console.log(chalk.gray(`  Integrations: ${spec.integrations.length}`));
      }

      // Determine output directory
      const outputDir = options.output
        ? path.isAbsolute(options.output) ? options.output : path.join(cwd, options.output)
        : path.join(cwd, spec.name);

      if (!options.dryRun) {
        // Check if output directory exists
        if (await fs.pathExists(outputDir)) {
          const files = await fs.readdir(outputDir);
          if (files.length > 0) {
            console.log(chalk.yellow(`\n⚠️  Output directory exists: ${outputDir}`));
            console.log(chalk.yellow('   Existing files may be overwritten.\n'));
          }
        }
      }

      // Configure LLM
      const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
      const llmConfig: LLMConfig = {
        provider: apiKey ? 'anthropic' : 'local',
        apiKey,
        model: options.model,
      };

      if (!apiKey) {
        console.log(chalk.yellow('\n⚠️  No ANTHROPIC_API_KEY found. Using template-based generation.'));
        console.log(chalk.gray('   For AI-powered generation, set the ANTHROPIC_API_KEY environment variable.\n'));
      }

      // Create generator
      const generator = createCodeGenerator(llmConfig);

      // Generate plugin
      const genSpinner = ora('Generating plugin code...').start();
      const generated = await generator.generatePlugin({
        spec,
        outputDir,
        dryRun: options.dryRun,
        skipTests: options.skipTests,
        skipBackend: options.skipBackend,
        includeDocumentation: !options.skipDocs,
      });
      genSpinner.succeed('Plugin code generated');

      // Calculate totals
      const allFiles = [
        ...generated.dataModel,
        ...generated.frontend,
        ...generated.backend,
        ...generated.tests,
      ];
      const totalSize = allFiles.reduce((sum, f) => sum + f.content.length, 0);

      // Display results
      console.log(chalk.bold('\n📦 Generated Files:\n'));

      // Display by category
      const categories = [
        { name: 'Data Model', files: generated.dataModel, icon: '📊' },
        { name: 'Frontend', files: generated.frontend, icon: '🎨' },
        { name: 'Backend', files: generated.backend, icon: '⚙️' },
        { name: 'Tests', files: generated.tests, icon: '🧪' },
      ];

      for (const category of categories) {
        if (category.files.length > 0) {
          console.log(chalk.bold(`${category.icon} ${category.name}:`));
          for (const file of category.files) {
            const sizeKB = (file.content.length / 1024).toFixed(1);
            const relPath = file.path.startsWith(outputDir)
              ? file.path.substring(outputDir.length + 1)
              : file.path;
            console.log(chalk.gray(`   ${relPath} (${sizeKB}KB)`));
            if (options.verbose && file.description) {
              console.log(chalk.gray(`      ${file.description}`));
            }
          }
          console.log('');
        }
      }

      // Write files if not dry run
      if (!options.dryRun) {
        const writeSpinner = ora('Writing files...').start();

        await fs.ensureDir(outputDir);

        for (const file of allFiles) {
          const filePath = file.path.startsWith('/')
            ? file.path
            : path.join(outputDir, file.path);
          await fs.ensureDir(path.dirname(filePath));
          await fs.writeFile(filePath, file.content, 'utf-8');
        }

        // Write manifest
        const manifestPath = path.join(outputDir, 'plugin.json');
        await fs.writeJson(manifestPath, generated.manifest, { spaces: 2 });

        writeSpinner.succeed(`Files written to ${outputDir}`);

        // Post-generation instructions
        console.log(chalk.bold('\n📋 Next Steps:\n'));
        console.log(chalk.cyan(`   cd ${spec.name}`));
        console.log(chalk.cyan('   npm install'));
        console.log(chalk.cyan('   npm run dev'));
        console.log('');
        console.log(chalk.gray('For more commands, run: naap-plugin --help'));
      } else {
        console.log(chalk.yellow('Dry run complete. No files were written.'));
        console.log(chalk.gray(`Would write ${allFiles.length + 1} files (${(totalSize / 1024).toFixed(1)}KB total)`));
      }

      // Summary
      console.log(chalk.green.bold('\n✓ Generation complete!\n'));

    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk.red(`\nError: ${error.message}`));
        if (options.verbose && error.stack) {
          console.error(chalk.gray(error.stack));
        }
      } else {
        console.error(chalk.red('\nUnknown error occurred'));
      }
      process.exit(1);
    }
  });

/**
 * Display file content preview in interactive mode
 * @internal Reserved for future interactive mode implementation
 */
export function previewFile(file: GeneratedFile): void {
  console.log(chalk.bold(`\n--- ${file.path} ---`));
  if (file.description) {
    console.log(chalk.gray(file.description));
  }
  console.log('');

  // Show first 50 lines
  const lines = file.content.split('\n');
  const preview = lines.slice(0, 50);
  preview.forEach((line, i) => {
    console.log(chalk.gray(`${String(i + 1).padStart(4)} │`) + line);
  });

  if (lines.length > 50) {
    console.log(chalk.gray(`\n... ${lines.length - 50} more lines`));
  }
}
