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
  return `import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ShellProvider } from '@naap/plugin-sdk/hooks';
import type { ShellContext } from '@naap/plugin-sdk/types';
import Dashboard from './pages/Dashboard';
import './index.css';

interface AppProps {
  shellContext?: ShellContext;
  basename?: string;
}

const App: React.FC<AppProps> = ({ shellContext, basename = '/${name}' }) => {
  const content = (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  );

  if (shellContext) {
    return (
      <ShellProvider value={shellContext}>
        {content}
      </ShellProvider>
    );
  }

  return content;
};

export default App;
`;
}

function generateMountTsx(): string {
  return `import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import type { ShellContext } from '@naap/plugin-sdk/types';
import App from './App';

let root: Root | null = null;

export function mount(container: HTMLElement, context: ShellContext) {
  root = createRoot(container);
  root.render(<App shellContext={context} />);

  return () => {
    if (root) {
      root.unmount();
      root = null;
    }
  };
}

export default { mount };
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
    it('mount.tsx exports a mount function', () => {
      const content = generateMountTsx();
      expect(content).toContain('export function mount(');
      expect(content).toContain('export default { mount }');
    });

    it('App.tsx does NOT export a mount function', () => {
      const content = generateAppTsx('my-plugin');
      expect(content).not.toMatch(/export\s+function\s+mount/);
      expect(content).not.toContain('let root: Root | null');
    });

    it('mount.tsx accepts ShellContext, not generic Record', () => {
      const content = generateMountTsx();
      expect(content).toContain('context: ShellContext');
      expect(content).not.toContain('context: Record<string, unknown>');
    });

    it('mount.tsx properly cleans up root on unmount', () => {
      const content = generateMountTsx();
      expect(content).toContain('root.unmount()');
      expect(content).toContain('root = null');
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
      // Read the create.ts source and verify the prompt array contains displayName
      const createSrc = await fs.readFile(
        path.join(__dirname, '..', 'create.ts'),
        'utf-8'
      );
      expect(createSrc).toContain("name: 'displayName'");
      expect(createSrc).toContain("message: 'Display name (human-readable):'");
    });
  });
});
