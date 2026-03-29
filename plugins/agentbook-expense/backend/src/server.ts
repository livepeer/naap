/**
 * AgentBook Expense Backend — Expense tracking, receipt management, vendor patterns.
 * Integrates with agentbook-core for journal entry creation.
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createPluginServer } from '@naap/plugin-server-sdk';
import { db } from './db/client.js';

const pluginConfig = JSON.parse(
  readFileSync(new URL('../../plugin.json', import.meta.url), 'utf8')
);

const { app, start } = createPluginServer({
  ...pluginConfig,
  requireAuth: process.env.NODE_ENV === 'production',
  publicRoutes: ['/healthz', '/api/v1/agentbook-expense'],
});

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

    // === Create expense + emit event in a single transaction ===
    // Event emission MUST be inside the transaction so that if either
    // the expense insert or the event insert fails, both are rolled back.
    // This guarantees the audit log is always consistent with the data.
    const expense = await db.$transaction(async (tx) => {
      const exp = await tx.abExpense.create({
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

      // Emit event inside transaction for atomicity
      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'expense.recorded',
          actor: 'agent',
          action: {
            expense_id: exp.id,
            amountCents,
            vendor: vendor || null,
            categoryId: resolvedCategoryId,
            isPersonal: isPersonal || false,
            hasReceipt: !!receiptUrl,
          },
        },
      });

      return exp;
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

// === PLAID INTEGRATION (Phase 6) ===

app.post('/api/v1/agentbook-expense/plaid/create-link-token', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    // In production: call Plaid API to create a link token
    // For now: return a mock token that Plaid Link can use in sandbox
    const linkToken = `link-sandbox-${crypto.randomUUID().slice(0, 8)}`;

    await db.abEvent.create({
      data: { tenantId, eventType: 'plaid.link_token_created', actor: 'system', action: { linkToken: linkToken.slice(0, 12) + '...' } },
    });

    res.json({ success: true, data: { linkToken, environment: process.env.PLAID_ENV || 'sandbox' } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

app.post('/api/v1/agentbook-expense/plaid/exchange-token', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { publicToken, accountId, institutionName } = req.body;

    // In production: exchange public token for access token via Plaid API
    // For now: create a bank account record
    const bankAccount = await db.abBankAccount.create({
      data: {
        tenantId,
        plaidItemId: `item-${crypto.randomUUID().slice(0, 8)}`,
        plaidAccountId: accountId || `acct-${crypto.randomUUID().slice(0, 8)}`,
        name: 'Checking Account',
        type: 'checking',
        institution: institutionName || 'Sandbox Bank',
        connected: true,
        lastSynced: new Date(),
      },
    });

    await db.abEvent.create({
      data: { tenantId, eventType: 'plaid.account_connected', actor: 'system', action: { bankAccountId: bankAccount.id, institution: institutionName } },
    });

    res.json({ success: true, data: bankAccount });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

app.get('/api/v1/agentbook-expense/bank-accounts', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const accounts = await db.abBankAccount.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    res.json({ success: true, data: accounts });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

app.post('/api/v1/agentbook-expense/bank-sync', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    // In production: call Plaid API to fetch transactions
    // For now: return sync status
    const accounts = await db.abBankAccount.findMany({ where: { tenantId, connected: true } });

    for (const acct of accounts) {
      await db.abBankAccount.update({ where: { id: acct.id }, data: { lastSynced: new Date() } });
    }

    res.json({ success: true, data: { accountsSynced: accounts.length, timestamp: new Date().toISOString() } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

app.get('/api/v1/agentbook-expense/reconciliation-summary', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const [total, matched, exceptions] = await Promise.all([
      db.abBankTransaction.count({ where: { tenantId } }),
      db.abBankTransaction.count({ where: { tenantId, matchStatus: 'matched' } }),
      db.abBankTransaction.count({ where: { tenantId, matchStatus: 'exception' } }),
    ]);

    res.json({ success: true, data: { totalTransactions: total, matched, exceptions, matchRate: total > 0 ? matched / total : 0 } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// === STRIPE CONNECT (Phase 6) ===

app.post('/api/v1/agentbook-expense/stripe/webhook', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const sig = req.headers['stripe-signature'];

    // In production: verify signature with Stripe webhook secret
    // const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

    const event = req.body;

    // Idempotency check
    if (event.id) {
      const existing = await db.abStripeWebhookEvent.findUnique({ where: { stripeEventId: event.id } });
      if (existing?.processed) {
        return res.json({ success: true, message: 'Already processed' });
      }

      await db.abStripeWebhookEvent.upsert({
        where: { stripeEventId: event.id },
        update: { processed: true },
        create: { tenantId, stripeEventId: event.id, eventType: event.type || 'unknown', payload: event, processed: true },
      });
    }

    await db.abEvent.create({
      data: { tenantId, eventType: `stripe.${event.type || 'webhook'}`, actor: 'system', action: { stripeEventId: event.id } },
    });

    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// === RECEIPT OCR (Phase 6) ===

app.post('/api/v1/agentbook-expense/receipts/ocr', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { imageUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ success: false, error: 'imageUrl is required' });
    }

    // Call Gemini for receipt OCR
    const llmConfig = await db.abLLMProviderConfig.findFirst({ where: { enabled: true, isDefault: true } });
    let ocrResult: any = { amount_cents: 0, vendor: null, date: new Date().toISOString().split('T')[0], confidence: 0, status: 'no_llm_configured' };

    if (llmConfig && llmConfig.provider === 'gemini') {
      try {
        const model = llmConfig.modelVision || llmConfig.modelStandard || 'gemini-2.5-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${llmConfig.apiKey}`;

        const llmRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: 'Extract receipt data as JSON: {"amount_cents": <integer>, "vendor": "<string>", "date": "<YYYY-MM-DD>", "currency": "USD or CAD", "confidence": <0-1>}. Return ONLY valid JSON.' }] },
            contents: [{ role: 'user', parts: [{ text: `Extract data from this receipt image URL: ${imageUrl}` }] }],
            generationConfig: { maxOutputTokens: 200, temperature: 0.1, responseMimeType: 'application/json' },
          }),
        });

        if (llmRes.ok) {
          const llmData = await llmRes.json();
          const text = llmData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
          try {
            const parsed = JSON.parse(text);
            ocrResult = { ...parsed, status: 'processed_by_gemini', model };
          } catch { ocrResult.status = 'gemini_parse_error'; }
        }
      } catch (err) {
        console.warn('Gemini OCR failed:', err);
        ocrResult.status = 'gemini_error';
      }
    }

    await db.abEvent.create({
      data: { tenantId, eventType: 'receipt.ocr_requested', actor: 'system', action: { imageUrl: imageUrl.slice(0, 50) + '...' } },
    });

    // Auto-execute: if OCR extracted data with confidence > 0.7, create expense automatically
    if (ocrResult.amount_cents > 0 && ocrResult.confidence > 0.7) {
      const vendor = ocrResult.vendor ? await db.abVendor.upsert({
        where: { tenantId_normalizedName: { tenantId, normalizedName: (ocrResult.vendor || '').toLowerCase().replace(/[^a-z0-9]/g, '') } },
        update: { lastSeen: new Date(), transactionCount: { increment: 1 } },
        create: { tenantId, name: ocrResult.vendor, normalizedName: (ocrResult.vendor || '').toLowerCase().replace(/[^a-z0-9]/g, '') },
      }) : null;

      const expense = await db.abExpense.create({
        data: {
          tenantId,
          amountCents: ocrResult.amount_cents,
          vendorId: vendor?.id,
          date: ocrResult.date ? new Date(ocrResult.date) : new Date(),
          description: `Receipt: ${ocrResult.vendor || 'Unknown'}`,
          receiptUrl: imageUrl,
          confidence: ocrResult.confidence,
        },
      });

      await db.abEvent.create({
        data: { tenantId, eventType: 'receipt.auto_processed', actor: 'agent',
          action: { expenseId: expense.id, amountCents: ocrResult.amount_cents, vendor: ocrResult.vendor, confidence: ocrResult.confidence } },
      });

      return res.json({ success: true, data: { ...ocrResult, autoRecorded: true, expenseId: expense.id } });
    }

    res.json({ success: true, data: ocrResult });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

start();
