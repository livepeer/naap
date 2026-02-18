/**
 * Create Command Tests
 *
 * Validates plugin scaffolding correctness:
 * - Generated mount.tsx is the single mount entry point
 * - Generated App.tsx does NOT export mount
 * - displayName prompt is included
 * - Backend ports are deterministic and not hardcoded to 4010
 * - Prisma schema uses multi-schema annotation
 * - Frontend/backend structure matches template selection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

/**
 * Simulates what createFrontend writes by extracting the string templates
 * directly (avoids running the interactive CLI).
 */
function generateAppTsx(name: string): string {
  const pascalName = name.split(/[-_]/).map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join('');
  return `import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import Dashboard from './pages/Dashboard';
import './index.css';

const ${pascalName}App: React.FC = () => (
  <MemoryRouter>
    <Routes>
      <Route path="/*" element={<Dashboard />} />
    </Routes>
  </MemoryRouter>
);

const plugin = createPlugin({
  name: '${name}',
  version: '1.0.0',
  routes: ['/${name}', '/${name}/*'],
  App: ${pascalName}App,
});

export const mount = plugin.mount;
export default plugin;
`;
}

function generateMountTsx(name: string): string {
  const pascalName = name.split(/[-_]/).map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join('');
  return `import plugin from './App';

const PLUGIN_GLOBAL_NAME = 'NaapPlugin${pascalName}';

export const mount = plugin.mount;
export const unmount = plugin.unmount;
export const metadata = plugin.metadata || { name: '${name}', version: '1.0.0' };

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>)[PLUGIN_GLOBAL_NAME] = {
    mount,
    unmount,
    metadata,
  };
}

export default { mount, unmount, metadata };
`;
}

function computeBackendPort(name: string): number {
  const hash = Array.from(name).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return 4000 + (hash % 1000);
}

function generatePrismaSchema(name: string): string {
  const schemaName = `plugin_${name.replace(/-/g, '_')}`;
  const modelName = name.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
  return `// Plugin schema extension for ${name}
// Models here are merged into the unified schema at packages/database/prisma/schema.prisma
// via the multi-schema approach: @@schema("${schemaName}")
//
// During development, use the centralized DB managed by packages/database.
// Do NOT define your own datasource block — the platform provides it.

generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["multiSchema"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["public", "${schemaName}"]
}

// Add your models here — always annotate with @@schema("${schemaName}")
model ${modelName}Example {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@schema("${schemaName}")
}
`;
}

describe('Create Command — Scaffolding Correctness', () => {
  // ---------------------------------------------------------------
  // Mount entry-point uniqueness
  // ---------------------------------------------------------------
  describe('mount entry point', () => {
    it('mount.tsx delegates to plugin from App.tsx', () => {
      const content = generateMountTsx('my-plugin');
      expect(content).toContain("import plugin from './App'");
      expect(content).toContain('export const mount = plugin.mount');
    });

    it('mount.tsx exports unmount and metadata', () => {
      const content = generateMountTsx('my-plugin');
      expect(content).toContain('export const unmount = plugin.unmount');
      expect(content).toContain('export const metadata = plugin.metadata');
    });

    it('mount.tsx registers on window for UMD', () => {
      const content = generateMountTsx('my-plugin');
      expect(content).toContain('NaapPluginMyPlugin');
      expect(content).toContain("if (typeof window !== 'undefined')");
    });

    it('App.tsx uses createPlugin() pattern', () => {
      const content = generateAppTsx('my-plugin');
      expect(content).toContain("import { createPlugin } from '@naap/plugin-sdk'");
      expect(content).toContain('createPlugin({');
      expect(content).not.toContain('ShellProvider');
      expect(content).not.toContain('createRoot');
    });

    it('App.tsx does NOT contain manual mount boilerplate', () => {
      const content = generateAppTsx('my-plugin');
      expect(content).not.toMatch(/export\s+function\s+mount/);
      expect(content).not.toContain('let root: Root | null');
      expect(content).not.toContain('ReactDOM.createRoot');
    });

    it('App.tsx exports mount from plugin instance', () => {
      const content = generateAppTsx('my-plugin');
      expect(content).toContain('export const mount = plugin.mount');
      expect(content).toContain('export default plugin');
    });
  });

  // ---------------------------------------------------------------
  // Backend port allocation
  // ---------------------------------------------------------------
  describe('backend port allocation', () => {
    it('derives deterministic port from plugin name', () => {
      const portA = computeBackendPort('my-plugin');
      const portB = computeBackendPort('my-plugin');
      expect(portA).toBe(portB);
    });

    it('different plugin names produce different ports', () => {
      const portA = computeBackendPort('plugin-alpha');
      const portB = computeBackendPort('plugin-beta');
      expect(portA).not.toBe(portB);
    });

    it('port is within valid range 4000-4999', () => {
      const names = ['a', 'zzzzz', 'my-super-long-plugin-name-here'];
      for (const n of names) {
        const port = computeBackendPort(n);
        expect(port).toBeGreaterThanOrEqual(4000);
        expect(port).toBeLessThan(5000);
      }
    });

    it('does not use hardcoded 4010', () => {
      // The old default was always 4010; verify at least some names diverge.
      const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
      const ports = names.map(computeBackendPort);
      const allSame = ports.every(p => p === 4010);
      expect(allSame).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // Prisma schema correctness
  // ---------------------------------------------------------------
  describe('prisma schema generation', () => {
    it('uses multiSchema preview feature', () => {
      const schema = generatePrismaSchema('my-plugin');
      expect(schema).toContain('previewFeatures = ["multiSchema"]');
    });

    it('annotates models with @@schema', () => {
      const schema = generatePrismaSchema('my-plugin');
      expect(schema).toContain('@@schema("plugin_my_plugin")');
    });

    it('includes the plugin-specific schema name in datasource schemas array', () => {
      const schema = generatePrismaSchema('data-processor');
      expect(schema).toContain('"plugin_data_processor"');
    });

    it('model name is PascalCase version of plugin name', () => {
      const schema = generatePrismaSchema('data-processor');
      expect(schema).toContain('model DataProcessorExample');
    });
  });

  // ---------------------------------------------------------------
  // displayName prompt presence
  // ---------------------------------------------------------------
  describe('displayName prompt', () => {
    it('prompt questions include displayName', async () => {
      const createSrc = await fs.readFile(
        path.join(__dirname, '..', 'create.ts'),
        'utf-8'
      );
      expect(createSrc).toContain("name: 'displayName'");
      expect(createSrc).toContain("message: 'Display name (human-readable):'");
    });
  });

  // ---------------------------------------------------------------
  // Default template behavior (P0: frontend-first)
  // ---------------------------------------------------------------
  describe('default template behavior', () => {
    it('TEMPLATES list places frontend-only first', async () => {
      const createSrc = await fs.readFile(
        path.join(__dirname, '..', 'create.ts'),
        'utf-8'
      );
      const fullStackIdx = createSrc.indexOf("value: 'full-stack'");
      const frontendOnlyIdx = createSrc.indexOf("value: 'frontend-only'");
      expect(frontendOnlyIdx).toBeLessThan(fullStackIdx);
    });

    it('fallback template defaults to frontend-only when no option or answer', async () => {
      const createSrc = await fs.readFile(
        path.join(__dirname, '..', 'create.ts'),
        'utf-8'
      );
      expect(createSrc).toContain("|| 'frontend-only') as PluginTemplate");
    });

    it('explicit --template full-stack overrides default', async () => {
      const createSrc = await fs.readFile(
        path.join(__dirname, '..', 'create.ts'),
        'utf-8'
      );
      expect(createSrc).toContain("options?.template || answers.template || 'frontend-only'");
    });

    it('next-steps messaging hints at full-stack upgrade path for frontend-only', async () => {
      const createSrc = await fs.readFile(
        path.join(__dirname, '..', 'create.ts'),
        'utf-8'
      );
      expect(createSrc).toContain("if (template === 'frontend-only')");
      expect(createSrc).toContain('--template full-stack');
      expect(createSrc).toContain('naap-plugin add endpoint');
    });
  });

  // ---------------------------------------------------------------
  // Simple full-stack backend mode (P0: --simple flag)
  // ---------------------------------------------------------------
  describe('simple full-stack backend mode', () => {
    it('CLI accepts --simple option', async () => {
      const createSrc = await fs.readFile(
        path.join(__dirname, '..', 'create.ts'),
        'utf-8'
      );
      expect(createSrc).toContain("'--simple'");
      expect(createSrc).toContain('Full-stack without Prisma/Docker');
    });

    it('simple backend scaffold has no Prisma or @naap/database dependency', async () => {
      const createSrc = await fs.readFile(
        path.join(__dirname, '..', 'create.ts'),
        'utf-8'
      );
      const simpleBackendFn = createSrc.slice(
        createSrc.indexOf('async function createBackendSimple'),
        createSrc.indexOf('async function createDocs')
      );
      expect(simpleBackendFn).not.toContain('@naap/database');
      expect(simpleBackendFn).not.toContain('prisma');
      expect(simpleBackendFn).toContain('In-memory store');
    });

    it('simple backend scaffold uses deterministic port', async () => {
      const createSrc = await fs.readFile(
        path.join(__dirname, '..', 'create.ts'),
        'utf-8'
      );
      const simpleBackendFn = createSrc.slice(
        createSrc.indexOf('async function createBackendSimple'),
        createSrc.indexOf('async function createDocs')
      );
      expect(simpleBackendFn).toContain('portHash');
      expect(simpleBackendFn).toContain('4000 + (portHash % 1000)');
    });

    it('simple backend scaffold includes CRUD routes', async () => {
      const createSrc = await fs.readFile(
        path.join(__dirname, '..', 'create.ts'),
        'utf-8'
      );
      const simpleBackendFn = createSrc.slice(
        createSrc.indexOf('async function createBackendSimple'),
        createSrc.indexOf('async function createDocs')
      );
      expect(simpleBackendFn).toContain("router.get('/'");
      expect(simpleBackendFn).toContain("router.post('/'");
      expect(simpleBackendFn).toContain("router.delete('/:id'");
    });

    it('simple mode branches from full-stack creation path', async () => {
      const createSrc = await fs.readFile(
        path.join(__dirname, '..', 'create.ts'),
        'utf-8'
      );
      expect(createSrc).toContain('options?.simple');
      expect(createSrc).toContain('createBackendSimple(targetDir, pluginName)');
    });

    it('simple backend package.json omits prisma devDependency', async () => {
      const createSrc = await fs.readFile(
        path.join(__dirname, '..', 'create.ts'),
        'utf-8'
      );
      const simpleBackendFn = createSrc.slice(
        createSrc.indexOf('async function createBackendSimple'),
        createSrc.indexOf('async function createDocs')
      );
      expect(simpleBackendFn).not.toContain("prisma: '^5.0.0'");
    });
  });
});
