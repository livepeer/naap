const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');

const REQUIRED_ARTIFACTS = [
  {
    name: '@naap/plugin-build',
    files: [
      'packages/plugin-build/dist/index.js',
      'packages/plugin-build/dist/vite.js',
    ],
  },
  {
    name: '@naap/cache',
    files: [
      'packages/cache/dist/index.js',
      'packages/cache/dist/index.d.ts',
    ],
  },
];

function exists(relPath) {
  return fs.existsSync(path.join(ROOT_DIR, relPath));
}

function getMissingArtifacts() {
  const missing = [];
  for (const pkg of REQUIRED_ARTIFACTS) {
    for (const file of pkg.files) {
      if (!exists(file)) missing.push({ pkg: pkg.name, file });
    }
  }
  return missing;
}

function writeLog(logPath, content) {
  if (!logPath) return;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, content, 'utf8');
}

function runBuild(logPath) {
  const args = [
    'run',
    'build',
    '--workspace=@naap/plugin-build',
    '--workspace=@naap/cache',
  ];

  const res = spawnSync('npm', args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    env: process.env,
  });

  const output = `${res.stdout || ''}${res.stderr || ''}`;
  writeLog(logPath, output);

  return {
    status: res.status ?? 1,
    error: res.error,
    output,
  };
}

function formatMissing(missing) {
  const grouped = new Map();
  for (const m of missing) {
    if (!grouped.has(m.pkg)) grouped.set(m.pkg, []);
    grouped.get(m.pkg).push(m.file);
  }
  let out = '';
  for (const [pkg, files] of grouped.entries()) {
    out += `- ${pkg}:\n`;
    for (const f of files) out += `  - ${f}\n`;
  }
  return out.trimEnd();
}

function main() {
  const logPath = process.env.BOOTSTRAP_LOG_PATH
    ? path.resolve(ROOT_DIR, process.env.BOOTSTRAP_LOG_PATH)
    : '';

  const missingBefore = getMissingArtifacts();
  if (missingBefore.length === 0) {
    process.exit(0);
  }

  console.log('[naap] Bootstrapping workspace package build artifacts...');
  console.log(formatMissing(missingBefore));

  const build = runBuild(logPath);
  if (build.error) {
    console.error('[naap] Failed to run npm to build workspace packages.');
    console.error(build.error);
    if (logPath) console.error(`[naap] Build output written to ${logPath}`);
    else if (build.output) console.error(build.output.trimEnd());
    process.exit(1);
  }

  const missingAfter = getMissingArtifacts();
  if (missingAfter.length > 0) {
    console.error('[naap] Workspace package bootstrap did not produce required artifacts:');
    console.error(formatMissing(missingAfter));
    if (logPath) console.error(`[naap] Build output written to ${logPath}`);
    else if (build.output) console.error(build.output.trimEnd());
    process.exit(1);
  }

  if (build.status !== 0) {
    console.warn(
      '[naap] Workspace build reported errors, but required artifacts were produced. Continuing.',
    );
    if (logPath) console.warn(`[naap] Build output written to ${logPath}`);
  }
}

main();

