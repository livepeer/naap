# Close Critical Gaps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close 3 critical competitive gaps: Stripe payment links in invoices, multi-line invoice creation via agent, and auto payment reminders.

**Architecture:** All skill-driven — new skills for agent brain, endpoints for invoice plugin, UI updates for web dashboard. Each feature works via Telegram bot AND web UI.

**Spec source:** `docs/competitor-analysis.md` — P1 gaps

---

## Gap 1: Stripe Payment Links in Invoices

### What to Build
When an invoice is created/sent, generate a Stripe Checkout session URL. Include the payment link in the invoice email and PDF. When client pays via Stripe, auto-record payment + update invoice status.

### Changes

**Schema:** Add `paymentUrl` field to `AbInvoice`

**Invoice plugin (`plugins/agentbook-invoice/backend/src/server.ts`):**
- New endpoint: `POST /invoices/:id/payment-link` — creates Stripe Checkout session, stores URL
- Modify `generateInvoiceHtml()` — add "Pay Now" button with payment link
- Modify invoice email — include payment link
- Modify payment reminder email — include payment link
- New endpoint: `POST /stripe/checkout-webhook` — handle `checkout.session.completed` event → auto-record payment

**Agent skill:** `create-payment-link` — "generate payment link for that invoice"

**Web UI:** Show payment link on invoice detail, copy-to-clipboard button

---

## Gap 2: Multi-Line Invoice via Agent

### What to Build
Agent can parse "Invoice Acme: consulting $3000, design $2000, hosting $500" into multiple line items.

### Changes

**Core server (`classifyAndExecuteV1`):** Enhance `create-invoice` pre-processing to parse multi-line items from text. Patterns:
- "Invoice Acme: item1 $X, item2 $Y, item3 $Z"
- "Invoice Acme $3000 consulting, $2000 design"
- LLM fallback for ambiguous formats

No new endpoints needed — the invoice creation endpoint already supports `lines[]` array.

---

## Gap 3: Auto Payment Reminders

### What to Build
Scheduled daily check for overdue invoices → auto-send reminders. Configurable per tenant (enable/disable, frequency).

### Changes

**Cron route:** New `apps/web-next/src/app/api/v1/agentbook/cron/payment-reminders/route.ts`
- Daily at 7 AM UTC
- Find overdue invoices where `status = 'sent'` and `dueDate < today`
- Send reminder via existing `/invoices/:id/remind` endpoint
- Respect tenant config (auto-remind enabled, min days between reminders)

**Schema:** Add `lastRemindedAt` to AbInvoice, `autoRemindEnabled` to AbTenantConfig

**Agent skill:** `toggle-auto-reminders` — "enable auto payment reminders" / "disable auto reminders"

---

## Task 1: Schema + Stripe Payment Link

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Modify: `plugins/agentbook-invoice/backend/src/server.ts`
- Modify: `plugins/agentbook-core/backend/src/server.ts`

- [ ] **Step 1: Add schema fields**

Add to AbInvoice (before `@@unique`):
```prisma
  paymentUrl      String?
  lastRemindedAt  DateTime?
```

Add to AbTenantConfig (before `@@index`):
```prisma
  autoRemindEnabled Boolean @default(false)
  autoRemindDays    Int     @default(3)         // min days between reminders
```

Push schema.

- [ ] **Step 2: Add payment link endpoint**

In invoice plugin server.ts, add:
```typescript
// POST /invoices/:id/payment-link — Generate Stripe Checkout session
app.post('/api/v1/agentbook-invoice/invoices/:id/payment-link', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const invoice = await db.abInvoice.findFirst({
      where: { id: req.params.id, tenantId },
      include: { client: true, lines: true },
    });
    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });
    if (invoice.status === 'paid') return res.json({ success: true, data: { paymentUrl: null, message: 'Invoice already paid' } });

    // If payment link already exists and invoice not modified, return existing
    if (invoice.paymentUrl) {
      return res.json({ success: true, data: { paymentUrl: invoice.paymentUrl } });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      // No Stripe configured — generate a mock payment URL for dev
      const mockUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/pay/${invoice.id}`;
      await db.abInvoice.update({ where: { id: invoice.id }, data: { paymentUrl: mockUrl } });
      return res.json({ success: true, data: { paymentUrl: mockUrl, mock: true } });
    }

    // Create Stripe Checkout Session
    const stripe = await import('stripe');
    const stripeClient = new stripe.default(stripeKey);

    const session = await stripeClient.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      client_reference_id: invoice.id,
      customer_email: invoice.client?.email || undefined,
      line_items: (invoice.lines || []).map((line: any) => ({
        price_data: {
          currency: (invoice.currency || 'usd').toLowerCase(),
          product_data: { name: line.description || 'Service' },
          unit_amount: line.rateCents,
        },
        quantity: line.quantity || 1,
      })),
      metadata: { invoiceId: invoice.id, tenantId, invoiceNumber: invoice.number },
      success_url: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/pay/success?invoice=${invoice.id}`,
      cancel_url: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/pay/cancel?invoice=${invoice.id}`,
    });

    const paymentUrl = session.url || '';
    await db.abInvoice.update({ where: { id: invoice.id }, data: { paymentUrl } });

    res.json({ success: true, data: { paymentUrl, sessionId: session.id } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});
```

- [ ] **Step 3: Update invoice HTML to include payment link**

In `generateInvoiceHtml()`, after the total amount box, add:
```typescript
// Add payment button if payment URL exists
if (invoice.paymentUrl && invoice.status !== 'paid') {
  html += `<div style="text-align:center;margin:24px 0">
    <a href="${invoice.paymentUrl}" style="display:inline-block;padding:14px 32px;background:#10b981;color:white;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px">
      Pay $${(invoice.amountCents / 100).toFixed(2)} Now
    </a>
    <p style="margin-top:8px;font-size:12px;color:#888">Secure payment powered by Stripe</p>
  </div>`;
}
```

Also add to reminder email template.

- [ ] **Step 4: Add Stripe checkout webhook handler**

```typescript
// POST /stripe/checkout-completed — Handle successful Stripe payment
app.post('/api/v1/agentbook-invoice/stripe/checkout-completed', async (req, res) => {
  try {
    const event = req.body;
    if (event.type !== 'checkout.session.completed') {
      return res.json({ received: true });
    }

    const session = event.data.object;
    const invoiceId = session.metadata?.invoiceId;
    const tenantId = session.metadata?.tenantId;
    if (!invoiceId || !tenantId) return res.json({ received: true });

    // Check idempotency
    const existing = await db.abPayment.findFirst({ where: { stripePaymentId: session.payment_intent } });
    if (existing) return res.json({ received: true, message: 'Already processed' });

    const invoice = await db.abInvoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!invoice || invoice.status === 'paid') return res.json({ received: true });

    // Record payment (reuse existing payment logic)
    const amountCents = session.amount_total || invoice.amountCents;
    // ... record payment + journal entry + update invoice status
    // (Call the existing internal payment recording logic)

    res.json({ received: true, recorded: true });
  } catch (err) {
    console.error('Stripe checkout webhook error:', err);
    res.json({ received: true, error: String(err) });
  }
});
```

- [ ] **Step 5: Add agent skill**

In core server BUILT_IN_SKILLS:
```typescript
{
  name: 'create-payment-link', description: 'Generate a Stripe payment link for an invoice so clients can pay online', category: 'invoicing',
  triggerPatterns: ['payment.*link', 'pay.*link', 'stripe.*link', 'online.*pay', 'pay.*online'],
  parameters: { invoiceId: { type: 'string', required: false } },
  endpoint: { method: 'POST', url: '/api/v1/agentbook-invoice/invoices/:id/payment-link' },
},
```

Add pre-processing to resolve invoice (same pattern as send-invoice).

- [ ] **Step 6: Commit**

---

## Task 2: Multi-Line Invoice via Agent

**Files:**
- Modify: `plugins/agentbook-core/backend/src/server.ts`

- [ ] **Step 1: Enhance create-invoice pre-processing**

Find the existing `create-invoice` pre-processing handler. Replace the single-line logic with multi-line parsing:

```typescript
if (selectedSkill.name === 'create-invoice' && extractedParams.clientName) {
  try {
    const invoiceBase = baseUrls['/api/v1/agentbook-invoice'] || 'http://localhost:4052';
    const client = await resolveOrCreateClient(invoiceBase, tenantId, extractedParams.clientName);
    if (client) {
      const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 30);

      // Parse multi-line items: "consulting $3000, design $2000, hosting $500"
      let lines: any[] = [];
      const lineText = extractedParams.description || text;

      // Pattern 1: "item1 $X, item2 $Y, item3 $Z"
      const multiLineMatch = lineText.match(/(.+?\$[\d,]+\.?\d{0,2})/gi);
      if (multiLineMatch && multiLineMatch.length > 1) {
        for (const seg of multiLineMatch) {
          const amtMatch = seg.match(/\$?([\d,]+\.?\d{0,2})\s*$/);
          const desc = seg.replace(/\$?[\d,]+\.?\d{0,2}\s*$/, '').replace(/[,;]\s*$/, '').trim();
          if (amtMatch) {
            lines.push({
              description: desc || 'Service',
              quantity: 1,
              rateCents: Math.round(parseFloat(amtMatch[1].replace(/,/g, '')) * 100),
            });
          }
        }
      }

      // Pattern 2: Single item (existing behavior)
      if (lines.length === 0 && extractedParams.amountCents) {
        lines = [{ description: extractedParams.description || 'Services', quantity: 1, rateCents: extractedParams.amountCents }];
      }

      if (lines.length > 0) {
        extractedParams = {
          clientId: client.id,
          issuedDate: new Date().toISOString().slice(0, 10),
          dueDate: dueDate.toISOString().slice(0, 10),
          status: 'draft',
          lines,
        };
      }
    }
  } catch (err) { console.warn('Invoice client resolution error:', err); }
}
```

- [ ] **Step 2: Update response formatting for multi-line**

In the response formatting, update the invoice creation message to show line items:
```typescript
} else if (data?.number) {
  message = `Invoice ${data.number} created — $${(data.amountCents / 100).toFixed(2)}`;
  if (data.lines?.length > 1) {
    message += '\n\nLine items:';
    data.lines.forEach((l: any) => {
      message += `\n• ${l.description}: $${(l.amountCents / 100).toFixed(2)}`;
    });
  }
```

- [ ] **Step 3: Commit**

---

## Task 3: Auto Payment Reminders (Cron + Skill)

**Files:**
- Create: `apps/web-next/src/app/api/v1/agentbook/cron/payment-reminders/route.ts`
- Modify: `plugins/agentbook-core/backend/src/server.ts`

- [ ] **Step 1: Create cron endpoint**

```typescript
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INVOICE_API = process.env.AGENTBOOK_INVOICE_URL || 'http://localhost:4052';
const CORE_API = process.env.AGENTBOOK_CORE_URL || 'http://localhost:4050';

export async function GET(): Promise<NextResponse> {
  try {
    // Get all tenants with auto-remind enabled
    const configRes = await fetch(`${CORE_API}/api/v1/agentbook-core/tenant-configs?autoRemindEnabled=true`);
    // For each tenant, find overdue invoices not reminded recently
    // Send reminders via existing /invoices/:id/remind endpoint
    // Update lastRemindedAt

    return NextResponse.json({ success: true, data: { reminders: 0 } });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Add toggle skill**

```typescript
{
  name: 'toggle-auto-reminders', description: 'Enable or disable automatic payment reminders for overdue invoices', category: 'invoicing',
  triggerPatterns: ['auto.*remind', 'automatic.*remind', 'enable.*remind', 'disable.*remind', 'turn.*remind'],
  parameters: { enabled: { type: 'boolean', required: false } },
  endpoint: { method: 'PUT', url: '/api/v1/agentbook-core/tenant-config' },
},
```

- [ ] **Step 3: Commit**

---

## Task 4: E2E Tests + Final Push

- [ ] **Step 1: Write tests**
- [ ] **Step 2: Run full suite**
- [ ] **Step 3: Push**
