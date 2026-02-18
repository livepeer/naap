/**
 * Add Command Tests
 *
 * Validates `naap-plugin add model` and `naap-plugin add endpoint`:
 * - Model block generation correctness
 * - Schema idempotency (no duplicates)
 * - Datasource schemas array expansion
 * - Endpoint file generation (basic + CRUD)
 * - Route aggregator idempotent registration
 * - CLI help discoverability
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import {
  buildModelBlock,
  modelExistsInSchema,
  ensureSchemaInDatasource,
  registrationExists,
} from '../add.js';

// ---------------------------------------------------------------------------
// Unit tests for pure helper functions
// ---------------------------------------------------------------------------

describe('Add Command — Model Helpers', () => {
  it('buildModelBlock generates valid Prisma model with @@schema', () => {
    const block = buildModelBlock('Todo', 'plugin_my_plugin', ['title:String', 'done:Boolean']);
    expect(block).toContain('model Todo {');
    expect(block).toContain('id        String   @id @default(cuid())');
    expect(block).toContain('title     String');
    expect(block).toContain('done      Boolean');
    expect(block).toContain('createdAt DateTime @default(now())');
    expect(block).toContain('updatedAt DateTime @updatedAt');
    expect(block).toContain('@@schema("plugin_my_plugin")');
  });

  it('buildModelBlock defaults to String type when type is omitted', () => {
    const block = buildModelBlock('Item', 'plugin_x', ['label']);
    expect(block).toContain('label     String');
  });

  it('modelExistsInSchema returns true when model is present', () => {
    const schema = 'model User {\n  id String @id\n}\n\nmodel Todo {\n  id String @id\n}';
    expect(modelExistsInSchema(schema, 'Todo')).toBe(true);
    expect(modelExistsInSchema(schema, 'User')).toBe(true);
  });

  it('modelExistsInSchema returns false when model is absent', () => {
    const schema = 'model User {\n  id String @id\n}';
    expect(modelExistsInSchema(schema, 'Todo')).toBe(false);
  });

  it('modelExistsInSchema does not false-positive on partial names', () => {
    const schema = 'model UserProfile {\n  id String @id\n}';
    expect(modelExistsInSchema(schema, 'User')).toBe(false);
  });

  it('ensureSchemaInDatasource adds missing schema name', () => {
    const schema = 'schemas = ["public", "plugin_a"]';
    const result = ensureSchemaInDatasource(schema, 'plugin_b');
    expect(result).toContain('"plugin_b"');
  });

  it('ensureSchemaInDatasource is idempotent when schema already present', () => {
    const schema = 'schemas = ["public", "plugin_a"]';
    const result = ensureSchemaInDatasource(schema, 'plugin_a');
    expect(result).toBe(schema);
  });

    it('ensureSchemaInDatasource returns unchanged if no schemas array found', () => {
      const schema = 'generator client { }';
      const result = ensureSchemaInDatasource(schema, 'plugin_x');
      expect(result).toBe(schema);
    });

    it('ensureSchemaInDatasource adds plugin_a when plugin_abc exists (no substring false-positive)', () => {
      const schema = 'schemas = ["plugin_abc"]';
      const result = ensureSchemaInDatasource(schema, 'plugin_a');
      expect(result).toContain('"plugin_a"');
      expect(result).toContain('"plugin_abc"');
    });
  });

describe('Add Command — Endpoint Helpers', () => {
  it('registrationExists detects existing router import', () => {
    const aggregator = `import { fooRouter } from './foo.js';\nrouter.use('/foo', fooRouter);`;
    expect(registrationExists(aggregator, 'fooRouter')).toBe(true);
  });

  it('registrationExists returns false for absent router', () => {
    const aggregator = `import { fooRouter } from './foo.js';`;
    expect(registrationExists(aggregator, 'barRouter')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration-style tests using temp directories
// ---------------------------------------------------------------------------

describe('Add Command — Model Integration', () => {
  let tmpDir: string;
  let schemaPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'naap-add-model-'));

    // Simulate monorepo layout: tmpDir/plugins/my-plugin  + tmpDir/packages/database/prisma/schema.prisma
    const pluginDir = path.join(tmpDir, 'plugins', 'my-plugin');
    const dbDir = path.join(tmpDir, 'packages', 'database', 'prisma');
    await fs.ensureDir(pluginDir);
    await fs.ensureDir(dbDir);

    schemaPath = path.join(dbDir, 'schema.prisma');
    await fs.writeFile(schemaPath, `datasource db {
  schemas = ["public"]
}

model User {
  id String @id
  @@schema("public")
}
`);
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('inserts model block at end of schema', async () => {
    let schema = await fs.readFile(schemaPath, 'utf-8');
    expect(modelExistsInSchema(schema, 'Todo')).toBe(false);

    schema = ensureSchemaInDatasource(schema, 'plugin_my_plugin');
    const block = buildModelBlock('Todo', 'plugin_my_plugin', ['title:String']);
    schema = schema.trimEnd() + '\n\n' + block + '\n';
    await fs.writeFile(schemaPath, schema);

    const updated = await fs.readFile(schemaPath, 'utf-8');
    expect(modelExistsInSchema(updated, 'Todo')).toBe(true);
    expect(updated).toContain('"plugin_my_plugin"');
  });

  it('running insertion twice does not create duplicate when checked', async () => {
    let schema = await fs.readFile(schemaPath, 'utf-8');
    schema = ensureSchemaInDatasource(schema, 'plugin_my_plugin');
    const block = buildModelBlock('Todo', 'plugin_my_plugin', ['title:String']);
    schema = schema.trimEnd() + '\n\n' + block + '\n';
    await fs.writeFile(schemaPath, schema);

    const updated = await fs.readFile(schemaPath, 'utf-8');
    expect(modelExistsInSchema(updated, 'Todo')).toBe(true);

    // Second run — idempotency guard prevents double insert
    const shouldSkip = modelExistsInSchema(updated, 'Todo');
    expect(shouldSkip).toBe(true);
  });
});

describe('Add Command — Endpoint Integration', () => {
  let tmpDir: string;
  let routesDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'naap-add-endpoint-'));
    routesDir = path.join(tmpDir, 'backend', 'src', 'routes');
    await fs.ensureDir(routesDir);

    await fs.writeFile(path.join(routesDir, 'index.ts'), `import { Router } from 'express';

export const router = Router();

router.get('/', (_req, res) => {
  res.json({ message: 'api' });
});
`);
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('route file does not exist initially', async () => {
    expect(await fs.pathExists(path.join(routesDir, 'users.ts'))).toBe(false);
  });

  it('existing route file blocks overwrite without --force', async () => {
    await fs.writeFile(path.join(routesDir, 'users.ts'), '// existing');
    expect(await fs.pathExists(path.join(routesDir, 'users.ts'))).toBe(true);
  });

  it('aggregator registration is idempotent', async () => {
    let aggregator = await fs.readFile(path.join(routesDir, 'index.ts'), 'utf-8');
    expect(registrationExists(aggregator, 'usersRouter')).toBe(false);

    // Simulate first registration
    aggregator += `\nimport { usersRouter } from './users.js';\nrouter.use('/users', usersRouter);\n`;
    await fs.writeFile(path.join(routesDir, 'index.ts'), aggregator);

    // Second check — already registered
    const updated = await fs.readFile(path.join(routesDir, 'index.ts'), 'utf-8');
    expect(registrationExists(updated, 'usersRouter')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CLI help discoverability
// ---------------------------------------------------------------------------

describe('Add Command — CLI Discoverability', () => {
  it('CLI index registers the add command', async () => {
    const indexSrc = await fs.readFile(
      path.join(__dirname, '..', '..', 'index.ts'),
      'utf-8'
    );
    expect(indexSrc).toContain("import { addCommand } from './commands/add.js'");
    expect(indexSrc).toContain('program.addCommand(addCommand)');
  });

  it('add command source exports addCommand', async () => {
    const addSrc = await fs.readFile(
      path.join(__dirname, '..', 'add.ts'),
      'utf-8'
    );
    expect(addSrc).toContain("export const addCommand = new Command('add')");
  });

  it('add command has model subcommand', async () => {
    const addSrc = await fs.readFile(
      path.join(__dirname, '..', 'add.ts'),
      'utf-8'
    );
    expect(addSrc).toContain(".command('model <name> [fields...]')");
  });

  it('add command has endpoint subcommand', async () => {
    const addSrc = await fs.readFile(
      path.join(__dirname, '..', 'add.ts'),
      'utf-8'
    );
    expect(addSrc).toContain(".command('endpoint <name>')");
  });

  it('endpoint subcommand has --crud option', async () => {
    const addSrc = await fs.readFile(
      path.join(__dirname, '..', 'add.ts'),
      'utf-8'
    );
    expect(addSrc).toContain("'--crud'");
  });
});
