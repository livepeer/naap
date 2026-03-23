/**
 * AgentBook Expense Backend — Expense tracking, receipt management, vendor patterns.
 * Integrates with agentbook-core for journal entry creation.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createPluginServer } from '@naap/plugin-server-sdk';
import { db } from './db/client.js';

const pluginConfig = JSON.parse(
  readFileSync(new URL('../../plugin.json', import.meta.url), 'utf8')
);

const { app, start } = createPluginServer(pluginConfig);

app.use((req, res, next) => {
  (req as any).tenantId = req.headers['x-tenant-id'] as string || 'default';
  next();
});

// === Health Check ===
app.get('/healthz', async (_req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: 'healthy', plugin: 'agentbook-expense', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: String(err) });
  }
});

// === Helper: Normalize vendor name ===
function normalizeVendorName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

// === Record Expense ===
app.post('/api/v1/agentbook-expense/expenses', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { amountCents, vendor, categoryId, date, description, receiptUrl, confidence, isPersonal } = req.body;

    if (!amountCents || amountCents <= 0) {
      return res.status(400).json({ success: false, error: 'amountCents must be a positive integer' });
    }

    // Find or create vendor
    let vendorRecord = null;
    if (vendor) {
      const normalized = normalizeVendorName(vendor);
      vendorRecord = await db.abVendor.upsert({
        where: { tenantId_normalizedName: { tenantId, normalizedName: normalized } },
        update: {
          transactionCount: { increment: 1 },
          lastSeen: new Date(),
        },
        create: {
          tenantId,
          name: vendor,
          normalizedName: normalized,
          defaultCategoryId: categoryId || null,
        },
      });
    }

    // Check for learned pattern if no category provided
    let resolvedCategoryId = categoryId;
    let resolvedConfidence = confidence;
    if (!resolvedCategoryId && vendorRecord) {
      const pattern = await db.abPattern.findUnique({
        where: { tenantId_vendorPattern: { tenantId, vendorPattern: vendorRecord.normalizedName } },
      });
      if (pattern) {
        resolvedCategoryId = pattern.categoryId;
        resolvedConfidence = pattern.confidence;
        // Increment usage count
        await db.abPattern.update({
          where: { id: pattern.id },
          data: { usageCount: { increment: 1 }, lastUsed: new Date() },
        });
      }
    }

    // Create expense
    const expense = await db.abExpense.create({
      data: {
        tenantId,
        amountCents,
        vendorId: vendorRecord?.id,
        categoryId: resolvedCategoryId,
        date: new Date(date || Date.now()),
        description: description || vendor || 'Expense',
        receiptUrl,
        confidence: resolvedConfidence,
        isPersonal: isPersonal || false,
      },
    });

    // Emit event
    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'expense.recorded',
        actor: 'agent',
        action: {
          expense_id: expense.id,
          amountCents,
          vendor: vendor || null,
          categoryId: resolvedCategoryId,
          isPersonal: isPersonal || false,
          hasReceipt: !!receiptUrl,
        },
      },
    });

    res.status(201).json({
      success: true,
      data: expense,
      meta: {
        vendor: vendorRecord,
        categoryFromPattern: !categoryId && !!resolvedCategoryId,
        confidence: resolvedConfidence,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// === List Expenses ===
app.get('/api/v1/agentbook-expense/expenses', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate, isPersonal, vendorId, limit = '50', offset = '0' } = req.query;

    const where: any = { tenantId };
    if (startDate) where.date = { ...where.date, gte: new Date(startDate as string) };
    if (endDate) where.date = { ...where.date, lte: new Date(endDate as string) };
    if (isPersonal !== undefined) where.isPersonal = isPersonal === 'true';
    if (vendorId) where.vendorId = vendorId;

    const [expenses, total] = await Promise.all([
      db.abExpense.findMany({
        where,
        orderBy: { date: 'desc' },
        take: parseInt(limit as string),
        skip: parseInt(offset as string),
      }),
      db.abExpense.count({ where }),
    ]);

    res.json({ success: true, data: expenses, meta: { total, limit: parseInt(limit as string), offset: parseInt(offset as string) } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// === Get Single Expense ===
app.get('/api/v1/agentbook-expense/expenses/:id', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const expense = await db.abExpense.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!expense) return res.status(404).json({ success: false, error: 'Expense not found' });
    res.json({ success: true, data: expense });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// === Update Expense ===
app.put('/api/v1/agentbook-expense/expenses/:id', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const existing = await db.abExpense.findFirst({ where: { id: req.params.id, tenantId } });
    if (!existing) return res.status(404).json({ success: false, error: 'Expense not found' });

    const { amountCents, categoryId, description, isPersonal, date } = req.body;
    const updated = await db.abExpense.update({
      where: { id: req.params.id },
      data: {
        ...(amountCents !== undefined && { amountCents }),
        ...(categoryId !== undefined && { categoryId }),
        ...(description !== undefined && { description }),
        ...(isPersonal !== undefined && { isPersonal }),
        ...(date !== undefined && { date: new Date(date) }),
      },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// === Categorize/Re-categorize Expense ===
app.post('/api/v1/agentbook-expense/expenses/:id/categorize', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { categoryId, source } = req.body;

    const expense = await db.abExpense.findFirst({ where: { id: req.params.id, tenantId } });
    if (!expense) return res.status(404).json({ success: false, error: 'Expense not found' });

    // Update expense category
    const updated = await db.abExpense.update({
      where: { id: req.params.id },
      data: { categoryId, confidence: 1.0 },
    });

    // Update or create vendor pattern (user correction = high confidence)
    if (expense.vendorId) {
      const vendor = await db.abVendor.findUnique({ where: { id: expense.vendorId } });
      if (vendor) {
        await db.abPattern.upsert({
          where: { tenantId_vendorPattern: { tenantId, vendorPattern: vendor.normalizedName } },
          update: {
            categoryId,
            confidence: 0.95,
            source: source || 'user_corrected',
            usageCount: { increment: 1 },
            lastUsed: new Date(),
          },
          create: {
            tenantId,
            vendorPattern: vendor.normalizedName,
            categoryId,
            confidence: 0.95,
            source: source || 'user_corrected',
          },
        });

        // Also update vendor default category
        await db.abVendor.update({
          where: { id: vendor.id },
          data: { defaultCategoryId: categoryId },
        });
      }
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// === Vendors ===
app.get('/api/v1/agentbook-expense/vendors', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const vendors = await db.abVendor.findMany({
      where: { tenantId },
      orderBy: { transactionCount: 'desc' },
    });
    res.json({ success: true, data: vendors });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.get('/api/v1/agentbook-expense/vendors/:id', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const vendor = await db.abVendor.findFirst({ where: { id: req.params.id, tenantId } });
    if (!vendor) return res.status(404).json({ success: false, error: 'Vendor not found' });
    res.json({ success: true, data: vendor });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// === Patterns ===
app.get('/api/v1/agentbook-expense/patterns', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const patterns = await db.abPattern.findMany({
      where: { tenantId },
      orderBy: { usageCount: 'desc' },
    });
    res.json({ success: true, data: patterns });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// === Receipt Upload (metadata only — actual upload goes to Vercel Blob / S3) ===
app.post('/api/v1/agentbook-expense/receipts/upload', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { expenseId, receiptUrl } = req.body;

    if (!expenseId || !receiptUrl) {
      return res.status(400).json({ success: false, error: 'expenseId and receiptUrl are required' });
    }

    const expense = await db.abExpense.findFirst({ where: { id: expenseId, tenantId } });
    if (!expense) return res.status(404).json({ success: false, error: 'Expense not found' });

    const updated = await db.abExpense.update({
      where: { id: expenseId },
      data: { receiptUrl },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// === Recurring Rules ===
app.get('/api/v1/agentbook-expense/recurring-rules', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const rules = await db.abRecurringRule.findMany({
      where: { tenantId, active: true },
      orderBy: { nextExpected: 'asc' },
    });
    res.json({ success: true, data: rules });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

start();
