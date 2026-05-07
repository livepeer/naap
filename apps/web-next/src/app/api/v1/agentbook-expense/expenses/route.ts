/**
 * Expense list + create — native Next.js route.
 *
 * GET: list with filters (status, vendor, date range, isPersonal).
 * POST: create with vendor upsert, learned-category pattern lookup,
 * and double-entry journal posting in a single transaction. Mirrors
 * the legacy plugin Express handler so the record-expense agent skill
 * works end-to-end.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { audit } from '@/lib/agentbook-audit';
import { inferSource, inferActor } from '@/lib/agentbook-audit-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function normalizeVendorName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

interface CreateExpenseBody {
  amountCents?: number;
  vendor?: string;
  categoryId?: string;
  date?: string;
  description?: string;
  receiptUrl?: string;
  confidence?: number;
  isPersonal?: boolean;
  taxAmountCents?: number;
  tipAmountCents?: number;
  paymentMethod?: string;
  currency?: string;
  notes?: string;
  tags?: string;
  isBillable?: boolean;
  clientId?: string;
  source?: string;
  status?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as CreateExpenseBody;
    const {
      amountCents, vendor, categoryId, date, description, receiptUrl, confidence, isPersonal,
      taxAmountCents, tipAmountCents, paymentMethod, currency, notes, tags, isBillable, clientId, source, status,
    } = body;

    if (!amountCents || amountCents <= 0) {
      return NextResponse.json({ success: false, error: 'amountCents must be a positive integer' }, { status: 400 });
    }

    let vendorRecord: { id: string; defaultCategoryId: string | null; normalizedName: string } | null = null;
    if (vendor) {
      const normalized = normalizeVendorName(vendor);
      if (normalized) {
        vendorRecord = await db.abVendor.upsert({
          where: { tenantId_normalizedName: { tenantId, normalizedName: normalized } },
          update: { transactionCount: { increment: 1 }, lastSeen: new Date() },
          create: {
            tenantId,
            name: vendor,
            normalizedName: normalized,
            defaultCategoryId: categoryId || null,
          },
          select: { id: true, defaultCategoryId: true, normalizedName: true },
        });
      }
    }

    let resolvedCategoryId: string | null = categoryId ?? null;
    let resolvedConfidence: number | null = confidence ?? null;
    if (!resolvedCategoryId && vendorRecord) {
      const pattern = await db.abPattern.findUnique({
        where: { tenantId_vendorPattern: { tenantId, vendorPattern: vendorRecord.normalizedName } },
      });
      if (pattern) {
        resolvedCategoryId = pattern.categoryId;
        resolvedConfidence = pattern.confidence;
        await db.abPattern.update({
          where: { id: pattern.id },
          data: { usageCount: { increment: 1 }, lastUsed: new Date() },
        });
      }
    }

    const expense = await db.$transaction(async (tx) => {
      let journalEntryId: string | null = null;
      if (resolvedCategoryId && !isPersonal) {
        const cashAccount = await tx.abAccount.findFirst({ where: { tenantId, code: '1000' } });
        if (cashAccount) {
          const je = await tx.abJournalEntry.create({
            data: {
              tenantId,
              date: new Date(date || Date.now()),
              memo: `Expense: ${description || vendor || 'Expense'}`,
              sourceType: 'expense',
              verified: true,
              lines: {
                create: [
                  { accountId: resolvedCategoryId, debitCents: amountCents, creditCents: 0, description: description || vendor || 'Expense' },
                  { accountId: cashAccount.id, debitCents: 0, creditCents: amountCents, description: `Payment: ${vendor || 'Expense'}` },
                ],
              },
            },
          });
          journalEntryId = je.id;
        }
      }

      const exp = await tx.abExpense.create({
        data: {
          tenantId,
          amountCents,
          taxAmountCents: taxAmountCents || 0,
          tipAmountCents: tipAmountCents || 0,
          vendorId: vendorRecord?.id,
          categoryId: resolvedCategoryId,
          date: new Date(date || Date.now()),
          description: description || vendor || 'Expense',
          notes: notes || null,
          receiptUrl,
          paymentMethod: paymentMethod || 'unknown',
          currency: currency || 'USD',
          tags: tags || null,
          confidence: resolvedConfidence,
          isPersonal: isPersonal || false,
          isBillable: isBillable || false,
          clientId: clientId || null,
          journalEntryId,
          ...(source ? { source } : {}),
          ...(status ? { status } : {}),
        },
        include: { vendor: true },
      });

      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'expense.recorded',
          actor: 'agent',
          action: {
            expense_id: exp.id,
            amountCents,
            vendor: vendor || null,
            categoryId: resolvedCategoryId,
            isPersonal: isPersonal || false,
            hasReceipt: !!receiptUrl,
          },
        },
      });

      return exp;
    });

    await audit({
      tenantId,
      source: inferSource(request),
      actor: await inferActor(request),
      action: 'expense.create',
      entityType: 'AbExpense',
      entityId: expense.id,
      after: {
        amountCents,
        vendorId: expense.vendorId,
        vendorName: vendor || null,
        categoryId: resolvedCategoryId,
        date: expense.date,
        description: expense.description,
        isPersonal: expense.isPersonal,
        hasReceipt: !!receiptUrl,
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: expense,
        meta: {
          vendor: vendorRecord,
          categoryFromPattern: !categoryId && !!resolvedCategoryId,
          confidence: resolvedConfidence,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[agentbook-expense/expenses POST] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const params = request.nextUrl.searchParams;
    const startDate = params.get('startDate');
    const endDate = params.get('endDate');
    const isPersonal = params.get('isPersonal');
    const vendorId = params.get('vendorId');
    const limit = parseInt(params.get('limit') || '50', 10);
    const offset = parseInt(params.get('offset') || '0', 10);

    const where: Record<string, unknown> = { tenantId };
    if (startDate || endDate) {
      const date: Record<string, Date> = {};
      if (startDate) date.gte = new Date(startDate);
      if (endDate) date.lte = new Date(endDate);
      where.date = date;
    }
    if (isPersonal !== null) where.isPersonal = isPersonal === 'true';
    if (vendorId) where.vendorId = vendorId;

    const [expenses, total] = await Promise.all([
      db.abExpense.findMany({
        where,
        include: { vendor: { select: { id: true, name: true, normalizedName: true } } },
        orderBy: { date: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.abExpense.count({ where }),
    ]);

    const categoryIds = [...new Set(expenses.map((e) => e.categoryId).filter((id): id is string => Boolean(id)))];
    const categories = categoryIds.length > 0
      ? await db.abAccount.findMany({
          where: { id: { in: categoryIds } },
          select: { id: true, name: true, code: true },
        })
      : [];
    const categoryMap = Object.fromEntries(categories.map((c) => [c.id, { name: c.name, code: c.code }]));

    const enriched = expenses.map((e) => ({
      ...e,
      vendorName: e.vendor?.name || null,
      categoryName: e.categoryId ? categoryMap[e.categoryId]?.name || null : null,
      categoryCode: e.categoryId ? categoryMap[e.categoryId]?.code || null : null,
    }));

    return NextResponse.json({
      success: true,
      data: enriched,
      meta: { total, limit, offset },
    });
  } catch (err) {
    console.error('[agentbook-expense/expenses GET] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
