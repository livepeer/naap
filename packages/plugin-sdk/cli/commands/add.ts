/**
 * add command
 * Incrementally add models and endpoints to an existing plugin
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs-extra';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toPascalCase(str: string): string {
  return str
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

function toSnakeCase(str: string): string {
  return str.replace(/[-]+/g, '_').toLowerCase();
}

interface PluginContext {
  name: string;
  rootDir: string;
  backendDir: string;
  isMonorepo: boolean;
  schemaPath: string | null;
}

async function resolvePluginContext(cwd: string): Promise<PluginContext> {
  const manifestPath = path.join(cwd, 'plugin.json');
  if (!(await fs.pathExists(manifestPath))) {
    throw new Error(
      `No plugin.json found in ${cwd}.\n` +
      `Run this command from your plugin root directory.`
    );
  }

  const manifest = await fs.readJson(manifestPath);
  const name: string = manifest.name || path.basename(cwd);
  const backendDir = path.join(cwd, 'backend');

  const monorepoSchema = path.resolve(cwd, '..', '..', 'packages', 'database', 'prisma', 'schema.prisma');
  const isMonorepo = await fs.pathExists(monorepoSchema);

  return {
    name,
    rootDir: cwd,
    backendDir,
    isMonorepo,
    schemaPath: isMonorepo ? monorepoSchema : null,
  };
}

// ---------------------------------------------------------------------------
// add model
// ---------------------------------------------------------------------------

export function buildModelBlock(modelName: string, schemaName: string, fields: string[]): string {
  const lines: string[] = [];
  lines.push(`model ${modelName} {`);
  lines.push(`  id        String   @id @default(cuid())`);
  for (const field of fields) {
    const parts = field.split(':');
    const fname = parts[0];
    const ftype = parts.length > 1 ? parts[1] : 'String';
    // Normalizes first char (e.g., "string" -> "String", "int" -> "Int").
    // Does NOT validate; caller must use valid Prisma types (String, Int, Boolean, DateTime, etc.).
    const prismaType = ftype.charAt(0).toUpperCase() + ftype.slice(1);
    lines.push(`  ${fname.padEnd(9)} ${prismaType}`);
  }
  lines.push(`  createdAt DateTime @default(now())`);
  lines.push(`  updatedAt DateTime @updatedAt`);
  lines.push('');
  lines.push(`  @@schema("${schemaName}")`);
  lines.push('}');
  return lines.join('\n');
}

export function modelExistsInSchema(schemaContent: string, modelName: string): boolean {
  const regex = new RegExp(`^model\\s+${modelName}\\s*\\{`, 'm');
  return regex.test(schemaContent);
}

export function ensureSchemaInDatasource(schemaContent: string, schemaName: string): string {
  const dsRegex = /schemas\s*=\s*\[([^\]]*)\]/;
  const match = dsRegex.exec(schemaContent);
  if (!match) return schemaContent;
  const existing = match[1];
  // Parse into individual entries to avoid substring false-positives (e.g. "plugin_a" vs "plugin_abc")
  const existingSchemas = existing
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)
    .map(entry => {
      const m = /^"(.*)"$/.exec(entry);
      return m ? m[1] : entry;
    });
  if (existingSchemas.includes(schemaName)) return schemaContent;
  const trimmed = existing.trim();
  const newSchemas = trimmed.length === 0 ? `"${schemaName}"` : existing.trimEnd() + `, "${schemaName}"`;
  return schemaContent.replace(dsRegex, `schemas = [${newSchemas}]`);
}

async function handleAddModel(modelName: string, fields: string[], opts: { force?: boolean }): Promise<void> {
  const spinner = ora('Adding model...').start();
  try {
    const ctx = await resolvePluginContext(process.cwd());

    if (!ctx.isMonorepo || !ctx.schemaPath) {
      spinner.fail('Not in a NAAP monorepo');
      console.log(chalk.yellow(
        'The `add model` command modifies the unified Prisma schema at\n' +
        'packages/database/prisma/schema.prisma.\n\n' +
        'Run this command from inside the monorepo workspace.'
      ));
      return;
    }

    const schemaName = `plugin_${toSnakeCase(ctx.name)}`;
    const pascalModel = toPascalCase(modelName);

    let schema = await fs.readFile(ctx.schemaPath, 'utf-8');

    if (modelExistsInSchema(schema, pascalModel)) {
      if (!opts.force) {
        spinner.warn(`Model ${pascalModel} already exists in schema — skipping`);
        return;
      }
      spinner.info(`Model ${pascalModel} exists but --force used, appending duplicate`);
    }

    schema = ensureSchemaInDatasource(schema, schemaName);

    const block = buildModelBlock(pascalModel, schemaName, fields);
    schema = schema.trimEnd() + '\n\n' + block + '\n';

    await fs.writeFile(ctx.schemaPath, schema);

    spinner.succeed(`Model ${pascalModel} added to unified schema`);
    console.log(chalk.gray(`  Schema: @@schema("${schemaName}")`));
    console.log(chalk.gray(`  Path: ${ctx.schemaPath}`));
    console.log('');
    console.log(chalk.bold('Next steps:'));
    console.log(chalk.cyan('  cd packages/database'));
    console.log(chalk.cyan('  npx prisma db push'));
    console.log(chalk.cyan('  npx prisma generate'));
  } catch (err) {
    spinner.fail('Failed to add model');
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// add endpoint
// ---------------------------------------------------------------------------

function generateEndpointFile(name: string, crud: boolean): string {
  const routerName = `${name}Router`;
  const lines: string[] = [];
  lines.push(`import { Router } from 'express';`);
  lines.push('');
  lines.push(`export const ${routerName} = Router();`);
  lines.push('');

  if (crud) {
    lines.push(`${routerName}.get('/', async (_req, res) => {`);
    lines.push(`  // TODO: list ${name}`);
    lines.push(`  res.json({ items: [] });`);
    lines.push('});');
    lines.push('');
    lines.push(`${routerName}.get('/:id', async (req, res) => {`);
    lines.push(`  // TODO: get ${name} by id`);
    lines.push(`  res.json({ id: req.params.id });`);
    lines.push('});');
    lines.push('');
    lines.push(`${routerName}.post('/', async (req, res) => {`);
    lines.push(`  // TODO: create ${name}`);
    lines.push(`  res.status(201).json({ ...req.body });`);
    lines.push('});');
    lines.push('');
    lines.push(`${routerName}.put('/:id', async (req, res) => {`);
    lines.push(`  // TODO: update ${name}`);
    lines.push(`  res.json({ id: req.params.id, ...req.body });`);
    lines.push('});');
    lines.push('');
    lines.push(`${routerName}.delete('/:id', async (_req, res) => {`);
    lines.push(`  // TODO: delete ${name}`);
    lines.push(`  res.status(204).send();`);
    lines.push('});');
  } else {
    lines.push(`${routerName}.get('/', async (_req, res) => {`);
    lines.push(`  // TODO: implement ${name} endpoint`);
    lines.push(`  res.json({ message: '${name} endpoint' });`);
    lines.push('});');
  }
  lines.push('');
  return lines.join('\n');
}

export function registrationExists(aggregatorContent: string, routerName: string): boolean {
  return aggregatorContent.includes(routerName);
}

function buildRegistrationLines(name: string): { importLine: string; useLine: string } {
  const routerName = `${name}Router`;
  return {
    importLine: `import { ${routerName} } from './${name}.js';`,
    useLine: `router.use('/${name}', ${routerName});`,
  };
}

async function handleAddEndpoint(name: string, opts: { crud?: boolean; force?: boolean }): Promise<void> {
  const spinner = ora('Adding endpoint...').start();
  try {
    const ctx = await resolvePluginContext(process.cwd());

    const routesDir = path.join(ctx.backendDir, 'src', 'routes');
    if (!(await fs.pathExists(routesDir))) {
      spinner.fail('No backend/src/routes directory found');
      console.log(chalk.yellow(
        'Your plugin does not appear to have a backend.\n' +
        'Create one first with: naap-plugin create <name> --template full-stack'
      ));
      return;
    }

    const routeFile = path.join(routesDir, `${name}.ts`);
    if (await fs.pathExists(routeFile)) {
      if (!opts.force) {
        spinner.warn(`Route file ${name}.ts already exists — skipping`);
        return;
      }
    }

    await fs.writeFile(routeFile, generateEndpointFile(name, !!opts.crud));

    const aggregatorPath = path.join(routesDir, 'index.ts');
    if (await fs.pathExists(aggregatorPath)) {
      let aggregator = await fs.readFile(aggregatorPath, 'utf-8');
      const routerName = `${name}Router`;
      const { importLine, useLine } = buildRegistrationLines(name);

      if (!registrationExists(aggregator, routerName)) {
        const lastImportIdx = aggregator.lastIndexOf('import ');
        if (lastImportIdx !== -1) {
          const lineEnd = aggregator.indexOf('\n', lastImportIdx);
          aggregator = aggregator.slice(0, lineEnd + 1) + importLine + '\n' + aggregator.slice(lineEnd + 1);
        } else {
          aggregator = importLine + '\n' + aggregator;
        }

        aggregator = aggregator.trimEnd() + '\n' + useLine + '\n';
        await fs.writeFile(aggregatorPath, aggregator);
      }
    }

    spinner.succeed(`Endpoint ${name} created`);
    console.log(chalk.gray(`  Route: backend/src/routes/${name}.ts`));
    if (opts.crud) {
      console.log(chalk.gray(`  Methods: GET / POST / PUT / DELETE`));
    }
    console.log('');
    console.log(chalk.bold('Next step:'));
    console.log(chalk.cyan(`  Edit backend/src/routes/${name}.ts and implement your logic`));
  } catch (err) {
    spinner.fail('Failed to add endpoint');
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export const addCommand = new Command('add')
  .description('Add models or endpoints to your plugin');

addCommand
  .command('model <name> [fields...]')
  .description('Add a Prisma model to the unified schema (e.g., add model Todo title:String done:Boolean)')
  .option('--force', 'Overwrite if model already exists')
  .action(handleAddModel);

addCommand
  .command('endpoint <name>')
  .description('Add a new API endpoint route file')
  .option('--crud', 'Generate full CRUD skeleton (GET, POST, PUT, DELETE)')
  .option('--force', 'Overwrite if route file already exists')
  .action(handleAddEndpoint);
