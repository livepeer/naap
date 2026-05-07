/**
 * Year-end mileage CSV export.
 *
 *   GET /mileage/export?year=2025&format=csv
 *
 * Columns are aligned to the lines a US sole proprietor / CA contractor
 * actually transcribes onto their return:
 *   • Schedule C, Part II, Line 9 ("Car and truck expenses") for US.
 *   • T2125, Part 5 ("Motor vehicle expenses"), box 9281 for CA.
 *
 * Output is plain CSV (RFC 4180 quoting). The body holds one entry per
 * row; totals + a per-purpose breakdown are appended as a footer block
 * after a blank separator row, so spreadsheet tools that auto-sum the
 * Quantity column don't double-count the totals row.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function csvEscape(value: string): string {
  // RFC 4180: wrap in quotes if the value contains comma, quote, CR, or LF.
  // Doubling embedded quotes inside is the canonical escape.
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const params = request.nextUrl.searchParams;
    const yearParam = params.get('year');
    const format = (params.get('format') || 'csv').toLowerCase();
    const year = yearParam ? parseInt(yearParam, 10) : new Date().getUTCFullYear();
    if (!isFinite(year)) {
      return NextResponse.json(
        { success: false, error: 'year must be a number' },
        { status: 400 },
      );
    }

    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));

    const [entries, clients] = await Promise.all([
      db.abMileageEntry.findMany({
        where: { tenantId, date: { gte: start, lt: end } },
        orderBy: { date: 'asc' },
      }),
      db.abClient.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    ]);
    const clientName = new Map(clients.map((c) => [c.id, c.name]));

    if (format !== 'csv') {
      // JSON path for the dashboard's "preview" pass — same shape as
      // each CSV row, easy to consume.
      return NextResponse.json({
        success: true,
        data: entries.map((e) => ({
          date: e.date.toISOString().slice(0, 10),
          quantity: e.miles,
          unit: e.unit,
          purpose: e.purpose,
          clientName: e.clientId ? clientName.get(e.clientId) || '' : '',
          jurisdiction: e.jurisdiction,
          ratePerUnitCents: e.ratePerUnitCents,
          deductibleAmountCents: e.deductibleAmountCents,
        })),
      });
    }

    // CSV body — entry rows only. Footer (totals + by-purpose) follows
    // a blank separator row so spreadsheets that auto-sum a column don't
    // double-count the summary lines.
    const header = ['Date', 'Quantity', 'Unit', 'Purpose', 'Client', 'Jurisdiction', 'Rate (¢ per unit)', 'Deductible amount'];
    const lines: string[] = [header.map(csvEscape).join(',')];
    let totalCents = 0;
    let totalQty = 0;
    const byPurpose = new Map<string, { miles: number; cents: number; unit: 'mi' | 'km'; label: string }>();

    for (const e of entries) {
      totalCents += e.deductibleAmountCents;
      totalQty += e.miles;
      lines.push([
        e.date.toISOString().slice(0, 10),
        // Quantity is rendered with two decimals so a row like 47 mi and
        // 47.50 mi line up visually in spreadsheets. CSV consumers that
        // parse as a number still get the right value.
        e.miles.toFixed(2),
        e.unit,
        e.purpose,
        e.clientId ? clientName.get(e.clientId) || '' : '',
        e.jurisdiction,
        e.ratePerUnitCents.toString(),
        (e.deductibleAmountCents / 100).toFixed(2),
      ].map((c) => csvEscape(String(c))).join(','));

      const label = (e.purpose || 'Business travel').trim();
      const key = label.toLowerCase();
      const slot = byPurpose.get(key) || { miles: 0, cents: 0, unit: e.unit as 'mi' | 'km', label };
      slot.miles += e.miles;
      slot.cents += e.deductibleAmountCents;
      byPurpose.set(key, slot);
    }

    // Footer: totals + by-purpose breakdown. Two blank separator rows so
    // spreadsheet auto-sum stops at the data block.
    lines.push('');
    lines.push(['Total Quantity:', totalQty.toFixed(2)].map(csvEscape).join(','));
    lines.push(['Total Deductible:', (totalCents / 100).toFixed(2)].map(csvEscape).join(','));

    if (byPurpose.size > 0) {
      lines.push('');
      lines.push(['By Purpose'].map(csvEscape).join(','));
      lines.push(['Purpose', 'Quantity', 'Unit', 'Deductible amount'].map(csvEscape).join(','));
      const sorted = Array.from(byPurpose.values()).sort((a, b) => b.cents - a.cents);
      for (const p of sorted) {
        lines.push([
          p.label,
          p.miles.toFixed(2),
          p.unit,
          (p.cents / 100).toFixed(2),
        ].map((c) => csvEscape(String(c))).join(','));
      }
    }

    const csv = lines.join('\n') + '\n';
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="mileage-${year}.csv"`,
      },
    });
  } catch (err) {
    console.error('[agentbook-expense/mileage/export GET] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
