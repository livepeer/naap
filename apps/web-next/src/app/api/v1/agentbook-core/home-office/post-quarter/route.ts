/**
 * Home-office quarterly entries — POST creates AbExpense rows for the
 * deductible portion of a single quarter (PR 15).
 *
 *  POST /agentbook-core/home-office/post-quarter
 *    body: {
 *      year: 2026,
 *      quarter: 2,         // 1-4
 *      utilities: 40000,   // cents
 *      internet: 9000,
 *      rentInterest: 300000,
 *      insurance: 9000,
 *      otherCents: 1000,
 *    }
 *
 * The deductible portion is computed via `computeQuarterlyDeductible()`:
 *
 *   • US simplified mode (`useUsSimplified=true`) — flat $5/sqft up to
 *     300 sqft, divided by 4 quarters. The component fields are
 *     ignored under this method (IRS rule). One AbExpense row is
 *     created with `taxCategory='home_office'`.
 *
 *   • Actual-expense mode — sum of components × ratio. We split that
 *     across the supplied components proportionally, creating one
 *     AbExpense row per non-zero component so the user can see "10%
 *     of utilities = $40, 10% of internet = $9, …" in the ledger.
 *
 * Tenant-scoped (`resolveAgentbookTenant`), 500s sanitised, 422 when
 * config is missing the data needed to compute the deductible.
 *
 * GET returns the history of quarters posted so far.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import {
  computeQuarterlyDeductible,
  computeRatio,
} from '@/lib/agentbook-home-office';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface PostQuarterBody {
  year?: number;
  quarter?: number;          // 1-4
  utilities?: number;        // cents
  internet?: number;
  rentInterest?: number;
  insurance?: number;
  otherCents?: number;
}

interface ComponentRow {
  label: string;
  cents: number;
}

function sanitizeError(err: unknown, label: string): string {
  console.error(`[agentbook-core/home-office/post-quarter ${label}]`, err);
  return 'Failed to record home-office quarterly entries.';
}

/** Quarter → first-day-of-month index (UTC). Q1=Jan, Q2=Apr, … */
const QUARTER_TO_MONTH: Record<number, number> = { 1: 0, 2: 3, 3: 6, 4: 9 };

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as PostQuarterBody;

    const year = typeof body.year === 'number' && body.year > 1900 && body.year < 9999
      ? Math.floor(body.year)
      : null;
    const quarter = typeof body.quarter === 'number' && body.quarter >= 1 && body.quarter <= 4
      ? Math.floor(body.quarter)
      : null;
    if (!year || !quarter) {
      return NextResponse.json(
        { success: false, error: 'year and quarter (1-4) are required' },
        { status: 400 },
      );
    }

    // Pull config — required to know which method to use.
    const cfg = await db.abHomeOfficeConfig.findUnique({ where: { tenantId } });
    if (!cfg) {
      return NextResponse.json(
        {
          success: false,
          error: 'Home-office config missing — set total/office sqft first.',
          code: 'config_missing',
        },
        { status: 422 },
      );
    }
    const ratio = cfg.ratio ?? computeRatio(cfg.totalSqft, cfg.officeSqft);
    const useSimplified = !!cfg.useUsSimplified;
    if (!useSimplified && (!ratio || ratio <= 0)) {
      return NextResponse.json(
        {
          success: false,
          error: 'No square-footage ratio configured — set total/office sqft or enable US simplified.',
          code: 'ratio_missing',
        },
        { status: 422 },
      );
    }

    const utilitiesCents = nzInt(body.utilities);
    const internetCents = nzInt(body.internet);
    const rentInterestCents = nzInt(body.rentInterest);
    const insuranceCents = nzInt(body.insurance);
    const otherCents = nzInt(body.otherCents);

    const result = computeQuarterlyDeductible({
      mode: useSimplified ? 'us_simplified' : 'actual',
      ratio,
      officeSqft: cfg.officeSqft || undefined,
      utilitiesCents,
      internetCents,
      rentInterestCents,
      insuranceCents,
      otherCents,
    });

    if (result.deductibleCents <= 0) {
      // Nothing to book — return success so the bot reply can echo
      // "no deduction this quarter" without surfacing a hard error.
      return NextResponse.json({
        success: true,
        data: {
          year,
          quarter,
          mode: result.mode,
          ratio: useSimplified ? null : ratio,
          totalQuarterCents: result.totalQuarterCents,
          deductibleCents: 0,
          entries: [],
          skipped: true,
        },
      }, { status: 201 });
    }

    // Best-effort category resolution — falls back to null when the
    // chart-of-accounts isn't seeded with a "home office" line.
    const expenseAccounts = await db.abAccount.findMany({
      where: { tenantId, accountType: 'expense' },
      select: { id: true, name: true },
    });
    const categoryId =
      expenseAccounts.find((c) => /home\s*office/i.test(c.name))?.id
      || expenseAccounts.find((c) => /utilit/i.test(c.name))?.id
      || null;

    // Anchor date — first day of the quarter at UTC midnight.
    const month = QUARTER_TO_MONTH[quarter];
    const anchor = new Date(Date.UTC(year, month, 1));
    const quarterLabel = `Q${quarter} ${year}`;

    // Build the per-component rows. Simplified mode books a single
    // flat row; actual-expense mode books one row per non-zero
    // component, splitting the deductible proportionally.
    const componentRows: ComponentRow[] = [];
    if (useSimplified) {
      componentRows.push({
        label: `Home office — ${quarterLabel} (US simplified, ${cfg.officeSqft || 0} sqft)`,
        cents: result.deductibleCents,
      });
    } else {
      const components: Array<{ label: string; gross: number }> = [
        { label: 'utilities', gross: utilitiesCents },
        { label: 'internet', gross: internetCents },
        { label: 'rent/mortgage interest', gross: rentInterestCents },
        { label: 'insurance', gross: insuranceCents },
        { label: 'other', gross: otherCents },
      ].filter((c) => c.gross > 0);
      // Apportion the deductibleCents across components by gross
      // weight, with the last row absorbing the rounding remainder so
      // the rows always sum exactly to deductibleCents.
      const totalGross = components.reduce((s, c) => s + c.gross, 0);
      let allocated = 0;
      components.forEach((c, i) => {
        let portion: number;
        if (i === components.length - 1) {
          portion = result.deductibleCents - allocated;
        } else {
          portion = Math.round((c.gross / totalGross) * result.deductibleCents);
          allocated += portion;
        }
        componentRows.push({
          label: `Home office — ${c.label} ${quarterLabel}`,
          cents: portion,
        });
      });
      // If no components were supplied at all, fall back to a single
      // catch-all row labelled "actual expenses" so we don't drop the
      // deductible silently. This shouldn't happen because the
      // deductibleCents > 0 guard above precludes empty inputs in
      // actual mode, but defence in depth.
      if (componentRows.length === 0) {
        componentRows.push({
          label: `Home office — ${quarterLabel} (actual)`,
          cents: result.deductibleCents,
        });
      }
    }

    // Anchor day — day 1 of the quarter (UTC midnight).
    const created = await db.$transaction(async (tx) => {
      const rows: Array<{ id: string; amountCents: number; description: string }> = [];
      for (const row of componentRows) {
        if (row.cents <= 0) continue;
        const r = await tx.abExpense.create({
          data: {
            tenantId,
            amountCents: row.cents,
            date: anchor,
            description: row.label,
            categoryId,
            taxCategory: 'home_office',
            isPersonal: false,
            isDeductible: true,
            status: 'confirmed',
            source: 'home_office',
            currency: 'USD',
          },
        });
        rows.push({ id: r.id, amountCents: r.amountCents, description: r.description || row.label });
      }
      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'home_office.quarter_posted',
          actor: 'agent',
          action: {
            year,
            quarter,
            mode: result.mode,
            ratio: useSimplified ? null : ratio,
            totalQuarterCents: result.totalQuarterCents,
            deductibleCents: result.deductibleCents,
            rowCount: rows.length,
            source: 'web',
          },
        },
      });
      return rows;
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          year,
          quarter,
          mode: result.mode,
          ratio: useSimplified ? null : ratio,
          totalQuarterCents: result.totalQuarterCents,
          deductibleCents: result.deductibleCents,
          entries: created,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { success: false, error: sanitizeError(err, 'POST') },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const entries = await db.abExpense.findMany({
      where: { tenantId, taxCategory: 'home_office' },
      orderBy: { date: 'desc' },
      take: 200,
      select: {
        id: true,
        date: true,
        amountCents: true,
        description: true,
      },
    });
    const totalCents = entries.reduce((s, e) => s + e.amountCents, 0);
    return NextResponse.json({ success: true, data: { entries, totalCents } });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: sanitizeError(err, 'GET') },
      { status: 500 },
    );
  }
}

function nzInt(v: unknown): number {
  if (typeof v !== 'number' || !isFinite(v) || v <= 0) return 0;
  return Math.floor(v);
}
