/**
 * Per-diem entries — native Next.js route (PR 14).
 *
 *   POST creates N daily AbExpense rows at the GSA M&IE rate (or
 *        M&IE + lodging when `includeLodging=true`) for the given city.
 *        All rows are tagged `taxCategory='per_diem'` so the year-end
 *        aggregator can distinguish them from itemised meals. CA tenants
 *        get a 422 with a "not supported yet" message — per-diem is an
 *        IRS-only construct in this MVP.
 *
 *   GET  lists per-diem entries (rows where `taxCategory='per_diem'`)
 *        for the dashboard preview.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { lookupPerDiem, CONUS_DEFAULT_MIE_CENTS } from '@/lib/agentbook-perdiem-rates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface CreatePerDiemBody {
  city?: string;
  startDate?: string;       // ISO yyyy-mm-dd
  endDate?: string;         // ISO yyyy-mm-dd (inclusive)
  days?: number;            // alternative when end-date is unknown
  includeLodging?: boolean; // default false (M&IE only)
}

const MAX_DAYS = 90;

function sanitizeError(err: unknown): string {
  // Don't surface internal error messages — they often include
  // schema/path details from Prisma. The route logs the full err
  // server-side; the client gets a generic message.
  console.error('[agentbook-expense/per-diem]', err);
  return 'Failed to record per-diem entries.';
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as CreatePerDiemBody;

    const cityRaw = (body.city || '').trim();
    if (!cityRaw) {
      return NextResponse.json(
        { success: false, error: 'city is required' },
        { status: 400 },
      );
    }

    // CA tenants — short-circuit with a friendly message (matches the
    // bot copy). 422 keeps it distinct from validation errors.
    const cfg = await db.abTenantConfig.findUnique({
      where: { userId: tenantId },
      select: { jurisdiction: true },
    });
    const jurisdiction: 'us' | 'ca' = cfg?.jurisdiction === 'ca' ? 'ca' : 'us';
    if (jurisdiction === 'ca') {
      return NextResponse.json(
        {
          success: false,
          error: "Per-diem isn't a CA-supported method yet — use mileage + meals expenses instead. (Coming in a future release.)",
          code: 'unsupported_jurisdiction',
        },
        { status: 422 },
      );
    }

    // Resolve date range. start+end takes precedence; falling back to
    // start+days, then days-from-today.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    let start: Date | null = null;
    let end: Date | null = null;
    if (body.startDate) {
      const s = new Date(body.startDate + 'T00:00:00.000Z');
      if (!isNaN(s.getTime())) start = s;
    }
    if (body.endDate) {
      const e = new Date(body.endDate + 'T00:00:00.000Z');
      if (!isNaN(e.getTime())) end = e;
    }
    let dayCount = body.days && body.days > 0 ? body.days : 0;
    if (start && end) {
      if (end < start) {
        return NextResponse.json(
          { success: false, error: 'endDate must be on or after startDate' },
          { status: 400 },
        );
      }
      const diffMs = end.getTime() - start.getTime();
      dayCount = Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;
    } else if (start && dayCount > 0) {
      end = new Date(start.getTime() + (dayCount - 1) * 24 * 60 * 60 * 1000);
    } else if (dayCount > 0 && !start) {
      start = today;
      end = new Date(today.getTime() + (dayCount - 1) * 24 * 60 * 60 * 1000);
    } else {
      return NextResponse.json(
        { success: false, error: 'specify startDate + endDate, or startDate + days, or days' },
        { status: 400 },
      );
    }
    if (dayCount <= 0 || dayCount > MAX_DAYS) {
      return NextResponse.json(
        { success: false, error: `dayCount must be between 1 and ${MAX_DAYS}` },
        { status: 400 },
      );
    }

    const rate = lookupPerDiem(cityRaw);
    if (!rate) {
      return NextResponse.json(
        { success: false, error: `couldn't resolve per-diem rate for "${cityRaw}"` },
        { status: 400 },
      );
    }
    const includeLodging = body.includeLodging === true;

    // Best-effort category resolution — meals and travel are common
    // names, but we don't fail the booking when the chart isn't seeded.
    const cats = await db.abAccount.findMany({
      where: { tenantId, accountType: 'expense' },
      select: { id: true, name: true },
    });
    const mealsCat = cats.find((c) => /meal/i.test(c.name))
      || cats.find((c) => /travel/i.test(c.name))
      || null;
    const lodgingCat = includeLodging
      ? (cats.find((c) => /lodg|hotel/i.test(c.name))
          || cats.find((c) => /travel/i.test(c.name))
          || null)
      : null;

    const cityLabel = rate.city;
    const created = await db.$transaction(async (tx) => {
      const rows: Array<{
        id: string;
        amountCents: number;
        date: Date;
        description: string;
        kind: 'mie' | 'lodging';
      }> = [];
      for (let i = 0; i < dayCount; i += 1) {
        const day = new Date(start!.getTime() + i * 24 * 60 * 60 * 1000);
        const dateLabel = day.toISOString().slice(0, 10);
        const mieDescription = `Per-diem M&IE — ${cityLabel} ${dateLabel}`;
        const mieRow = await tx.abExpense.create({
          data: {
            tenantId,
            amountCents: rate.mieCents,
            date: day,
            description: mieDescription,
            categoryId: mealsCat?.id || null,
            taxCategory: 'per_diem',
            isPersonal: false,
            isDeductible: true,
            status: 'confirmed',
            source: 'per_diem',
            currency: 'USD',
          },
        });
        rows.push({
          id: mieRow.id,
          amountCents: mieRow.amountCents,
          date: mieRow.date,
          description: mieRow.description || mieDescription,
          kind: 'mie',
        });
        if (includeLodging) {
          const lodgingDescription = `Per-diem lodging — ${cityLabel} ${dateLabel}`;
          const lodgingRow = await tx.abExpense.create({
            data: {
              tenantId,
              amountCents: rate.lodgingCents,
              date: day,
              description: lodgingDescription,
              categoryId: lodgingCat?.id || null,
              taxCategory: 'per_diem',
              isPersonal: false,
              isDeductible: true,
              status: 'confirmed',
              source: 'per_diem',
              currency: 'USD',
            },
          });
          rows.push({
            id: lodgingRow.id,
            amountCents: lodgingRow.amountCents,
            date: lodgingRow.date,
            description: lodgingRow.description || lodgingDescription,
            kind: 'lodging',
          });
        }
      }
      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'per_diem.recorded',
          actor: 'agent',
          action: {
            cityHint: cityRaw,
            cityLabel,
            state: rate.state,
            days: dayCount,
            includeLodging,
            mieCents: rate.mieCents,
            lodgingCents: includeLodging ? rate.lodgingCents : null,
            rowCount: rows.length,
            source: 'web',
          },
        },
      });
      return rows;
    });

    const totalCents = created.reduce((s, r) => s + r.amountCents, 0);
    const usingFallbackRate =
      rate.mieCents === CONUS_DEFAULT_MIE_CENTS && cityLabel === 'CONUS Standard';

    return NextResponse.json(
      {
        success: true,
        data: {
          city: cityLabel,
          state: rate.state,
          days: dayCount,
          includeLodging,
          mieCents: rate.mieCents,
          lodgingCents: includeLodging ? rate.lodgingCents : null,
          startDate: start!.toISOString().slice(0, 10),
          endDate: end!.toISOString().slice(0, 10),
          entries: created,
          totalCents,
          usingFallbackRate,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { success: false, error: sanitizeError(err) },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const params = request.nextUrl.searchParams;
    const since = params.get('since');
    const until = params.get('until');

    const where: Record<string, unknown> = {
      tenantId,
      taxCategory: 'per_diem',
    };
    if (since || until) {
      const d: Record<string, Date> = {};
      if (since) d.gte = new Date(since);
      if (until) d.lt = new Date(until);
      where.date = d;
    }

    const entries = await db.abExpense.findMany({
      where,
      orderBy: { date: 'desc' },
      take: 500,
      select: {
        id: true,
        date: true,
        amountCents: true,
        description: true,
        categoryId: true,
      },
    });
    const totalCents = entries.reduce((s, e) => s + e.amountCents, 0);
    return NextResponse.json({
      success: true,
      data: { entries, totalCents },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: sanitizeError(err) },
      { status: 500 },
    );
  }
}
