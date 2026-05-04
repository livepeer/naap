/**
 * CSV expense import — auto-detects column mapping, upserts vendors,
 * and creates expenses with confidence 0.6 (imported = medium trust).
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

interface ColumnMapping {
  date: string;
  amount: string;
  description: string;
  vendor?: string;
  category?: string;
}

interface ImportBody {
  csv?: string;
  mapping?: ColumnMapping;
}

function parseCSV(csvText: string): Record<string, string>[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    rows.push(row);
  }
  return rows;
}

function detectMapping(headers: string[]): ColumnMapping {
  const lower = headers.map((h) => h.toLowerCase());
  const find = (...names: string[]): string | undefined => lower.find((h) => names.includes(h));
  const findContains = (substr: string): string | undefined => lower.find((h) => h.includes(substr));

  return {
    date: find('date', 'transaction date', 'trans date', 'posted date') || lower[0],
    amount: find('amount', 'debit', 'transaction amount', 'total') || findContains('amount') || lower[1],
    description:
      find('description', 'memo', 'transaction description', 'details', 'name') ||
      findContains('desc') ||
      lower[2],
    vendor: find('vendor', 'merchant', 'payee', 'merchant name'),
    category: find('category', 'type', 'expense type'),
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as ImportBody;
    const { csv, mapping } = body;

    if (!csv || typeof csv !== 'string') {
      return NextResponse.json(
        { success: false, error: 'csv field (string) is required' },
        { status: 400 },
      );
    }

    const rows = parseCSV(csv);
    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'CSV has no data rows' }, { status: 400 });
    }

    const headers = Object.keys(rows[0]);
    const colMapping = mapping || detectMapping(headers);

    const imported: { row: number; expenseId: string; amountCents: number; description: string }[] = [];
    const errors: { row: number; error: string; raw?: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const rawAmount = row[colMapping.amount] || '0';
        const amountFloat = Math.abs(parseFloat(rawAmount.replace(/[^0-9.-]/g, '')));
        if (isNaN(amountFloat) || amountFloat === 0) {
          errors.push({ row: i + 2, error: 'Invalid amount', raw: rawAmount });
          continue;
        }
        const amountCents = Math.round(amountFloat * 100);
        const dateStr = row[colMapping.date];
        const date = dateStr ? new Date(dateStr) : new Date();
        if (isNaN(date.getTime())) {
          errors.push({ row: i + 2, error: 'Invalid date', raw: dateStr });
          continue;
        }

        const description = row[colMapping.description] || `CSV import row ${i + 2}`;
        const vendorName = colMapping.vendor ? row[colMapping.vendor] : undefined;

        let vendorId: string | undefined;
        if (vendorName) {
          const normalized = vendorName.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
          if (normalized) {
            const vendor = await db.abVendor.upsert({
              where: { tenantId_normalizedName: { tenantId, normalizedName: normalized } },
              update: { lastSeen: new Date(), transactionCount: { increment: 1 } },
              create: { tenantId, name: vendorName, normalizedName: normalized },
            });
            vendorId = vendor.id;
          }
        }

        const expense = await db.abExpense.create({
          data: {
            tenantId,
            amountCents,
            date,
            description,
            vendorId: vendorId || null,
            confidence: 0.6,
          },
        });

        imported.push({ row: i + 2, expenseId: expense.id, amountCents, description });
      } catch (err) {
        errors.push({ row: i + 2, error: err instanceof Error ? err.message : String(err) });
      }
    }

    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'expense.csv_imported',
        actor: 'user',
        action: {
          totalRows: rows.length,
          imported: imported.length,
          errors: errors.length,
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        totalRows: rows.length,
        imported: imported.length,
        errors: errors.length,
        importedExpenses: imported,
        importErrors: errors.slice(0, 20),
      },
    });
  } catch (err) {
    console.error('[agentbook-expense/import/csv POST] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
