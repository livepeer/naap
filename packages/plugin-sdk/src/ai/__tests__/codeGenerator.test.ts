/**
 * CodeGenerator Tests
 *
 * Tests for AI-assisted plugin code generation functionality.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CodeGenerator, createCodeGenerator } from '../codeGenerator.js';
import type {
  PluginSpec,
  UserStory,
  DataModel,
  GeneratedPlugin,
  LLMClient,
} from '../types.js';

// Mock LLM Client that always throws to trigger template fallback
class TemplateFallbackLLMClient implements LLMClient {
  async complete(): Promise<string> {
    throw new Error('Mock error - use template fallback');
  }

  async *streamComplete(): AsyncIterable<string> {
    throw new Error('Mock error - use template fallback');
  }
}

// Mock LLM Client with controlled responses
class MockLLMClient implements LLMClient {
  responses: Map<string, string> = new Map();

  setResponse(prompt: string, response: string) {
    this.responses.set(prompt, response);
  }

  async complete(request: { system: string; messages: Array<{ role: string; content: string }> }): Promise<string> {
    const userMessage = request.messages.find(m => m.role === 'user')?.content || '';
    for (const [key, value] of this.responses) {
      if (userMessage.includes(key)) {
        return value;
      }
    }
    throw new Error('No mock response - use template fallback');
  }

  async *streamComplete(): AsyncIterable<string> {
    throw new Error('No mock response - use template fallback');
  }
}

// Test fixtures
function createTestSpec(overrides: Partial<PluginSpec> = {}): PluginSpec {
  return {
    name: 'expense-tracker',
    displayName: 'Expense Tracker',
    description: 'Track team expenses',
    version: '1.0.0',
    category: 'productivity',
    userStories: [
      {
        id: 'US-1',
        title: 'Create Expense',
        asA: 'team member',
        iWant: 'create expense entries',
        soThat: 'I can track my spending',
        acceptanceCriteria: [
          { description: 'Can enter amount', completed: false },
          { description: 'Can select category', completed: false },
        ],
      },
      {
        id: 'US-2',
        title: 'View Expenses',
        asA: 'team member',
        iWant: 'view my expenses',
        soThat: 'I can see my spending history',
        acceptanceCriteria: [
          { description: 'Shows list of expenses', completed: false },
          { description: 'Can filter by date', completed: false },
        ],
      },
    ],
    dataModel: [
      {
        name: 'Expense',
        fields: [
          { name: 'id', type: 'String', optional: false },
          { name: 'amount', type: 'Decimal', optional: false },
          { name: 'category', type: 'String', optional: false },
          { name: 'description', type: 'String', optional: true },
        ],
      },
    ],
    permissions: [
      { role: 'team:member', actions: ['read', 'create'] },
      { role: 'team:admin', actions: ['read', 'create', 'update', 'delete', 'approve'] },
    ],
    integrations: [
      { name: 'storage', type: 'Storage', required: false, description: 'Receipt uploads' },
    ],
    settings: [
      { name: 'currency', type: 'string', required: false, default: 'USD', description: 'Default currency' },
    ],
    rawMarkdown: '# Expense Tracker\n...',
    ...overrides,
  };
}

describe('CodeGenerator', () => {
  let generator: CodeGenerator;
  let mockLLM: MockLLMClient;

  beforeEach(() => {
    mockLLM = new MockLLMClient();
    generator = new CodeGenerator(undefined, mockLLM);
  });

  describe('Factory Function', () => {
    it('should create generator without config', () => {
      const gen = createCodeGenerator();
      expect(gen).toBeInstanceOf(CodeGenerator);
    });

    it('should create generator with config', () => {
      const gen = createCodeGenerator({
        provider: 'anthropic',
        apiKey: 'test-key',
      });
      expect(gen).toBeInstanceOf(CodeGenerator);
    });
  });

  describe('generatePlugin', () => {
    it('should generate complete plugin structure', async () => {
      const spec = createTestSpec();

      const result = await generator.generatePlugin({
        spec,
        dryRun: true,
      });

      expect(result.manifest).toBeDefined();
      expect(result.dataModel).toBeDefined();
      expect(result.frontend).toBeDefined();
      expect(result.backend).toBeDefined();
      expect(result.tests).toBeDefined();
    });

    it('should skip tests when option is set', async () => {
      const spec = createTestSpec();

      const result = await generator.generatePlugin({
        spec,
        skipTests: true,
      });

      expect(result.tests.length).toBe(0);
    });

    it('should skip backend when option is set', async () => {
      const spec = createTestSpec();

      const result = await generator.generatePlugin({
        spec,
        skipBackend: true,
      });

      expect(result.backend.length).toBe(0);
    });
  });

  describe('generateManifest', () => {
    it('should generate valid manifest', async () => {
      const spec = createTestSpec();

      const manifest = await generator.generateManifest(spec);

      expect(manifest.name).toBe('expense-tracker');
      expect(manifest.displayName).toBe('Expense Tracker');
      expect(manifest.version).toBe('1.0.0');
      expect(manifest.description).toBe('Track team expenses');
    });

    it('should include frontend config', async () => {
      const spec = createTestSpec();

      const manifest = await generator.generateManifest(spec);

      expect(manifest.frontend).toBeDefined();
      expect((manifest.frontend as Record<string, unknown>).entry).toMatch(/\.\/frontend\/dist\/production\/.*\.js/);
    });

    it('should include backend config when data model exists', async () => {
      const spec = createTestSpec();

      const manifest = await generator.generateManifest(spec);

      expect(manifest.backend).toBeDefined();
      expect((manifest.backend as Record<string, unknown>).entry).toBe('./backend/dist/server.js');
    });

    it('should include database config when data model exists', async () => {
      const spec = createTestSpec();

      const manifest = await generator.generateManifest(spec);

      expect(manifest.database).toBeDefined();
      expect((manifest.database as Record<string, unknown>).schema).toBe('./backend/prisma/schema.prisma');
    });

    it('should include permissions', async () => {
      const spec = createTestSpec();

      const manifest = await generator.generateManifest(spec);

      expect(manifest.permissions).toBeDefined();
      const permissions = manifest.permissions as Array<{ role: string; actions: string[] }>;
      expect(permissions.length).toBe(2);
      expect(permissions[0].role).toBe('team:member');
    });

    it('should omit backend/database when no data model', async () => {
      const spec = createTestSpec({ dataModel: [] });

      const manifest = await generator.generateManifest(spec);

      expect(manifest.backend).toBeUndefined();
      expect(manifest.database).toBeUndefined();
    });
  });

  describe('generateDataModel', () => {
    it('should generate Prisma schema', async () => {
      const spec = createTestSpec();

      const files = await generator.generateDataModel(spec);

      expect(files.length).toBe(1);
      expect(files[0].path).toBe('APPEND_TO_packages_database_prisma_schema.prisma');
    });

    it('should include model definition', async () => {
      const spec = createTestSpec();

      const files = await generator.generateDataModel(spec);
      const schema = files[0].content;

      expect(schema).toContain('model Expense');
      expect(schema).toContain('id String');
      expect(schema).toContain('amount Decimal');
    });

    it('should mark optional fields correctly', async () => {
      const spec = createTestSpec();

      const files = await generator.generateDataModel(spec);
      const schema = files[0].content;

      expect(schema).toContain('description String?');
    });

    it('should include createdAt and updatedAt', async () => {
      const spec = createTestSpec();

      const files = await generator.generateDataModel(spec);
      const schema = files[0].content;

      expect(schema).toContain('createdAt DateTime @default(now())');
      expect(schema).toContain('updatedAt DateTime @updatedAt');
    });

    it('should return empty array when no data model', async () => {
      const spec = createTestSpec({ dataModel: [] });

      const files = await generator.generateDataModel(spec);

      expect(files.length).toBe(0);
    });
  });

  describe('generateFrontend', () => {
    it('should generate App.tsx', async () => {
      const spec = createTestSpec();

      const files = await generator.generateFrontend(spec);
      const appFile = files.find(f => f.path.includes('App.tsx'));

      expect(appFile).toBeDefined();
      expect(appFile!.content).toContain('export function App');
    });

    it('should generate mount.tsx', async () => {
      const spec = createTestSpec();

      const files = await generator.generateFrontend(spec);
      const mountFile = files.find(f => f.path.includes('mount.tsx'));

      expect(mountFile).toBeDefined();
      expect(mountFile!.content).toContain('export function mount');
      expect(mountFile!.content).toContain('export function unmount');
    });

    it('should generate page for each user story', async () => {
      const spec = createTestSpec();

      const files = await generator.generateFrontend(spec);
      const pageFiles = files.filter(f => f.path.includes('/pages/'));

      expect(pageFiles.length).toBe(spec.userStories.length);
    });

    it('should generate shared components', async () => {
      const spec = createTestSpec();

      const files = await generator.generateFrontend(spec);
      const componentFiles = files.filter(f => f.path.includes('/components/'));

      expect(componentFiles.length).toBeGreaterThanOrEqual(2);
      expect(componentFiles.some(f => f.path.includes('LoadingSpinner'))).toBe(true);
      expect(componentFiles.some(f => f.path.includes('ErrorMessage'))).toBe(true);
    });

    it('should include React Router setup in App.tsx', async () => {
      const spec = createTestSpec();

      const files = await generator.generateFrontend(spec);
      const appFile = files.find(f => f.path.includes('App.tsx'));

      expect(appFile!.content).toContain('Routes');
      expect(appFile!.content).toContain('Route');
    });
  });

  describe('generateBackend', () => {
    it('should generate server.ts', async () => {
      const spec = createTestSpec();

      const files = await generator.generateBackend(spec);
      const serverFile = files.find(f => f.path.includes('server.ts'));

      expect(serverFile).toBeDefined();
      expect(serverFile!.content).toContain('express');
      expect(serverFile!.content).toContain('app.listen');
    });

    it('should generate route for each data model', async () => {
      const spec = createTestSpec();

      const files = await generator.generateBackend(spec);
      const routeFiles = files.filter(f => f.path.includes('/routes/'));

      expect(routeFiles.length).toBe(spec.dataModel.length);
      expect(routeFiles.some(f => f.path.includes('expense.ts'))).toBe(true);
    });

    it('should generate auth middleware', async () => {
      const spec = createTestSpec();

      const files = await generator.generateBackend(spec);
      const authFile = files.find(f => f.path.includes('auth.ts'));

      expect(authFile).toBeDefined();
      expect(authFile!.content).toContain('requirePermission');
    });

    it('should generate db client', async () => {
      const spec = createTestSpec();

      const files = await generator.generateBackend(spec);
      const dbFile = files.find(f => f.path.includes('client.ts'));

      expect(dbFile).toBeDefined();
      expect(dbFile!.content).toContain('prisma');
    });

    it('should include CRUD operations in routes', async () => {
      const spec = createTestSpec();

      const files = await generator.generateBackend(spec);
      const expenseRoute = files.find(f => f.path.includes('expense.ts'));

      expect(expenseRoute!.content).toContain("router.get('/'");
      expect(expenseRoute!.content).toContain("router.post('/'");
      expect(expenseRoute!.content).toContain("router.put('/:id'");
      expect(expenseRoute!.content).toContain("router.delete('/:id'");
    });

    it('should include Zod validation', async () => {
      const spec = createTestSpec();

      const files = await generator.generateBackend(spec);
      const expenseRoute = files.find(f => f.path.includes('expense.ts'));

      expect(expenseRoute!.content).toContain('z.object');
      expect(expenseRoute!.content).toContain('.parse(req.body)');
    });
  });

  describe('generateTests', () => {
    it('should generate test file for each user story', async () => {
      const spec = createTestSpec();

      const files = await generator.generateTests(spec);
      const storyTests = files.filter(f => f.path.includes('us_'));

      expect(storyTests.length).toBe(spec.userStories.length);
    });

    it('should generate contract tests', async () => {
      const spec = createTestSpec();

      const files = await generator.generateTests(spec);
      const contractTest = files.find(f => f.path.includes('contract.test'));

      expect(contractTest).toBeDefined();
      expect(contractTest!.content).toContain('API Contract');
    });

    it('should include acceptance criteria tests', async () => {
      const spec = createTestSpec();

      const files = await generator.generateTests(spec);
      const storyTest = files.find(f => f.path.includes('us_1'));

      expect(storyTest!.content).toContain('Acceptance Criteria');
      expect(storyTest!.content).toContain('describe');
      expect(storyTest!.content).toContain('it(');
    });

    it('should include error handling tests', async () => {
      const spec = createTestSpec();

      const files = await generator.generateTests(spec);
      const storyTest = files.find(f => f.path.includes('us_1'));

      expect(storyTest!.content).toContain('Error Handling');
    });

    it('should include permission tests', async () => {
      const spec = createTestSpec();

      const files = await generator.generateTests(spec);
      const storyTest = files.find(f => f.path.includes('us_1'));

      expect(storyTest!.content).toContain('Permissions');
    });
  });

  describe('Type Conversions', () => {
    it('should convert types to Prisma types correctly', async () => {
      const spec = createTestSpec({
        dataModel: [
          {
            name: 'TypeTest',
            fields: [
              { name: 'id', type: 'uuid', optional: false },
              { name: 'name', type: 'string', optional: false },
              { name: 'count', type: 'int', optional: false },
              { name: 'price', type: 'float', optional: false },
              { name: 'active', type: 'boolean', optional: false },
              { name: 'created', type: 'datetime', optional: false },
              { name: 'data', type: 'json', optional: true },
            ],
          },
        ],
      });

      const files = await generator.generateDataModel(spec);
      const schema = files[0].content;

      expect(schema).toContain('id String');
      expect(schema).toContain('name String');
      expect(schema).toContain('count Int');
      expect(schema).toContain('price Float');
      expect(schema).toContain('active Boolean');
      expect(schema).toContain('created DateTime');
      expect(schema).toContain('data Json?');
    });

    it('should convert types to Zod types correctly', async () => {
      const spec = createTestSpec({
        dataModel: [
          {
            name: 'ZodTest',
            fields: [
              { name: 'id', type: 'String', optional: false },
              { name: 'name', type: 'String', optional: false },
              { name: 'amount', type: 'Decimal', optional: false },
              { name: 'active', type: 'Boolean', optional: false },
            ],
          },
        ],
      });

      const files = await generator.generateBackend(spec);
      const route = files.find(f => f.path.includes('zodtest.ts'));

      // Note: 'id' is filtered out from create schema as it's auto-generated
      expect(route!.content).toContain('z.string()');  // for 'name' field
      expect(route!.content).toContain('z.number()');  // for 'amount' (Decimal -> number)
      expect(route!.content).toContain('z.boolean()'); // for 'active'
    });
  });

  describe('iterate', () => {
    it('should return changes when LLM provides valid diff response', async () => {
      // Create a custom mock that returns a valid diff response
      const customMock = new MockLLMClient();
      customMock.setResponse('Add a delete button', `Here are the changes:
\`\`\`diff
--- a/frontend/src/App.tsx
+++ b/frontend/src/App.tsx
@@ -10,6 +10,9 @@
  return (
    <div>
+     <button onClick={handleDelete}>Delete</button>
    </div>
  );
\`\`\`

\`\`\`tsx
// Updated file content
import React from 'react';
export function App() {
  return <div><button onClick={handleDelete}>Delete</button></div>;
}
\`\`\`
`);

      const customGenerator = new CodeGenerator(undefined, customMock);
      const spec = createTestSpec();
      const currentCode = new Map<string, string>();
      currentCode.set('frontend/src/App.tsx', '// Old code');

      const changes = await customGenerator.iterate({
        instruction: 'Add a delete button',
        spec,
        currentCode,
      });

      expect(Array.isArray(changes)).toBe(true);
    });

    it('should throw when LLM is unavailable', async () => {
      const spec = createTestSpec();
      const currentCode = new Map<string, string>();
      currentCode.set('frontend/src/pages/CreateExpense.tsx', '// Current page');

      // The mock LLM throws, so iterate should throw
      await expect(generator.iterate({
        instruction: 'Add validation',
        spec,
        currentCode,
        targetFile: 'frontend/src/pages/CreateExpense.tsx',
      })).rejects.toThrow();
    });

    it('should return empty array when no changes detected', async () => {
      // Mock that returns response without diff blocks
      const customMock = new MockLLMClient();
      customMock.setResponse('No changes needed', 'The code looks good as is.');

      const customGenerator = new CodeGenerator(undefined, customMock);
      const spec = createTestSpec();
      const currentCode = new Map<string, string>();
      currentCode.set('frontend/src/pages/CreateExpense.tsx', '// Current page');

      const changes = await customGenerator.iterate({
        instruction: 'No changes needed',
        spec,
        currentCode,
        targetStory: 'US-1',
      });

      expect(changes).toEqual([]);
    });
  });

  describe('Route Generation', () => {
    it('should derive routes from user story titles', async () => {
      const spec = createTestSpec({
        userStories: [
          {
            id: 'US-1',
            title: 'Create Item',
            asA: 'user',
            iWant: 'create items',
            soThat: 'tracking',
            acceptanceCriteria: [],
          },
          {
            id: 'US-2',
            title: 'List Items',
            asA: 'user',
            iWant: 'view items',
            soThat: 'reference',
            acceptanceCriteria: [],
          },
          {
            id: 'US-3',
            title: 'Edit Item',
            asA: 'user',
            iWant: 'edit items',
            soThat: 'updates',
            acceptanceCriteria: [],
          },
        ],
      });

      const files = await generator.generateFrontend(spec);
      const appFile = files.find(f => f.path.includes('App.tsx'));

      expect(appFile!.content).toContain('/create');
      expect(appFile!.content).toContain('/');
      expect(appFile!.content).toContain('/edit/:id');
    });
  });
});
