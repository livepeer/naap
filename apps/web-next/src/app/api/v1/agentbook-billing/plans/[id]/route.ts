import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@naap/database';
import { invalidateAll } from '@naap/billing';
import { getStripe } from '@/lib/billing/stripe';
import { requireAdmin, HttpError } from '@/lib/billing/admin-auth';

export const runtime = 'nodejs';

const PatchBody = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  features: z.object({
    telegram_bot: z.boolean(),
    tax_package_generation: z.boolean(),
    multi_user_teams: z.boolean(),
  }).optional(),
  quotas: z.object({
    expenses_created: z.number().int(),
    ocr_scans: z.number().int(),
    ai_messages: z.number().int(),
    invoices_sent: z.number().int(),
    bank_connections: z.number().int(),
  }).optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireAdmin(request);
  } catch (err) {
    const e = err as HttpError;
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  const { id } = await params;
  const parsed = PatchBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  const plan = await prisma.billPlan.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ plan });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireAdmin(request);
  } catch (err) {
    const e = err as HttpError;
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  const { id } = await params;
  const plan = await prisma.billPlan.findUnique({ where: { id } });
  if (!plan) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (plan.stripeProductId) {
    try {
      await getStripe().products.update(plan.stripeProductId, { active: false });
    } catch (err) {
      console.warn('[billing] stripe archive failed (continuing):', err);
    }
  }
  await prisma.billPlan.update({ where: { id }, data: { isActive: false } });
  invalidateAll();
  return NextResponse.json({ ok: true });
}
