/**
 * create command
 * Scaffold a new plugin from templates
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs-extra';
import { validatePluginName, createDefaultManifest } from '../../src/utils/validation.js';
import type { PluginTemplate, PluginCategory } from '../../src/types/manifest.js';

const TEMPLATES: { value: PluginTemplate; name: string; description: string }[] = [
  { value: 'frontend-only', name: 'Frontend Only', description: 'UI plugin without backend (recommended start)' },
  { value: 'full-stack', name: 'Full Stack', description: 'Frontend + Backend + Database' },
  { value: 'backend-only', name: 'Backend Only', description: 'API service without UI' },
];

const CATEGORIES: { value: PluginCategory; name: string }[] = [
  { value: 'analytics', name: 'Analytics' },
  { value: 'monitoring', name: 'Monitoring' },
  { value: 'integration', name: 'Integration' },
  { value: 'developer-tools', name: 'Developer Tools' },
  { value: 'communication', name: 'Communication' },
  { value: 'security', name: 'Security' },
  { value: 'other', name: 'Other' },
];

const INTEGRATIONS = [
  { value: 'openai', name: 'OpenAI (AI/ML)' },
  { value: 'aws-s3', name: 'AWS S3 (Storage)' },
  { value: 'sendgrid', name: 'SendGrid (Email)' },
  { value: 'stripe', name: 'Stripe (Payments)' },
  { value: 'twilio', name: 'Twilio (Messaging)' },
];

const ROUTES_README_CONTENT = `# Adding Routes

## Quick steps

1. Create a new file, e.g. \`users.ts\`:
   \`\`\`ts
   import { Router } from 'express';
   export const usersRouter = Router();
   usersRouter.get('/', (_req, res) => res.json({ users: [] }));
   \`\`\`

2. Register it in \`index.ts\`:
   \`\`\`ts
   import { usersRouter } from './users.js';
   router.use('/users', usersRouter);
   \`\`\`

Or run: \`naap-plugin add endpoint users --crud\`
`;

export const createCommand = new Command('create')
  .description('Create a new NAAP plugin')
  .argument('[name]', 'Plugin name (kebab-case)')
  .option('-t, --template <template>', 'Template to use (full-stack, frontend-only, backend-only)')
  .option('-d, --directory <dir>', 'Target directory')
  .option('--simple', 'Full-stack without Prisma/Docker (in-memory backend)')
  .option('--skip-install', 'Skip npm install')
  .option('--skip-git', 'Skip git initialization')
  .action(async (name?: string, options?: {
    template?: string;
    directory?: string;
    simple?: boolean;
    skipInstall?: boolean;
    skipGit?: boolean;
  }) => {
    console.log(chalk.bold.blue('\n🚀 NAAP Plugin Creator\n'));

    // Interactive prompts if options not provided
    interface CreateAnswers {
      name?: string;
      template?: string;
      category?: PluginCategory;
      displayName?: string;
      description?: string;
      author?: string;
      integrations?: string[];
    }

    const answers = await inquirer.prompt<CreateAnswers>([
      {
        type: 'input',
        name: 'name',
        message: 'Plugin name (kebab-case):',
        default: name,
        validate: (input: string) => {
          if (!input) return 'Plugin name is required';
          if (!validatePluginName(input)) {
            return 'Name must be kebab-case (e.g., my-plugin)';
          }
          return true;
        },
        when: !name,
      },
      {
        type: 'input',
        name: 'displayName',
        message: 'Display name (human-readable):',
        default: (ans: CreateAnswers) => {
          const n = ans.name || name || 'my-plugin';
          return n.split('-').map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
        },
      },
      {
        type: 'list',
        name: 'template',
        message: 'Select template:',
        choices: TEMPLATES.map(t => ({
          name: `${t.name} - ${chalk.gray(t.description)}`,
          value: t.value,
        })),
        when: !options?.template,
      },
      {
        type: 'list',
        name: 'category',
        message: 'Select category:',
        choices: CATEGORIES,
      },
      {
        type: 'input',
        name: 'description',
        message: 'Description:',
        default: 'A NAAP plugin',
      },
      {
        type: 'input',
        name: 'author',
        message: 'Author name:',
      },
      {
        type: 'checkbox',
        name: 'integrations',
        message: 'Include integrations:',
        choices: INTEGRATIONS,
        when: (ans: CreateAnswers) => 
          (ans.template || options?.template) !== 'frontend-only',
      },
    ]);

    const pluginName = name || answers.name || 'my-plugin';
    const template = (options?.template || answers.template || 'frontend-only') as PluginTemplate;
    const targetDir = options?.directory || path.join(process.cwd(), pluginName);

    // Check if directory exists
    if (await fs.pathExists(targetDir)) {
      const { overwrite } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'overwrite',
          message: `Directory ${pluginName} already exists. Overwrite?`,
          default: false,
        },
      ]);
      if (!overwrite) {
        console.log(chalk.yellow('Aborted.'));
        return;
      }
      await fs.remove(targetDir);
    }

    const spinner = ora('Creating plugin...').start();

    try {
      // Create plugin directory
      await fs.ensureDir(targetDir);

      // Create manifest
      const manifest = createDefaultManifest(pluginName, template, {
        displayName: answers.displayName || pluginName,
        description: answers.description || '',
        author: answers.author || '',
      });
      manifest.category = answers.category || 'other';
      manifest.integrations = {
        required: [],
        optional: answers.integrations || [],
      };

      await fs.writeJson(
        path.join(targetDir, 'plugin.json'),
        manifest,
        { spaces: 2 }
      );

      // Create .naap directory
      await fs.ensureDir(path.join(targetDir, '.naap'));
      await fs.writeJson(
        path.join(targetDir, '.naap', 'config.json'),
        { devShell: 'http://localhost:3000' },
        { spaces: 2 }
      );

      // Create frontend if applicable
      if (template === 'full-stack' || template === 'frontend-only') {
        await createFrontend(targetDir, pluginName, manifest.displayName || pluginName);
      }

      // Create backend if applicable
      if (template === 'full-stack' || template === 'backend-only') {
        if (options?.simple) {
          await createBackendSimple(targetDir, pluginName);
        } else {
          await createBackend(targetDir, pluginName, answers.integrations || []);
        }
      }

      // Create docs
      await createDocs(targetDir, pluginName, answers.description || '');

      // Create .gitignore
      await fs.writeFile(
        path.join(targetDir, '.gitignore'),
        `node_modules/
dist/
.env
.env.local
*.log
.DS_Store
.naap/credentials.json
`
      );

      // Create GitHub workflow
      await fs.ensureDir(path.join(targetDir, '.github', 'workflows'));
      await createGitHubWorkflow(targetDir);

      spinner.succeed('Plugin structure created');

      // Initialize git
      if (!options?.skipGit) {
        const gitSpinner = ora('Initializing git repository...').start();
        try {
          const { execa } = await import('execa');
          await execa('git', ['init'], { cwd: targetDir });
          gitSpinner.succeed('Git repository initialized');
        } catch {
          gitSpinner.warn('Failed to initialize git repository');
        }
      }

      // Install dependencies
      if (!options?.skipInstall) {
        const installSpinner = ora('Installing dependencies...').start();
        try {
          const { execa } = await import('execa');
          
          // Install frontend deps
          if (template === 'full-stack' || template === 'frontend-only') {
            await execa('npm', ['install'], { cwd: path.join(targetDir, 'frontend') });
          }
          
          // Install backend deps
          if (template === 'full-stack' || template === 'backend-only') {
            await execa('npm', ['install'], { cwd: path.join(targetDir, 'backend') });
          }
          
          installSpinner.succeed('Dependencies installed');
        } catch {
          installSpinner.warn('Failed to install dependencies - run npm install manually');
        }
      }

      console.log(chalk.green('\n✅ Plugin created successfully!\n'));
      console.log(chalk.bold('Next steps:'));
      console.log(chalk.cyan(`  cd ${pluginName}`));
      console.log(chalk.cyan('  naap-plugin dev'));
      console.log('');
      if (template === 'frontend-only') {
        console.log(chalk.gray('  Need a backend later? Re-scaffold with:'));
        console.log(chalk.gray(`    naap-plugin create ${pluginName} --template full-stack`));
        console.log(chalk.gray('  Or add endpoints incrementally:'));
        console.log(chalk.gray('    naap-plugin add endpoint <name>'));
        console.log('');
      }

    } catch (error) {
      spinner.fail('Failed to create plugin');
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });

async function createFrontend(targetDir: string, name: string, displayName: string): Promise<void> {
  const frontendDir = path.join(targetDir, 'frontend');
  await fs.ensureDir(path.join(frontendDir, 'src', 'pages'));
  await fs.ensureDir(path.join(frontendDir, 'src', 'components'));
  await fs.ensureDir(path.join(frontendDir, 'src', 'hooks'));
  await fs.ensureDir(path.join(frontendDir, 'tests', 'unit'));
  await fs.ensureDir(path.join(frontendDir, 'tests', 'e2e'));

  // package.json
  await fs.writeJson(path.join(frontendDir, 'package.json'), {
    name: `@naap-plugins/${name}-frontend`,
    version: '0.1.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'tsc && vite build',
      preview: 'vite preview',
      test: 'vitest',
      'test:e2e': 'playwright test',
    },
    dependencies: {
      react: '^18.2.0',
      'react-dom': '^18.2.0',
      'react-router-dom': '^6.22.0',
      '@naap/plugin-sdk': '^0.1.0',
      'lucide-react': '^0.344.0',
    },
    devDependencies: {
      '@types/react': '^18.2.0',
      '@types/react-dom': '^18.2.0',
      '@vitejs/plugin-react': '^4.2.0',
      typescript: '~5.8.2',
      vite: '^6.0.0',
      vitest: '^1.0.0',
      '@playwright/test': '^1.40.0',
      tailwindcss: '^3.4.0',
      postcss: '^8.4.0',
      autoprefixer: '^10.4.0',
    },
  }, { spaces: 2 });

  // vite.config.ts (UMD build via @naap/plugin-build)
  const pascalName = name.split(/[-_]/).map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join('');
  await fs.writeFile(path.join(frontendDir, 'vite.config.ts'), `/**
 * Vite Configuration for ${pascalName} Plugin
 */
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  name: '${name}',
  displayName: '${pascalName}',
  globalName: 'NaapPlugin${pascalName}',
});
`);

  // mount.tsx (single authoritative entry point for UMD shell integration)
  // Uses the delegate pattern: imports the plugin instance from App.tsx
  await fs.writeFile(path.join(frontendDir, 'src', 'mount.tsx'), `import plugin from './App';

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
`);

  // tsconfig.json
  await fs.writeJson(path.join(frontendDir, 'tsconfig.json'), {
    compilerOptions: {
      target: 'ES2020',
      useDefineForClassFields: true,
      lib: ['ES2020', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      skipLibCheck: true,
      moduleResolution: 'bundler',
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
      jsx: 'react-jsx',
      strict: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      noFallthroughCasesInSwitch: true,
    },
    include: ['src'],
  }, { spaces: 2 });

  // tailwind.config.js
  await fs.writeFile(path.join(frontendDir, 'tailwind.config.js'), `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
`);

  // postcss.config.js
  await fs.writeFile(path.join(frontendDir, 'postcss.config.js'), `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`);

  // index.html
  await fs.writeFile(path.join(frontendDir, 'index.html'), `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${displayName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`);

  // src/main.tsx
  await fs.writeFile(path.join(frontendDir, 'src', 'main.tsx'), `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`);

  // src/index.css
  await fs.writeFile(path.join(frontendDir, 'src', 'index.css'), `@tailwind base;
@tailwind components;
@tailwind utilities;
`);

  // src/App.tsx - Main component using createPlugin() pattern
  await fs.writeFile(path.join(frontendDir, 'src', 'App.tsx'), `import React from 'react';
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
`);

  // src/pages/Dashboard.tsx
  await fs.writeFile(path.join(frontendDir, 'src', 'pages', 'Dashboard.tsx'), `import React from 'react';
import { useShell, useUser } from '@naap/plugin-sdk/hooks';

const Dashboard: React.FC = () => {
  let user = null;
  let theme = { mode: 'dark' as const };
  
  try {
    const shell = useShell();
    user = shell.user();
    theme = shell.theme;
  } catch {
    // Running in standalone mode
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">${displayName}</h1>
      <p className="text-gray-600 dark:text-gray-400">
        Welcome to your new NAAP plugin!
      </p>
      
      {user && (
        <div className="mt-4 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
          <p>Logged in as: {user.displayName || user.walletAddress}</p>
          <p>Theme: {theme.mode}</p>
        </div>
      )}

      <div className="mt-8">
        <h2 className="text-xl font-semibold mb-2">Getting Started</h2>
        <ul className="list-disc list-inside space-y-2 text-gray-600 dark:text-gray-400">
          <li>Edit this file at <code>src/pages/Dashboard.tsx</code></li>
          <li>Add more pages in the <code>src/pages/</code> directory</li>
          <li>Create reusable components in <code>src/components/</code></li>
          <li>Use shell hooks from <code>@naap/plugin-sdk/hooks</code></li>
        </ul>
      </div>
    </div>
  );
};

export default Dashboard;
`);
}

async function createBackend(targetDir: string, name: string, integrations: string[]): Promise<void> {
  const backendDir = path.join(targetDir, 'backend');
  await fs.ensureDir(path.join(backendDir, 'src', 'routes'));
  await fs.ensureDir(path.join(backendDir, 'src', 'services'));
  await fs.ensureDir(path.join(backendDir, 'src', 'integrations'));
  await fs.ensureDir(path.join(backendDir, 'prisma'));
  await fs.ensureDir(path.join(backendDir, 'tests'));

  // package.json
  const deps: Record<string, string> = {
    express: '^4.18.0',
    cors: '^2.8.5',
    '@naap/database': 'workspace:*',
    '@naap/plugin-sdk': '^0.1.0',
    dotenv: '^16.3.0',
  };

  // Add integration-specific dependencies
  if (integrations.includes('openai')) {
    deps['openai'] = '^4.0.0';
  }
  if (integrations.includes('aws-s3')) {
    deps['@aws-sdk/client-s3'] = '^3.0.0';
  }
  if (integrations.includes('sendgrid')) {
    deps['@sendgrid/mail'] = '^8.0.0';
  }
  if (integrations.includes('stripe')) {
    deps['stripe'] = '^14.0.0';
  }

  await fs.writeJson(path.join(backendDir, 'package.json'), {
    name: `@naap-plugins/${name}-backend`,
    version: '0.1.0',
    type: 'module',
    scripts: {
      dev: 'tsx watch src/server.ts',
      build: 'tsc',
      start: 'node dist/server.js',
      test: 'vitest',
      // DB is managed centrally via packages/database
    },
    dependencies: deps,
    devDependencies: {
      '@types/express': '^4.17.0',
      '@types/cors': '^2.8.0',
      '@types/node': '^22.0.0',
      typescript: '~5.8.2',
      tsx: '^4.7.0',
      prisma: '^5.0.0',
      vitest: '^1.0.0',
    },
  }, { spaces: 2 });

  // tsconfig.json
  await fs.writeJson(path.join(backendDir, 'tsconfig.json'), {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      outDir: './dist',
      rootDir: './src',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      declaration: true,
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist'],
  }, { spaces: 2 });

  // Derive a deterministic port from the plugin name to avoid conflicts
  const portHash = Array.from(name).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const backendPort = 4000 + (portHash % 1000);

  // src/server.ts
  await fs.writeFile(path.join(backendDir, 'src', 'server.ts'), `import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { router } from './routes/index.js';

config();

const app = express();
const PORT = process.env.PORT || ${backendPort};

app.use(cors());
app.use(express.json());

// Health check
app.get('/healthz', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/v1/${name}', router);

app.listen(PORT, () => {
  console.log(\`🚀 ${name} backend running on port \${PORT}\`);
});
`);

  // src/routes/index.ts
  await fs.writeFile(path.join(backendDir, 'src', 'routes', 'index.ts'), `import { Router } from 'express';
import { prisma } from '../db/client.js';

export const router = Router();

// Example route
router.get('/', async (req, res) => {
  res.json({ 
    message: '${name} API',
    version: '0.1.0',
  });
});

// Add your routes here — see routes/README.md for the pattern
`);

  // routes/README.md — route discoverability guide
  await fs.writeFile(path.join(backendDir, 'src', 'routes', 'README.md'), ROUTES_README_CONTENT);

  // src/db/client.ts
  await fs.ensureDir(path.join(backendDir, 'src', 'db'));
  await fs.writeFile(path.join(backendDir, 'src', 'db', 'client.ts'), `import { prisma } from '@naap/database';

export { prisma };

export async function connectDatabase() {
  try {
    await prisma.$connect();
    console.log('✅ Database connected');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
}
`);

  const schemaName = `plugin_${name.replace(/-/g, '_')}`;

  // prisma/schema.prisma — extends the unified database schema
  await fs.writeFile(path.join(backendDir, 'prisma', 'schema.prisma'), `// Plugin schema extension for ${name}
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
model ${name.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')}Example {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@schema("${schemaName}")
}
`);

  // prisma/seed.ts
  await fs.writeFile(path.join(backendDir, 'prisma', 'seed.ts'), `import { prisma } from '@naap/database';

async function main() {
  console.log('Seeding database...');
  
  // Add your seed data here
  
  console.log('Seeding complete!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
`);

  // .env.example
  await fs.writeFile(path.join(backendDir, '.env.example'), `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/${name.replace(/-/g, '_')}_db"
PORT=${backendPort}
`);

  // Dockerfile
  await fs.writeFile(path.join(backendDir, 'Dockerfile'), `FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist

EXPOSE ${backendPort}

CMD ["node", "dist/server.js"]
`);
}

async function createBackendSimple(targetDir: string, name: string): Promise<void> {
  const backendDir = path.join(targetDir, 'backend');
  await fs.ensureDir(path.join(backendDir, 'src', 'routes'));
  await fs.ensureDir(path.join(backendDir, 'tests'));

  const portHash = Array.from(name).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const backendPort = 4000 + (portHash % 1000);

  await fs.writeJson(path.join(backendDir, 'package.json'), {
    name: `@naap-plugins/${name}-backend`,
    version: '0.1.0',
    type: 'module',
    scripts: {
      dev: 'tsx watch src/server.ts',
      build: 'tsc',
      start: 'node dist/server.js',
      test: 'vitest',
    },
    dependencies: {
      express: '^4.18.0',
      cors: '^2.8.5',
      '@naap/plugin-sdk': '^0.1.0',
      dotenv: '^16.3.0',
    },
    devDependencies: {
      '@types/express': '^4.17.0',
      '@types/cors': '^2.8.0',
      '@types/node': '^22.0.0',
      typescript: '~5.8.2',
      tsx: '^4.7.0',
      vitest: '^1.0.0',
    },
  }, { spaces: 2 });

  await fs.writeJson(path.join(backendDir, 'tsconfig.json'), {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      outDir: './dist',
      rootDir: './src',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      declaration: true,
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist'],
  }, { spaces: 2 });

  await fs.writeFile(path.join(backendDir, 'src', 'server.ts'), `import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { router } from './routes/index.js';

config();

const app = express();
const PORT = process.env.PORT || ${backendPort};

app.use(cors());
app.use(express.json());

app.get('/healthz', (_req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.use('/api/v1/${name}', router);

app.listen(PORT, () => {
  console.log(\`🚀 ${name} backend running on port \${PORT}\`);
});
`);

  await fs.writeFile(path.join(backendDir, 'src', 'routes', 'index.ts'), `import { Router } from 'express';

export const router = Router();

// In-memory store — swap for a real database when ready
const items: { id: string; name: string; createdAt: string }[] = [];
let nextId = 1;

router.get('/', (_req, res) => {
  res.json({ items });
});

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  const item = { id: String(nextId++), name, createdAt: new Date().toISOString() };
  items.push(item);
  res.status(201).json(item);
});

router.delete('/:id', (req, res) => {
  const idx = items.findIndex(i => i.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  items.splice(idx, 1);
  res.status(204).send();
});
`);

  await fs.writeFile(path.join(backendDir, '.env.example'), `PORT=${backendPort}
`);

  // routes/README.md — route discoverability guide
  await fs.writeFile(path.join(backendDir, 'src', 'routes', 'README.md'), ROUTES_README_CONTENT);
}

async function createDocs(targetDir: string, name: string, description: string): Promise<void> {
  const docsDir = path.join(targetDir, 'docs');
  await fs.ensureDir(docsDir);

  await fs.writeFile(path.join(targetDir, 'README.md'), `# ${name}

${description}

## Development

\`\`\`bash
# Start development server
naap-plugin dev

# Run tests
naap-plugin test

# Build for production
naap-plugin build
\`\`\`

## Deployment

\`\`\`bash
# Package the plugin
naap-plugin package

# Publish to registry
naap-plugin publish
\`\`\`

## License

MIT
`);

  await fs.writeFile(path.join(docsDir, 'CHANGELOG.md'), `# Changelog

## [0.1.0] - ${new Date().toISOString().split('T')[0]}

### Added
- Initial release
`);

  await fs.writeFile(path.join(docsDir, 'api.md'), `# API Documentation

## Endpoints

Document your API endpoints here.
`);
}

async function createGitHubWorkflow(targetDir: string): Promise<void> {
  await fs.writeFile(
    path.join(targetDir, '.github', 'workflows', 'publish.yml'),
    `name: Publish Plugin

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          
      - name: Install dependencies
        run: |
          cd frontend && npm ci
          cd ../backend && npm ci
          
      - name: Build
        run: naap-plugin build
        
      - name: Package
        run: naap-plugin package
        
      - name: Publish
        run: naap-plugin publish
        env:
          NAAP_REGISTRY_TOKEN: \${{ secrets.NAAP_REGISTRY_TOKEN }}
`
  );
}
