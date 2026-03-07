#!/usr/bin/env npx tsx
/**
 * Validates that every Express backend route in the deployment-manager plugin
 * has a corresponding Next.js API route handler in apps/web-next.
 *
 * This prevents the "works locally, broken on Vercel" pattern where the local
 * Express proxy handles requests but Vercel returns 501 because no dedicated
 * Next.js route exists.
 *
 * Run: npx tsx scripts/validate-dm-routes.ts
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const EXPRESS_ROUTES_DIR = path.join(ROOT, 'plugins/deployment-manager/backend/src/routes');
const NEXTJS_ROUTES_DIR = path.join(ROOT, 'apps/web-next/src/app/api/v1/deployment-manager');

interface ExpressRoute {
  method: string;
  path: string;
  file: string;
  line: number;
}

interface ValidationResult {
  route: ExpressRoute;
  nextjsPath: string | null;
  exists: boolean;
  methodMatch: boolean;
}

const METHOD_MAP: Record<string, string> = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  delete: 'DELETE',
  patch: 'PATCH',
};

function extractExpressRoutes(): ExpressRoute[] {
  const routes: ExpressRoute[] = [];
  if (!fs.existsSync(EXPRESS_ROUTES_DIR)) return routes;

  const routePattern = /router\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/g;

  const files = fs.readdirSync(EXPRESS_ROUTES_DIR).filter((f) => f.endsWith('.ts'));
  for (const file of files) {
    const content = fs.readFileSync(path.join(EXPRESS_ROUTES_DIR, file), 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = /router\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/.exec(line);
      if (match) {
        const prefix = file.replace('.ts', '');
        const routePath = match[2] === '/' ? '' : match[2];
        routes.push({
          method: METHOD_MAP[match[1]] || match[1].toUpperCase(),
          path: `/${prefix}${routePath}`,
          file,
          line: i + 1,
        });
      }
    }
  }

  return routes;
}

function expressPathToSegments(expressPath: string): string[] {
  return expressPath.replace(/^\//, '').split('/').map((seg) =>
    seg.startsWith(':') ? '__DYNAMIC__' : seg,
  );
}

function walkNextjsRoutes(baseDir: string, prefix: string[] = []): { segments: string[]; routeFile: string }[] {
  const results: { segments: string[]; routeFile: string }[] = [];
  if (!fs.existsSync(baseDir)) return results;

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      results.push(...walkNextjsRoutes(path.join(baseDir, entry.name), [...prefix, entry.name]));
    } else if (entry.name === 'route.ts') {
      results.push({ segments: prefix, routeFile: path.join(baseDir, entry.name) });
    }
  }
  return results;
}

function normalizeSegments(segments: string[]): string[] {
  return segments.map((s) => (s.startsWith('[') && s.endsWith(']') ? '__DYNAMIC__' : s));
}

let _nextjsRoutes: { segments: string[]; normalized: string[]; routeFile: string }[] | null = null;

function getNextjsRoutes(): typeof _nextjsRoutes & {} {
  if (_nextjsRoutes) return _nextjsRoutes;
  const raw = walkNextjsRoutes(NEXTJS_ROUTES_DIR);
  _nextjsRoutes = raw.map((r) => ({
    ...r,
    normalized: normalizeSegments(r.segments),
  }));
  return _nextjsRoutes;
}

function findNextjsRoute(expressPath: string, method: string): { dirPath: string; exists: boolean; methodMatch: boolean } {
  const expressSegments = expressPathToSegments(expressPath);
  const nextjsRoutes = getNextjsRoutes();

  const match = nextjsRoutes.find((r) => {
    if (r.normalized.length !== expressSegments.length) return false;
    return r.normalized.every((seg, i) => seg === expressSegments[i]);
  });

  if (!match) {
    const fallbackPath = expressPath.replace(/:(\w+)/g, '[$1]').replace(/^\//, '');
    return { dirPath: path.join(NEXTJS_ROUTES_DIR, fallbackPath, 'route.ts'), exists: false, methodMatch: false };
  }

  const content = fs.readFileSync(match.routeFile, 'utf-8');
  const hasMethod = content.includes(`export async function ${method}`) || content.includes(`export function ${method}`);
  return { dirPath: match.routeFile, exists: true, methodMatch: hasMethod };
}

function main() {
  const expressRoutes = extractExpressRoutes();

  if (expressRoutes.length === 0) {
    console.log('No Express routes found in', EXPRESS_ROUTES_DIR);
    process.exit(0);
  }

  console.log(`Found ${expressRoutes.length} Express routes in deployment-manager backend\n`);

  const results: ValidationResult[] = [];
  let missingCount = 0;
  let methodMismatchCount = 0;

  for (const route of expressRoutes) {
    const { dirPath, exists, methodMatch } = findNextjsRoute(route.path, route.method);
    results.push({ route, nextjsPath: dirPath, exists, methodMatch });

    if (!exists) {
      missingCount++;
    } else if (!methodMatch) {
      methodMismatchCount++;
    }
  }

  console.log('Route Coverage Report');
  console.log('='.repeat(80));

  const missing = results.filter((r) => !r.exists);
  const mismatch = results.filter((r) => r.exists && !r.methodMatch);
  const ok = results.filter((r) => r.exists && r.methodMatch);

  if (missing.length > 0) {
    console.log(`\n  MISSING Next.js routes (${missing.length}):`);
    for (const r of missing) {
      console.log(`    ${r.route.method} ${r.route.path}`);
      console.log(`      Express: ${r.route.file}:${r.route.line}`);
      console.log(`      Expected: ${r.nextjsPath}`);
    }
  }

  if (mismatch.length > 0) {
    console.log(`\n  METHOD MISMATCH (${mismatch.length}):`);
    for (const r of mismatch) {
      console.log(`    ${r.route.method} ${r.route.path} — route file exists but no ${r.route.method} export`);
    }
  }

  if (ok.length > 0) {
    console.log(`\n  OK (${ok.length}):`);
    for (const r of ok) {
      console.log(`    ${r.route.method} ${r.route.path}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`Total: ${results.length} | OK: ${ok.length} | Missing: ${missing.length} | Method mismatch: ${mismatch.length}`);

  if (missing.length > 0 || mismatch.length > 0) {
    console.log('\nThese routes work locally (Express proxy) but WILL FAIL on Vercel.');
    console.log('Create Next.js route handlers at the expected paths above.');
    process.exit(1);
  }

  console.log('\nAll Express routes have matching Next.js route handlers.');
  process.exit(0);
}

main();
