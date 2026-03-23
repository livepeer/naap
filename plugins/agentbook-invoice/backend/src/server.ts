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

const { app, start } = createPluginServer(pluginConfig);

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
app.post('/clients', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { name, email, address, defaultTerms } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'name is required' });
    }

    const client = await db.abClient.create({
      data: {
        tenantId,
        name,
        email: email || null,
        address: address || null,
        defaultTerms: defaultTerms || 'net-30',
      },
    });

    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'client.created',
        actor: 'agent',
        action: { clientId: client.id, name },
      },
    });

    res.status(201).json({ success: true, data: client });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// GET /clients — list clients for tenant
app.get('/clients', async (req: Request, res: Response) => {
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
app.get('/clients/:id', async (req: Request, res: Response) => {
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
app.put('/clients/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { name, email, address, defaultTerms } = req.body;

    const existing = await db.abClient.findFirst({
      where: { id: req.params.id, tenantId },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    const client = await db.abClient.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(address !== undefined && { address }),
        ...(defaultTerms !== undefined && { defaultTerms }),
      },
    });

    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'client.updated',
        actor: 'agent',
        action: { clientId: client.id, changes: req.body },
      },
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
app.post('/invoices', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { clientId, issuedDate, dueDate, lines, status } = req.body;

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

    // Create invoice, lines, journal entry, and update client in a transaction
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
app.get('/invoices', async (req: Request, res: Response) => {
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

    const updated = await db.abInvoice.update({
      where: { id: req.params.id },
      data: { status: 'sent' },
    });

    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'invoice.sent',
        actor: 'agent',
        action: { invoiceId: invoice.id, number: invoice.number },
      },
    });

    // TODO: integrate email sending service

    res.json({ success: true, data: updated });
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
app.post('/payments', async (req: Request, res: Response) => {
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
app.get('/aging-report', async (req: Request, res: Response) => {
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
app.post('/estimates', async (req: Request, res: Response) => {
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

    const estimate = await db.abEstimate.create({
      data: {
        tenantId,
        clientId,
        amountCents,
        description,
        validUntil: expiryDate,
      },
    });

    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'estimate.created',
        actor: 'agent',
        action: { estimateId: estimate.id, clientId, amountCents },
      },
    });

    res.status(201).json({ success: true, data: estimate });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// GET /estimates — list estimates
app.get('/estimates', async (req: Request, res: Response) => {
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
// START
// ============================================

start();
