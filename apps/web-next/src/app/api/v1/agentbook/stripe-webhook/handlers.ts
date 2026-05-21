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
    case 'checkout.session.completed': {
      // Customer-invoice payment via Stripe Checkout (NOT subscription).
      // Records payment, marks AbInvoice paid, creates journal entry.
      // Previously handled by plugins/agentbook-invoice /stripe/checkout-completed
      // (which was unsigned). Now consolidated into the signed canonical handler.
      const session = event.data.object as Stripe.Checkout.Session;
      const invoiceId = session.metadata?.invoiceId;
      const tenantId = session.metadata?.tenantId;
      if (!invoiceId || !tenantId) {
        console.warn('[stripe-webhook] checkout.session.completed missing invoiceId/tenantId metadata');
        return;
      }
      const paymentIntent =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id ?? null;

      // Idempotency: skip if a payment row already exists for this PaymentIntent.
      if (paymentIntent) {
        const existing = await prisma.abPayment.findFirst({ where: { stripePaymentId: paymentIntent } });
        if (existing) return;
      }

      const invoice = await prisma.abInvoice.findFirst({ where: { id: invoiceId, tenantId } });
      if (!invoice || invoice.status === 'paid') return;

      const amountCents = session.amount_total ?? invoice.amountCents;

      await prisma.abPayment.create({
        data: {
          tenantId,
          invoiceId: invoice.id,
          amountCents,
          method: 'stripe',
          date: new Date(),
          stripePaymentId: paymentIntent,
        },
      });

      await prisma.abInvoice.update({
        where: { id: invoice.id },
        data: { status: 'paid' },
      });

      // Best-effort journal entry — won't block payment recording if accounts missing.
      try {
        const cashAccount = await prisma.abAccount.findFirst({ where: { tenantId, code: '1010' } });
        const arAccount = await prisma.abAccount.findFirst({ where: { tenantId, code: '1200' } });
        if (cashAccount && arAccount) {
          await prisma.abJournalEntry.create({
            data: {
              tenantId,
              date: new Date(),
              memo: `Stripe payment for ${invoice.number}`,
              sourceType: 'payment',
              sourceId: invoice.id,
              lines: {
                create: [
                  { tenantId, accountId: cashAccount.id, debitCents: amountCents, creditCents: 0 }, // G-009
                  { tenantId, accountId: arAccount.id, debitCents: 0, creditCents: amountCents }, // G-009
                ],
              },
            },
          });
        }
      } catch (err) {
        console.warn('[stripe-webhook] journal entry creation failed (non-fatal):', err);
      }

      await prisma.abEvent.create({
        data: {
          tenantId,
          eventType: 'invoice.stripe_payment',
          actor: 'stripe',
          action: { invoiceId: invoice.id, amountCents, paymentIntent },
        },
      });
      break;
    }
    default:
      // Unknown event type — still recorded in BillEvent for replay.
      break;
  }
}
