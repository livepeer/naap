/**
 * Saved-search by-id — PUT (edit + toggle pinned) + DELETE (PR 17).
 *
 * Tenant-scoped. Pin toggle enforces the 10-per-tenant cap (the same
 * cap as POST /searches) so the user can't unpin → pin → unpin into a
 * keyboard the bot can't render.
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

interface RouteCtx {
  params: Promise<{ id: string }>;
}

interface UpdateBody {
  name?: string;
  scope?: string;
  query?: unknown;
  pinned?: boolean;
}

export async function PUT(request: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });

    const existing = await db.abSavedSearch.findFirst({ where: { id, tenantId } });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as UpdateBody;
    const data: Record<string, unknown> = {};

    if (typeof body.name === 'string' && body.name.trim()) {
      data.name = body.name.trim();
    }

    if (typeof body.scope === 'string') {
      if (!ALLOWED_SCOPES.includes(body.scope as SearchScope)) {
        return NextResponse.json(
          { success: false, error: `scope must be one of ${ALLOWED_SCOPES.join(', ')}` },
          { status: 400 },
        );
      }
      data.scope = body.scope;
    }

    if (body.query !== undefined) {
      if (!body.query || typeof body.query !== 'object') {
        return NextResponse.json(
          { success: false, error: 'query must be an object' },
          { status: 400 },
        );
      }
      data.query = body.query;
    }

    if (typeof body.pinned === 'boolean') {
      // Only enforce the cap when the user is *adding* a pin. Unpinning is
      // always free, and re-saving a row that's already pinned doesn't
      // increment the count.
      if (body.pinned && !existing.pinned) {
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
      data.pinned = body.pinned;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { success: false, error: 'no editable fields' },
        { status: 400 },
      );
    }

    const updated = await db.abSavedSearch.update({
      where: { id },
      data,
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    console.error('[agentbook-core/searches/:id PUT] failed:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to update saved search' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });

    const r = await db.abSavedSearch.deleteMany({ where: { id, tenantId } });
    if (r.count === 0) {
      return NextResponse.json({ success: false, error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[agentbook-core/searches/:id DELETE] failed:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to delete saved search' },
      { status: 500 },
    );
  }
}
