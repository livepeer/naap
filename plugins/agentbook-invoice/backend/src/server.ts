/**
 * AgentBook Invoicing Backend - v1.0
 *
 * Full implementation:
 * - Clients CRUD
 * - Invoices CRUD, send, void (with journal entries)
 * - Payments (with journal entries, fee handling)
 * - Aging report
 * - Estimates CRUD + convert to invoice
 *
 * Uses @naap/plugin-server-sdk for standardized server setup.
 * Uses unified database schema (packages/database).
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createPluginServer } from '@naap/plugin-server-sdk';
import { db } from './db/client.js';

import type { Request, Response } from 'express';

const pluginConfig = JSON.parse(
  readFileSync(new URL('../../plugin.json', import.meta.url), 'utf8')
);

// ============================================
// SERVER SETUP
// ============================================

const { app, start } = createPluginServer({
  ...pluginConfig,
  requireAuth: process.env.NODE_ENV === 'production',
  publicRoutes: ['/healthz', '/api/v1/agentbook-invoice'],
});

// ============================================
// TENANT MIDDLEWARE
// ============================================

app.use((req: Request, _res: Response, next) => {
  (req as any).tenantId = req.headers['x-tenant-id'] as string || 'default';
  next();
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/healthz', async (_req: Request, res: Response) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', plugin: 'agentbook-invoice', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: String(err) });
  }
});

// ============================================
// HELPER: Look up accounts by code for journal entries
// ============================================

async function getAccountByCode(tenantId: string, code: string) {
  return db.abAccount.findUnique({
    where: { tenantId_code: { tenantId, code } },
  });
}

// ============================================
// CLIENT ROUTES
// ============================================

// POST /clients — create client
app.post('/api/v1/agentbook-invoice/clients', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { name, email, address, defaultTerms } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'name is required' });
    }

    // Create client + emit event in a transaction for atomicity
    const client = await db.$transaction(async (tx) => {
      const c = await tx.abClient.create({
        data: {
          tenantId,
          name,
          email: email || null,
          address: address || null,
          defaultTerms: defaultTerms || 'net-30',
        },
      });

      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'client.created',
          actor: 'agent',
          action: { clientId: c.id, name },
        },
      });

      return c;
    });

    res.status(201).json({ success: true, data: client });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// GET /clients — list clients for tenant
app.get('/api/v1/agentbook-invoice/clients', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const clients = await db.abClient.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: clients });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// GET /clients/:id — get client with stats
app.get('/api/v1/agentbook-invoice/clients/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const client = await db.abClient.findFirst({
      where: { id: req.params.id, tenantId },
      include: {
        invoices: {
          orderBy: { issuedDate: 'desc' },
          take: 10,
          include: { lines: true },
        },
        estimates: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    const outstandingInvoices = await db.abInvoice.count({
      where: { clientId: client.id, tenantId, status: { in: ['sent', 'viewed', 'overdue'] } },
    });

    res.json({
      success: true,
      data: {
        ...client,
        stats: {
          outstandingInvoices,
          totalBilledCents: client.totalBilledCents,
          totalPaidCents: client.totalPaidCents,
          balanceCents: client.totalBilledCents - client.totalPaidCents,
          avgDaysToPay: client.avgDaysToPay,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// PUT /clients/:id — update client
app.put('/api/v1/agentbook-invoice/clients/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { name, email, address, defaultTerms } = req.body;

    const existing = await db.abClient.findFirst({
      where: { id: req.params.id, tenantId },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    // Update client + emit event in a transaction for atomicity
    const client = await db.$transaction(async (tx) => {
      const c = await tx.abClient.update({
        where: { id: req.params.id },
        data: {
          ...(name !== undefined && { name }),
          ...(email !== undefined && { email }),
          ...(address !== undefined && { address }),
          ...(defaultTerms !== undefined && { defaultTerms }),
        },
      });

      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'client.updated',
          actor: 'agent',
          action: { clientId: c.id, changes: req.body },
        },
      });

      return c;
    });

    res.json({ success: true, data: client });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ============================================
// INVOICE ROUTES
// ============================================

// POST /invoices — create invoice with line items + journal entry
app.post('/api/v1/agentbook-invoice/invoices', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { clientId, issuedDate, dueDate, lines, status, currency } = req.body;

    if (!clientId || !lines || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ success: false, error: 'clientId and at least one line item are required' });
    }

    // Verify client belongs to tenant
    const client = await db.abClient.findFirst({
      where: { id: clientId, tenantId },
    });
    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    // Calculate total from lines
    const lineItems = lines.map((l: any) => ({
      description: l.description,
      quantity: l.quantity || 1,
      rateCents: l.rateCents,
      amountCents: Math.round((l.quantity || 1) * l.rateCents),
    }));
    const totalAmountCents = lineItems.reduce((sum: number, l: any) => sum + l.amountCents, 0);

    // Auto-generate invoice number: INV-YYYY-NNNN
    const year = new Date(issuedDate || Date.now()).getFullYear();
    const lastInvoice = await db.abInvoice.findFirst({
      where: {
        tenantId,
        number: { startsWith: `INV-${year}-` },
      },
      orderBy: { number: 'desc' },
    });

    let nextSeq = 1;
    if (lastInvoice) {
      const parts = lastInvoice.number.split('-');
      nextSeq = parseInt(parts[2], 10) + 1;
    }
    const invoiceNumber = `INV-${year}-${String(nextSeq).padStart(4, '0')}`;

    // Look up AR (1100) and Revenue (4000) accounts for journal entry
    const arAccount = await getAccountByCode(tenantId, '1100');
    const revenueAccount = await getAccountByCode(tenantId, '4000');

    if (!arAccount || !revenueAccount) {
      return res.status(422).json({
        success: false,
        error: 'AR account (1100) or Revenue account (4000) not found. Ensure chart of accounts is seeded.',
      });
    }

    // Create invoice, lines, journal entry, and update client in a transaction.
    // IMPORTANT: Event emission is inside this transaction. If any step fails,
    // everything rolls back — guaranteeing audit log consistency with ledger state.
    const invoice = await db.$transaction(async (tx) => {
      // Create journal entry: debit AR, credit Revenue
      const journalEntry = await tx.abJournalEntry.create({
        data: {
          tenantId,
          date: new Date(issuedDate || Date.now()),
          memo: `Invoice ${invoiceNumber} to ${client.name}`,
          sourceType: 'invoice',
          verified: true,
          lines: {
            create: [
              {
                accountId: arAccount.id,
                debitCents: totalAmountCents,
                creditCents: 0,
                description: `AR - Invoice ${invoiceNumber}`,
              },
              {
                accountId: revenueAccount.id,
                debitCents: 0,
                creditCents: totalAmountCents,
                description: `Revenue - Invoice ${invoiceNumber}`,
              },
            ],
          },
        },
      });

      // Create invoice with lines
      const inv = await tx.abInvoice.create({
        data: {
          tenantId,
          clientId,
          number: invoiceNumber,
          amountCents: totalAmountCents,
          currency: currency || 'USD',
          issuedDate: new Date(issuedDate || Date.now()),
          dueDate: new Date(dueDate || Date.now()),
          status: status || 'draft',
          journalEntryId: journalEntry.id,
          lines: {
            create: lineItems,
          },
        },
        include: { lines: true },
      });

      // Update journal entry sourceId to link back
      await tx.abJournalEntry.update({
        where: { id: journalEntry.id },
        data: { sourceId: inv.id },
      });

      // Update client totalBilledCents
      await tx.abClient.update({
        where: { id: clientId },
        data: {
          totalBilledCents: { increment: totalAmountCents },
        },
      });

      // Audit event
      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'invoice.created',
          actor: 'agent',
          action: {
            invoiceId: inv.id,
            number: invoiceNumber,
            clientId,
            amountCents: totalAmountCents,
            lineCount: lineItems.length,
          },
          constraintsPassed: ['balance_invariant'],
          verificationResult: 'passed',
        },
      });

      return inv;
    });

    res.status(201).json({ success: true, data: invoice });
  } catch (err: any) {
    if (err.code === 'P2002') {
      return res.status(409).json({ success: false, error: 'Invoice number already exists' });
    }
    res.status(500).json({ success: false, error: String(err) });
  }
});

// GET /invoices — list with status/date filters and pagination
app.get('/api/v1/agentbook-invoice/invoices', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { status, startDate, endDate, clientId, limit = '50', offset = '0' } = req.query;

    const where: any = { tenantId };
    if (status) where.status = status as string;
    if (clientId) where.clientId = clientId as string;
    if (startDate || endDate) {
      where.issuedDate = {};
      if (startDate) where.issuedDate.gte = new Date(startDate as string);
      if (endDate) where.issuedDate.lte = new Date(endDate as string);
    }

    const [invoices, total] = await Promise.all([
      db.abInvoice.findMany({
        where,
        include: { lines: true, client: true },
        orderBy: { issuedDate: 'desc' },
        take: parseInt(limit as string, 10),
        skip: parseInt(offset as string, 10),
      }),
      db.abInvoice.count({ where }),
    ]);

    res.json({ success: true, data: invoices, pagination: { total, limit: parseInt(limit as string, 10), offset: parseInt(offset as string, 10) } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// GET /invoices/:id — get invoice with lines and payments
app.get('/invoices/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const invoice = await db.abInvoice.findFirst({
      where: { id: req.params.id, tenantId },
      include: { lines: true, payments: true, client: true },
    });

    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amountCents, 0);

    res.json({
      success: true,
      data: {
        ...invoice,
        totalPaidCents: totalPaid,
        balanceDueCents: invoice.amountCents - totalPaid,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// POST /invoices/:id/send — mark as sent
app.post('/invoices/:id/send', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const invoice = await db.abInvoice.findFirst({
      where: { id: req.params.id, tenantId },
    });

    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    if (invoice.status === 'void') {
      return res.status(422).json({ success: false, error: 'Cannot send a voided invoice' });
    }

    if (invoice.status === 'paid') {
      return res.status(422).json({ success: false, error: 'Invoice is already paid' });
    }

    // Update status + emit event in a transaction for atomicity
    const updated = await db.$transaction(async (tx) => {
      const inv = await tx.abInvoice.update({
        where: { id: req.params.id },
        data: { status: 'sent' },
      });

      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'invoice.sent',
          actor: 'agent',
          action: { invoiceId: invoice.id, number: invoice.number },
        },
      });

      return inv;
    });

    // Send email if client has email address
    const client = await db.abClient.findFirst({ where: { id: invoice.clientId, tenantId } });
    let emailSent = false;
    if (client?.email) {
      try {
        const fullInvoice = await db.abInvoice.findFirst({
          where: { id: invoice.id },
          include: { lines: true, client: true },
        });
        const tenantConfig = await db.abTenantConfig.findFirst({ where: { userId: tenantId } });
        const html = generateInvoiceHtml(fullInvoice!, fullInvoice!.client, fullInvoice!.lines, tenantConfig);
        const emailProvider = getEmailProvider();
        await emailProvider.send(
          client.email,
          `Invoice ${invoice.number} from ${tenantConfig?.businessName || 'Your Company'}`,
          html,
        );
        emailSent = true;
      } catch (emailErr) {
        console.warn('Email send failed (non-blocking):', emailErr);
      }
    }

    res.json({ success: true, data: { ...updated, emailSent } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// POST /invoices/:id/void — void invoice + create reversing journal entry
app.post('/invoices/:id/void', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const invoice = await db.abInvoice.findFirst({
      where: { id: req.params.id, tenantId },
      include: { payments: true },
    });

    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    if (invoice.status === 'void') {
      return res.status(422).json({ success: false, error: 'Invoice is already voided' });
    }

    if (invoice.status === 'paid') {
      return res.status(422).json({ success: false, error: 'Cannot void a paid invoice' });
    }

    const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amountCents, 0);
    if (totalPaid > 0) {
      return res.status(422).json({ success: false, error: 'Cannot void invoice with existing payments. Refund payments first.' });
    }

    // Look up accounts for reversing entry
    const arAccount = await getAccountByCode(tenantId, '1100');
    const revenueAccount = await getAccountByCode(tenantId, '4000');

    if (!arAccount || !revenueAccount) {
      return res.status(422).json({ success: false, error: 'AR/Revenue accounts not found' });
    }

    const updated = await db.$transaction(async (tx) => {
      // Create reversing journal entry: credit AR, debit Revenue
      await tx.abJournalEntry.create({
        data: {
          tenantId,
          date: new Date(),
          memo: `VOID - Reverse Invoice ${invoice.number}`,
          sourceType: 'invoice',
          sourceId: invoice.id,
          verified: true,
          lines: {
            create: [
              {
                accountId: arAccount.id,
                debitCents: 0,
                creditCents: invoice.amountCents,
                description: `Reverse AR - Invoice ${invoice.number}`,
              },
              {
                accountId: revenueAccount.id,
                debitCents: invoice.amountCents,
                creditCents: 0,
                description: `Reverse Revenue - Invoice ${invoice.number}`,
              },
            ],
          },
        },
      });

      // Update invoice status
      const inv = await tx.abInvoice.update({
        where: { id: invoice.id },
        data: { status: 'void' },
      });

      // Reverse client totalBilledCents
      await tx.abClient.update({
        where: { id: invoice.clientId },
        data: {
          totalBilledCents: { decrement: invoice.amountCents },
        },
      });

      // Audit event
      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'invoice.voided',
          actor: 'agent',
          action: {
            invoiceId: invoice.id,
            number: invoice.number,
            amountCents: invoice.amountCents,
          },
          constraintsPassed: ['balance_invariant'],
          verificationResult: 'passed',
        },
      });

      return inv;
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ============================================
// PAYMENT ROUTES
// ============================================

// POST /payments — record payment against invoice
app.post('/api/v1/agentbook-invoice/payments', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { invoiceId, amountCents, method, date, stripePaymentId, feesCents } = req.body;

    if (!invoiceId || !amountCents || amountCents <= 0) {
      return res.status(400).json({ success: false, error: 'invoiceId and positive amountCents are required' });
    }

    // Verify invoice
    const invoice = await db.abInvoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: { payments: true, client: true },
    });

    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    if (invoice.status === 'void') {
      return res.status(422).json({ success: false, error: 'Cannot pay a voided invoice' });
    }

    const existingPaid = invoice.payments.reduce((sum, p) => sum + p.amountCents, 0);
    const remainingBalance = invoice.amountCents - existingPaid;

    if (amountCents > remainingBalance) {
      return res.status(422).json({
        success: false,
        error: `Payment amount (${amountCents}) exceeds remaining balance (${remainingBalance})`,
      });
    }

    // Look up accounts for journal entry
    const arAccount = await getAccountByCode(tenantId, '1100');
    // Cash account: typically code 1000
    const cashAccount = await getAccountByCode(tenantId, '1000');
    // Fees expense account: typically code 5200 (Bank Fees / Payment Processing Fees)
    const feesAccount = feesCents && feesCents > 0
      ? await getAccountByCode(tenantId, '5200')
      : null;

    if (!arAccount || !cashAccount) {
      return res.status(422).json({
        success: false,
        error: 'AR account (1100) or Cash account (1000) not found. Ensure chart of accounts is seeded.',
      });
    }

    const fees = feesCents || 0;
    const fullyPaid = (existingPaid + amountCents) >= invoice.amountCents;

    const payment = await db.$transaction(async (tx) => {
      // Create journal entry: debit Cash (net of fees), credit AR
      // If fees: debit Fees Expense, credit Cash (for the fee portion)
      const journalLines: Array<{
        accountId: string;
        debitCents: number;
        creditCents: number;
        description: string;
      }> = [
        {
          accountId: cashAccount.id,
          debitCents: amountCents,
          creditCents: 0,
          description: `Cash received - Invoice ${invoice.number}`,
        },
        {
          accountId: arAccount.id,
          debitCents: 0,
          creditCents: amountCents,
          description: `AR payment - Invoice ${invoice.number}`,
        },
      ];

      // If there are processing fees, add fee journal lines
      if (fees > 0 && feesAccount) {
        journalLines.push(
          {
            accountId: feesAccount.id,
            debitCents: fees,
            creditCents: 0,
            description: `Payment processing fees - Invoice ${invoice.number}`,
          },
          {
            accountId: cashAccount.id,
            debitCents: 0,
            creditCents: fees,
            description: `Fees deducted from cash - Invoice ${invoice.number}`,
          },
        );
      }

      const journalEntry = await tx.abJournalEntry.create({
        data: {
          tenantId,
          date: new Date(date || Date.now()),
          memo: `Payment for Invoice ${invoice.number}`,
          sourceType: 'payment',
          verified: true,
          lines: {
            create: journalLines,
          },
        },
      });

      // Create payment record
      const pmt = await tx.abPayment.create({
        data: {
          tenantId,
          invoiceId,
          amountCents,
          method: method || 'manual',
          date: new Date(date || Date.now()),
          stripePaymentId: stripePaymentId || null,
          feesCents: fees,
          journalEntryId: journalEntry.id,
        },
      });

      // Update journal entry sourceId
      await tx.abJournalEntry.update({
        where: { id: journalEntry.id },
        data: { sourceId: pmt.id },
      });

      // Update invoice status if fully paid
      if (fullyPaid) {
        await tx.abInvoice.update({
          where: { id: invoiceId },
          data: { status: 'paid' },
        });
      }

      // Update client totalPaidCents
      await tx.abClient.update({
        where: { id: invoice.clientId },
        data: {
          totalPaidCents: { increment: amountCents },
        },
      });

      // Emit payment.received event
      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'payment.received',
          actor: 'agent',
          action: {
            paymentId: pmt.id,
            invoiceId,
            invoiceNumber: invoice.number,
            amountCents,
            method: method || 'manual',
            feesCents: fees,
            fullyPaid,
            clientId: invoice.clientId,
            clientName: invoice.client.name,
          },
          constraintsPassed: ['balance_invariant'],
          verificationResult: 'passed',
        },
      });

      return pmt;
    });

    res.status(201).json({ success: true, data: payment });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ============================================
// AGING REPORT
// ============================================

// GET /aging-report — group outstanding invoices by age buckets
app.get('/api/v1/agentbook-invoice/aging-report', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const now = new Date();

    // Get all outstanding invoices (sent, viewed, overdue)
    const invoices = await db.abInvoice.findMany({
      where: {
        tenantId,
        status: { in: ['sent', 'viewed', 'overdue'] },
      },
      include: { payments: true, client: true },
    });

    const buckets = {
      current: [] as any[],
      '1-30': [] as any[],
      '31-60': [] as any[],
      '61-90': [] as any[],
      '90+': [] as any[],
    };

    const bucketTotals = {
      current: 0,
      '1-30': 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 0,
    };

    for (const inv of invoices) {
      const totalPaid = inv.payments.reduce((sum, p) => sum + p.amountCents, 0);
      const balanceDue = inv.amountCents - totalPaid;
      if (balanceDue <= 0) continue;

      const dueDate = new Date(inv.dueDate);
      const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

      const entry = {
        invoiceId: inv.id,
        number: inv.number,
        clientId: inv.clientId,
        clientName: inv.client.name,
        amountCents: inv.amountCents,
        balanceDueCents: balanceDue,
        issuedDate: inv.issuedDate,
        dueDate: inv.dueDate,
        daysOverdue: Math.max(0, daysOverdue),
      };

      let bucket: keyof typeof buckets;
      if (daysOverdue <= 0) {
        bucket = 'current';
      } else if (daysOverdue <= 30) {
        bucket = '1-30';
      } else if (daysOverdue <= 60) {
        bucket = '31-60';
      } else if (daysOverdue <= 90) {
        bucket = '61-90';
      } else {
        bucket = '90+';
      }

      buckets[bucket].push(entry);
      bucketTotals[bucket] += balanceDue;
    }

    const totalOutstanding = Object.values(bucketTotals).reduce((s, v) => s + v, 0);

    res.json({
      success: true,
      data: {
        buckets,
        totals: bucketTotals,
        totalOutstandingCents: totalOutstanding,
        asOfDate: now.toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ============================================
// ESTIMATE ROUTES
// ============================================

// POST /estimates — create estimate
app.post('/api/v1/agentbook-invoice/estimates', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { clientId, amountCents, description, validUntil } = req.body;

    if (!clientId || !amountCents || !description) {
      return res.status(400).json({ success: false, error: 'clientId, amountCents, and description are required' });
    }

    // Verify client
    const client = await db.abClient.findFirst({
      where: { id: clientId, tenantId },
    });
    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    // Default validUntil to 30 days from now
    const expiryDate = validUntil
      ? new Date(validUntil)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Create estimate + emit event in a transaction for atomicity
    const estimate = await db.$transaction(async (tx) => {
      const est = await tx.abEstimate.create({
        data: {
          tenantId,
          clientId,
          amountCents,
          description,
          validUntil: expiryDate,
        },
      });

      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'estimate.created',
          actor: 'agent',
          action: { estimateId: est.id, clientId, amountCents },
        },
      });

      return est;
    });

    res.status(201).json({ success: true, data: estimate });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// GET /estimates — list estimates
app.get('/api/v1/agentbook-invoice/estimates', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { status, clientId } = req.query;

    const where: any = { tenantId };
    if (status) where.status = status as string;
    if (clientId) where.clientId = clientId as string;

    const estimates = await db.abEstimate.findMany({
      where,
      include: { client: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: estimates });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// POST /estimates/:id/convert — convert approved estimate to invoice
app.post('/estimates/:id/convert', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const estimate = await db.abEstimate.findFirst({
      where: { id: req.params.id, tenantId },
      include: { client: true },
    });

    if (!estimate) {
      return res.status(404).json({ success: false, error: 'Estimate not found' });
    }

    if (estimate.status !== 'approved') {
      return res.status(422).json({ success: false, error: `Estimate must be approved to convert. Current status: ${estimate.status}` });
    }

    // Auto-generate invoice number
    const year = new Date().getFullYear();
    const lastInvoice = await db.abInvoice.findFirst({
      where: {
        tenantId,
        number: { startsWith: `INV-${year}-` },
      },
      orderBy: { number: 'desc' },
    });

    let nextSeq = 1;
    if (lastInvoice) {
      const parts = lastInvoice.number.split('-');
      nextSeq = parseInt(parts[2], 10) + 1;
    }
    const invoiceNumber = `INV-${year}-${String(nextSeq).padStart(4, '0')}`;

    // Look up accounts
    const arAccount = await getAccountByCode(tenantId, '1100');
    const revenueAccount = await getAccountByCode(tenantId, '4000');

    if (!arAccount || !revenueAccount) {
      return res.status(422).json({ success: false, error: 'AR/Revenue accounts not found' });
    }

    // Default due date: 30 days from now
    const issuedDate = new Date();
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const invoice = await db.$transaction(async (tx) => {
      // Create journal entry
      const journalEntry = await tx.abJournalEntry.create({
        data: {
          tenantId,
          date: issuedDate,
          memo: `Invoice ${invoiceNumber} (from Estimate) to ${estimate.client.name}`,
          sourceType: 'invoice',
          verified: true,
          lines: {
            create: [
              {
                accountId: arAccount.id,
                debitCents: estimate.amountCents,
                creditCents: 0,
                description: `AR - Invoice ${invoiceNumber}`,
              },
              {
                accountId: revenueAccount.id,
                debitCents: 0,
                creditCents: estimate.amountCents,
                description: `Revenue - Invoice ${invoiceNumber}`,
              },
            ],
          },
        },
      });

      // Create invoice with a single line item from the estimate
      const inv = await tx.abInvoice.create({
        data: {
          tenantId,
          clientId: estimate.clientId,
          number: invoiceNumber,
          amountCents: estimate.amountCents,
          issuedDate,
          dueDate,
          status: 'draft',
          journalEntryId: journalEntry.id,
          lines: {
            create: [
              {
                description: estimate.description,
                quantity: 1,
                rateCents: estimate.amountCents,
                amountCents: estimate.amountCents,
              },
            ],
          },
        },
        include: { lines: true },
      });

      // Update journal entry sourceId
      await tx.abJournalEntry.update({
        where: { id: journalEntry.id },
        data: { sourceId: inv.id },
      });

      // Update estimate status
      await tx.abEstimate.update({
        where: { id: estimate.id },
        data: {
          status: 'converted',
          convertedInvoiceId: inv.id,
        },
      });

      // Update client totalBilledCents
      await tx.abClient.update({
        where: { id: estimate.clientId },
        data: {
          totalBilledCents: { increment: estimate.amountCents },
        },
      });

      // Audit event
      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'estimate.converted',
          actor: 'agent',
          action: {
            estimateId: estimate.id,
            invoiceId: inv.id,
            invoiceNumber,
            amountCents: estimate.amountCents,
          },
          constraintsPassed: ['balance_invariant'],
          verificationResult: 'passed',
        },
      });

      return inv;
    });

    res.status(201).json({ success: true, data: invoice });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ============================================
// TIME TRACKING (Phase 7)
// ============================================

// Projects CRUD
app.post('/api/v1/agentbook-invoice/projects', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { name, clientId, description, hourlyRateCents, budgetHours } = req.body;
    const project = await db.abProject.create({
      data: { tenantId, name, clientId, description, hourlyRateCents, budgetHours },
    });
    res.status(201).json({ success: true, data: project });
  } catch (err: any) {
    if (err.code === 'P2002') return res.status(409).json({ success: false, error: 'Project name already exists' });
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.get('/api/v1/agentbook-invoice/projects', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const projects = await db.abProject.findMany({
      where: { tenantId, status: { not: 'archived' } },
      include: { timeEntries: { select: { durationMinutes: true, billed: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const result = projects.map((p: any) => {
      const totalMinutes = p.timeEntries.reduce((s: number, e: any) => s + (e.durationMinutes || 0), 0);
      const billedMinutes = p.timeEntries.filter((e: any) => e.billed).reduce((s: number, e: any) => s + (e.durationMinutes || 0), 0);
      return {
        ...p,
        timeEntries: undefined,
        totalHours: Math.round(totalMinutes / 6) / 10,
        billedHours: Math.round(billedMinutes / 6) / 10,
        unbilledHours: Math.round((totalMinutes - billedMinutes) / 6) / 10,
      };
    });

    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// Timer — Start
app.post('/api/v1/agentbook-invoice/timer/start', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { description, projectId, clientId } = req.body;

    // Auto-stop any running timer
    const running = await db.abTimeEntry.findFirst({ where: { tenantId, endedAt: null } });
    if (running) {
      const dur = Math.max(1, Math.round((Date.now() - new Date(running.startedAt).getTime()) / 60000));
      await db.abTimeEntry.update({ where: { id: running.id }, data: { endedAt: new Date(), durationMinutes: dur } });
    }

    // Get rate from project
    let rateCents: number | null = null;
    if (projectId) {
      const project = await db.abProject.findFirst({ where: { id: projectId, tenantId } });
      rateCents = project?.hourlyRateCents ?? null;
    }

    const entry = await db.abTimeEntry.create({
      data: { tenantId, projectId, clientId, description: description || 'Working', startedAt: new Date(), hourlyRateCents: rateCents },
    });

    res.status(201).json({ success: true, data: entry });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// Timer — Stop
app.post('/api/v1/agentbook-invoice/timer/stop', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const running = await db.abTimeEntry.findFirst({ where: { tenantId, endedAt: null }, orderBy: { startedAt: 'desc' } });
    if (!running) return res.status(404).json({ success: false, error: 'No running timer' });

    const dur = Math.max(1, Math.round((Date.now() - new Date(running.startedAt).getTime()) / 60000));
    const updated = await db.abTimeEntry.update({
      where: { id: running.id },
      data: { endedAt: new Date(), durationMinutes: dur },
    });

    await db.abEvent.create({
      data: { tenantId, eventType: 'time.logged', actor: 'agent', action: { entryId: updated.id, minutes: dur } },
    });

    res.json({ success: true, data: updated });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// Timer — Status
app.get('/api/v1/agentbook-invoice/timer/status', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const running = await db.abTimeEntry.findFirst({ where: { tenantId, endedAt: null }, orderBy: { startedAt: 'desc' } });
    if (!running) return res.json({ success: true, data: { running: false } });

    const elapsedMinutes = Math.round((Date.now() - new Date(running.startedAt).getTime()) / 60000);
    res.json({ success: true, data: { running: true, entry: running, elapsedMinutes } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// Log time manually
app.post('/api/v1/agentbook-invoice/time-entries', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { description, minutes, projectId, clientId, date, hourlyRateCents } = req.body;
    if (!minutes || minutes <= 0) return res.status(400).json({ success: false, error: 'minutes must be positive' });

    const entryDate = date ? new Date(date) : new Date();
    const startedAt = new Date(entryDate.getTime() - minutes * 60000);

    const entry = await db.abTimeEntry.create({
      data: { tenantId, projectId, clientId, description: description || 'Time entry', startedAt, endedAt: entryDate, durationMinutes: minutes, hourlyRateCents },
    });

    res.status(201).json({ success: true, data: entry });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// List time entries
app.get('/api/v1/agentbook-invoice/time-entries', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { projectId, clientId, billed, startDate, endDate, limit = '50' } = req.query;

    const where: any = { tenantId };
    if (projectId) where.projectId = projectId;
    if (clientId) where.clientId = clientId;
    if (billed !== undefined) where.billed = billed === 'true';
    if (startDate) where.startedAt = { ...where.startedAt, gte: new Date(startDate as string) };
    if (endDate) where.startedAt = { ...where.startedAt, lte: new Date(endDate as string) };

    const entries = await db.abTimeEntry.findMany({
      where,
      include: { project: { select: { name: true } } },
      orderBy: { startedAt: 'desc' },
      take: parseInt(limit as string),
    });

    const totalMinutes = entries.reduce((s: number, e: any) => s + (e.durationMinutes || 0), 0);

    res.json({ success: true, data: entries, meta: { totalMinutes, totalHours: Math.round(totalMinutes / 6) / 10 } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// Unbilled summary
app.get('/api/v1/agentbook-invoice/unbilled-summary', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const entries = await db.abTimeEntry.findMany({
      where: { tenantId, billable: true, billed: false, endedAt: { not: null } },
    });

    // Group by clientId
    const groups: Map<string, { minutes: number; entries: number; rateCents: number }> = new Map();
    for (const e of entries) {
      const key = (e as any).clientId || 'no-client';
      const g = groups.get(key) || { minutes: 0, entries: 0, rateCents: (e as any).hourlyRateCents || 0 };
      g.minutes += (e as any).durationMinutes;
      g.entries += 1;
      if ((e as any).hourlyRateCents) g.rateCents = (e as any).hourlyRateCents;
      groups.set(key, g);
    }

    const clientIds = Array.from(groups.keys()).filter(k => k !== 'no-client');
    const clients = await db.abClient.findMany({ where: { id: { in: clientIds } } });
    const nameMap = new Map(clients.map((c: any) => [c.id, c.name]));

    const result = Array.from(groups.entries()).map(([cid, g]) => ({
      clientId: cid,
      clientName: nameMap.get(cid) || 'No Client',
      totalMinutes: g.minutes,
      totalHours: Math.round(g.minutes / 6) / 10,
      hourlyRateCents: g.rateCents,
      unbilledAmountCents: Math.round((g.minutes / 60) * g.rateCents),
      entries: g.entries,
    }));

    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// Project profitability
app.get('/api/v1/agentbook-invoice/project-profitability', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const projects = await db.abProject.findMany({
      where: { tenantId },
      include: { timeEntries: { select: { durationMinutes: true, billed: true } } },
    });

    const result = projects.map((p: any) => {
      const totalMinutes = p.timeEntries.reduce((s: number, e: any) => s + (e.durationMinutes || 0), 0);
      const totalHours = totalMinutes / 60;
      const rate = p.hourlyRateCents || 0;
      const revenue = Math.round(totalHours * rate);
      return {
        projectId: p.id, projectName: p.name, totalHours: Math.round(totalHours * 10) / 10,
        totalRevenueCents: revenue, effectiveRateCents: totalHours > 0 ? Math.round(revenue / totalHours) : 0,
        budgetHours: p.budgetHours, budgetUsedPercent: p.budgetHours ? Math.round((totalHours / p.budgetHours) * 100) : null,
      };
    });

    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ============================================
// INVOICE PDF GENERATION (B2 — Competitive Gap)
// ============================================

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', CAD: 'C$', GBP: '£', AUD: 'A$', EUR: '€',
};

const CURRENCY_LOCALES: Record<string, string> = {
  USD: 'en-US', CAD: 'en-CA', GBP: 'en-GB', AUD: 'en-AU', EUR: 'de-DE',
};

function formatMoney(cents: number, currency: string = 'USD'): string {
  const locale = CURRENCY_LOCALES[currency] || 'en-US';
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}

function generateInvoiceHtml(invoice: any, client: any, lines: any[], tenantConfig: any): string {
  const currency = invoice.currency || 'USD';
  const companyName = tenantConfig?.companyName || tenantConfig?.businessName || 'Your Company';
  const companyAddress = tenantConfig?.companyAddress || tenantConfig?.address || '';
  const companyEmail = tenantConfig?.companyEmail || tenantConfig?.email || '';
  const companyPhone = tenantConfig?.companyPhone || '';
  const logoUrl = tenantConfig?.logoUrl || '';
  const brandColor = tenantConfig?.brandColor || '#10b981';

  const lineRows = lines.map((l: any, i: number) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee;">${i + 1}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;">${l.description}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${l.quantity}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${formatMoney(l.rateCents, currency)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${formatMoney(l.amountCents, currency)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Invoice ${invoice.number}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a2e; margin: 0; padding: 40px; }
  .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
  .company { font-size: 24px; font-weight: 700; color: ${brandColor}; }
  .invoice-title { font-size: 32px; font-weight: 300; color: #64748b; text-align: right; }
  .invoice-number { font-size: 14px; color: #94a3b8; text-align: right; }
  .details { display: flex; justify-content: space-between; margin-bottom: 30px; }
  .details-box { background: #f8fafc; padding: 16px; border-radius: 8px; min-width: 200px; }
  .details-label { font-size: 11px; text-transform: uppercase; color: #94a3b8; letter-spacing: 1px; margin-bottom: 4px; }
  .details-value { font-size: 14px; font-weight: 500; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
  thead th { background: ${brandColor}; color: white; padding: 10px 8px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  thead th:nth-child(3), thead th:nth-child(4), thead th:nth-child(5) { text-align: right; }
  .total-row { display: flex; justify-content: flex-end; }
  .total-box { background: ${brandColor}; color: white; padding: 16px 32px; border-radius: 8px; font-size: 20px; font-weight: 700; }
  .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center; }
  .status { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
  .status-draft { background: #f1f5f9; color: #64748b; }
  .status-sent { background: #dbeafe; color: #2563eb; }
  .status-paid { background: #d1fae5; color: #059669; }
  .status-overdue { background: #fee2e2; color: #dc2626; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      ${logoUrl ? `<img src="${logoUrl}" alt="${companyName}" style="max-height:60px;max-width:200px;margin-bottom:8px;" />` : ''}
      <div class="company">${companyName}</div>
      <div style="font-size:13px;color:#64748b;margin-top:4px;">${companyAddress}</div>
      ${companyEmail ? `<div style="font-size:13px;color:#64748b;">${companyEmail}</div>` : ''}
      ${companyPhone ? `<div style="font-size:13px;color:#64748b;">${companyPhone}</div>` : ''}
    </div>
    <div>
      <div class="invoice-title">INVOICE</div>
      <div class="invoice-number">${invoice.number}</div>
      <div style="margin-top:8px;text-align:right;"><span class="status status-${invoice.status}">${invoice.status}</span></div>
    </div>
  </div>

  <div class="details">
    <div class="details-box">
      <div class="details-label">Bill To</div>
      <div class="details-value">${client.name}</div>
      ${client.email ? `<div style="font-size:13px;color:#64748b;">${client.email}</div>` : ''}
      ${client.address ? `<div style="font-size:13px;color:#64748b;">${client.address}</div>` : ''}
    </div>
    <div class="details-box">
      <div class="details-label">Invoice Date</div>
      <div class="details-value">${new Date(invoice.issuedDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
      <div class="details-label" style="margin-top:12px;">Due Date</div>
      <div class="details-value">${new Date(invoice.dueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
    </div>
    <div class="details-box">
      <div class="details-label">Currency</div>
      <div class="details-value">${currency}</div>
      <div class="details-label" style="margin-top:12px;">Amount Due</div>
      <div class="details-value" style="font-size:18px;color:${brandColor};">${formatMoney(invoice.amountCents, currency)}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:40px;">#</th>
        <th>Description</th>
        <th style="width:80px;text-align:center;">Qty</th>
        <th style="width:120px;text-align:right;">Rate</th>
        <th style="width:120px;text-align:right;">Amount</th>
      </tr>
    </thead>
    <tbody>${lineRows}</tbody>
  </table>

  <div class="total-row">
    <div class="total-box">Total: ${formatMoney(invoice.amountCents, currency)}</div>
  </div>

  ${invoice.paymentUrl && invoice.status !== 'paid' ? `<div style="text-align:center;margin:24px 0">
    <a href="${invoice.paymentUrl}" style="display:inline-block;padding:14px 32px;background:${brandColor};color:white;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px">
      Pay ${formatMoney(invoice.amountCents, currency)} Now
    </a>
    <p style="margin-top:8px;font-size:12px;color:#888">Secure payment powered by Stripe</p>
  </div>` : ''}

  <div class="footer">
    <p>Generated by AgentBook — Powered by AI</p>
    <p>Thank you for your business!</p>
  </div>
</body>
</html>`;
}

// POST /invoices/:id/pdf — Generate invoice PDF HTML
app.post('/invoices/:id/pdf', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const invoice = await db.abInvoice.findFirst({
      where: { id: req.params.id, tenantId },
      include: { lines: true, client: true },
    });
    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });

    const tenantConfig = await db.abTenantConfig.findFirst({ where: { userId: tenantId } });
    const html = generateInvoiceHtml(invoice, invoice.client, invoice.lines, tenantConfig);

    await db.abInvoice.update({
      where: { id: invoice.id },
      data: { pdfHtml: html, pdfUrl: `/api/v1/agentbook-invoice/invoices/${invoice.id}/pdf` },
    });

    res.json({ success: true, data: { invoiceId: invoice.id, pdfUrl: `/api/v1/agentbook-invoice/invoices/${invoice.id}/pdf` } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// GET /invoices/:id/pdf — Render invoice PDF HTML (printable)
app.get('/invoices/:id/pdf', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const invoice = await db.abInvoice.findFirst({
      where: { id: req.params.id, tenantId },
      include: { lines: true, client: true },
    });
    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });

    // Use cached HTML or generate fresh
    const tenantConfig = await db.abTenantConfig.findFirst({ where: { userId: tenantId } });
    const html = invoice.pdfHtml || generateInvoiceHtml(invoice, invoice.client, invoice.lines, tenantConfig);

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ============================================
// EMAIL DELIVERY (B3 — Competitive Gap)
// ============================================

interface EmailProvider {
  send(to: string, subject: string, html: string, from?: string): Promise<{ id: string; status: string }>;
}

class ResendProvider implements EmailProvider {
  private apiKey: string;
  private fromAddress: string;

  constructor(apiKey: string, fromAddress: string = 'invoices@agentbook.ai') {
    this.apiKey = apiKey;
    this.fromAddress = fromAddress;
  }

  async send(to: string, subject: string, html: string, from?: string): Promise<{ id: string; status: string }> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: from || this.fromAddress, to, subject, html }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Email send failed: ${err}`);
    }

    const data = await response.json() as any;
    return { id: data.id || 'unknown', status: 'sent' };
  }
}

// Fallback: log-only provider for development
class LogEmailProvider implements EmailProvider {
  async send(to: string, subject: string, _html: string): Promise<{ id: string; status: string }> {
    console.log(`[EMAIL] To: ${to}, Subject: ${subject}`);
    return { id: `log-${Date.now()}`, status: 'logged' };
  }
}

function getEmailProvider(): EmailProvider {
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) return new ResendProvider(resendKey);
  return new LogEmailProvider();
}

// POST /invoices/:id/email — Send invoice via email
app.post('/invoices/:id/email', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const invoice = await db.abInvoice.findFirst({
      where: { id: req.params.id, tenantId },
      include: { lines: true, client: true },
    });
    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });
    if (!invoice.client.email) return res.status(422).json({ success: false, error: 'Client has no email address' });
    if (invoice.status === 'void') return res.status(422).json({ success: false, error: 'Cannot email a voided invoice' });

    const tenantConfig = await db.abTenantConfig.findFirst({ where: { userId: tenantId } });
    const html = invoice.pdfHtml || generateInvoiceHtml(invoice, invoice.client, invoice.lines, tenantConfig);
    const companyName = tenantConfig?.businessName || 'Your Company';

    const emailProvider = getEmailProvider();
    const result = await emailProvider.send(
      invoice.client.email,
      `Invoice ${invoice.number} from ${companyName} — ${formatMoney(invoice.amountCents, invoice.currency)}`,
      html,
    );

    // Update invoice status to sent if still draft
    if (invoice.status === 'draft') {
      await db.abInvoice.update({ where: { id: invoice.id }, data: { status: 'sent' } });
    }

    await db.abEvent.create({
      data: {
        tenantId, eventType: 'invoice.emailed', actor: 'agent',
        action: { invoiceId: invoice.id, to: invoice.client.email, emailId: result.id, status: result.status },
      },
    });

    res.json({ success: true, data: { emailId: result.id, status: result.status, to: invoice.client.email } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// POST /invoices/:id/remind — Send payment reminder email
app.post('/invoices/:id/remind', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const invoice = await db.abInvoice.findFirst({
      where: { id: req.params.id, tenantId },
      include: { client: true, payments: true },
    });
    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });
    if (!invoice.client.email) return res.status(422).json({ success: false, error: 'Client has no email address' });
    if (invoice.status === 'paid' || invoice.status === 'void') {
      return res.status(422).json({ success: false, error: `Cannot remind — invoice is ${invoice.status}` });
    }

    const totalPaid = invoice.payments.reduce((s: number, p: any) => s + p.amountCents, 0);
    const balance = invoice.amountCents - totalPaid;
    const daysOverdue = Math.max(0, Math.floor((Date.now() - new Date(invoice.dueDate).getTime()) / 86400000));
    const tenantConfig = await db.abTenantConfig.findFirst({ where: { userId: tenantId } });
    const companyName = tenantConfig?.businessName || 'Your Company';

    const tone = daysOverdue > 30 ? 'urgent' : daysOverdue > 14 ? 'firm' : 'gentle';
    const toneText = { gentle: 'Friendly Reminder', firm: 'Payment Reminder', urgent: 'Urgent: Payment Overdue' };

    const reminderHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;padding:40px;">
      <h2 style="color:${tone === 'urgent' ? '#dc2626' : '#1a1a2e'};">${toneText[tone]}</h2>
      <p>Dear ${invoice.client.name},</p>
      <p>This is a ${tone} reminder regarding invoice <strong>${invoice.number}</strong> for <strong>${formatMoney(balance, invoice.currency)}</strong>${daysOverdue > 0 ? ` which was due ${daysOverdue} days ago` : ` due on ${new Date(invoice.dueDate).toLocaleDateString()}`}.</p>
      ${totalPaid > 0 ? `<p>We have received ${formatMoney(totalPaid, invoice.currency)} — remaining balance: ${formatMoney(balance, invoice.currency)}.</p>` : ''}
      ${invoice.paymentUrl ? `<div style="text-align:center;margin:24px 0">
        <a href="${invoice.paymentUrl}" style="display:inline-block;padding:14px 32px;background:${brandColor};color:white;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px">
          Pay ${formatMoney(balance, invoice.currency)} Now
        </a>
        <p style="margin-top:8px;font-size:12px;color:#888">Secure payment powered by Stripe</p>
      </div>` : '<p>Please arrange payment at your earliest convenience.</p>'}
      <p>Best regards,<br>${companyName}</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:30px 0;">
      <p style="font-size:12px;color:#94a3b8;">Sent via AgentBook</p>
    </body></html>`;

    const emailProvider = getEmailProvider();
    const result = await emailProvider.send(
      invoice.client.email,
      `${toneText[tone]}: Invoice ${invoice.number} — ${formatMoney(balance, invoice.currency)}`,
      reminderHtml,
    );

    // Update lastRemindedAt for auto-reminder scheduling
    await db.abInvoice.update({ where: { id: invoice.id }, data: { lastRemindedAt: new Date() } });

    await db.abEvent.create({
      data: {
        tenantId, eventType: 'invoice.reminder_sent', actor: 'agent',
        action: { invoiceId: invoice.id, tone, daysOverdue, balance, emailId: result.id },
      },
    });

    res.json({ success: true, data: { emailId: result.id, tone, daysOverdue, balance } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ============================================
// CREDIT NOTES (B9 — Competitive Gap)
// ============================================

// POST /credit-notes — Create credit note against an invoice
app.post('/api/v1/agentbook-invoice/credit-notes', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { invoiceId, amountCents, reason } = req.body;

    if (!invoiceId || !amountCents || amountCents <= 0 || !reason) {
      return res.status(400).json({ success: false, error: 'invoiceId, amountCents (positive), and reason are required' });
    }

    const invoice = await db.abInvoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: { payments: true, client: true },
    });
    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });
    if (invoice.status === 'void') return res.status(422).json({ success: false, error: 'Cannot credit a voided invoice' });

    const totalPaid = invoice.payments.reduce((s: number, p: any) => s + p.amountCents, 0);
    const balance = invoice.amountCents - totalPaid;
    if (amountCents > balance) {
      return res.status(422).json({ success: false, error: `Credit amount (${amountCents}) exceeds remaining balance (${balance})` });
    }

    // Generate credit note number: CN-YYYY-NNNN
    const year = new Date().getFullYear();
    const lastCN = await db.abCreditNote.findFirst({
      where: { tenantId, number: { startsWith: `CN-${year}-` } },
      orderBy: { number: 'desc' },
    });
    let cnSeq = 1;
    if (lastCN) cnSeq = parseInt(lastCN.number.split('-')[2], 10) + 1;
    const cnNumber = `CN-${year}-${String(cnSeq).padStart(4, '0')}`;

    const arAccount = await getAccountByCode(tenantId, '1100');
    const revenueAccount = await getAccountByCode(tenantId, '4000');
    if (!arAccount || !revenueAccount) {
      return res.status(422).json({ success: false, error: 'AR/Revenue accounts not found' });
    }

    const creditNote = await db.$transaction(async (tx) => {
      // Reversing journal entry: DR Revenue, CR AR
      const je = await tx.abJournalEntry.create({
        data: {
          tenantId, date: new Date(), memo: `Credit note ${cnNumber} against ${invoice.number}`,
          sourceType: 'credit_note', verified: true,
          lines: {
            create: [
              { accountId: revenueAccount.id, debitCents: amountCents, creditCents: 0, description: `Revenue reversal - ${cnNumber}` },
              { accountId: arAccount.id, debitCents: 0, creditCents: amountCents, description: `AR reduction - ${cnNumber}` },
            ],
          },
        },
      });

      const cn = await tx.abCreditNote.create({
        data: { tenantId, invoiceId, number: cnNumber, amountCents, reason, journalEntryId: je.id },
      });

      // Reduce client totalBilledCents
      await tx.abClient.update({
        where: { id: invoice.clientId },
        data: { totalBilledCents: { decrement: amountCents } },
      });

      await tx.abEvent.create({
        data: {
          tenantId, eventType: 'credit_note.created', actor: 'agent',
          action: { creditNoteId: cn.id, number: cnNumber, invoiceId, amountCents, reason },
        },
      });

      return cn;
    });

    res.status(201).json({ success: true, data: creditNote });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// GET /credit-notes — List credit notes
app.get('/api/v1/agentbook-invoice/credit-notes', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const creditNotes = await db.abCreditNote.findMany({
      where: { tenantId },
      include: { invoice: { select: { number: true, clientId: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: creditNotes });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ============================================
// RECURRING INVOICES (B5 — Competitive Gap)
// ============================================

// POST /recurring-invoices — Create recurring invoice schedule
app.post('/api/v1/agentbook-invoice/recurring-invoices', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { clientId, frequency, nextDue, endDate, templateLines, daysToPay, autoSend, currency } = req.body;

    if (!clientId || !frequency || !nextDue || !templateLines || !Array.isArray(templateLines) || templateLines.length === 0) {
      return res.status(400).json({ success: false, error: 'clientId, frequency, nextDue, and templateLines are required' });
    }

    const client = await db.abClient.findFirst({ where: { id: clientId, tenantId } });
    if (!client) return res.status(404).json({ success: false, error: 'Client not found' });

    const validFreqs = ['weekly', 'biweekly', 'monthly', 'quarterly', 'annual'];
    if (!validFreqs.includes(frequency)) {
      return res.status(400).json({ success: false, error: `frequency must be one of: ${validFreqs.join(', ')}` });
    }

    const totalCents = templateLines.reduce((s: number, l: any) => s + Math.round((l.quantity || 1) * l.rateCents), 0);

    const recurring = await db.abRecurringInvoice.create({
      data: {
        tenantId, clientId, frequency,
        nextDue: new Date(nextDue),
        endDate: endDate ? new Date(endDate) : null,
        templateLines, totalCents,
        daysToPay: daysToPay || 30,
        autoSend: autoSend || false,
        currency: currency || 'USD',
      },
    });

    await db.abEvent.create({
      data: {
        tenantId, eventType: 'recurring_invoice.created', actor: 'agent',
        action: { recurringId: recurring.id, clientId, frequency, totalCents },
      },
    });

    res.status(201).json({ success: true, data: recurring });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// GET /recurring-invoices — List recurring schedules
app.get('/api/v1/agentbook-invoice/recurring-invoices', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const items = await db.abRecurringInvoice.findMany({
      where: { tenantId },
      orderBy: { nextDue: 'asc' },
    });
    res.json({ success: true, data: items });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// PUT /recurring-invoices/:id — Update recurring invoice
app.put('/api/v1/agentbook-invoice/recurring-invoices/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const existing = await db.abRecurringInvoice.findFirst({ where: { id: req.params.id, tenantId } });
    if (!existing) return res.status(404).json({ success: false, error: 'Recurring invoice not found' });

    const { status, frequency, templateLines, daysToPay, autoSend, nextDue, endDate } = req.body;
    const updateData: any = {};
    if (status) updateData.status = status;
    if (frequency) updateData.frequency = frequency;
    if (templateLines) {
      updateData.templateLines = templateLines;
      updateData.totalCents = templateLines.reduce((s: number, l: any) => s + Math.round((l.quantity || 1) * l.rateCents), 0);
    }
    if (daysToPay !== undefined) updateData.daysToPay = daysToPay;
    if (autoSend !== undefined) updateData.autoSend = autoSend;
    if (nextDue) updateData.nextDue = new Date(nextDue);
    if (endDate) updateData.endDate = new Date(endDate);

    const updated = await db.abRecurringInvoice.update({ where: { id: req.params.id }, data: updateData });
    res.json({ success: true, data: updated });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// POST /recurring-invoices/generate — Manually trigger recurring invoice generation
// Also used by cron job
app.post('/api/v1/agentbook-invoice/recurring-invoices/generate', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const now = new Date();

    const dueItems = await db.abRecurringInvoice.findMany({
      where: { tenantId, status: 'active', nextDue: { lte: now } },
    });

    const generated: any[] = [];

    for (const item of dueItems) {
      // Check end date
      if (item.endDate && now > item.endDate) {
        await db.abRecurringInvoice.update({ where: { id: item.id }, data: { status: 'completed' } });
        continue;
      }

      const client = await db.abClient.findFirst({ where: { id: item.clientId, tenantId } });
      if (!client) continue;

      // Generate invoice number
      const year = now.getFullYear();
      const lastInvoice = await db.abInvoice.findFirst({
        where: { tenantId, number: { startsWith: `INV-${year}-` } },
        orderBy: { number: 'desc' },
      });
      let nextSeq = 1;
      if (lastInvoice) nextSeq = parseInt(lastInvoice.number.split('-')[2], 10) + 1;
      const invoiceNumber = `INV-${year}-${String(nextSeq).padStart(4, '0')}`;

      const lines = (item.templateLines as any[]).map((l: any) => ({
        description: l.description,
        quantity: l.quantity || 1,
        rateCents: l.rateCents,
        amountCents: Math.round((l.quantity || 1) * l.rateCents),
      }));

      const arAccount = await getAccountByCode(tenantId, '1100');
      const revenueAccount = await getAccountByCode(tenantId, '4000');
      if (!arAccount || !revenueAccount) continue;

      const dueDate = new Date(now);
      dueDate.setDate(dueDate.getDate() + item.daysToPay);

      const invoice = await db.$transaction(async (tx) => {
        const je = await tx.abJournalEntry.create({
          data: {
            tenantId, date: now, memo: `Recurring Invoice ${invoiceNumber} to ${client.name}`,
            sourceType: 'invoice', verified: true,
            lines: {
              create: [
                { accountId: arAccount.id, debitCents: item.totalCents, creditCents: 0, description: `AR - ${invoiceNumber}` },
                { accountId: revenueAccount.id, debitCents: 0, creditCents: item.totalCents, description: `Revenue - ${invoiceNumber}` },
              ],
            },
          },
        });

        const inv = await tx.abInvoice.create({
          data: {
            tenantId, clientId: item.clientId, number: invoiceNumber,
            amountCents: item.totalCents, currency: item.currency,
            issuedDate: now, dueDate,
            status: item.autoSend ? 'sent' : 'draft',
            journalEntryId: je.id, recurringId: item.id,
            lines: { create: lines },
          },
          include: { lines: true },
        });

        await tx.abJournalEntry.update({ where: { id: je.id }, data: { sourceId: inv.id } });
        await tx.abClient.update({ where: { id: item.clientId }, data: { totalBilledCents: { increment: item.totalCents } } });

        await tx.abEvent.create({
          data: {
            tenantId, eventType: 'invoice.auto_generated', actor: 'system',
            action: { invoiceId: inv.id, number: invoiceNumber, recurringId: item.id, amountCents: item.totalCents },
          },
        });

        return inv;
      });

      // Calculate next due date
      const nextDue = new Date(item.nextDue);
      switch (item.frequency) {
        case 'weekly': nextDue.setDate(nextDue.getDate() + 7); break;
        case 'biweekly': nextDue.setDate(nextDue.getDate() + 14); break;
        case 'monthly': nextDue.setMonth(nextDue.getMonth() + 1); break;
        case 'quarterly': nextDue.setMonth(nextDue.getMonth() + 3); break;
        case 'annual': nextDue.setFullYear(nextDue.getFullYear() + 1); break;
      }

      await db.abRecurringInvoice.update({
        where: { id: item.id },
        data: { nextDue, lastGenerated: now, generatedCount: { increment: 1 } },
      });

      generated.push({ invoiceId: invoice.id, number: invoice.number, clientId: item.clientId });
    }

    res.json({ success: true, data: { generated, count: generated.length } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ============================================
// STRIPE PAYMENT LINKS
// ============================================

// POST /invoices/:id/payment-link — Generate Stripe Checkout session or mock URL
app.post('/api/v1/agentbook-invoice/invoices/:id/payment-link', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const invoice = await db.abInvoice.findFirst({
      where: { id: req.params.id, tenantId },
      include: { client: true, lines: true },
    });
    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });
    if (invoice.status === 'paid') return res.json({ success: true, data: { paymentUrl: null, message: 'Invoice already paid' } });

    // If payment link already exists, return existing
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

// POST /stripe/checkout-completed — Handle successful Stripe payment
app.post('/api/v1/agentbook-invoice/stripe/checkout-completed', async (req: Request, res: Response) => {
  try {
    const event = req.body;
    if (event.type !== 'checkout.session.completed') {
      return res.json({ received: true });
    }

    const session = event.data.object;
    const invoiceId = session.metadata?.invoiceId;
    const tenantId = session.metadata?.tenantId;
    if (!invoiceId || !tenantId) return res.json({ received: true });

    // Check idempotency — skip if already processed
    const existing = await db.abPayment.findFirst({ where: { stripePaymentId: session.payment_intent } });
    if (existing) return res.json({ received: true, message: 'Already processed' });

    const invoice = await db.abInvoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!invoice || invoice.status === 'paid') return res.json({ received: true });

    const amountCents = session.amount_total || invoice.amountCents;

    // Record payment
    await db.abPayment.create({
      data: {
        tenantId,
        invoiceId: invoice.id,
        amountCents,
        method: 'stripe',
        date: new Date(),
        stripePaymentId: session.payment_intent,
      },
    });

    // Update invoice status
    await db.abInvoice.update({
      where: { id: invoice.id },
      data: { status: 'paid' },
    });

    // Create journal entry if accounts exist
    try {
      const cashAccount = await getAccountByCode(tenantId, '1010');
      const arAccount = await getAccountByCode(tenantId, '1200');
      if (cashAccount && arAccount) {
        await db.abJournalEntry.create({
          data: {
            tenantId, date: new Date(), description: `Stripe payment for ${invoice.number}`,
            lines: {
              create: [
                { accountId: cashAccount.id, debitCents: amountCents, creditCents: 0 },
                { accountId: arAccount.id, debitCents: 0, creditCents: amountCents },
              ],
            },
          },
        });
      }
    } catch { /* journal entry is best-effort */ }

    // Log event
    await db.abEvent.create({
      data: {
        tenantId, eventType: 'invoice.stripe_payment', actor: 'stripe',
        action: { invoiceId: invoice.id, amountCents, paymentIntent: session.payment_intent },
      },
    });

    res.json({ received: true, recorded: true });
  } catch (err) {
    console.error('Stripe checkout webhook error:', err);
    res.json({ received: true, error: String(err) });
  }
});

// ============================================
// PUBLIC INVOICE VIEW (no auth required)
// ============================================

app.get('/api/v1/agentbook-invoice/invoices/:id/public', async (req: Request, res: Response) => {
  try {
    const invoice = await db.abInvoice.findFirst({
      where: { id: req.params.id },
      include: { client: true, lines: true },
    });
    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });

    // Mark as viewed
    if (invoice.status === 'sent') {
      await db.abInvoice.update({ where: { id: invoice.id }, data: { status: 'viewed' } });
    }

    // Return safe data (no tenant secrets)
    res.json({
      success: true,
      data: {
        number: invoice.number,
        amountCents: invoice.amountCents,
        currency: invoice.currency,
        issuedDate: invoice.issuedDate,
        dueDate: invoice.dueDate,
        status: invoice.status === 'sent' ? 'viewed' : invoice.status,
        paymentUrl: invoice.paymentUrl,
        clientName: invoice.client?.name,
        lines: (invoice.lines || []).map((l: any) => ({
          description: l.description,
          quantity: l.quantity,
          rateCents: l.rateCents,
          amountCents: l.amountCents,
        })),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ============================================
// START
// ============================================

start();
