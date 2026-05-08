/**
 * Saved-search execute — GET /searches/:id/run (PR 17).
 *
 * Loads the tenant-scoped AbSavedSearch, hands its `query` JSON to
 * `runSavedSearch`, and returns the rows + count + scope. The bot's
 * `srch_run:<id>` callback and the SavedSearches page's "Run" button
 * both hit this endpoint.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { runSavedSearch, type SearchQuery, type SearchScope } from '@/lib/agentbook-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });

    const row = await db.abSavedSearch.findFirst({ where: { id, tenantId } });
    if (!row) {
      return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });
    }

    // Re-hydrate the SearchQuery from the JSON column. We trust the shape
    // because POST/PUT validated it, but coerce scope from the row in case
    // the saved JSON omitted it (older rows from buggy clients).
    const stored = (row.query ?? {}) as Partial<SearchQuery>;
    const query: SearchQuery = {
      ...stored,
      scope: (stored.scope as SearchScope | undefined) ?? (row.scope as SearchScope),
    };

    const result = await runSavedSearch(tenantId, query);
    return NextResponse.json({
      success: true,
      data: {
        search: { id: row.id, name: row.name, scope: row.scope, pinned: row.pinned },
        ...result,
      },
    });
  } catch (err) {
    console.error('[agentbook-core/searches/:id/run GET] failed:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to run saved search' },
      { status: 500 },
    );
  }
}
