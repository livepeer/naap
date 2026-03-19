#!/usr/bin/env node
/**
 * Generate examples-manifest.json for API routes.
 *
 * Scans examples/* /plugin.json and writes a JSON array to
 * apps/web-next/examples-manifest.json. This file is consumed by
 * the registry/examples API routes so they can list example plugins
 * without needing runtime fs access (critical for Vercel serverless).
 *
 * Usage:  node bin/generate-examples-manifest.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.env.MONOREPO_ROOT
  ? path.resolve(process.env.MONOREPO_ROOT)
  : path.resolve(__dirname, '..');

const EXAMPLES_DIR = path.join(ROOT, 'examples');
const CDN_DIR = path.join(ROOT, 'apps', 'web-next', 'public', 'cdn', 'plugins');
const DIST_DIR = path.join(ROOT, 'dist', 'plugins');
const OUT_FILE = path.join(ROOT, 'apps', 'web-next', 'examples-manifest.json');

function toCamelCase(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function toPascalCase(s) {
  const camel = toCamelCase(s);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function generate() {
  if (!fs.existsSync(EXAMPLES_DIR)) {
    fs.writeFileSync(OUT_FILE, '[]');
    console.log('[examples-manifest] No examples/ directory found — wrote empty manifest');
    return;
  }

  const entries = fs
    .readdirSync(EXAMPLES_DIR)
    .filter((d) => {
      const pj = path.join(EXAMPLES_DIR, d, 'plugin.json');
      return fs.existsSync(pj);
    })
    .map((d) => {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(EXAMPLES_DIR, d, 'plugin.json'), 'utf8'),
      );
      const rawAuthor = manifest.author;
      const authorName = typeof rawAuthor === 'string' ? rawAuthor : rawAuthor?.name;
      const authorEmail = typeof rawAuthor === 'object' ? rawAuthor?.email : undefined;
      const rawRoutes = manifest.frontend?.routes || [];
      const camelName = toCamelCase(d);

      const hasCdnBundle = fs.existsSync(path.join(CDN_DIR, d, '1.0.0', `${d}.js`));
      const hasDistBundle = fs.existsSync(path.join(DIST_DIR, d, '1.0.0', `${d}.js`));

      return {
        name: camelName,
        dirName: d,
        displayName: manifest.displayName || d,
        description: manifest.description || '',
        category: manifest.category || 'example',
        author: authorName || 'NAAP Examples',
        authorEmail: authorEmail || undefined,
        version: '1.0.0',
        icon: manifest.frontend?.navigation?.icon || 'Box',
        routes: [`/plugins/${d}`, `/plugins/${d}/*`],
        originalRoutes: rawRoutes,
        order: manifest.frontend?.navigation?.order ?? 99,
        globalName: `NaapPlugin${toPascalCase(d)}`,
        keywords: manifest.keywords || [],
        license: manifest.license || 'MIT',
        repository: manifest.repository || `https://github.com/livepeer/naap/tree/main/examples/${d}`,
        hasBuild: hasCdnBundle || hasDistBundle,
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(entries, null, 2));
  console.log(`[examples-manifest] Wrote ${entries.length} example(s) to ${path.relative(ROOT, OUT_FILE)}`);
}

generate();
