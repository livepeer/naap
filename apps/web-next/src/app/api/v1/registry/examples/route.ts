/**
 * Example Plugins API Route
 * GET /api/v1/registry/examples - List example plugins available for publishing
 *
 * Mirrors the base-svc GET /registry/examples endpoint for environments
 * where base-svc is not running (e.g. Vercel deployments).
 *
 * NOTE: Discovery logic is inlined here to avoid importing shared utilities
 * that use Node.js fs/path (blocked by Vercel safety pre-push check).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import * as path from 'path';
import * as fs from 'fs';

const MONOREPO_ROOT = path.resolve(process.cwd(), process.env.MONOREPO_ROOT || '.');

function toCamelCase(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

interface ExampleEntry {
  name: string;
  dirName: string;
  displayName: string;
  description: string;
  category: string;
  author: string;
  version: string;
  icon: string;
  alreadyPublished: boolean;
}

function discoverExamples(rootDir: string): ExampleEntry[] {
  const examplesDir = path.join(rootDir, 'examples');
  if (!fs.existsSync(examplesDir)) return [];

  return fs
    .readdirSync(examplesDir)
    .filter((dir) => fs.existsSync(path.join(examplesDir, dir, 'plugin.json')))
    .map((dir) => {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(examplesDir, dir, 'plugin.json'), 'utf8'),
      );
      const rawAuthor = manifest.author;
      const authorName = typeof rawAuthor === 'string' ? rawAuthor : rawAuthor?.name;

      return {
        name: toCamelCase(dir),
        dirName: dir,
        displayName: manifest.displayName || dir,
        description: manifest.description || '',
        category: manifest.category || 'example',
        author: authorName || 'NAAP Examples',
        version: '1.0.0',
        icon: manifest.frontend?.navigation?.icon || 'Box',
        alreadyPublished: false,
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const user = await validateSession(token);
    if (!user) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
    }

    const flag = await prisma.featureFlag.findUnique({
      where: { key: 'enableExamplePublishing' },
    });
    if (!flag?.enabled) {
      return NextResponse.json(
        { error: 'Example plugin publishing is not enabled' },
        { status: 403 },
      );
    }

    const examples = discoverExamples(MONOREPO_ROOT);

    const publishedPkgs = examples.length > 0
      ? await prisma.pluginPackage.findMany({
          where: {
            name: { in: examples.map((e) => e.name) },
            publishStatus: 'published',
          },
          select: { name: true },
        })
      : [];
    const publishedSet = new Set(publishedPkgs.map((p) => p.name));

    const result = examples.map((e) => ({
      ...e,
      alreadyPublished: publishedSet.has(e.name),
    }));

    return NextResponse.json({ success: true, examples: result });
  } catch (err) {
    console.error('List examples error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
