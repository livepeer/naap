import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/billing/stripe';
import { prisma } from '@naap/database';
import { applyEvent } from './handlers';

// Stripe webhooks must run on Node runtime (raw body + signature verify)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const sig = request.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'missing signature' }, { status: 400 });

  const rawBody = await request.text();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'webhook secret not configured' }, { status: 500 });

  let event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    console.warn('[stripe-webhook] signature verification failed:', err);
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  // Idempotency: try to insert BillEvent. If P2002 (unique violation),
  // we've already processed this event — short-circuit success.
  try {
    await prisma.billEvent.create({
      data: {
        accountId: (event.data.object as { metadata?: { tenantId?: string } })?.metadata?.tenantId ?? null,
        stripeEventId: event.id,
        eventType: event.type,
        payload: JSON.parse(JSON.stringify(event)),
      },
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'P2002') {
      return NextResponse.json({ received: true, idempotent: true });
    }
    console.error('[stripe-webhook] BillEvent create failed:', err);
    return NextResponse.json({ error: 'persist failed' }, { status: 500 });
  }

  try {
    await applyEvent(event);
    await prisma.billEvent.update({
      where: { stripeEventId: event.id },
      data: { processedAt: new Date() },
    });
  } catch (err) {
    console.error('[stripe-webhook] applyEvent failed:', err);
    // Return 500 so Stripe retries. BillEvent row stays without processedAt.
    return NextResponse.json({ error: 'handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
