/**
 * iterate command
 * AI-assisted modification of existing plugin code
 *
 * Usage:
 *   naap-plugin iterate <instruction> [options]
 *
 * Examples:
 *   naap-plugin iterate "Add a delete confirmation dialog"
 *   naap-plugin iterate "Add pagination to the list view" --file src/App.tsx
 *   naap-plugin iterate "Implement US-3 acceptance criteria" --story US-3
 *   naap-plugin iterate "Fix the form validation" --diff
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
  type IterationRequest,
  type FileChange,
  type LLMConfig,
} from '../../src/ai/index.js';

export const iterateCommand = new Command('iterate')
  .description('Modify existing plugin code with AI assistance')
  .argument('<instruction>', 'Natural language instruction for the modification')
  .option('-f, --file <path>', 'Target specific file for modification')
  .option('-s, --story <id>', 'Target specific user story (e.g., US-1)')
  .option('--spec <file>', 'Plugin specification file', 'plugin.md')
  .option('--diff', 'Show diff output instead of applying changes')
  .option('--dry-run', 'Preview changes without applying')
  .option('--api-key <key>', 'Anthropic API key (or set ANTHROPIC_API_KEY env)')
  .option('--model <model>', 'LLM model to use', 'claude-sonnet-4-20250514')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (instruction: string, options: {
    file?: string;
    story?: string;
    spec?: string;
    diff?: boolean;
    dryRun?: boolean;
    apiKey?: string;
    model?: string;
    verbose?: boolean;
  }) => {
    const cwd = process.cwd();
    const manifestPath = path.join(cwd, 'plugin.json');

    console.log(chalk.bold.blue('\n🔄 NAAP Plugin Iterator\n'));

    // Check if we're in a plugin directory
    if (!await fs.pathExists(manifestPath)) {
      console.error(chalk.red('Error: plugin.json not found'));
      console.log(chalk.gray('Run this command from a plugin directory.\n'));
      process.exit(1);
    }

    try {
      const manifest = await fs.readJson(manifestPath);
      console.log(chalk.gray(`Plugin: ${manifest.displayName} v${manifest.version}`));
      console.log(chalk.gray(`Instruction: "${instruction}"\n`));

      // Parse specification if available
      let spec = null;
      const specPath = path.join(cwd, options.spec || 'plugin.md');
      if (await fs.pathExists(specPath)) {
        const parseSpinner = ora('Parsing plugin specification...').start();
        const markdown = await fs.readFile(specPath, 'utf-8');
        const parser = new SpecParser();
        spec = parser.parse(markdown);
        parseSpinner.succeed(`Loaded specification: ${spec.userStories.length} user stories`);
      } else {
        console.log(chalk.yellow('⚠️  No plugin.md found. Proceeding without specification context.\n'));
      }

      // Validate story reference
      if (options.story) {
        if (!spec) {
          console.error(chalk.red(`Error: Cannot target story ${options.story} without a plugin.md specification`));
          console.log(chalk.gray('Create a plugin.md file with user stories defined.\n'));
          process.exit(1);
        }
        const story = spec.userStories.find(s => s.id === options.story);
        if (!story) {
          console.error(chalk.red(`Error: User story ${options.story} not found in specification`));
          console.log(chalk.gray('Available stories:'));
          spec.userStories.forEach(s => console.log(chalk.gray(`  • ${s.id}: ${s.title}`)));
          process.exit(1);
        }
        console.log(chalk.cyan(`Targeting story: ${story.id} - ${story.title}\n`));
      }

      // Gather current code
      const gatherSpinner = ora('Gathering current code...').start();
      const currentCode = new Map<string, string>();

      // Determine which files to read
      let filesToRead: string[] = [];

      if (options.file) {
        // Specific file
        const filePath = path.isAbsolute(options.file)
          ? options.file
          : path.join(cwd, options.file);
        if (await fs.pathExists(filePath)) {
          filesToRead.push(filePath);
        } else {
          gatherSpinner.fail(`File not found: ${options.file}`);
          process.exit(1);
        }
      } else {
        // Gather all relevant source files
        filesToRead = await gatherSourceFiles(cwd, manifest);
      }

      for (const filePath of filesToRead) {
        const content = await fs.readFile(filePath, 'utf-8');
        const relativePath = path.relative(cwd, filePath);
        currentCode.set(relativePath, content);
      }

      gatherSpinner.succeed(`Loaded ${currentCode.size} source files`);

      if (options.verbose) {
        console.log(chalk.gray('\nFiles loaded:'));
        for (const file of currentCode.keys()) {
          console.log(chalk.gray(`  • ${file}`));
        }
        console.log('');
      }

      // Check for API key
      const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        console.error(chalk.red('\nError: ANTHROPIC_API_KEY required for iteration'));
        console.log(chalk.gray('Set the environment variable or use --api-key option.\n'));
        process.exit(1);
      }

      // Configure LLM
      const llmConfig: LLMConfig = {
        provider: 'anthropic',
        apiKey,
        model: options.model,
      };

      // Create generator
      const generator = createCodeGenerator(llmConfig);

      // Build iteration request - create minimal spec if none exists
      const minimalSpec = spec || {
        name: manifest.name || 'unknown',
        displayName: manifest.displayName || 'Unknown Plugin',
        description: manifest.description || '',
        version: manifest.version || '1.0.0',
        userStories: [],
        dataModel: [],
        permissions: [],
        integrations: [],
        settings: [],
        rawMarkdown: '',
      };

      const request: IterationRequest = {
        instruction,
        spec: minimalSpec,
        currentCode,
        targetFile: options.file,
        targetStory: options.story,
      };

      // Generate changes
      const iterateSpinner = ora('Generating changes...').start();
      const changes = await generator.iterate(request);

      if (changes.length === 0) {
        iterateSpinner.warn('No changes generated');
        console.log(chalk.yellow('\nThe AI could not determine necessary changes.'));
        console.log(chalk.gray('Try being more specific in your instruction.\n'));
        process.exit(0);
      }

      iterateSpinner.succeed(`Generated ${changes.length} file change(s)`);

      // Display changes
      console.log(chalk.bold('\n📝 Proposed Changes:\n'));

      for (const change of changes) {
        console.log(chalk.bold(`${change.file}`));
        console.log(chalk.gray(`  ${change.description}`));

        if (options.diff || options.verbose) {
          console.log('');
          displayDiff(change);
        }
        console.log('');
      }

      // Apply changes if not dry run
      if (!options.dryRun && !options.diff) {
        const applySpinner = ora('Applying changes...').start();

        for (const change of changes) {
          const filePath = path.join(cwd, change.file);
          await fs.ensureDir(path.dirname(filePath));
          await fs.writeFile(filePath, change.newContent, 'utf-8');
        }

        applySpinner.succeed('Changes applied');

        console.log(chalk.gray('\nModified files:'));
        for (const change of changes) {
          console.log(chalk.green(`  ✓ ${change.file}`));
        }
      } else if (options.dryRun) {
        console.log(chalk.yellow('Dry run complete. No files were modified.'));
      }

      // Update story completion if targeting a story
      if (options.story && spec) {
        console.log(chalk.cyan(`\n💡 Consider updating ${options.story} acceptance criteria in plugin.md`));
      }

      console.log(chalk.green.bold('\n✓ Iteration complete!\n'));

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
 * Gather all source files from a plugin directory
 */
async function gatherSourceFiles(cwd: string, manifest: Record<string, unknown>): Promise<string[]> {
  const files: string[] = [];

  // Frontend files
  if (manifest.frontend) {
    const frontendSrc = path.join(cwd, 'frontend', 'src');
    if (await fs.pathExists(frontendSrc)) {
      const frontendFiles = await collectFiles(frontendSrc, ['.tsx', '.ts', '.jsx', '.js']);
      files.push(...frontendFiles);
    }
  }

  // Backend files
  if (manifest.backend) {
    const backendSrc = path.join(cwd, 'backend', 'src');
    if (await fs.pathExists(backendSrc)) {
      const backendFiles = await collectFiles(backendSrc, ['.ts', '.js']);
      files.push(...backendFiles);
    }
  }

  // Prisma schema
  const prismaSchema = path.join(cwd, 'backend', 'prisma', 'schema.prisma');
  if (await fs.pathExists(prismaSchema)) {
    files.push(prismaSchema);
  }

  return files;
}

/**
 * Recursively collect files with specified extensions
 */
async function collectFiles(dir: string, extensions: string[]): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip node_modules, dist, etc.
      if (!['node_modules', 'dist', '.git', 'coverage'].includes(entry.name)) {
        const subFiles = await collectFiles(fullPath, extensions);
        files.push(...subFiles);
      }
    } else if (extensions.some(ext => entry.name.endsWith(ext))) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Display colored diff output
 */
function displayDiff(change: FileChange): void {
  const diffLines = change.diff.split('\n');

  for (const line of diffLines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      console.log(chalk.green(line));
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      console.log(chalk.red(line));
    } else if (line.startsWith('@@')) {
      console.log(chalk.cyan(line));
    } else if (line.startsWith('diff') || line.startsWith('---') || line.startsWith('+++')) {
      console.log(chalk.bold(line));
    } else {
      console.log(chalk.gray(line));
    }
  }
}
