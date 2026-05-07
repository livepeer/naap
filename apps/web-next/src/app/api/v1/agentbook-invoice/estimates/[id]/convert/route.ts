/**
 * POST /agentbook-invoice/estimates/[id]/convert
 *   approved → converted, creating an AbInvoice via createInvoiceDraft (PR 1).
 *
 * UX choice (documented in plan): if the estimate is `pending`, we
 * auto-flip it through `approved` first. Friction here is bad — a user
 * who explicitly says "convert" doesn't want a separate accept click.
 *
 * Idempotent: if `convertedInvoiceId` already exists, return the existing
 * invoice without creating a duplicate.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { createInvoiceDraft } from '@/lib/agentbook-invoice-draft';
import { formatEstimateNumber } from '@/lib/agentbook-estimate-parser';
import { audit } from '@/lib/agentbook-audit';
import { inferSource, inferActor } from '@/lib/agentbook-audit-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

interface ConvertBody {
  source?: string;
}

export async function POST(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as ConvertBody;
    const source = body.source || 'web';

    const existing = await db.abEstimate.findFirst({
      where: { id, tenantId },
      include: { client: true },
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Estimate not found' }, { status: 404 });
    }

    // Idempotent: already converted? Return the existing invoice.
    if (existing.status === 'converted' && existing.convertedInvoiceId) {
      const inv = await db.abInvoice.findFirst({
        where: { id: existing.convertedInvoiceId, tenantId },
        include: { lines: true, client: true },
      });
      if (inv) {
        return NextResponse.json({
          success: true,
          alreadyConverted: true,
          data: {
            estimate: { ...existing, number: formatEstimateNumber(existing) },
            invoice: inv,
          },
        });
      }
      // Edge case: estimate marked converted but invoice missing — fall
      // through to fresh conversion (best-effort recovery).
    }

    if (existing.status !== 'approved' && existing.status !== 'pending') {
      return NextResponse.json(
        { success: false, error: `Cannot convert estimate with status=${existing.status}` },
        { status: 409 },
      );
    }

    // Auto-approve pending estimates as part of convert — friction here is
    // bad and the user has explicitly asked to convert.
    if (existing.status === 'pending') {
      await db.$transaction(async (tx) => {
        await tx.abEstimate.update({
          where: { id },
          data: { status: 'approved' },
        });
        await tx.abEvent.create({
          data: {
            tenantId,
            eventType: 'estimate.approved',
            actor: 'user',
            action: { estimateId: id, viaConvert: true },
          },
        });
      });
    }

    if (!existing.client) {
      return NextResponse.json(
        { success: false, error: 'Estimate has no client on file' },
        { status: 409 },
      );
    }

    // Reuse PR 1's createInvoiceDraft. parsed.lines is a single line built
    // from the estimate's amount + description.
    const draft = await createInvoiceDraft({
      tenantId,
      client: {
        id: existing.client.id,
        name: existing.client.name,
        email: existing.client.email,
      },
      parsed: {
        lines: [
          {
            description: existing.description,
            rateCents: existing.amountCents,
            quantity: 1,
          },
        ],
        description: existing.description,
        dueDateHint: 'net-30',
      },
      source,
    });

    // Mark the estimate as converted, link the invoice.
    const finalEstimate = await db.$transaction(async (tx) => {
      const u = await tx.abEstimate.update({
        where: { id },
        data: { status: 'converted', convertedInvoiceId: draft.draftId },
        include: { client: true },
      });
      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'estimate.converted',
          actor: 'user',
          action: {
            estimateId: id,
            invoiceId: draft.draftId,
            invoiceNumber: draft.invoiceNumber,
            amountCents: existing.amountCents,
            source,
          },
        },
      });
      return u;
    });

    const inv = await db.abInvoice.findFirst({
      where: { id: draft.draftId, tenantId },
      include: { lines: true, client: true },
    });

    // PR 10 — record both the estimate state change AND the invoice
    // create. Two rows make the activity-log filter "everything that
    // happened to estimate X" trivially complete.
    await audit({
      tenantId,
      source: inferSource(request),
      actor: await inferActor(request),
      action: 'estimate.convert',
      entityType: 'AbEstimate',
      entityId: id,
      before: { status: existing.status, convertedInvoiceId: existing.convertedInvoiceId },
      after: { status: 'converted', convertedInvoiceId: draft.draftId },
    });
    await audit({
      tenantId,
      source: inferSource(request),
      actor: await inferActor(request),
      action: 'invoice.create',
      entityType: 'AbInvoice',
      entityId: draft.draftId,
      after: {
        number: draft.invoiceNumber,
        clientId: existing.client.id,
        amountCents: existing.amountCents,
        currency: draft.currency,
        status: 'draft',
        source: 'estimate-convert',
        fromEstimateId: id,
      },
    });

    return NextResponse.json(
      {
        success: true,
        alreadyConverted: false,
        data: {
          estimate: { ...finalEstimate, number: formatEstimateNumber(finalEstimate) },
          invoice: inv,
          invoiceNumber: draft.invoiceNumber,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[agentbook-invoice/estimates/[id]/convert POST] failed:', err);
    return NextResponse.json(
      { success: false, error: 'Internal error' },
      { status: 500 },
    );
  }
}
