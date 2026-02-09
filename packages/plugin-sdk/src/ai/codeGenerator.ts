/**
 * AI Code Generator
 * Generates plugin code from PluginSpec using LLM.
 */

import type {
  PluginSpec,
  UserStory,
  DataModel,
  GeneratedPlugin,
  GeneratedFile,
  CodeGenerationOptions,
  IterationRequest,
  FileChange,
  LLMClient,
  LLMConfig,
} from './types.js';
import {
  FRONTEND_SYSTEM_PROMPT,
  BACKEND_SYSTEM_PROMPT,
  TEST_SYSTEM_PROMPT,
  MANIFEST_SYSTEM_PROMPT,
  ITERATE_SYSTEM_PROMPT,
} from './prompts.js';

/**
 * Code generation error
 */
export class CodeGenerationError extends Error {
  public readonly component: string;

  constructor(
    message: string,
    component: string,
    cause?: Error,
  ) {
    super(`[${component}] ${message}`, { cause });
    this.name = 'CodeGenerationError';
    this.component = component;
  }
}

/**
 * Simple mock LLM client for when no API key is available
 * Returns template code based on the spec
 */
class MockLLMClient implements LLMClient {
  async complete(): Promise<string> {
    return '// Generated code placeholder\n// Configure LLM API key for actual generation';
  }

  async *streamComplete(): AsyncIterable<string> {
    yield '// Generated code placeholder';
  }
}

/**
 * Anthropic Claude LLM client
 */
class AnthropicLLMClient implements LLMClient {
  constructor(private config: LLMConfig) {}

  async complete(request: { system: string; messages: Array<{ role: string; content: string }> }): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.config.model || 'claude-sonnet-4-20250514',
        max_tokens: this.config.maxTokens || 4096,
        system: request.system,
        messages: request.messages,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${error}`);
    }

    const data = await response.json() as { content: Array<{ text: string }> };
    return data.content[0]?.text || '';
  }

  async *streamComplete(request: { system: string; messages: Array<{ role: string; content: string }> }): AsyncIterable<string> {
    // For simplicity, use non-streaming for now
    const result = await this.complete(request);
    yield result;
  }
}

/**
 * CodeGenerator - Generates plugin code from PluginSpec
 */
export class CodeGenerator {
  private llm: LLMClient;

  constructor(
    config?: LLMConfig,
    llmClient?: LLMClient,
  ) {
    if (llmClient) {
      this.llm = llmClient;
    } else if (config?.apiKey) {
      this.llm = new AnthropicLLMClient(config);
    } else {
      // Use mock client if no API key
      this.llm = new MockLLMClient();
    }
  }

  /**
   * Generate complete plugin from specification
   */
  async generatePlugin(options: CodeGenerationOptions): Promise<GeneratedPlugin> {
    const { spec, skipTests, skipBackend } = options;

    // Generate in parallel where possible
    const [manifest, dataModel, frontend] = await Promise.all([
      this.generateManifest(spec),
      this.generateDataModel(spec),
      this.generateFrontend(spec),
    ]);

    const backend = skipBackend ? [] : await this.generateBackend(spec);
    const tests = skipTests ? [] : await this.generateTests(spec);

    return {
      manifest,
      dataModel,
      frontend,
      backend,
      tests,
    };
  }

  /**
   * Generate plugin.json manifest
   */
  async generateManifest(spec: PluginSpec): Promise<Record<string, unknown>> {
    const prompt = this.buildManifestPrompt(spec);

    try {
      const response = await this.llm.complete({
        system: MANIFEST_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      });

      // Extract JSON from response
      const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/) ||
                        response.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        return JSON.parse(jsonStr);
      }

      // Fallback to template-based generation
      return this.buildManifestTemplate(spec);
    } catch (error) {
      // Fallback to template
      return this.buildManifestTemplate(spec);
    }
  }

  /**
   * Generate data model files (Prisma schema)
   */
  async generateDataModel(spec: PluginSpec): Promise<GeneratedFile[]> {
    if (spec.dataModel.length === 0) {
      return [];
    }

    const pgSchemaName = `plugin_${spec.name.replace(/-/g, '_')}`;
    const prismaModels = this.buildPrismaSchema(spec.dataModel, pgSchemaName);

    return [
      {
        path: 'APPEND_TO_packages_database_prisma_schema.prisma',
        content: prismaModels,
        description: `Prisma models to append to packages/database/prisma/schema.prisma (schema: ${pgSchemaName})`,
      },
    ];
  }

  /**
   * Generate frontend React components
   */
  async generateFrontend(spec: PluginSpec): Promise<GeneratedFile[]> {
    const files: GeneratedFile[] = [];

    // Generate App.tsx (main router)
    files.push({
      path: 'frontend/src/App.tsx',
      content: this.buildAppRouter(spec),
      description: 'Main application with routing',
    });

    // Generate mount.tsx
    files.push({
      path: 'frontend/src/mount.tsx',
      content: this.buildMountFile(spec),
      description: 'Plugin mount entry point',
    });

    // Generate pages from user stories
    for (const story of spec.userStories) {
      const pageName = this.storyToPageName(story);
      const pageContent = await this.generatePage(spec, story);

      files.push({
        path: `frontend/src/pages/${pageName}.tsx`,
        content: pageContent,
        description: `Page for ${story.title}`,
      });
    }

    // Generate shared components
    files.push({
      path: 'frontend/src/components/LoadingSpinner.tsx',
      content: this.buildLoadingSpinner(),
      description: 'Loading spinner component',
    });

    files.push({
      path: 'frontend/src/components/ErrorMessage.tsx',
      content: this.buildErrorMessage(),
      description: 'Error message component',
    });

    return files;
  }

  /**
   * Generate backend Express routes
   */
  async generateBackend(spec: PluginSpec): Promise<GeneratedFile[]> {
    const files: GeneratedFile[] = [];

    // Generate server.ts
    files.push({
      path: 'backend/src/server.ts',
      content: this.buildServerFile(spec),
      description: 'Express server entry point',
    });

    // Generate routes for each data model
    for (const model of spec.dataModel) {
      const routeContent = await this.generateRoute(spec, model);

      files.push({
        path: `backend/src/routes/${model.name.toLowerCase()}.ts`,
        content: routeContent,
        description: `CRUD routes for ${model.name}`,
      });
    }

    // Generate middleware
    files.push({
      path: 'backend/src/middleware/auth.ts',
      content: this.buildAuthMiddleware(spec),
      description: 'Authentication middleware',
    });

    // Generate db client
    files.push({
      path: 'backend/src/db/client.ts',
      content: this.buildDbClient(),
      description: 'Prisma client export',
    });

    return files;
  }

  /**
   * Generate test files
   */
  async generateTests(spec: PluginSpec): Promise<GeneratedFile[]> {
    const files: GeneratedFile[] = [];

    // Generate tests for each user story
    for (const story of spec.userStories) {
      const testName = this.storyToTestName(story);
      const testContent = await this.generateStoryTests(spec, story);

      files.push({
        path: `tests/${testName}.test.tsx`,
        content: testContent,
        description: `Tests for ${story.title}`,
      });
    }

    // Generate contract tests
    files.push({
      path: 'tests/contract.test.ts',
      content: this.buildContractTests(spec),
      description: 'API contract tests',
    });

    return files;
  }

  /**
   * Iterate on existing plugin code
   * Note: This method requires a real LLM connection - there's no template fallback
   * for code iteration since it requires understanding context.
   */
  async iterate(request: IterationRequest): Promise<FileChange[]> {
    const prompt = this.buildIteratePrompt(request);

    try {
      const response = await this.llm.complete({
        system: ITERATE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      });

      return this.parseIterationResponse(response, request.currentCode);
    } catch (error) {
      // Re-throw with more context
      if (error instanceof Error) {
        throw new CodeGenerationError(
          `Failed to iterate on plugin code: ${error.message}`,
          'iterate',
          error,
        );
      }
      throw new CodeGenerationError(
        'Unknown error during code iteration',
        'iterate',
      );
    }
  }

  /**
   * Alias for iterate() for backward compatibility
   */
  async iteratePlugin(request: IterationRequest): Promise<FileChange[]> {
    return this.iterate(request);
  }

  // --- Private helper methods ---

  private buildManifestPrompt(spec: PluginSpec): string {
    return `Generate a plugin.json manifest for this plugin:

Name: ${spec.name}
Display Name: ${spec.displayName}
Description: ${spec.description}
Category: ${spec.category || 'productivity'}

User Stories:
${spec.userStories.map(s => `- ${s.id}: ${s.title}`).join('\n')}

Data Models:
${spec.dataModel.map(m => `- ${m.name}: ${m.fields.map(f => f.name).join(', ')}`).join('\n')}

Permissions:
${spec.permissions.map(p => `- ${p.role}: ${p.actions.join(', ')}`).join('\n')}

Integrations:
${spec.integrations.map(i => `- ${i.name} (${i.required ? 'required' : 'optional'})`).join('\n')}

Settings:
${spec.settings.map(s => `- ${s.name}: ${s.type}${s.required ? '' : ' (optional)'}`).join('\n')}
`;
  }

  private buildManifestTemplate(spec: PluginSpec): Record<string, unknown> {
    return {
      name: spec.name,
      displayName: spec.displayName,
      version: spec.version || '1.0.0',
      description: spec.description,
      category: spec.category || 'productivity',
      frontend: {
        entry: `./frontend/dist/production/${spec.name || 'plugin'}.js`,
      },
      backend: spec.dataModel.length > 0 ? {
        entry: './backend/dist/server.js',
        port: 3001,
      } : undefined,
      database: spec.dataModel.length > 0 ? {
        schema: './backend/prisma/schema.prisma',
        migrations: './backend/prisma/migrations',
      } : undefined,
      permissions: spec.permissions.map(p => ({
        role: p.role,
        actions: p.actions,
      })),
      settings: spec.settings.length > 0 ? {
        schema: {
          type: 'object',
          properties: Object.fromEntries(
            spec.settings.map(s => [s.name, {
              type: s.type,
              description: s.description,
              default: s.default,
            }])
          ),
        },
      } : undefined,
      integrations: spec.integrations.map(i => ({
        name: i.name,
        required: i.required,
      })),
    };
  }

  private buildPrismaSchema(dataModel: DataModel[], schemaName?: string): string {
    const pgSchema = schemaName || 'plugin_unknown';

    const models = dataModel.map(model => {
      const fields = model.fields.map(field => {
        let type = this.toPrismaType(field.type);
        if (field.optional) type += '?';
        if (field.enumValues) {
          type = field.name + 'Type';
        }

        let line = `  ${field.name} ${type}`;
        if (field.name === 'id') {
          line += ' @id @default(uuid())';
        }
        if (field.default) {
          line += ` @default(${field.default})`;
        }
        return line;
      }).join('\n');

      return `model ${model.name} {
${fields}
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@schema("${pgSchema}")
}`;
    }).join('\n\n');

    const enums = dataModel.flatMap(model =>
      model.fields
        .filter(f => f.enumValues)
        .map(f => `enum ${f.name}Type {
  ${f.enumValues!.join('\n  ')}

  @@schema("${pgSchema}")
}`)
    ).join('\n\n');

    return `// Prisma models for ${dataModel[0]?.name || 'Plugin'}
// Generated by NAAP Plugin CLI
//
// IMPORTANT: Append these models to packages/database/prisma/schema.prisma
// Do NOT create a local prisma/schema.prisma in your plugin directory.
// Also add "${pgSchema}" to the schemas array if not already present.
// Also add: CREATE SCHEMA IF NOT EXISTS ${pgSchema}; to docker/init-schemas.sql

${enums}

${models}
`;
  }

  private toPrismaType(type: string): string {
    const typeMap: Record<string, string> = {
      string: 'String',
      String: 'String',
      number: 'Int',
      int: 'Int',
      Int: 'Int',
      float: 'Float',
      Float: 'Float',
      decimal: 'Decimal',
      Decimal: 'Decimal',
      boolean: 'Boolean',
      Boolean: 'Boolean',
      bool: 'Boolean',
      datetime: 'DateTime',
      DateTime: 'DateTime',
      date: 'DateTime',
      json: 'Json',
      Json: 'Json',
      uuid: 'String',
      UUID: 'String',
    };

    return typeMap[type] || 'String';
  }

  private buildAppRouter(spec: PluginSpec): string {
    const pages = spec.userStories.map(story => {
      const pageName = this.storyToPageName(story);
      const componentName = this.toPascalCase(pageName);
      const route = this.storyToRoute(story);
      return { pageName, componentName, route };
    });

    const imports = pages.map(p =>
      `import { ${p.componentName} } from './pages/${p.pageName}.js';`
    ).join('\n');

    const routes = pages.map(p =>
      `        <Route path="${p.route}" element={<${p.componentName} />} />`
    ).join('\n');

    return `/**
 * ${spec.displayName} - Main Application
 * Generated by NAAP Plugin CLI
 */

import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
${imports}

export function App() {
  return (
    <div className="min-h-screen bg-background">
      <Routes>
${routes}
        <Route path="*" element={<Navigate to="${pages[0]?.route || '/'}" replace />} />
      </Routes>
    </div>
  );
}

export default App;
`;
  }

  private buildMountFile(spec: PluginSpec): string {
    return `/**
 * ${spec.displayName} - Mount Entry Point
 * Generated by NAAP Plugin CLI
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ShellProvider } from '@naap/plugin-sdk';
import type { ShellContext } from '@naap/plugin-sdk';
import App from './App.js';
import './globals.css';

let root: ReturnType<typeof createRoot> | null = null;

export function mount(container: HTMLElement, context: ShellContext) {
  root = createRoot(container);
  root.render(
    <React.StrictMode>
      <ShellProvider value={context}>
        <BrowserRouter basename={context.pluginBasePath}>
          <App />
        </BrowserRouter>
      </ShellProvider>
    </React.StrictMode>
  );
}

export function unmount() {
  if (root) {
    root.unmount();
    root = null;
  }
}

// For standalone development
if (import.meta.env.DEV && document.getElementById('root')) {
  const mockContext: ShellContext = {
    auth: {
      getToken: async () => 'dev-token',
      getUser: () => ({ id: 'dev-user', email: 'dev@example.com' }),
      login: () => {},
      logout: () => {},
      isAuthenticated: () => true,
      hasRole: () => true,
      hasPermission: () => true,
      onAuthStateChange: () => () => {},
    },
    notifications: {
      success: (msg) => console.log('Success:', msg),
      error: (msg) => console.error('Error:', msg),
      info: (msg) => console.info('Info:', msg),
      warning: (msg) => console.warn('Warning:', msg),
    },
    navigate: (path) => console.log('Navigate:', path),
    eventBus: {
      emit: () => {},
      on: () => () => {},
      off: () => {},
      once: () => () => {},
    },
    theme: {
      current: 'light',
      toggle: () => {},
      set: () => {},
    },
    team: {
      getCurrentTeam: () => null,
      getTeams: async () => [],
      switchTeam: async () => {},
      onTeamChange: () => () => {},
    },
    api: {
      fetch: (url, options) => fetch(url, options),
      get: (url) => fetch(url).then(r => r.json()),
      post: (url, data) => fetch(url, { method: 'POST', body: JSON.stringify(data) }).then(r => r.json()),
      put: (url, data) => fetch(url, { method: 'PUT', body: JSON.stringify(data) }).then(r => r.json()),
      delete: (url) => fetch(url, { method: 'DELETE' }).then(r => r.json()),
    },
    logger: console,
    pluginBasePath: '/${spec.name}',
    version: '${spec.version}',
  };

  mount(document.getElementById('root')!, mockContext);
}
`;
  }

  private async generatePage(spec: PluginSpec, story: UserStory): Promise<string> {
    const prompt = `Generate a React component for this user story:

Title: ${story.title}
As a: ${story.asA}
I want: ${story.iWant}
So that: ${story.soThat}

Acceptance Criteria:
${story.acceptanceCriteria.map(c => `- ${c.description}`).join('\n')}

Data Model:
${JSON.stringify(spec.dataModel, null, 2)}

Permissions:
${spec.permissions.map(p => `- ${p.role}: ${p.actions.join(', ')}`).join('\n')}
`;

    try {
      return await this.llm.complete({
        system: FRONTEND_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      });
    } catch {
      // Return template page
      return this.buildTemplatePage(spec, story);
    }
  }

  private buildTemplatePage(spec: PluginSpec, story: UserStory): string {
    const componentName = this.toPascalCase(this.storyToPageName(story));

    return `/**
 * ${componentName} Page
 * ${story.title}
 * Generated by NAAP Plugin CLI
 */

import React, { useState, useEffect } from 'react';
import { useAuth, useTeam, useNotify, useApiClient } from '@naap/plugin-sdk';
import { Loader2, AlertCircle } from 'lucide-react';

export function ${componentName}() {
  const { user, hasPermission } = useAuth();
  const { currentTeam } = useTeam();
  const notify = useNotify();
  const api = useApiClient();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError(null);
      // TODO: Implement data loading
    } catch (err) {
      setError('Failed to load data');
      notify.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 p-4 bg-destructive/10 text-destructive rounded-lg">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
          <button onClick={loadData} className="ml-auto underline">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">${story.title}</h1>
      <p className="text-muted-foreground mb-6">
        ${story.iWant}
      </p>

      {/* TODO: Implement UI for acceptance criteria:
${story.acceptanceCriteria.map(c => `        - ${c.description}`).join('\n')}
      */}

      <div className="bg-card border border-border rounded-lg p-6">
        <p className="text-muted-foreground">
          Implementation needed. See acceptance criteria above.
        </p>
      </div>
    </div>
  );
}
`;
  }

  private async generateRoute(spec: PluginSpec, model: DataModel): Promise<string> {
    const prompt = `Generate Express.js CRUD routes for:

Model: ${model.name}
Fields: ${JSON.stringify(model.fields, null, 2)}

Permissions required:
${spec.permissions.map(p => `- ${p.role}: ${p.actions.join(', ')}`).join('\n')}
`;

    try {
      return await this.llm.complete({
        system: BACKEND_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      });
    } catch {
      return this.buildTemplateRoute(model);
    }
  }

  private buildTemplateRoute(model: DataModel): string {
    const modelLower = model.name.toLowerCase();

    return `/**
 * ${model.name} Routes
 * Generated by NAAP Plugin CLI
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { requirePermission } from '../middleware/auth.js';

const router = Router();

// Validation schemas
const Create${model.name}Schema = z.object({
${model.fields.filter(f => f.name !== 'id').map(f =>
  `  ${f.name}: z.${this.toZodType(f.type)}()${f.optional ? '.optional()' : ''},`
).join('\n')}
});

const Update${model.name}Schema = Create${model.name}Schema.partial();

// GET /api/plugin/${modelLower} - List all
router.get('/', async (req, res) => {
  try {
    const { team } = req;

    const items = await prisma.${modelLower}.findMany({
      where: { teamId: team.id },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: items });
  } catch (error) {
    console.error('Failed to fetch ${modelLower}:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/plugin/${modelLower}/:id - Get one
router.get('/:id', async (req, res) => {
  try {
    const { team } = req;
    const { id } = req.params;

    const item = await prisma.${modelLower}.findFirst({
      where: { id, teamId: team.id },
    });

    if (!item) {
      res.status(404).json({ success: false, error: 'Not found' });
      return;
    }

    res.json({ success: true, data: item });
  } catch (error) {
    console.error('Failed to fetch ${modelLower}:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/plugin/${modelLower} - Create
router.post('/', requirePermission('create'), async (req, res) => {
  try {
    const { user, team } = req;
    const data = Create${model.name}Schema.parse(req.body);

    const item = await prisma.${modelLower}.create({
      data: {
        ...data,
        teamId: team.id,
        createdBy: user.id,
      },
    });

    res.status(201).json({ success: true, data: item });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: error.errors });
      return;
    }
    console.error('Failed to create ${modelLower}:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/plugin/${modelLower}/:id - Update
router.put('/:id', requirePermission('update'), async (req, res) => {
  try {
    const { team } = req;
    const { id } = req.params;
    const data = Update${model.name}Schema.parse(req.body);

    const item = await prisma.${modelLower}.update({
      where: { id, teamId: team.id },
      data,
    });

    res.json({ success: true, data: item });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: error.errors });
      return;
    }
    console.error('Failed to update ${modelLower}:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/plugin/${modelLower}/:id - Delete
router.delete('/:id', requirePermission('delete'), async (req, res) => {
  try {
    const { team } = req;
    const { id } = req.params;

    await prisma.${modelLower}.delete({
      where: { id, teamId: team.id },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete ${modelLower}:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
`;
  }

  private toZodType(type: string): string {
    const typeMap: Record<string, string> = {
      string: 'string',
      String: 'string',
      number: 'number',
      int: 'number',
      Int: 'number',
      float: 'number',
      Float: 'number',
      decimal: 'number',
      Decimal: 'number',
      boolean: 'boolean',
      Boolean: 'boolean',
      bool: 'boolean',
    };

    return typeMap[type] || 'string';
  }

  private buildServerFile(spec: PluginSpec): string {
    const routeImports = spec.dataModel.map(m =>
      `import ${m.name.toLowerCase()}Routes from './routes/${m.name.toLowerCase()}.js';`
    ).join('\n');

    const routeUses = spec.dataModel.map(m =>
      `app.use('/api/plugin/${m.name.toLowerCase()}', ${m.name.toLowerCase()}Routes);`
    ).join('\n');

    return `/**
 * ${spec.displayName} - Backend Server
 * Generated by NAAP Plugin CLI
 */

import express from 'express';
import cors from 'cors';
import { authMiddleware } from './middleware/auth.js';
${routeImports}

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(authMiddleware);

// Health check
app.get('/healthz', (req, res) => {
  res.json({ status: 'healthy', plugin: '${spec.name}', version: '${spec.version}' });
});

// Routes
${routeUses}

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(\`${spec.displayName} backend running on port \${PORT}\`);
});

export default app;
`;
  }

  private buildAuthMiddleware(spec: PluginSpec): string {
    return `/**
 * Authentication Middleware
 * Generated by NAAP Plugin CLI
 */

import { Request, Response, NextFunction } from 'express';

export interface AuthUser {
  id: string;
  email: string;
  roles: string[];
}

export interface AuthTeam {
  id: string;
  name: string;
  membership: {
    role: string;
  };
}

declare global {
  namespace Express {
    interface Request {
      user: AuthUser;
      team: AuthTeam;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // In production, this would validate JWT from shell
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  // Mock user for development
  req.user = {
    id: 'dev-user',
    email: 'dev@example.com',
    roles: ['team:admin'],
  };

  req.team = {
    id: 'dev-team',
    name: 'Development Team',
    membership: { role: 'admin' },
  };

  next();
}

export function requirePermission(action: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const { user, team } = req;

    // Check permission based on role
    const rolePermissions: Record<string, string[]> = {
${spec.permissions.map(p => `      '${p.role}': [${p.actions.map(a => `'${a}'`).join(', ')}],`).join('\n')}
    };

    const userRole = \`team:\${team.membership.role}\`;
    const allowed = rolePermissions[userRole]?.includes(action);

    if (!allowed) {
      res.status(403).json({ success: false, error: 'Permission denied' });
      return;
    }

    next();
  };
}
`;
  }

  private buildDbClient(): string {
    return `/**
 * Prisma Database Client
 * Generated by NAAP Plugin CLI
 */

import { prisma } from '@naap/database';

export { prisma };
}
`;
  }

  private async generateStoryTests(spec: PluginSpec, story: UserStory): Promise<string> {
    const prompt = `Generate tests for this user story:

${story.title}

Acceptance Criteria:
${story.acceptanceCriteria.map(c => `- ${c.description}`).join('\n')}

Data Model:
${JSON.stringify(spec.dataModel, null, 2)}
`;

    try {
      return await this.llm.complete({
        system: TEST_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      });
    } catch {
      return this.buildTemplateTests(story);
    }
  }

  private buildTemplateTests(story: UserStory): string {
    const testName = this.storyToTestName(story);
    const componentName = this.toPascalCase(this.storyToPageName(story));

    return `/**
 * Tests for ${story.title}
 * Generated by NAAP Plugin CLI
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithShell, createMockUser, createMockTeam } from '@naap/plugin-sdk/testing';
import { ${componentName} } from '../frontend/src/pages/${this.storyToPageName(story)}.js';

describe('${story.id}: ${story.title}', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Acceptance Criteria', () => {
${story.acceptanceCriteria.map((c, i) => `
    it('should ${c.description.toLowerCase()}', async () => {
      renderWithShell(<${componentName} />, {
        user: createMockUser({ roles: ['admin'] }),
        team: createMockTeam(),
      });

      // TODO: Implement test for: ${c.description}
      await waitFor(() => {
        expect(screen.getByRole('main')).toBeInTheDocument();
      });
    });
`).join('')}
  });

  describe('Error Handling', () => {
    it('should handle loading state', () => {
      renderWithShell(<${componentName} />);
      // Check for loading indicator
    });

    it('should handle error state', async () => {
      // Mock API failure and verify error message
    });
  });

  describe('Permissions', () => {
    it('should respect user permissions', () => {
      renderWithShell(<${componentName} />, {
        user: createMockUser({ permissions: [] }),
      });
      // Verify restricted actions are not available
    });
  });
});
`;
  }

  private buildContractTests(spec: PluginSpec): string {
    return `/**
 * API Contract Tests
 * Generated by NAAP Plugin CLI
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../backend/src/server.js';

describe('${spec.displayName} API Contract', () => {
  const authHeader = { Authorization: 'Bearer test-token' };

${spec.dataModel.map(model => `
  describe('${model.name} API', () => {
    const baseUrl = '/api/plugin/${model.name.toLowerCase()}';

    it('GET / should return array', async () => {
      const res = await request(app)
        .get(baseUrl)
        .set(authHeader);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('POST / should create item', async () => {
      const res = await request(app)
        .post(baseUrl)
        .set(authHeader)
        .send({
          // TODO: Add required fields
        });

      expect([201, 400]).toContain(res.status);
      expect(res.body).toHaveProperty('success');
    });

    it('GET /:id should return item or 404', async () => {
      const res = await request(app)
        .get(\`\${baseUrl}/nonexistent-id\`)
        .set(authHeader);

      expect([200, 404]).toContain(res.status);
    });
  });
`).join('')}
});
`;
  }

  private buildLoadingSpinner(): string {
    return `/**
 * Loading Spinner Component
 * Generated by NAAP Plugin CLI
 */

import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
}

export function LoadingSpinner({ size = 'md', text }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };

  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <Loader2 className={\`\${sizeClasses[size]} animate-spin text-primary\`} />
      {text && <p className="text-muted-foreground text-sm">{text}</p>}
    </div>
  );
}
`;
  }

  private buildErrorMessage(): string {
    return `/**
 * Error Message Component
 * Generated by NAAP Plugin CLI
 */

import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorMessage({ message, onRetry }: ErrorMessageProps) {
  return (
    <div className="flex items-center gap-3 p-4 bg-destructive/10 text-destructive rounded-lg">
      <AlertCircle className="w-5 h-5 flex-shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1 px-3 py-1 bg-destructive/20 rounded hover:bg-destructive/30 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      )}
    </div>
  );
}
`;
  }

  private buildIteratePrompt(request: IterationRequest): string {
    return `Modify this plugin based on the following instruction:

INSTRUCTION: ${request.instruction}

CURRENT SPEC:
${request.spec.rawMarkdown}

${request.targetFile ? `TARGET FILE: ${request.targetFile}` : ''}
${request.targetStory ? `TARGET USER STORY: ${request.targetStory}` : ''}

CURRENT CODE:
${Array.from(request.currentCode.entries()).map(([path, content]) =>
  `--- ${path} ---\n${content}`
).join('\n\n')}

Generate the necessary changes to implement the instruction.
`;
  }

  private parseIterationResponse(response: string, currentCode: Map<string, string>): FileChange[] {
    const changes: FileChange[] = [];

    // Parse diff blocks
    const diffRegex = /```diff\n([\s\S]*?)```/g;
    let match;

    while ((match = diffRegex.exec(response)) !== null) {
      const diffContent = match[1];

      // Extract file path from diff header
      const fileMatch = diffContent.match(/---\s+a\/(.+)/);
      if (fileMatch) {
        const file = fileMatch[1];
        const oldContent = currentCode.get(file) || '';

        // Find new content block after diff
        const newContentRegex = new RegExp(`\`\`\`(?:tsx?|jsx?|ts|js)\\n([\\s\\S]*?)\`\`\``, 'g');
        const contentMatch = newContentRegex.exec(response.slice(match.index + match[0].length));

        if (contentMatch) {
          changes.push({
            file,
            oldContent,
            newContent: contentMatch[1],
            diff: diffContent,
            description: `Modified ${file}`,
          });
        }
      }
    }

    return changes;
  }

  // --- Utility methods ---

  private storyToPageName(story: UserStory): string {
    // Convert story title to page name
    // e.g., "Create Expense" -> "CreateExpense"
    return story.title
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }

  private storyToRoute(story: UserStory): string {
    // Convert story ID to route
    // e.g., "US-1" -> "/", "US-2" -> "/approve"
    const title = story.title.toLowerCase();

    if (title.includes('create')) return '/create';
    if (title.includes('list') || title.includes('view all')) return '/';
    if (title.includes('edit')) return '/edit/:id';
    if (title.includes('delete')) return '/delete/:id';
    if (title.includes('approve')) return '/approve';
    if (title.includes('dashboard') || title.includes('analytics')) return '/dashboard';
    if (title.includes('settings')) return '/settings';

    return `/${story.id.toLowerCase().replace('us-', '')}`;
  }

  private storyToTestName(story: UserStory): string {
    return story.id.toLowerCase().replace('-', '_');
  }

  private toPascalCase(str: string): string {
    return str
      .replace(/[^a-zA-Z0-9]/g, ' ')
      .split(/\s+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
  }
}

/**
 * Create a new CodeGenerator instance
 */
export function createCodeGenerator(config?: LLMConfig): CodeGenerator {
  return new CodeGenerator(config);
}
