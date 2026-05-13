import 'server-only';
import { prisma } from '@naap/database';
import { invalidateAccount } from '@naap/billing';
import type Stripe from 'stripe';

export async function applyEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const tenantId = (sub.metadata?.tenantId as string | undefined) ?? null;
      if (!tenantId) {
        console.warn('[stripe-webhook] subscription missing tenantId metadata, skipping');
        return;
      }
      const priceId = sub.items.data[0]?.price.id;
      const plan = priceId
        ? await prisma.billPlan.findFirst({ where: { stripePriceId: priceId } })
        : null;
      if (!plan) {
        console.error('[stripe-webhook] plan not found for stripePriceId', priceId);
        return;
      }
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      const startSec = (sub as unknown as { current_period_start: number }).current_period_start;
      const endSec = (sub as unknown as { current_period_end: number }).current_period_end;
      await prisma.billSubscription.upsert({
        where: { accountId: tenantId },
        create: {
          accountId: tenantId,
          planId: plan.id,
          status: sub.status,
          stripeCustomerId: customerId,
          stripeSubscriptionId: sub.id,
          currentPeriodStart: new Date(startSec * 1000),
          currentPeriodEnd: new Date(endSec * 1000),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        },
        update: {
          planId: plan.id,
          status: sub.status,
          stripeSubscriptionId: sub.id,
          currentPeriodStart: new Date(startSec * 1000),
          currentPeriodEnd: new Date(endSec * 1000),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        },
      });
      invalidateAccount(tenantId);
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const tenantId = (sub.metadata?.tenantId as string | undefined) ?? null;
      if (!tenantId) return;
      await prisma.billSubscription.update({
        where: { accountId: tenantId },
        data: { status: 'canceled', canceledAt: new Date() },
      });
      invalidateAccount(tenantId);
      break;
    }
    case 'invoice.paid':
    case 'invoice.payment_failed':
      // No DB writes here; the matching customer.subscription.updated
      // event flips status. Logged for observability.
      console.log('[stripe-webhook]', event.type, 'recorded');
      break;
    default:
      // Unknown event type — still recorded in BillEvent for replay.
      break;
  }
}
