/**
 * Saved searches collection — GET (list) + POST (create) (PR 17).
 *
 * Tenant-scoped CRUD for `AbSavedSearch`. Pinned searches surface
 * first in the list (used by the bot's `/searches` command and the
 * SavedSearches web page). Each tenant is capped at 10 pinned
 * searches — the 11th attempt returns 422 — to keep the Telegram
 * inline-keyboard manageable.
 *
 * The `query` body field is stored as JSON verbatim and validated
 * lazily at run-time by `runSavedSearch`. The route only validates
 * the shape (scope is one of the 4 allowed values, name is a non-
 * empty string).
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import type { SearchScope } from '@/lib/agentbook-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_PINNED = 10;
const ALLOWED_SCOPES: SearchScope[] = ['expense', 'invoice', 'mileage', 'all'];

interface CreateBody {
  name?: string;
  scope?: string;
  query?: unknown;
  pinned?: boolean;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const rows = await db.abSavedSearch.findMany({
      where: { tenantId },
      // Pinned-first then newest-first so the bot list lines up with the UI.
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    });
    return NextResponse.json({ success: true, data: rows });
  } catch (err) {
    console.error('[agentbook-core/searches GET] failed:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load saved searches' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as CreateBody;

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json(
        { success: false, error: 'name is required' },
        { status: 400 },
      );
    }

    const scope = body.scope as SearchScope;
    if (!ALLOWED_SCOPES.includes(scope)) {
      return NextResponse.json(
        { success: false, error: `scope must be one of ${ALLOWED_SCOPES.join(', ')}` },
        { status: 400 },
      );
    }

    if (!body.query || typeof body.query !== 'object') {
      return NextResponse.json(
        { success: false, error: 'query is required' },
        { status: 400 },
      );
    }

    const wantsPinned = body.pinned === true;

    if (wantsPinned) {
      const pinnedCount = await db.abSavedSearch.count({
        where: { tenantId, pinned: true },
      });
      if (pinnedCount >= MAX_PINNED) {
        return NextResponse.json(
          {
            success: false,
            error: `pinned limit reached — at most ${MAX_PINNED} per tenant. Unpin one before adding another.`,
          },
          { status: 422 },
        );
      }
    }

    const created = await db.abSavedSearch.create({
      data: {
        tenantId,
        name,
        scope,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        query: body.query as any,
        pinned: wantsPinned,
      },
    });

    return NextResponse.json({ success: true, data: created });
  } catch (err) {
    console.error('[agentbook-core/searches POST] failed:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to create saved search' },
      { status: 500 },
    );
  }
}
