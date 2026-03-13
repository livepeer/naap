#!/usr/bin/env npx tsx
/**
 * NAAP Platform — Dev Runner
 *
 * Replaces bin/start.sh for local development. Runs shell + base-svc + plugin-server
 * with dynamic port allocation and console logs visible.
 *
 * Usage: npm run dev
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import getPort from 'get-port';
import { fileURLToPath } from 'url';
import concurrently from 'concurrently';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const UNIFIED_DB_URL = 'postgresql://postgres:postgres@localhost:5432/naap';
const UNIFIED_DB_CONTAINER = 'naap-db';
const UNIFIED_DB_USER = 'postgres';

// Prefer conventional ports; find next available if busy
const PREFERRED_PORTS = { shell: 3000, base: 4000, pluginServer: 3100 };

function log(msg: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') {
  const prefix = { info: '[INFO]', success: '[OK]', warn: '[WARN]', error: '[ERROR]' }[type];
  console.log(`${prefix}  ${msg}`);
}

function preflight(): void {
  const nodeVer = process.version;
  const major = parseInt(nodeVer.slice(1).split('.')[0] || '0', 10);
  if (major < 20) {
    log(`Node.js v20+ required (found ${nodeVer}). Upgrade: nvm install 20`, 'error');
    process.exit(1);
  }
  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    log('node_modules not found. Run: npm install', 'error');
    process.exit(1);
  }
  log(`Pre-flight OK (node ${nodeVer})`, 'success');
}

function dockerCompose(args: string[]): boolean {
  const hasCompose = spawnSync('docker', ['compose', 'version'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  }).status === 0;
  const cmd = hasCompose ? 'docker' : 'docker-compose';
  const cmdArgs = hasCompose ? ['compose', ...args] : args;
  const res = spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' });
  return res.status === 0;
}

function ensureDatabase(): void {
  log('Checking database...');
  const running = spawnSync('docker', ['ps', '-q', '-f', `name=${UNIFIED_DB_CONTAINER}`], {
    cwd: ROOT,
    encoding: 'utf8',
  }).stdout?.trim();
  if (!running) {
    log('Starting database container...');
    if (!dockerCompose(['up', '-d', 'database'])) {
      log('Failed to start database. Is Docker running?', 'error');
      process.exit(1);
    }
  }
  log('Waiting for database...');
  for (let i = 0; i < 30; i++) {
    const ok =
      spawnSync('docker', ['exec', UNIFIED_DB_CONTAINER, 'pg_isready', '-U', UNIFIED_DB_USER], {
        encoding: 'utf8',
        stdio: 'pipe',
      }).status === 0;
    if (ok) {
      log('Database ready', 'success');
      return;
    }
    if (i % 5 === 4) log(`Still waiting... (${i + 1}/30)`);
  }
  log('Database failed to start. Check: docker logs naap-db', 'error');
  process.exit(1);
}

function initSchemas(): void {
  const initPath = path.join(ROOT, 'docker', 'init-schemas.sql');
  if (!fs.existsSync(initPath)) return;
  spawnSync('docker', ['exec', '-i', UNIFIED_DB_CONTAINER, 'psql', '-U', UNIFIED_DB_USER, '-d', 'naap'], {
    cwd: ROOT,
    input: fs.readFileSync(initPath),
  });
}

function syncDatabase(): void {
  log('Syncing database (Prisma)...');
  const dbDir = path.join(ROOT, 'packages', 'database');
  const gen = spawnSync('npx', ['prisma', 'generate'], {
    cwd: dbDir,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: UNIFIED_DB_URL },
  });
  if (gen.status !== 0) {
    log('Prisma generate failed', 'error');
    if (gen.stderr) console.error(gen.stderr);
    process.exit(1);
  }
  const push = spawnSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    cwd: dbDir,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: UNIFIED_DB_URL },
  });
  if (push.status !== 0) {
    log('Prisma db push had issues (may be fine on first run)', 'warn');
  } else {
    log('Schema synced', 'success');
  }
}

function bootstrapWorkspace(): void {
  const pluginBuild = path.join(ROOT, 'packages', 'plugin-build', 'dist', 'index.js');
  const cacheDist = path.join(ROOT, 'packages', 'cache', 'dist', 'index.js');
  if (fs.existsSync(pluginBuild) && fs.existsSync(cacheDist)) {
    return;
  }
  log('Bootstrapping workspace packages...');
  const res = spawnSync('node', [path.join(ROOT, 'bin', 'bootstrap-workspace-packages.cjs')], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    log('Workspace bootstrap failed', 'error');
    process.exit(1);
  }
}

function buildPlugins(): void {
  log('Building plugins...');
  const script = path.join(ROOT, 'bin', 'build-plugins.sh');
  if (!fs.existsSync(script)) {
    log('build-plugins.sh not found, skipping', 'warn');
    return;
  }
  const res = spawnSync('bash', [script], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
    env: { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') },
  });
  if (res.status !== 0) {
    log('Plugin build had issues', 'warn');
  }
}

async function allocatePorts(): Promise<{ shell: number; base: number; pluginServer: number }> {
  const [shell, base, pluginServer] = await Promise.all([
    getPort({ port: PREFERRED_PORTS.shell }),
    getPort({ port: PREFERRED_PORTS.base }),
    getPort({ port: PREFERRED_PORTS.pluginServer }),
  ]);
  log(`Ports: shell=${shell} base=${base} plugin-server=${pluginServer}`, 'info');
  return { shell, base, pluginServer };
}

function writeEnvFiles(ports: { shell: number; base: number; pluginServer: number }): void {
  const webEnvPath = path.join(ROOT, 'apps', 'web-next', '.env.local');
  const webEnv = [
    '# NAAP Platform - Local Development (auto-generated by dev-runner)',
    `NEXT_PUBLIC_APP_URL=http://localhost:${ports.shell}`,
    'NEXTAUTH_SECRET=dev-secret-change-me-in-production-min-32-chars',
    `DATABASE_URL=${UNIFIED_DB_URL}`,
    `BASE_SVC_URL=http://localhost:${ports.base}`,
    `PLUGIN_SERVER_URL=http://localhost:${ports.pluginServer}`,
  ].join('\n');
  fs.mkdirSync(path.dirname(webEnvPath), { recursive: true });
  fs.writeFileSync(webEnvPath, webEnv + '\n', 'utf8');
  log('Updated apps/web-next/.env.local', 'success');

  const baseEnvPath = path.join(ROOT, 'services', 'base-svc', '.env');
  const baseEnv = [`DATABASE_URL="${UNIFIED_DB_URL}"`, `PORT=${ports.base}`].join('\n');
  fs.mkdirSync(path.dirname(baseEnvPath), { recursive: true });
  fs.writeFileSync(baseEnvPath, baseEnv + '\n', 'utf8');

  const portsPath = path.join(ROOT, '.dev-ports.json');
  fs.writeFileSync(
    portsPath,
    JSON.stringify({ shell: ports.shell, base: ports.base, pluginServer: ports.pluginServer }, null, 2),
    'utf8',
  );
}

async function runConcurrently(ports: { shell: number; base: number; pluginServer: number }): Promise<void> {
  const shellDir = path.join(ROOT, 'apps', 'web-next');
  const baseDir = path.join(ROOT, 'services', 'base-svc');
  const pluginDir = path.join(ROOT, 'services', 'plugin-server');

  console.log('');
  console.log('================================================');
  console.log('NAAP Platform — Dev Mode');
  console.log('================================================');
  console.log(`  Shell:          http://localhost:${ports.shell}`);
  console.log(`  Base Service:   http://localhost:${ports.base}/healthz`);
  console.log(`  Plugin Server:  http://localhost:${ports.pluginServer}/plugins`);
  console.log('  Stop: Ctrl+C');
  console.log('================================================');
  console.log('');

  const { result } = concurrently(
    [
      {
        command: `npx next dev -p ${ports.shell}`,
        name: 'shell',
        cwd: shellDir,
        env: { ...process.env, PORT: String(ports.shell), WATCHPACK_POLLING: '1000' },
      },
      {
        command: 'npm run dev',
        name: 'base-svc',
        cwd: baseDir,
        env: { ...process.env, PORT: String(ports.base), DATABASE_URL: UNIFIED_DB_URL },
      },
      {
        command: 'npm run dev',
        name: 'plugin-server',
        cwd: pluginDir,
        env: {
          ...process.env,
          PLUGIN_SERVER_PORT: String(ports.pluginServer),
          BASE_SVC_URL: `http://localhost:${ports.base}`,
        },
      },
    ],
    { prefix: 'name', prefixColors: ['blue', 'green', 'magenta'] },
  );

  try {
    await result;
    process.exit(0);
  } catch (events) {
    process.exit(1);
  }
}

async function main(): Promise<void> {
  preflight();
  ensureDatabase();
  initSchemas();
  syncDatabase();
  bootstrapWorkspace();
  buildPlugins();
  const ports = await allocatePorts();
  writeEnvFiles(ports);
  await runConcurrently(ports);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
