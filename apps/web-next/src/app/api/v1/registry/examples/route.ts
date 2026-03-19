/**
 * Example Plugins API Route
 * GET /api/v1/registry/examples - List example plugins available for publishing
 *
 * Uses the generated TypeScript manifest (src/generated/examples-manifest.ts)
 * which is compiled into the function bundle by webpack/turbopack. This
 * guarantees the data is available on Vercel without runtime fs access.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import { EXAMPLES_MANIFEST, type ExampleManifestEntry } from '@/generated/examples-manifest';

interface ExampleResponse extends ExampleManifestEntry {
  alreadyPublished: boolean;
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

    const examples = EXAMPLES_MANIFEST;

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

    const result: ExampleResponse[] = examples.map((e) => ({
      ...e,
      alreadyPublished: publishedSet.has(e.name),
    }));

    return NextResponse.json({ success: true, examples: result });
  } catch (err) {
    console.error('List examples error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
