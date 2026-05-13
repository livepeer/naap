import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@naap/database';
import { getCurrentPlan, invalidateAccount } from '@naap/billing';
import { getStripe } from '@/lib/billing/stripe';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const tenantId = await resolveAgentbookTenant(request);
  const cur = await getCurrentPlan(tenantId);
  return NextResponse.json(cur);
}

const Body = z.object({
  planId: z.string(),
  paymentMethodId: z.string(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const tenantId = await resolveAgentbookTenant(request);
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  const { planId, paymentMethodId } = parsed.data;

  const plan = await prisma.billPlan.findUnique({ where: { id: planId } });
  if (!plan?.stripePriceId) {
    return NextResponse.json({ error: 'plan has no Stripe price' }, { status: 400 });
  }

  const sub = await prisma.billSubscription.findUnique({ where: { accountId: tenantId } });
  const customerId = sub?.stripeCustomerId;
  if (!customerId) {
    return NextResponse.json({ error: 'no customer; call /intent first' }, { status: 400 });
  }

  try {
    const stripeSub = await getStripe().subscriptions.create({
      customer: customerId,
      items: [{ price: plan.stripePriceId }],
      default_payment_method: paymentMethodId,
      metadata: { tenantId },
    });
    const startSec = (stripeSub as unknown as { current_period_start: number }).current_period_start;
    const endSec = (stripeSub as unknown as { current_period_end: number }).current_period_end;
    await prisma.billSubscription.upsert({
      where: { accountId: tenantId },
      create: {
        accountId: tenantId, planId, status: stripeSub.status,
        stripeCustomerId: customerId, stripeSubscriptionId: stripeSub.id,
        currentPeriodStart: new Date(startSec * 1000),
        currentPeriodEnd: new Date(endSec * 1000),
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
      },
      update: {
        planId, status: stripeSub.status, stripeSubscriptionId: stripeSub.id,
        currentPeriodStart: new Date(startSec * 1000),
        currentPeriodEnd: new Date(endSec * 1000),
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
      },
    });
    invalidateAccount(tenantId);
    return NextResponse.json({ ok: true, subscriptionId: stripeSub.id });
  } catch (err) {
    console.error('[billing] subscribe failed:', err);
    return NextResponse.json({ error: 'subscribe failed' }, { status: 502 });
  }
}
