/**
 * AgentBook Expense Backend — Expense tracking, receipt management, vendor patterns.
 * Integrates with agentbook-core for journal entry creation.
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createPluginServer } from '@naap/plugin-server-sdk';
import { db } from './db/client.js';
import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid';

// === Plaid Client Setup ===
const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID || '69d02fa4f1949b000dbfc51e';
const PLAID_SECRET = process.env.PLAID_SECRET || '59be40029c47288c4db4acfd79ae56';
const PLAID_ENV = process.env.PLAID_ENV || 'sandbox';

const plaidConfig = new Configuration({
  basePath: PlaidEnvironments[PLAID_ENV as keyof typeof PlaidEnvironments] || PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': PLAID_CLIENT_ID,
      'PLAID-SECRET': PLAID_SECRET,
    },
  },
});
const plaidClient = new PlaidApi(plaidConfig);

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

// === LLM Helper (local to expense plugin — same pattern as core) ===
async function callGemini(systemPrompt: string, userMessage: string, maxTokens: number = 500): Promise<string | null> {
  try {
    const llmConfig = await db.abLLMProviderConfig.findFirst({ where: { enabled: true, isDefault: true } });
    if (!llmConfig || llmConfig.provider !== 'gemini') return null;

    const model = llmConfig.modelFast || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${llmConfig.apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch { return null; }
}

function formatCents(c: number): string {
  return '$' + (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// === Record Expense ===
app.post('/api/v1/agentbook-expense/expenses', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { amountCents, vendor, categoryId, date, description, receiptUrl, confidence, isPersonal,
            taxAmountCents, tipAmountCents, paymentMethod, currency, notes, tags, isBillable, clientId, source, status } = req.body;

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
      // Create journal entry if category is assigned (double-entry: DR Expense, CR Cash)
      let journalEntryId: string | null = null;
      if (resolvedCategoryId && !isPersonal) {
        const cashAccount = await tx.abAccount.findFirst({ where: { tenantId, code: '1000' } });
        if (cashAccount) {
          const je = await tx.abJournalEntry.create({
            data: {
              tenantId, date: new Date(date || Date.now()),
              memo: `Expense: ${description || vendor || 'Expense'}`,
              sourceType: 'expense', verified: true,
              lines: {
                create: [
                  { accountId: resolvedCategoryId, debitCents: amountCents, creditCents: 0, description: description || vendor || 'Expense' },
                  { accountId: cashAccount.id, debitCents: 0, creditCents: amountCents, description: `Payment: ${vendor || 'Expense'}` },
                ],
              },
            },
          });
          journalEntryId = je.id;
        }
      }

      const exp = await tx.abExpense.create({
        data: {
          tenantId,
          amountCents,
          taxAmountCents: taxAmountCents || 0,
          tipAmountCents: tipAmountCents || 0,
          vendorId: vendorRecord?.id,
          categoryId: resolvedCategoryId,
          date: new Date(date || Date.now()),
          description: description || vendor || 'Expense',
          notes: notes || null,
          receiptUrl,
          paymentMethod: paymentMethod || 'unknown',
          currency: currency || 'USD',
          tags: tags || null,
          confidence: resolvedConfidence,
          isPersonal: isPersonal || false,
          isBillable: isBillable || false,
          clientId: clientId || null,
          journalEntryId,
          ...(source ? { source } : {}),
          ...(status ? { status } : {}),
        },
        include: { vendor: true },
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
        include: { vendor: { select: { id: true, name: true, normalizedName: true } } },
        orderBy: { date: 'desc' },
        take: parseInt(limit as string),
        skip: parseInt(offset as string),
      }),
      db.abExpense.count({ where }),
    ]);

    // Resolve category names from accounts (cross-schema)
    const categoryIds = [...new Set(expenses.map((e: any) => e.categoryId).filter(Boolean))];
    const categories = categoryIds.length > 0
      ? await db.abAccount.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true, code: true } })
      : [];
    const categoryMap = Object.fromEntries(categories.map((c: any) => [c.id, { name: c.name, code: c.code }]));

    const enriched = expenses.map((e: any) => ({
      ...e,
      vendorName: e.vendor?.name || null,
      categoryName: e.categoryId ? categoryMap[e.categoryId]?.name || null : null,
      categoryCode: e.categoryId ? categoryMap[e.categoryId]?.code || null : null,
    }));

    res.json({ success: true, data: enriched, meta: { total, limit: parseInt(limit as string), offset: parseInt(offset as string) } });
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
      include: { vendor: { select: { id: true, name: true } } },
    });
    if (!expense) return res.status(404).json({ success: false, error: 'Expense not found' });

    // Resolve category
    let categoryName = null;
    let categoryCode = null;
    if (expense.categoryId) {
      const cat = await db.abAccount.findFirst({ where: { id: expense.categoryId } });
      if (cat) { categoryName = cat.name; categoryCode = cat.code; }
    }

    // Get splits if any
    const splits = await db.abExpenseSplit.findMany({ where: { expenseId: expense.id } });

    res.json({ success: true, data: { ...expense, vendorName: (expense as any).vendor?.name, categoryName, categoryCode, splits } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// === Category Summary with Trends ===
app.get('/api/v1/agentbook-expense/category-summary', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate, compareStartDate, compareEndDate } = req.query;

    // Current period
    const currentWhere: any = { tenantId, isPersonal: false };
    if (startDate) currentWhere.date = { ...currentWhere.date, gte: new Date(startDate as string) };
    if (endDate) currentWhere.date = { ...currentWhere.date, lte: new Date(endDate as string) };

    const currentExpenses = await db.abExpense.findMany({
      where: currentWhere,
      include: { vendor: { select: { name: true } } },
    });

    // Comparison period (optional)
    let compareExpenses: any[] = [];
    if (compareStartDate && compareEndDate) {
      compareExpenses = await db.abExpense.findMany({
        where: { tenantId, isPersonal: false, date: { gte: new Date(compareStartDate as string), lte: new Date(compareEndDate as string) } },
      });
    }

    // Group by category
    const categoryIds = [...new Set(currentExpenses.map((e: any) => e.categoryId).filter(Boolean))];
    const categories = categoryIds.length > 0
      ? await db.abAccount.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true, code: true } })
      : [];
    const catMap = Object.fromEntries(categories.map((c: any) => [c.id, c]));

    // Compare period by category
    const compareByCat: Record<string, number> = {};
    for (const e of compareExpenses) {
      const key = e.categoryId || 'uncategorized';
      compareByCat[key] = (compareByCat[key] || 0) + e.amountCents;
    }

    // Build summary
    const byCat: Record<string, { totalCents: number; count: number; expenses: any[] }> = {};
    for (const e of currentExpenses) {
      const key = e.categoryId || 'uncategorized';
      if (!byCat[key]) byCat[key] = { totalCents: 0, count: 0, expenses: [] };
      byCat[key].totalCents += e.amountCents;
      byCat[key].count++;
      byCat[key].expenses.push(e);
    }

    const summary = Object.entries(byCat).map(([catId, data]) => {
      const cat = catMap[catId];
      const prevTotal = compareByCat[catId] || 0;
      const changePercent = prevTotal > 0 ? Math.round(((data.totalCents - prevTotal) / prevTotal) * 100) : null;

      // Top vendors in this category
      const vendorTotals: Record<string, number> = {};
      for (const e of data.expenses) {
        const vn = (e as any).vendor?.name || 'Other';
        vendorTotals[vn] = (vendorTotals[vn] || 0) + e.amountCents;
      }
      const topVendors = Object.entries(vendorTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, cents]) => ({ name, totalCents: cents }));

      return {
        categoryId: catId === 'uncategorized' ? null : catId,
        categoryName: cat?.name || 'Uncategorized',
        categoryCode: cat?.code || null,
        totalCents: data.totalCents,
        count: data.count,
        previousPeriodCents: prevTotal,
        changePercent,
        topVendors,
      };
    }).sort((a, b) => b.totalCents - a.totalCents);

    // Personal expenses summary
    const personalWhere: any = { tenantId, isPersonal: true };
    if (startDate) personalWhere.date = { ...personalWhere.date, gte: new Date(startDate as string) };
    if (endDate) personalWhere.date = { ...personalWhere.date, lte: new Date(endDate as string) };
    const personalExpenses = await db.abExpense.findMany({ where: personalWhere });
    const personalTotal = personalExpenses.reduce((s: number, e: any) => s + e.amountCents, 0);

    res.json({
      success: true,
      data: {
        categories: summary,
        totals: {
          businessCents: currentExpenses.reduce((s: number, e: any) => s + e.amountCents, 0),
          personalCents: personalTotal,
          businessCount: currentExpenses.length,
          personalCount: personalExpenses.length,
        },
      },
    });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// === Auto-tag expense using vendor patterns ===
app.post('/api/v1/agentbook-expense/expenses/:id/auto-tag', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const expense = await db.abExpense.findFirst({
      where: { id: req.params.id, tenantId },
      include: { vendor: true },
    });
    if (!expense) return res.status(404).json({ success: false, error: 'Expense not found' });

    const vendorName = (expense.vendor?.name || expense.description || '').toLowerCase();
    let tags: string[] = expense.tags ? expense.tags.split(',').map((t: string) => t.trim()) : [];

    // Auto-tag rules based on vendor/description patterns
    const tagRules: [RegExp, string][] = [
      [/restaurant|cafe|coffee|starbucks|mcdonald|chipotle|uchi|canoe|alo|dinner|lunch|breakfast|food|eat/i, 'meals'],
      [/uber|lyft|taxi|cab|transit|subway|bus/i, 'transportation'],
      [/hotel|marriott|hyatt|hilton|airbnb|motel|inn/i, 'accommodation'],
      [/air canada|westjet|delta|united|american|flight|airline/i, 'flights'],
      [/adobe|figma|slack|notion|github|asana|shopify|grammarly|wordpress|aws|google cloud|azure/i, 'software'],
      [/apple|dell|wacom|samsung|lenovo|monitor|laptop|keyboard|mouse|printer/i, 'equipment'],
      [/insurance|manulife|hiscox|allstate|geico/i, 'insurance'],
      [/rent|lease|wework|cowork|office space/i, 'rent'],
      [/phone|internet|bell|rogers|comcast|att|verizon|tmobile/i, 'telecom'],
      [/usps|fedex|ups|dhl|shipping|postage/i, 'shipping'],
      [/google ads|facebook ads|marketing|advertising|promotion/i, 'marketing'],
      [/contractor|freelance|consultant/i, 'contractor'],
      [/costco|walmart|target|staples|office depot|supplies/i, 'supplies'],
      [/gas|gasoline|shell|esso|petro/i, 'fuel'],
      [/parking|meter/i, 'parking'],
      [/training|course|udemy|coursera|workshop|conference|seminar/i, 'education'],
      [/netflix|spotify|hulu|disney|entertainment|movie|theater/i, 'entertainment'],
      [/grocery|trader|whole foods|safeway|kroger/i, 'groceries'],
    ];

    for (const [pattern, tag] of tagRules) {
      if (pattern.test(vendorName) && !tags.includes(tag)) {
        tags.push(tag);
      }
    }

    // Also tag by amount range
    if (expense.amountCents > 100000) tags.push('high-value');
    if (expense.amountCents < 1000) tags.push('micro');

    const tagString = [...new Set(tags)].join(',');

    await db.abExpense.update({
      where: { id: expense.id },
      data: { tags: tagString },
    });

    res.json({ success: true, data: { expenseId: expense.id, tags: tagString.split(',') } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// === Bulk auto-tag all expenses ===
app.post('/api/v1/agentbook-expense/auto-tag-all', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const expenses = await db.abExpense.findMany({
      where: { tenantId, tags: null },
      include: { vendor: true },
      take: 500,
    });

    const tagRules: [RegExp, string][] = [
      [/restaurant|cafe|coffee|starbucks|mcdonald|chipotle|uchi|canoe|alo|dinner|lunch|breakfast|food|eat/i, 'meals'],
      [/uber|lyft|taxi|cab|transit/i, 'transportation'],
      [/hotel|marriott|hyatt|hilton|airbnb/i, 'accommodation'],
      [/air canada|westjet|delta|united|flight|airline/i, 'flights'],
      [/adobe|figma|slack|notion|github|asana|shopify|grammarly|wordpress|aws/i, 'software'],
      [/apple|dell|wacom|samsung|monitor|laptop/i, 'equipment'],
      [/insurance|manulife|hiscox/i, 'insurance'],
      [/rent|lease|wework|cowork/i, 'rent'],
      [/phone|internet|bell|comcast/i, 'telecom'],
      [/usps|fedex|ups|shipping|postage/i, 'shipping'],
      [/google ads|facebook ads|marketing|advertising/i, 'marketing'],
      [/contractor|freelance/i, 'contractor'],
      [/costco|walmart|target|staples|supplies/i, 'supplies'],
      [/training|course|udemy|workshop|conference/i, 'education'],
      [/netflix|spotify|entertainment/i, 'entertainment'],
      [/grocery|trader|whole foods/i, 'groceries'],
    ];

    let tagged = 0;
    for (const exp of expenses) {
      const vn = ((exp as any).vendor?.name || exp.description || '').toLowerCase();
      const tags: string[] = [];
      for (const [pattern, tag] of tagRules) {
        if (pattern.test(vn)) tags.push(tag);
      }
      if (exp.amountCents > 100000) tags.push('high-value');
      if (tags.length > 0) {
        await db.abExpense.update({ where: { id: exp.id }, data: { tags: tags.join(',') } });
        tagged++;
      }
    }

    res.json({ success: true, data: { checked: expenses.length, tagged } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
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

// === PLAID INTEGRATION (Live) ===

// Store access tokens in memory per tenant (in production: encrypt and store in DB)
const plaidAccessTokens: Record<string, string> = {};

app.post('/api/v1/agentbook-expense/plaid/create-link-token', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;

    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: tenantId },
      client_name: 'AgentBook',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us, CountryCode.Ca],
      language: 'en',
    });

    const linkToken = response.data.link_token;

    await db.abEvent.create({
      data: { tenantId, eventType: 'plaid.link_token_created', actor: 'system', action: { tokenPrefix: linkToken.slice(0, 20) + '...' } },
    });

    res.json({ success: true, data: { linkToken, environment: PLAID_ENV, expiration: response.data.expiration } });
  } catch (err: any) {
    console.error('Plaid link token error:', err?.response?.data || err);
    res.status(500).json({ success: false, error: err?.response?.data?.error_message || String(err) });
  }
});

app.post('/api/v1/agentbook-expense/plaid/exchange-token', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { publicToken, institutionId, institutionName, accounts: plaidAccounts } = req.body;

    if (!publicToken) {
      return res.status(400).json({ success: false, error: 'publicToken is required' });
    }

    // Exchange public token for access token
    const exchangeRes = await plaidClient.itemPublicTokenExchange({ public_token: publicToken });
    const accessToken = exchangeRes.data.access_token;
    const itemId = exchangeRes.data.item_id;

    // Store access token
    plaidAccessTokens[tenantId] = accessToken;

    // Get account details
    const accountsRes = await plaidClient.accountsGet({ access_token: accessToken });
    const createdAccounts = [];

    for (const acct of accountsRes.data.accounts) {
      // Check if account already exists
      const existing = await db.abBankAccount.findFirst({ where: { plaidAccountId: acct.account_id } });
      if (existing) continue;

      const bankAccount = await db.abBankAccount.create({
        data: {
          tenantId,
          plaidItemId: itemId,
          plaidAccountId: acct.account_id,
          name: acct.name,
          officialName: acct.official_name || null,
          type: acct.type || 'checking',
          subtype: acct.subtype || null,
          mask: acct.mask || null,
          balanceCents: Math.round((acct.balances.current || 0) * 100),
          currency: acct.balances.iso_currency_code || 'USD',
          institution: institutionName || null,
          connected: true,
          lastSynced: new Date(),
        },
      });
      createdAccounts.push(bankAccount);
    }

    await db.abEvent.create({
      data: {
        tenantId, eventType: 'plaid.account_connected', actor: 'system',
        action: { itemId, institution: institutionName, accountCount: createdAccounts.length },
      },
    });

    res.json({ success: true, data: { accounts: createdAccounts, itemId } });
  } catch (err: any) {
    console.error('Plaid exchange error:', err?.response?.data || err);
    res.status(500).json({ success: false, error: err?.response?.data?.error_message || String(err) });
  }
});

app.get('/api/v1/agentbook-expense/bank-accounts', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const accounts = await db.abBankAccount.findMany({
      where: { tenantId },
      include: { transactions: { select: { id: true }, take: 0 } },
      orderBy: { createdAt: 'desc' },
    });

    // Enrich with transaction counts
    const enriched = await Promise.all(accounts.map(async (acct: any) => {
      const txnCount = await db.abBankTransaction.count({ where: { bankAccountId: acct.id } });
      return { ...acct, transactionCount: txnCount };
    }));

    res.json({ success: true, data: enriched });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

app.post('/api/v1/agentbook-expense/bank-sync', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const accessToken = plaidAccessTokens[tenantId];

    const accounts = await db.abBankAccount.findMany({ where: { tenantId, connected: true } });
    if (accounts.length === 0) {
      return res.json({ success: true, data: { accountsSynced: 0, transactionsImported: 0, message: 'No connected accounts' } });
    }

    let totalImported = 0;
    let totalMatched = 0;

    if (accessToken) {
      // Fetch transactions from Plaid (last 30 days)
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
      const startDate = thirtyDaysAgo.toISOString().slice(0, 10);
      const endDate = now.toISOString().slice(0, 10);

      try {
        const txnRes = await plaidClient.transactionsGet({
          access_token: accessToken,
          start_date: startDate,
          end_date: endDate,
          options: { count: 500, offset: 0 },
        });

        for (const txn of txnRes.data.transactions) {
          // Idempotent: skip if already imported
          const existing = await db.abBankTransaction.findFirst({
            where: { plaidTransactionId: txn.transaction_id },
          });
          if (existing) continue;

          // Find the matching bank account
          const bankAcct = accounts.find((a: any) => a.plaidAccountId === txn.account_id);
          if (!bankAcct) continue;

          const bankTxn = await db.abBankTransaction.create({
            data: {
              tenantId,
              bankAccountId: bankAcct.id,
              plaidTransactionId: txn.transaction_id,
              amount: Math.round(txn.amount * 100), // Plaid: positive = outflow
              date: new Date(txn.date),
              merchantName: txn.merchant_name || null,
              name: txn.name || 'Unknown',
              category: txn.personal_finance_category?.primary || txn.category?.join(' > ') || null,
              pending: txn.pending || false,
              matchStatus: 'pending',
              idempotencyKey: txn.transaction_id,
            },
          });
          totalImported++;

          // Auto-match: try to find a matching expense by amount + date (±2 days)
          if (txn.amount > 0) { // outflow = expense
            const amountCents = Math.round(txn.amount * 100);
            const txnDate = new Date(txn.date);
            const matchWindow = 2 * 86400000;

            const matchingExpense = await db.abExpense.findFirst({
              where: {
                tenantId,
                amountCents: { gte: Math.round(amountCents * 0.95), lte: Math.round(amountCents * 1.05) },
                date: { gte: new Date(txnDate.getTime() - matchWindow), lte: new Date(txnDate.getTime() + matchWindow) },
                journalEntryId: { not: null },
              },
              orderBy: { date: 'asc' },
            });

            if (matchingExpense) {
              await db.abBankTransaction.update({
                where: { id: bankTxn.id },
                data: { matchedExpenseId: matchingExpense.id, matchStatus: 'matched' },
              });
              totalMatched++;
            }
          }
        }

        // Update account balances
        for (const plaidAcct of txnRes.data.accounts) {
          const dbAcct = accounts.find((a: any) => a.plaidAccountId === plaidAcct.account_id);
          if (dbAcct) {
            await db.abBankAccount.update({
              where: { id: dbAcct.id },
              data: {
                balanceCents: Math.round((plaidAcct.balances.current || 0) * 100),
                lastSynced: new Date(),
              },
            });
          }
        }
      } catch (plaidErr: any) {
        console.error('Plaid transactions error:', plaidErr?.response?.data || plaidErr);
        // Still return partial success
      }
    } else {
      // No access token — just update timestamps
      for (const acct of accounts) {
        await db.abBankAccount.update({ where: { id: acct.id }, data: { lastSynced: new Date() } });
      }
    }

    await db.abEvent.create({
      data: {
        tenantId, eventType: 'bank.sync_completed', actor: 'system',
        action: { accountsSynced: accounts.length, transactionsImported: totalImported, autoMatched: totalMatched },
      },
    });

    res.json({
      success: true,
      data: { accountsSynced: accounts.length, transactionsImported: totalImported, autoMatched: totalMatched, timestamp: new Date().toISOString() },
    });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// GET /bank-transactions — List imported bank transactions
app.get('/api/v1/agentbook-expense/bank-transactions', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { status, limit = '50' } = req.query;
    const where: any = { tenantId };
    if (status) where.matchStatus = status;

    const transactions = await db.abBankTransaction.findMany({
      where,
      orderBy: { date: 'desc' },
      take: parseInt(limit as string),
    });
    res.json({ success: true, data: transactions });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

app.get('/api/v1/agentbook-expense/reconciliation-summary', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const [total, matched, exceptions, pending] = await Promise.all([
      db.abBankTransaction.count({ where: { tenantId } }),
      db.abBankTransaction.count({ where: { tenantId, matchStatus: 'matched' } }),
      db.abBankTransaction.count({ where: { tenantId, matchStatus: 'exception' } }),
      db.abBankTransaction.count({ where: { tenantId, matchStatus: 'pending' } }),
    ]);

    res.json({ success: true, data: { totalTransactions: total, matched, exceptions, pending, matchRate: total > 0 ? matched / total : 0 } });
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

        // Download image and convert to base64 for Gemini Vision
        // Cap at 4MB (Gemini inline limit). For larger images, resize would be needed.
        let imageParts: any[] = [];
        try {
          const imgRes = await fetch(imageUrl);
          if (imgRes.ok) {
            const imgBuffer = await imgRes.arrayBuffer();
            const sizeKB = imgBuffer.byteLength / 1024;
            const base64 = Buffer.from(imgBuffer).toString('base64');
            const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
            if (sizeKB < 4096) { // Under 4MB — send directly
              imageParts = [{ inlineData: { mimeType, data: base64 } }];
            } else {
              console.warn(`Receipt image too large (${Math.round(sizeKB)}KB), using URL fallback`);
              imageParts = [{ text: `[Image too large for inline. URL: ${imageUrl}]` }];
            }
          }
        } catch (imgErr) {
          console.warn('Image download failed:', imgErr);
          // Fall back to asking Gemini to fetch the URL (less reliable)
          imageParts = [{ text: `Please analyze the receipt image at this URL: ${imageUrl}` }];
        }

        const systemPrompt = `You are an expert receipt and document scanner. Extract data from the receipt image.

INSTRUCTIONS:
- Look carefully at the TOTAL or AMOUNT DUE — this is the most important field
- The total is usually the largest number, often at the bottom, sometimes after "Total", "Amount Due", "Balance", or "Grand Total"
- Vendor/store name is usually at the top of the receipt
- Date may be in various formats (MM/DD/YYYY, YYYY-MM-DD, DD/MM/YYYY, Mon DD YYYY)
- If the image is blurry or unclear, extract what you CAN see and set confidence lower
- amount_cents is the total in CENTS (e.g., $45.99 = 4599, $132.99 = 13299)
- If you see tax/tip lines, use the GRAND TOTAL (after tax and tip)
- If you can't read the amount at all, set amount_cents to 0 and confidence to 0

Return ONLY valid JSON: {"amount_cents": <integer>, "vendor": "<string or null>", "date": "<YYYY-MM-DD>", "currency": "USD or CAD", "items": "<brief description of items if visible>", "tax_cents": <integer or 0>, "tip_cents": <integer or 0>, "confidence": <0.0-1.0>}`;

        const llmRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [
              ...imageParts,
              { text: 'Extract the receipt data from this image. Focus on the total amount, vendor name, and date.' },
            ] }],
            generationConfig: { maxOutputTokens: 4096, temperature: 0.1 },
          }),
        });

        if (llmRes.ok) {
          const llmData = await llmRes.json();
          const text = llmData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
          try {
            const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const parsed = JSON.parse(cleaned);
            ocrResult = {
              amount_cents: parsed.amount_cents || 0,
              vendor: parsed.vendor || null,
              date: parsed.date || new Date().toISOString().split('T')[0],
              currency: parsed.currency || 'USD',
              items: parsed.items || null,
              tax_cents: parsed.tax_cents || 0,
              tip_cents: parsed.tip_cents || 0,
              confidence: parsed.confidence || 0,
              status: 'processed_by_gemini',
              model,
            };
          } catch (parseErr) {
            // Try to extract from non-standard response (Gemini sometimes wraps in extra structure)
            try {
              const jsonMatch = text.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                ocrResult = {
                  amount_cents: parsed.amount_cents || 0,
                  vendor: parsed.vendor || null,
                  date: parsed.date || new Date().toISOString().split('T')[0],
                  currency: parsed.currency || 'USD',
                  items: parsed.items || null,
                  tax_cents: parsed.tax_cents || 0,
                  tip_cents: parsed.tip_cents || 0,
                  confidence: parsed.confidence || 0,
                  status: 'processed_by_gemini',
                  model,
                };
              } else {
                ocrResult.status = 'gemini_parse_error';
                console.warn('Gemini OCR parse error, raw text:', text.slice(0, 300));
              }
            } catch {
              ocrResult.status = 'gemini_parse_error';
              console.warn('Gemini OCR parse error (fallback), raw text:', text.slice(0, 300));
            }
          }
        } else {
          const errBody = await llmRes.text().catch(() => '');
          console.warn('Gemini OCR HTTP error:', llmRes.status, errBody.slice(0, 500));
          // Retry with gemini-2.0-flash (no thinking mode) if primary model fails
          if (model !== 'gemini-2.0-flash') {
            try {
              const retryUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${llmConfig.apiKey}`;
              const retryRes = await fetch(retryUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  systemInstruction: { parts: [{ text: systemPrompt }] },
                  contents: [{ role: 'user', parts: [...imageParts, { text: 'Extract the receipt data from this image.' }] }],
                  generationConfig: { maxOutputTokens: 1024, temperature: 0.1 },
                }),
              });
              if (retryRes.ok) {
                const retryData = await retryRes.json();
                const retryText = retryData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
                const jsonMatch = retryText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                  const parsed = JSON.parse(jsonMatch[0]);
                  ocrResult = { ...parsed, status: 'processed_by_gemini', model: 'gemini-2.0-flash' };
                }
              }
            } catch { /* retry failed too */ }
          }
          if (ocrResult.status !== 'processed_by_gemini') ocrResult.status = 'gemini_http_error';
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

// ============================================
// SPLIT TRANSACTIONS (A6 — Competitive Gap)
// ============================================

// POST /expenses/:id/split — Split expense into business/personal portions
app.post('/api/v1/agentbook-expense/expenses/:id/split', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { splits } = req.body;

    if (!splits || !Array.isArray(splits) || splits.length < 2) {
      return res.status(400).json({ success: false, error: 'At least 2 splits are required' });
    }

    const expense = await db.abExpense.findFirst({ where: { id: req.params.id, tenantId } });
    if (!expense) return res.status(404).json({ success: false, error: 'Expense not found' });

    // Validate splits sum to original amount
    const totalSplit = splits.reduce((s: number, sp: any) => s + (sp.amountCents || 0), 0);
    if (totalSplit !== expense.amountCents) {
      return res.status(422).json({
        success: false,
        error: `Split amounts (${totalSplit}) must equal expense amount (${expense.amountCents})`,
      });
    }

    // Create split records
    const splitRecords = await db.$transaction(async (tx: any) => {
      // Delete existing splits if re-splitting
      await tx.abExpenseSplit.deleteMany({ where: { expenseId: expense.id } });

      const records = [];
      for (const sp of splits) {
        const record = await tx.abExpenseSplit.create({
          data: {
            expenseId: expense.id,
            categoryId: sp.categoryId || expense.categoryId,
            amountCents: sp.amountCents,
            isPersonal: sp.isPersonal || false,
            description: sp.description || null,
          },
        });
        records.push(record);
      }

      // Update the original expense: mark the personal amount
      const personalAmount = splits.filter((s: any) => s.isPersonal).reduce((sum: number, s: any) => sum + s.amountCents, 0);
      await tx.abExpense.update({
        where: { id: expense.id },
        data: { isPersonal: personalAmount > expense.amountCents / 2 },
      });

      await tx.abEvent.create({
        data: {
          tenantId, eventType: 'expense.split', actor: 'user',
          action: { expenseId: expense.id, splitCount: splits.length, personalAmount, businessAmount: expense.amountCents - personalAmount },
        },
      });

      return records;
    });

    res.json({ success: true, data: { expenseId: expense.id, splits: splitRecords } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// GET /expenses/:id/splits — Get splits for an expense
app.get('/api/v1/agentbook-expense/expenses/:id/splits', async (req, res) => {
  try {
    const splits = await db.abExpenseSplit.findMany({
      where: { expenseId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: splits });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ============================================
// RECURRING EXPENSE AUTO-SUGGEST (A5 — Competitive Gap)
// ============================================

// GET /expenses/recurring-suggestions — Detect expenses that could be recurring
app.get('/api/v1/agentbook-expense/recurring-suggestions', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;

    // Find vendors with 3+ expenses at similar amounts in the last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const expenses = await db.abExpense.findMany({
      where: { tenantId, vendorId: { not: null }, date: { gte: sixMonthsAgo }, isPersonal: false },
      orderBy: { date: 'asc' },
    });

    // Group by vendor
    const byVendor: Record<string, any[]> = {};
    for (const e of expenses) {
      if (!e.vendorId) continue;
      if (!byVendor[e.vendorId]) byVendor[e.vendorId] = [];
      byVendor[e.vendorId].push(e);
    }

    // Check existing recurring rules
    const existingRules = await db.abRecurringRule.findMany({
      where: { tenantId, active: true },
    });
    const existingVendorIds = new Set(existingRules.map((r: any) => r.vendorId));

    const suggestions: any[] = [];

    for (const [vendorId, vendorExpenses] of Object.entries(byVendor)) {
      if (vendorExpenses.length < 3) continue;
      if (existingVendorIds.has(vendorId)) continue;  // Already has a rule

      // Check if amounts are similar (within 20%)
      const amounts = vendorExpenses.map((e: any) => e.amountCents);
      const avgAmount = Math.round(amounts.reduce((a: number, b: number) => a + b, 0) / amounts.length);
      const allSimilar = amounts.every((a: number) => Math.abs(a - avgAmount) / avgAmount < 0.2);
      if (!allSimilar) continue;

      // Detect frequency from date intervals
      const dates = vendorExpenses.map((e: any) => new Date(e.date).getTime()).sort();
      const intervals = [];
      for (let i = 1; i < dates.length; i++) {
        intervals.push((dates[i] - dates[i - 1]) / 86400000);  // days
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

      let frequency = 'monthly';
      if (avgInterval < 10) frequency = 'weekly';
      else if (avgInterval < 21) frequency = 'biweekly';
      else if (avgInterval > 80) frequency = 'quarterly';
      else if (avgInterval > 300) frequency = 'annual';

      // Get vendor name
      const vendor = await db.abVendor.findFirst({ where: { id: vendorId } });

      suggestions.push({
        vendorId,
        vendorName: vendor?.name || 'Unknown',
        avgAmountCents: avgAmount,
        frequency,
        occurrences: vendorExpenses.length,
        avgIntervalDays: Math.round(avgInterval),
        lastExpenseDate: vendorExpenses[vendorExpenses.length - 1].date,
        categoryId: vendorExpenses[0].categoryId,
      });
    }

    // Sort by occurrences (most frequent first)
    suggestions.sort((a, b) => b.occurrences - a.occurrences);

    res.json({ success: true, data: suggestions });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// POST /expenses/recurring-suggestions/:vendorId/accept — Accept suggestion, create rule
app.post('/api/v1/agentbook-expense/recurring-suggestions/:vendorId/accept', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { amountCents, frequency } = req.body;

    const vendor = await db.abVendor.findFirst({ where: { id: req.params.vendorId, tenantId } });
    if (!vendor) return res.status(404).json({ success: false, error: 'Vendor not found' });

    // Calculate next expected date based on frequency
    const nextExpected = new Date();
    switch (frequency) {
      case 'weekly': nextExpected.setDate(nextExpected.getDate() + 7); break;
      case 'biweekly': nextExpected.setDate(nextExpected.getDate() + 14); break;
      case 'monthly': nextExpected.setMonth(nextExpected.getMonth() + 1); break;
      case 'quarterly': nextExpected.setMonth(nextExpected.getMonth() + 3); break;
      case 'annual': nextExpected.setFullYear(nextExpected.getFullYear() + 1); break;
    }

    const rule = await db.abRecurringRule.create({
      data: { tenantId, vendorId: req.params.vendorId, amountCents, frequency, nextExpected },
    });

    await db.abEvent.create({
      data: {
        tenantId, eventType: 'recurring_rule.created_from_suggestion', actor: 'user',
        action: { ruleId: rule.id, vendorId: req.params.vendorId, vendorName: vendor.name, amountCents, frequency },
      },
    });

    res.status(201).json({ success: true, data: rule });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ============================================
// CSV DATA IMPORT (E6 — Competitive Gap)
// ============================================

function parseCSV(csvText: string): Array<Record<string, string>> {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  // Parse header
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
    rows.push(row);
  }
  return rows;
}

function detectCSVMapping(headers: string[]): { date: string; amount: string; description: string; vendor?: string; category?: string } {
  const lowerHeaders = headers.map(h => h.toLowerCase());

  const dateCol = lowerHeaders.find(h => ['date', 'transaction date', 'trans date', 'posted date'].includes(h)) || lowerHeaders[0];
  const amountCol = lowerHeaders.find(h => ['amount', 'debit', 'transaction amount', 'total'].includes(h)) || lowerHeaders.find(h => h.includes('amount')) || lowerHeaders[1];
  const descCol = lowerHeaders.find(h => ['description', 'memo', 'transaction description', 'details', 'name'].includes(h)) || lowerHeaders.find(h => h.includes('desc')) || lowerHeaders[2];
  const vendorCol = lowerHeaders.find(h => ['vendor', 'merchant', 'payee', 'merchant name'].includes(h));
  const categoryCol = lowerHeaders.find(h => ['category', 'type', 'expense type'].includes(h));

  return { date: dateCol, amount: amountCol, description: descCol, vendor: vendorCol, category: categoryCol };
}

// POST /import/csv — Import expenses from CSV
app.post('/api/v1/agentbook-expense/import/csv', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { csv, mapping } = req.body;

    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ success: false, error: 'csv field (string) is required' });
    }

    const rows = parseCSV(csv);
    if (rows.length === 0) {
      return res.status(400).json({ success: false, error: 'CSV has no data rows' });
    }

    // Auto-detect or use provided mapping
    const headers = Object.keys(rows[0]);
    const colMapping = mapping || detectCSVMapping(headers);

    const imported: any[] = [];
    const errors: any[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const rawAmount = row[colMapping.amount] || '0';
        const amountFloat = Math.abs(parseFloat(rawAmount.replace(/[^0-9.-]/g, '')));
        if (isNaN(amountFloat) || amountFloat === 0) {
          errors.push({ row: i + 2, error: 'Invalid amount', raw: rawAmount });
          continue;
        }

        const amountCents = Math.round(amountFloat * 100);
        const dateStr = row[colMapping.date];
        const date = dateStr ? new Date(dateStr) : new Date();
        if (isNaN(date.getTime())) {
          errors.push({ row: i + 2, error: 'Invalid date', raw: dateStr });
          continue;
        }

        const description = row[colMapping.description] || `CSV import row ${i + 2}`;
        const vendorName = colMapping.vendor ? row[colMapping.vendor] : undefined;

        // Upsert vendor if provided
        let vendorId: string | undefined;
        if (vendorName) {
          const normalized = vendorName.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
          if (normalized) {
            const vendor = await db.abVendor.upsert({
              where: { tenantId_normalizedName: { tenantId, normalizedName: normalized } },
              update: { lastSeen: new Date(), transactionCount: { increment: 1 } },
              create: { tenantId, name: vendorName, normalizedName: normalized },
            });
            vendorId = vendor.id;
          }
        }

        const expense = await db.abExpense.create({
          data: {
            tenantId, amountCents, date, description,
            vendorId: vendorId || null,
            confidence: 0.6,  // imported data — medium confidence
          },
        });

        imported.push({ row: i + 2, expenseId: expense.id, amountCents, description });
      } catch (err) {
        errors.push({ row: i + 2, error: String(err) });
      }
    }

    await db.abEvent.create({
      data: {
        tenantId, eventType: 'expense.csv_imported', actor: 'user',
        action: { totalRows: rows.length, imported: imported.length, errors: errors.length },
      },
    });

    res.json({
      success: true,
      data: {
        totalRows: rows.length,
        imported: imported.length,
        errors: errors.length,
        importedExpenses: imported,
        importErrors: errors.slice(0, 20),  // cap error list
      },
    });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// GET /import/csv/preview — Preview CSV mapping before importing
app.post('/api/v1/agentbook-expense/import/csv/preview', async (req, res) => {
  try {
    const { csv } = req.body;
    if (!csv) return res.status(400).json({ success: false, error: 'csv field is required' });

    const rows = parseCSV(csv);
    if (rows.length === 0) return res.status(400).json({ success: false, error: 'No data rows' });

    const headers = Object.keys(rows[0]);
    const mapping = detectCSVMapping(headers);

    // Preview first 5 rows
    const preview = rows.slice(0, 5).map((row, i) => ({
      row: i + 2,
      date: row[mapping.date],
      amount: row[mapping.amount],
      description: row[mapping.description],
      vendor: mapping.vendor ? row[mapping.vendor] : undefined,
      category: mapping.category ? row[mapping.category] : undefined,
    }));

    res.json({ success: true, data: { headers, mapping, totalRows: rows.length, preview } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ============================================================
// === Endpoint: GET /advisor/insights — Proactive AI Insights ===
// ============================================================
app.get('/api/v1/agentbook-expense/advisor/insights', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const now = new Date();
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(now.getFullYear(), 0, 1);
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : now;
    const periodMs = endDate.getTime() - startDate.getTime();
    const prevStart = new Date(startDate.getTime() - periodMs);
    const prevEnd = new Date(startDate.getTime());

    const insights: any[] = [];
    let insightIdx = 0;

    // Fetch current and previous period expenses
    const [currentExpenses, prevExpenses] = await Promise.all([
      db.abExpense.findMany({ where: { tenantId, date: { gte: startDate, lte: endDate } } }),
      db.abExpense.findMany({ where: { tenantId, date: { gte: prevStart, lt: prevEnd } } }),
    ]);

    // Collect all categoryIds for name resolution
    const allCatIds = new Set<string>();
    [...currentExpenses, ...prevExpenses].forEach((e: any) => { if (e.categoryId) allCatIds.add(e.categoryId); });
    const catAccounts = allCatIds.size > 0
      ? await db.abAccount.findMany({ where: { id: { in: Array.from(allCatIds) } }, select: { id: true, name: true } })
      : [];
    const catNameMap: Record<string, string> = {};
    catAccounts.forEach((a: any) => { catNameMap[a.id] = a.name; });

    // 1. Spending spikes — compare category totals between periods
    const groupBy = (list: any[]) => {
      const m: Record<string, number> = {};
      list.forEach((e: any) => { if (e.categoryId) m[e.categoryId] = (m[e.categoryId] || 0) + e.amountCents; });
      return m;
    };
    const curByCat = groupBy(currentExpenses);
    const prevByCat = groupBy(prevExpenses);
    for (const catId of Object.keys(curByCat)) {
      const cur = curByCat[catId];
      const prev = prevByCat[catId] || 0;
      if (prev > 0) {
        const pct = ((cur - prev) / prev) * 100;
        if (pct > 20) {
          const severity = pct > 50 ? 'critical' : 'warning';
          const catName = catNameMap[catId] || catId;
          insights.push({
            id: `insight-${++insightIdx}`,
            type: 'spending_spike',
            severity,
            title: `Spending spike in ${catName}`,
            message: `${catName} spending increased ${Math.round(pct)}% from ${formatCents(prev)} to ${formatCents(cur)}.`,
            data: { categoryId: catId, categoryName: catName, currentAmount: cur, previousAmount: prev, changePercent: Math.round(pct) },
          });
        }
      }
    }

    // 2. Anomalies — expenses > 3x 90-day rolling average for category
    const ninetyDaysAgo = new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000);
    const rollingExpenses = await db.abExpense.findMany({
      where: { tenantId, date: { gte: ninetyDaysAgo, lte: endDate } },
    });
    const catAvg: Record<string, { total: number; count: number }> = {};
    rollingExpenses.forEach((e: any) => {
      if (e.categoryId) {
        if (!catAvg[e.categoryId]) catAvg[e.categoryId] = { total: 0, count: 0 };
        catAvg[e.categoryId].total += e.amountCents;
        catAvg[e.categoryId].count += 1;
      }
    });
    for (const exp of currentExpenses) {
      const e = exp as any;
      if (e.categoryId && catAvg[e.categoryId] && catAvg[e.categoryId].count >= 2) {
        const avg = catAvg[e.categoryId].total / catAvg[e.categoryId].count;
        if (e.amountCents > avg * 3) {
          const catName = catNameMap[e.categoryId] || e.categoryId;
          insights.push({
            id: `insight-${++insightIdx}`,
            type: 'anomaly',
            severity: 'warning',
            title: `Unusual expense in ${catName}`,
            message: `${formatCents(e.amountCents)} is ${Math.round(e.amountCents / avg)}x the 90-day average of ${formatCents(Math.round(avg))} for ${catName}.`,
            data: { expenseId: e.id, amount: e.amountCents, average: Math.round(avg), categoryName: catName },
          });
        }
      }
    }

    // 3. Duplicates — same vendor, amount within 5%, date within 3 days
    const sorted = [...currentExpenses].sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const seenDups = new Set<string>();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i] as any;
        const b = sorted[j] as any;
        if (!a.vendorId || a.vendorId !== b.vendorId) continue;
        const dayDiff = Math.abs(new Date(a.date).getTime() - new Date(b.date).getTime()) / (1000 * 60 * 60 * 24);
        if (dayDiff > 3) break; // sorted by date, no need to check further
        const amtDiff = Math.abs(a.amountCents - b.amountCents) / Math.max(a.amountCents, b.amountCents);
        if (amtDiff <= 0.05) {
          const key = [a.id, b.id].sort().join('-');
          if (!seenDups.has(key)) {
            seenDups.add(key);
            insights.push({
              id: `insight-${++insightIdx}`,
              type: 'duplicate',
              severity: 'warning',
              title: 'Potential duplicate expense',
              message: `Two charges of ${formatCents(a.amountCents)} and ${formatCents(b.amountCents)} to the same vendor within ${Math.round(dayDiff)} day(s).`,
              data: { expenseIds: [a.id, b.id], amounts: [a.amountCents, b.amountCents] },
            });
          }
        }
      }
    }

    // 4. Missing receipts — business expenses > $25 without receiptUrl
    const missingReceipts = currentExpenses.filter((e: any) => !e.isPersonal && e.amountCents > 2500 && !e.receiptUrl);
    if (missingReceipts.length > 0) {
      insights.push({
        id: `insight-${++insightIdx}`,
        type: 'missing_receipts',
        severity: 'info',
        title: `${missingReceipts.length} expense(s) missing receipts`,
        message: `${missingReceipts.length} business expense(s) over $25 are missing receipt documentation.`,
        data: { count: missingReceipts.length, expenseIds: missingReceipts.map((e: any) => e.id) },
      });
    }

    // 5. Uncategorized expenses
    const uncategorized = currentExpenses.filter((e: any) => !e.categoryId);
    if (uncategorized.length > 0) {
      insights.push({
        id: `insight-${++insightIdx}`,
        type: 'uncategorized',
        severity: 'info',
        title: `${uncategorized.length} uncategorized expense(s)`,
        message: `${uncategorized.length} expense(s) need category assignment for accurate reporting.`,
        data: { count: uncategorized.length, expenseIds: uncategorized.map((e: any) => e.id) },
      });
    }

    // 6. Savings opportunities — recurring vendor charges (last 6 months)
    const sixMonthsAgo = new Date(endDate.getTime() - 180 * 24 * 60 * 60 * 1000);
    const recentExpenses = await db.abExpense.findMany({
      where: { tenantId, date: { gte: sixMonthsAgo, lte: endDate }, vendorId: { not: null } },
      include: { vendor: true },
    });
    const byVendor: Record<string, { amounts: number[]; vendorName: string }> = {};
    recentExpenses.forEach((e: any) => {
      if (e.vendorId) {
        if (!byVendor[e.vendorId]) byVendor[e.vendorId] = { amounts: [], vendorName: e.vendor?.name || e.vendorId };
        byVendor[e.vendorId].amounts.push(e.amountCents);
      }
    });
    for (const [vendorId, info] of Object.entries(byVendor)) {
      if (info.amounts.length >= 3) {
        const avg = info.amounts.reduce((s, a) => s + a, 0) / info.amounts.length;
        const maxVariance = Math.max(...info.amounts.map(a => Math.abs(a - avg) / avg));
        if (maxVariance <= 0.10) {
          const totalAnnual = avg * 12;
          insights.push({
            id: `insight-${++insightIdx}`,
            type: 'savings',
            severity: 'info',
            title: `Savings opportunity with ${info.vendorName}`,
            message: `${info.amounts.length} recurring charges averaging ${formatCents(Math.round(avg))}. Consider an annual plan to save.`,
            data: { vendorId, vendorName: info.vendorName, chargeCount: info.amounts.length, averageAmount: Math.round(avg), estimatedAnnual: Math.round(totalAnnual) },
            action: { label: 'Review vendor', type: 'navigate', target: `/expenses?vendor=${vendorId}` },
          });
        }
      }
    }

    res.json({ success: true, data: { insights } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ============================================================
// === Endpoint: GET /advisor/chart — Chart Data for Visualization ===
// ============================================================
app.get('/api/v1/agentbook-expense/advisor/chart', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const now = new Date();
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(now.getFullYear(), 0, 1);
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : now;
    const chartType = (req.query.chartType as string) || 'bar';
    const colors = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899', '#ef4444', '#84cc16'];

    const expenses = await db.abExpense.findMany({
      where: { tenantId, date: { gte: startDate, lte: endDate } },
    });

    // Fetch comparison period expenses if provided
    let compExpenses: any[] = [];
    if (req.query.compareStartDate && req.query.compareEndDate) {
      compExpenses = await db.abExpense.findMany({
        where: {
          tenantId,
          date: { gte: new Date(req.query.compareStartDate as string), lte: new Date(req.query.compareEndDate as string) },
        },
      });
    }

    // Resolve category names
    const allCatIds = new Set<string>();
    [...expenses, ...compExpenses].forEach((e: any) => { if (e.categoryId) allCatIds.add(e.categoryId); });
    const catAccounts = allCatIds.size > 0
      ? await db.abAccount.findMany({ where: { id: { in: Array.from(allCatIds) } }, select: { id: true, name: true } })
      : [];
    const catNameMap: Record<string, string> = {};
    catAccounts.forEach((a: any) => { catNameMap[a.id] = a.name; });

    let data: any[] = [];
    let title = '';
    let subtitle = '';

    if (chartType === 'trend') {
      // Group by month
      const monthMap: Record<string, number> = {};
      expenses.forEach((e: any) => {
        const d = new Date(e.date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthMap[key] = (monthMap[key] || 0) + e.amountCents;
      });
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      data = Object.entries(monthMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value], i) => {
          const month = parseInt(key.split('-')[1]) - 1;
          return { name: monthNames[month], value, color: colors[i % colors.length] };
        });
      title = 'Monthly Spending Trend';
      subtitle = `${startDate.toLocaleDateString()} — ${endDate.toLocaleDateString()}`;
    } else {
      // bar or pie — group by category
      const catTotals: Record<string, number> = {};
      expenses.forEach((e: any) => {
        const cat = e.categoryId || 'uncategorized';
        catTotals[cat] = (catTotals[cat] || 0) + e.amountCents;
      });
      const compCatTotals: Record<string, number> = {};
      compExpenses.forEach((e: any) => {
        const cat = e.categoryId || 'uncategorized';
        compCatTotals[cat] = (compCatTotals[cat] || 0) + e.amountCents;
      });

      data = Object.entries(catTotals)
        .sort(([, a], [, b]) => b - a)
        .map(([catId, value], i) => {
          const name = catId === 'uncategorized' ? 'Uncategorized' : (catNameMap[catId] || catId);
          const entry: any = { name, value, color: colors[i % colors.length] };
          if (compExpenses.length > 0) {
            const prev = compCatTotals[catId] || 0;
            entry.previousValue = prev;
            entry.changePercent = prev > 0 ? Math.round(((value - prev) / prev) * 100) : null;
          }
          return entry;
        });
      title = chartType === 'pie' ? 'Expense Breakdown' : 'Expenses by Category';
      subtitle = `${startDate.toLocaleDateString()} — ${endDate.toLocaleDateString()}`;
    }

    // Generate annotation via LLM with fallback
    let annotation = '';
    if (data.length > 0) {
      const biggest = data.reduce((max, d) => d.value > max.value ? d : max, data[0]);
      const totalValue = data.reduce((s, d) => s + d.value, 0);
      const prompt = `Given expense chart data: ${JSON.stringify(data.map(d => ({ name: d.name, amount: formatCents(d.value) })))}. Total: ${formatCents(totalValue)}. Provide a single-sentence insight.`;
      const llmAnnotation = await callGemini(
        'You are a concise financial analyst. Respond with exactly one sentence of insight about the spending data.',
        prompt,
        150
      );
      annotation = llmAnnotation || `${biggest.name} is your largest expense at ${formatCents(biggest.value)}.`;
    }

    res.json({ success: true, data: { chartType, title, subtitle, data, annotation } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ============================================================
// === Endpoint: POST /advisor/ask — Natural Language Q&A ===
// ============================================================
app.post('/api/v1/agentbook-expense/advisor/ask', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { question, period } = req.body;
    if (!question) return res.status(400).json({ success: false, error: 'question is required' });

    const now = new Date();
    const startDate = period?.start ? new Date(period.start) : new Date(now.getFullYear(), 0, 1);
    const endDate = period?.end ? new Date(period.end) : now;

    // Fetch expenses with vendor relation
    const expenses = await db.abExpense.findMany({
      where: { tenantId, date: { gte: startDate, lte: endDate } },
      include: { vendor: true },
    });

    // Resolve category names
    const allCatIds = new Set<string>();
    expenses.forEach((e: any) => { if (e.categoryId) allCatIds.add(e.categoryId); });
    const catAccounts = allCatIds.size > 0
      ? await db.abAccount.findMany({ where: { id: { in: Array.from(allCatIds) } }, select: { id: true, name: true } })
      : [];
    const catNameMap: Record<string, string> = {};
    catAccounts.forEach((a: any) => { catNameMap[a.id] = a.name; });

    // Aggregate data
    const total = expenses.reduce((s: number, e: any) => s + e.amountCents, 0);
    const byCatRaw: Record<string, number> = {};
    expenses.forEach((e: any) => {
      const catName = e.categoryId ? (catNameMap[e.categoryId] || e.categoryId) : 'Uncategorized';
      byCatRaw[catName] = (byCatRaw[catName] || 0) + e.amountCents;
    });
    const byCat = Object.entries(byCatRaw).sort(([, a], [, b]) => b - a).slice(0, 8);

    const byVendorRaw: Record<string, number> = {};
    expenses.forEach((e: any) => {
      const vName = (e.vendor as any)?.name || 'Unknown';
      byVendorRaw[vName] = (byVendorRaw[vName] || 0) + e.amountCents;
    });
    const byVendor = Object.entries(byVendorRaw).sort(([, a], [, b]) => b - a).slice(0, 10);

    // Recent individual expenses (for "show me last N" type questions)
    const recentExpenses = [...expenses]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 20)
      .map((e: any) => {
        const vName = e.vendor?.name || 'Unknown';
        const catName = e.categoryId ? (catNameMap[e.categoryId] || 'Uncategorized') : 'Uncategorized';
        return `${new Date(e.date).toLocaleDateString()} | ${vName} | ${formatCents(e.amountCents)} | ${catName} | ${e.description || ''}${e.isPersonal ? ' [personal]' : ''}`;
      });

    // Build context string
    const contextStr = [
      `Period: ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`,
      `Total expenses: ${formatCents(total)} (${expenses.length} transactions)`,
      `Top categories: ${byCat.map(([n, v]) => `${n}: ${formatCents(v)}`).join(', ')}`,
      `Top vendors: ${byVendor.map(([n, v]) => `${n}: ${formatCents(v)}`).join(', ')}`,
      `\nRecent expenses (newest first):`,
      `Date | Vendor | Amount | Category | Description`,
      ...recentExpenses,
    ].join('\n');

    let answer = '';
    let chartData: any = null;
    let actions: any[] = [];

    // Try LLM
    const systemPrompt = `You are AgentBook Expense Advisor — a friendly, concise financial expert.
You have access to the user's complete expense data including individual transactions, category totals, and vendor breakdowns.
When asked to list or show expenses, use the "Recent expenses" data provided. When asked about totals or comparisons, use the aggregated data.
Always include specific dollar amounts. Be helpful and direct.
Respond in JSON format: { "answer": "your detailed answer as a string (use \\n for line breaks)", "chartData": { "type": "bar"|"pie"|"trend", "data": [{ "name": "string", "value": number_in_cents }] } | null, "suggestedActions": [{ "label": "string", "type": "suggestion" }] | [] }
Only include chartData if the question would benefit from visualization.`;

    const userMsg = `Context:\n${contextStr}\n\nQuestion: ${question}`;
    const llmResponse = await callGemini(systemPrompt, userMsg, 800);

    if (llmResponse) {
      try {
        // Try to extract JSON from the response (handle markdown code blocks)
        const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          answer = parsed.answer || llmResponse;
          chartData = parsed.chartData || null;
          actions = (parsed.suggestedActions || []).map((a: any) => ({ label: a.label, type: a.type || 'suggestion' }));
        } else {
          answer = llmResponse;
        }
      } catch {
        answer = llmResponse;
      }
    }

    // Template fallback if no LLM answer
    if (!answer) {
      const q = question.toLowerCase();
      const recentForFallback = [...expenses]
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      if (q.match(/show|list|last|recent|latest/)) {
        // Extract number (e.g., "last 5") or default to 5
        const numMatch = q.match(/(\d+)/);
        const count = numMatch ? Math.min(parseInt(numMatch[1]), 20) : 5;
        const items = recentForFallback.slice(0, count);
        answer = `Here are your last ${items.length} expenses:\n\n${items.map((e: any) => {
          const vName = e.vendor?.name || 'Unknown';
          const catName = e.categoryId ? (catNameMap[e.categoryId] || '') : '';
          return `• ${new Date(e.date).toLocaleDateString()} — **${vName}** — ${formatCents(e.amountCents)}${catName ? ` (${catName})` : ''}`;
        }).join('\n')}`;
      } else if (q.includes('travel')) {
        const travelCats = byCat.filter(([n]) => n.toLowerCase().includes('travel'));
        if (travelCats.length > 0) {
          const travelExpenses = recentForFallback.filter((e: any) => {
            const cn = e.categoryId ? catNameMap[e.categoryId] : '';
            return cn?.toLowerCase().includes('travel');
          });
          answer = `Your travel expenses total ${formatCents(travelCats.reduce((s, [, v]) => s + v, 0))} (${travelExpenses.length} transactions).\n\n${travelExpenses.slice(0, 10).map((e: any) => `• ${new Date(e.date).toLocaleDateString()} — ${e.vendor?.name || 'Unknown'} — ${formatCents(e.amountCents)}`).join('\n')}`;
        } else {
          answer = `No travel expenses found in this period. Total spending: ${formatCents(total)}.`;
        }
      } else if (q.match(/top|most|biggest|largest|highest/)) {
        answer = `Your top expense categories:\n\n${byCat.slice(0, 5).map(([n, v]) => `• **${n}** — ${formatCents(v)}`).join('\n')}\n\nTotal: ${formatCents(total)}`;
        chartData = { type: 'bar' as const, data: byCat.slice(0, 5).map(([name, value]) => ({ name, value })) };
      } else if (q.match(/summary|overview|breakdown/)) {
        answer = `Expense summary (${expenses.length} transactions, ${formatCents(total)} total):\n\n**By category:**\n${byCat.map(([n, v]) => `• ${n}: ${formatCents(v)}`).join('\n')}\n\n**Top vendors:**\n${byVendor.slice(0, 5).map(([n, v]) => `• ${n}: ${formatCents(v)}`).join('\n')}`;
        chartData = { type: 'bar' as const, data: byCat.map(([name, value]) => ({ name, value })) };
      } else if (q.match(/duplicate|double/)) {
        const sorted = [...recentForFallback].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const dups: string[] = [];
        for (let i = 0; i < sorted.length && dups.length < 5; i++) {
          for (let j = i + 1; j < sorted.length; j++) {
            const a = sorted[i], b = sorted[j];
            if (Math.abs(new Date(b.date).getTime() - new Date(a.date).getTime()) > 3 * 86400000) break;
            if (a.vendorId && a.vendorId === b.vendorId && Math.abs(a.amountCents - b.amountCents) / a.amountCents < 0.05) {
              dups.push(`• ${(a as any).vendor?.name || 'Unknown'}: ${formatCents(a.amountCents)} on ${new Date(a.date).toLocaleDateString()} and ${formatCents(b.amountCents)} on ${new Date(b.date).toLocaleDateString()}`);
            }
          }
        }
        answer = dups.length > 0 ? `Found ${dups.length} potential duplicate(s):\n\n${dups.join('\n')}` : 'No duplicate expenses detected.';
      } else {
        answer = `You have ${expenses.length} expenses totaling ${formatCents(total)}.\n\nTop category: ${byCat[0] ? `**${byCat[0][0]}** at ${formatCents(byCat[0][1])}` : 'N/A'}.\nTop vendor: ${byVendor[0] ? `**${byVendor[0][0]}** at ${formatCents(byVendor[0][1])}` : 'N/A'}.`;
      }
      actions = [{ label: 'Show breakdown', type: 'suggestion' }, { label: 'Any duplicates?', type: 'suggestion' }];
    }

    // Log to AbEvent
    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'advisor.question',
        actor: 'user',
        action: { question, answerLength: answer.length, hasChart: !!chartData } as any,
      },
    });

    res.json({
      success: true,
      data: {
        answer,
        chartData,
        actions,
        sources: ['expenses', 'categories', 'vendors'],
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ============================================
// EXPENSE REVIEW QUEUE (Gap 6)
// ============================================

// GET /review-queue — list expenses needing review
app.get('/api/v1/agentbook-expense/review-queue', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const expenses = await db.abExpense.findMany({
      where: { tenantId, status: 'pending_review' },
      include: { vendor: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const catIds = [...new Set(expenses.map((e: any) => e.categoryId).filter(Boolean))];
    const categories = catIds.length > 0 ? await db.abAccount.findMany({ where: { id: { in: catIds } } }) : [];
    const catMap = Object.fromEntries(categories.map((c: any) => [c.id, c.name]));

    const enriched = expenses.map((e: any) => ({
      ...e, vendorName: e.vendor?.name || null, categoryName: e.categoryId ? catMap[e.categoryId] || null : null,
    }));

    res.json({ success: true, data: enriched });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// POST /expenses/:id/confirm — confirm a pending expense, create journal entry
app.post('/api/v1/agentbook-expense/expenses/:id/confirm', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const expense = await db.abExpense.findFirst({ where: { id: req.params.id, tenantId } });
    if (!expense) return res.status(404).json({ success: false, error: 'Expense not found' });
    if (expense.status === 'confirmed') return res.json({ success: true, data: expense, message: 'Already confirmed' });

    // Allow updating fields during confirmation
    const { amountCents, categoryId, description, vendorName } = req.body || {};

    let journalEntryId = expense.journalEntryId;
    const finalCategoryId = categoryId || expense.categoryId;
    const finalAmount = amountCents || expense.amountCents;

    // Create journal entry if not exists and category is set
    if (!journalEntryId && finalCategoryId && !expense.isPersonal) {
      const cashAccount = await db.abAccount.findFirst({ where: { tenantId, code: '1000' } });
      if (cashAccount) {
        const je = await db.abJournalEntry.create({
          data: {
            tenantId, date: expense.date,
            memo: `Expense: ${description || expense.description || 'Confirmed expense'}`,
            sourceType: 'expense', sourceId: expense.id, verified: true,
            lines: {
              create: [
                { accountId: finalCategoryId, debitCents: finalAmount, creditCents: 0, description: description || expense.description || 'Expense' },
                { accountId: cashAccount.id, debitCents: 0, creditCents: finalAmount, description: 'Payment' },
              ],
            },
          },
        });
        journalEntryId = je.id;
      }
    }

    const updated = await db.abExpense.update({
      where: { id: expense.id },
      data: {
        status: 'confirmed',
        journalEntryId,
        ...(amountCents && { amountCents }),
        ...(categoryId && { categoryId }),
        ...(description && { description }),
      },
    });

    await db.abEvent.create({
      data: { tenantId, eventType: 'expense.confirmed', actor: 'user', action: { expenseId: expense.id, amountCents: finalAmount } },
    });

    res.json({ success: true, data: updated });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// POST /expenses/:id/reject — reject a pending expense
app.post('/api/v1/agentbook-expense/expenses/:id/reject', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const expense = await db.abExpense.findFirst({ where: { id: req.params.id, tenantId } });
    if (!expense) return res.status(404).json({ success: false, error: 'Expense not found' });

    const updated = await db.abExpense.update({
      where: { id: expense.id },
      data: { status: 'rejected' },
    });

    await db.abEvent.create({
      data: { tenantId, eventType: 'expense.rejected', actor: 'user', action: { expenseId: expense.id } },
    });

    res.json({ success: true, data: updated });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ============================================
// RECEIPT BLOB STORAGE (Gap 2)
// ============================================

// POST /receipts/upload-blob — download URL and store permanently
app.post('/api/v1/agentbook-expense/receipts/upload-blob', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { sourceUrl, expenseId } = req.body;
    if (!sourceUrl) return res.status(400).json({ success: false, error: 'sourceUrl is required' });

    let permanentUrl = sourceUrl;

    // Try to upload to Vercel Blob via the web-next storage endpoint
    try {
      const imageRes = await fetch(sourceUrl);
      if (imageRes.ok) {
        const contentType = imageRes.headers.get('content-type') || 'image/jpeg';
        const extension = contentType.includes('pdf') ? 'pdf' : contentType.includes('png') ? 'png' : 'jpg';
        const filename = `receipts/${tenantId}/${Date.now()}.${extension}`;

        // Use Vercel Blob directly if available, otherwise store URL as-is
        const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
        if (BLOB_TOKEN) {
          const { put } = await import('@vercel/blob');
          const blob = await put(filename, imageRes.body as any, {
            access: 'public',
            token: BLOB_TOKEN,
            contentType,
          });
          permanentUrl = blob.url;
        } else {
          // Dev mode: store source URL directly (no blob storage)
          permanentUrl = sourceUrl;
        }
      }
    } catch (uploadErr) {
      console.warn('Blob upload failed, using source URL:', uploadErr);
    }

    // Update expense if ID provided
    if (expenseId) {
      await db.abExpense.update({
        where: { id: expenseId },
        data: { receiptUrl: permanentUrl },
      });
    }

    res.json({ success: true, data: { permanentUrl, sourceUrl, stored: permanentUrl !== sourceUrl } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ============================================
// CREDIT CARD STATEMENT IMPORT (Gap 4)
// ============================================

app.post('/api/v1/agentbook-expense/import/cc-statement', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { transactions, csv } = req.body;

    // Parse CSV if provided
    let txns: { date: string; amount: number; description: string; merchant?: string }[] = transactions || [];
    if (csv && typeof csv === 'string' && txns.length === 0) {
      const lines = csv.trim().split('\n');
      if (lines.length < 2) return res.status(400).json({ success: false, error: 'CSV has no data rows' });
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));

      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
        const row: any = {};
        headers.forEach((h, idx) => row[h] = vals[idx] || '');

        const dateCol = headers.find(h => ['date', 'transaction date', 'trans date', 'posted date'].includes(h)) || headers[0];
        const amountCol = headers.find(h => ['amount', 'debit', 'charge'].includes(h)) || headers.find(h => h.includes('amount')) || headers[1];
        const descCol = headers.find(h => ['description', 'merchant', 'name', 'memo'].includes(h)) || headers[2];

        const amount = Math.abs(parseFloat((row[amountCol] || '0').replace(/[^0-9.-]/g, '')));
        if (amount > 0) {
          txns.push({
            date: row[dateCol],
            amount: Math.round(amount * 100),
            description: row[descCol] || `CC transaction row ${i + 1}`,
            merchant: row[headers.find(h => h.includes('merchant')) || ''] || undefined,
          });
        }
      }
    }

    if (txns.length === 0) return res.status(400).json({ success: false, error: 'No transactions to import' });

    const results = { matched: 0, created: 0, duplicates: 0, errors: 0, details: [] as any[] };

    for (const txn of txns) {
      const amountCents = typeof txn.amount === 'number' && txn.amount > 100 ? txn.amount : Math.round((txn.amount || 0) * 100);
      const txnDate = new Date(txn.date);
      if (isNaN(txnDate.getTime()) || amountCents <= 0) { results.errors++; continue; }

      const matchWindow = 2 * 86400000;

      // Try to match against existing expense
      const matchingExpense = await db.abExpense.findFirst({
        where: {
          tenantId,
          amountCents: { gte: Math.round(amountCents * 0.95), lte: Math.round(amountCents * 1.05) },
          date: { gte: new Date(txnDate.getTime() - matchWindow), lte: new Date(txnDate.getTime() + matchWindow) },
        },
      });

      if (matchingExpense) {
        results.matched++;
        results.details.push({ action: 'matched', expenseId: matchingExpense.id, amount: amountCents, description: txn.description });
        continue;
      }

      // Try to match against bank transaction
      const matchingBankTxn = await db.abBankTransaction.findFirst({
        where: {
          tenantId,
          amount: { gte: Math.round(amountCents * 0.95), lte: Math.round(amountCents * 1.05) },
          date: { gte: new Date(txnDate.getTime() - matchWindow), lte: new Date(txnDate.getTime() + matchWindow) },
        },
      });

      // Check for duplicate (same amount + date already imported as CC)
      const duplicate = await db.abExpense.findFirst({
        where: {
          tenantId, source: 'cc_statement',
          amountCents: { gte: Math.round(amountCents * 0.99), lte: Math.round(amountCents * 1.01) },
          date: { gte: new Date(txnDate.getTime() - 86400000), lte: new Date(txnDate.getTime() + 86400000) },
        },
      });
      if (duplicate) { results.duplicates++; continue; }

      // Create new expense as pending review
      const vendorName = txn.merchant || txn.description.split(/\s{2,}/)[0] || txn.description;
      let vendorId = null;
      if (vendorName) {
        const normalized = vendorName.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
        if (normalized) {
          const vendor = await db.abVendor.upsert({
            where: { tenantId_normalizedName: { tenantId, normalizedName: normalized } },
            update: { lastSeen: new Date(), transactionCount: { increment: 1 } },
            create: { tenantId, name: vendorName, normalizedName: normalized },
          });
          vendorId = vendor.id;
        }
      }

      const expense = await db.abExpense.create({
        data: {
          tenantId, amountCents, date: txnDate, description: txn.description,
          vendorId, source: 'cc_statement', status: 'pending_review',
          confidence: 0.6, paymentMethod: 'credit_card',
        },
      });

      results.created++;
      results.details.push({ action: 'created', expenseId: expense.id, amount: amountCents, description: txn.description, status: 'pending_review' });
    }

    await db.abEvent.create({
      data: { tenantId, eventType: 'cc_statement.imported', actor: 'user',
        action: { total: txns.length, matched: results.matched, created: results.created, duplicates: results.duplicates } },
    });

    res.json({ success: true, data: results });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ============================================
// PROACTIVE ALERTS (Gap 5)
// ============================================

app.get('/api/v1/agentbook-expense/advisor/proactive-alerts', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 86400000);

    const alerts: any[] = [];

    // 1. Pending review items
    const pendingCount = await db.abExpense.count({ where: { tenantId, status: 'pending_review' } });
    if (pendingCount > 0) {
      alerts.push({
        id: 'pending-review', type: 'review_needed', severity: 'important',
        title: `${pendingCount} expense${pendingCount > 1 ? 's' : ''} need${pendingCount === 1 ? 's' : ''} review`,
        message: `You have ${pendingCount} unconfirmed expense${pendingCount > 1 ? 's' : ''}. Review them to keep your books accurate.`,
        action: { label: 'Review Now', type: 'navigate', url: '/agentbook/expenses?filter=pending_review' },
      });
    }

    // 2. Missing receipts (business expenses >$25 in last 30 days)
    const missingReceipts = await db.abExpense.count({
      where: { tenantId, isPersonal: false, status: 'confirmed', receiptUrl: null, amountCents: { gt: 2500 }, date: { gte: thirtyDaysAgo } },
    });
    if (missingReceipts > 0) {
      alerts.push({
        id: 'missing-receipts', type: 'missing_receipt', severity: missingReceipts > 5 ? 'important' : 'info',
        title: `${missingReceipts} receipt${missingReceipts > 1 ? 's' : ''} missing`,
        message: `${missingReceipts} business expense${missingReceipts > 1 ? 's' : ''} over $25 without receipt. Snap photos before they fade!`,
        action: { label: 'View Expenses', type: 'navigate', url: '/agentbook/expenses' },
      });
    }

    // 3. Unmatched bank transactions (>7 days old)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const unmatchedBank = await db.abBankTransaction.count({
      where: { tenantId, matchStatus: 'pending', date: { lte: sevenDaysAgo } },
    });
    if (unmatchedBank > 0) {
      alerts.push({
        id: 'unmatched-bank', type: 'reconciliation', severity: 'important',
        title: `${unmatchedBank} unmatched bank transaction${unmatchedBank > 1 ? 's' : ''}`,
        message: `${unmatchedBank} bank transaction${unmatchedBank > 1 ? 's are' : ' is'} older than 7 days and not matched to any expense. These may be missing from your books.`,
        action: { label: 'Reconcile', type: 'navigate', url: '/agentbook/bank' },
      });
    }

    // 4. Spending spike detection (category >20% vs prior 30 days)
    const currentExpenses = await db.abExpense.findMany({
      where: { tenantId, isPersonal: false, status: 'confirmed', date: { gte: thirtyDaysAgo } },
    });
    const priorExpenses = await db.abExpense.findMany({
      where: { tenantId, isPersonal: false, status: 'confirmed', date: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
    });

    const currentByCat: Record<string, number> = {};
    const priorByCat: Record<string, number> = {};
    for (const e of currentExpenses) { const k = e.categoryId || 'other'; currentByCat[k] = (currentByCat[k] || 0) + e.amountCents; }
    for (const e of priorExpenses) { const k = e.categoryId || 'other'; priorByCat[k] = (priorByCat[k] || 0) + e.amountCents; }

    const catIds = [...new Set([...Object.keys(currentByCat), ...Object.keys(priorByCat)].filter(k => k !== 'other'))];
    const catNames = catIds.length > 0 ? await db.abAccount.findMany({ where: { id: { in: catIds } } }) : [];
    const catNameMap = Object.fromEntries(catNames.map((c: any) => [c.id, c.name]));

    for (const [catId, current] of Object.entries(currentByCat)) {
      const prior = priorByCat[catId] || 0;
      if (prior > 0) {
        const pct = Math.round(((current - prior) / prior) * 100);
        if (pct > 20) {
          alerts.push({
            id: `spike-${catId}`, type: 'spending_spike', severity: pct > 50 ? 'critical' : 'important',
            title: `${catNameMap[catId] || 'Spending'} up ${pct}%`,
            message: `${catNameMap[catId] || 'Category'}: ${formatCents(current)} this month vs ${formatCents(prior)} last month (+${pct}%).`,
            action: { label: 'View Details', type: 'navigate', url: '/agentbook/expenses' },
          });
        }
      }
    }

    // 5. Uncategorized expenses
    const uncategorized = await db.abExpense.count({
      where: { tenantId, categoryId: null, isPersonal: false, status: 'confirmed', date: { gte: thirtyDaysAgo } },
    });
    if (uncategorized > 3) {
      alerts.push({
        id: 'uncategorized', type: 'uncategorized', severity: 'info',
        title: `${uncategorized} uncategorized expenses`,
        message: `Categorize them for accurate tax reporting and spending insights.`,
        action: { label: 'Categorize', type: 'navigate', url: '/agentbook/expenses' },
      });
    }

    // Sort by severity
    const severityOrder: Record<string, number> = { critical: 0, important: 1, info: 2 };
    alerts.sort((a, b) => (severityOrder[a.severity] || 9) - (severityOrder[b.severity] || 9));

    res.json({ success: true, data: { alerts, generatedAt: now.toISOString() } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// === Budget Tracking ===

// POST /budgets — Create/upsert budget
app.post('/api/v1/agentbook-expense/budgets', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { amountCents, categoryId, categoryName, period, alertPercent } = req.body;
    if (!amountCents || amountCents <= 0) return res.status(400).json({ success: false, error: 'amountCents required' });
    const budget = await db.abBudget.upsert({
      where: { tenantId_categoryId_period: { tenantId, categoryId: categoryId || null, period: period || 'monthly' } },
      update: { amountCents, categoryName, alertPercent: alertPercent || 80 },
      create: { tenantId, amountCents, categoryId: categoryId || null, categoryName: categoryName || 'Total', period: period || 'monthly', alertPercent: alertPercent || 80 },
    });
    res.json({ success: true, data: budget });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// GET /budgets — List all budgets
app.get('/api/v1/agentbook-expense/budgets', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const budgets = await db.abBudget.findMany({ where: { tenantId }, orderBy: { categoryName: 'asc' } });
    res.json({ success: true, data: budgets });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// GET /budgets/status — Budget health with spending comparison
app.get('/api/v1/agentbook-expense/budgets/status', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const budgets = await db.abBudget.findMany({ where: { tenantId } });

    // Get current month spending
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const result = [];
    for (const budget of budgets) {
      let spentCents = 0;
      if (budget.categoryId) {
        const agg = await db.abExpense.aggregate({
          _sum: { amountCents: true },
          where: { tenantId, categoryId: budget.categoryId, date: { gte: monthStart, lte: monthEnd }, isPersonal: false },
        });
        spentCents = agg._sum.amountCents || 0;
      } else {
        const agg = await db.abExpense.aggregate({
          _sum: { amountCents: true },
          where: { tenantId, date: { gte: monthStart, lte: monthEnd }, isPersonal: false },
        });
        spentCents = agg._sum.amountCents || 0;
      }
      result.push({ ...budget, spentCents, percent: Math.round((spentCents / Math.max(1, budget.amountCents)) * 100) });
    }

    res.json({ success: true, data: { budgets: result, period: 'monthly', monthStart: monthStart.toISOString(), monthEnd: monthEnd.toISOString() } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// POST /reports/expense-pdf — Generate expense report HTML
app.post('/api/v1/agentbook-expense/reports/expense-pdf', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = req.body;
    const start = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const end = endDate ? new Date(endDate) : new Date();

    const expenses = await db.abExpense.findMany({
      where: { tenantId, date: { gte: start, lte: end }, isPersonal: false },
      orderBy: { date: 'desc' },
      take: 500,
    });

    // Group by category
    const categories: Record<string, { name: string; total: number; count: number }> = {};
    let grandTotal = 0;
    for (const exp of expenses) {
      const cat = (exp as any).categoryName || 'Uncategorized';
      if (!categories[cat]) categories[cat] = { name: cat, total: 0, count: 0 };
      categories[cat].total += exp.amountCents;
      categories[cat].count++;
      grandTotal += exp.amountCents;
    }

    // Generate HTML
    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Expense Report</title>
<style>body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:20px}h1{color:#1a1a2e}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{padding:8px 12px;border-bottom:1px solid #eee;text-align:left}th{background:#f8f9fa;font-weight:600}td.amt{text-align:right;font-family:monospace}.total td{font-weight:bold;border-top:2px solid #333}.cat-header{background:#f0f0f0;font-weight:600}</style></head><body>`;
    html += `<h1>Expense Report</h1>`;
    html += `<p>${start.toLocaleDateString()} — ${end.toLocaleDateString()} | ${expenses.length} expenses | Total: $${(grandTotal / 100).toFixed(2)}</p>`;

    // Category summary
    html += `<h2>By Category</h2><table><tr><th>Category</th><th>Count</th><th style="text-align:right">Amount</th></tr>`;
    for (const [, cat] of Object.entries(categories).sort((a, b) => b[1].total - a[1].total)) {
      html += `<tr><td>${cat.name}</td><td>${cat.count}</td><td class="amt">$${(cat.total / 100).toFixed(2)}</td></tr>`;
    }
    html += `<tr class="total"><td>Total</td><td>${expenses.length}</td><td class="amt">$${(grandTotal / 100).toFixed(2)}</td></tr></table>`;

    // Detail table
    html += `<h2>All Expenses</h2><table><tr><th>Date</th><th>Description</th><th>Vendor</th><th style="text-align:right">Amount</th></tr>`;
    for (const exp of expenses.slice(0, 200)) {
      html += `<tr><td>${new Date(exp.date).toLocaleDateString()}</td><td>${exp.description || ''}</td><td>${(exp as any).vendorName || ''}</td><td class="amt">$${(exp.amountCents / 100).toFixed(2)}</td></tr>`;
    }
    html += `</table>`;
    html += `<p style="color:#888;font-size:12px;margin-top:24px">Generated by AgentBook</p></body></html>`;

    res.json({ success: true, data: { html, expenseCount: expenses.length, totalCents: grandTotal, categories: Object.values(categories) } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

start();
