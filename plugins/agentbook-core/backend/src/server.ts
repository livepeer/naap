/**
 * AgentBook Core Backend — Double-entry ledger with constraint engine.
 * Every financial action produces a balanced journal entry.
 * The constraint engine is code, not LLM prompts.
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
  // In development, make API routes publicly accessible for testing.
  // In production, auth is enforced by the Next.js proxy layer.
  requireAuth: process.env.NODE_ENV === 'production',
  publicRoutes: ['/healthz', '/api/v1/agentbook-core'],
});

// === Middleware ===
app.use((req, res, next) => {
  // TODO: Extract tenant_id from auth token. For now use header.
  (req as any).tenantId = req.headers['x-tenant-id'] as string || 'default';
  next();
});

// === Health Check ===
app.get('/healthz', async (_req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: 'healthy', plugin: 'agentbook-core', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: String(err) });
  }
});

// === Tenant Config ===
app.get('/api/v1/agentbook-core/tenant-config', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    let config = await db.abTenantConfig.findUnique({ where: { userId: tenantId } });
    if (!config) {
      config = await db.abTenantConfig.create({
        data: { userId: tenantId },
      });
    }
    res.json({ success: true, data: config });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.put('/api/v1/agentbook-core/tenant-config', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { businessType, jurisdiction, region, currency, locale, timezone, fiscalYearStart, autoApproveLimitCents } = req.body;
    const config = await db.abTenantConfig.upsert({
      where: { userId: tenantId },
      update: {
        ...(businessType && { businessType }),
        ...(jurisdiction && { jurisdiction }),
        ...(region !== undefined && { region }),
        ...(currency && { currency }),
        ...(locale && { locale }),
        ...(timezone && { timezone }),
        ...(fiscalYearStart && { fiscalYearStart }),
        ...(autoApproveLimitCents !== undefined && { autoApproveLimitCents }),
      },
      create: {
        userId: tenantId,
        businessType: businessType || 'freelancer',
        jurisdiction: jurisdiction || 'us',
        region: region || '',
        currency: currency || 'USD',
        locale: locale || 'en-US',
        timezone: timezone || 'America/New_York',
      },
    });
    res.json({ success: true, data: config });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// === Chart of Accounts ===
app.get('/api/v1/agentbook-core/accounts', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const accounts = await db.abAccount.findMany({
      where: { tenantId, isActive: true },
      orderBy: { code: 'asc' },
    });
    res.json({ success: true, data: accounts });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post('/api/v1/agentbook-core/accounts', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { code, name, accountType, parentId, taxCategory } = req.body;

    if (!code || !name || !accountType) {
      return res.status(400).json({ success: false, error: 'code, name, and accountType are required' });
    }

    const account = await db.abAccount.create({
      data: { tenantId, code, name, accountType, parentId, taxCategory },
    });
    res.status(201).json({ success: true, data: account });
  } catch (err: any) {
    if (err.code === 'P2002') {
      return res.status(409).json({ success: false, error: 'Account code already exists for this tenant' });
    }
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post('/api/v1/agentbook-core/accounts/seed', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { accounts } = req.body; // Array of { code, name, accountType, taxCategory }

    if (!accounts || !Array.isArray(accounts)) {
      return res.status(400).json({ success: false, error: 'accounts array is required' });
    }

    const created = await db.$transaction(
      accounts.map((a: any) =>
        db.abAccount.upsert({
          where: { tenantId_code: { tenantId, code: a.code } },
          update: { name: a.name, accountType: a.accountType, taxCategory: a.taxCategory },
          create: { tenantId, code: a.code, name: a.name, accountType: a.accountType, taxCategory: a.taxCategory },
        })
      )
    );

    res.status(201).json({ success: true, data: { count: created.length } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// === Journal Entries (the core of double-entry bookkeeping) ===

app.post('/api/v1/agentbook-core/journal-entries', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { date, memo, sourceType, sourceId, lines } = req.body;

    // Validate required fields
    if (!date || !memo || !lines || !Array.isArray(lines) || lines.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'date, memo, and at least 2 lines are required',
      });
    }

    // === CONSTRAINT: Balance Invariant (hard gate) ===
    // This is code, not an LLM instruction. It cannot be bypassed.
    const totalDebits = lines.reduce((sum: number, l: any) => sum + (l.debitCents || 0), 0);
    const totalCredits = lines.reduce((sum: number, l: any) => sum + (l.creditCents || 0), 0);

    if (totalDebits !== totalCredits) {
      return res.status(422).json({
        success: false,
        error: 'Balance invariant violated',
        details: {
          constraint: 'balance_invariant',
          totalDebits,
          totalCredits,
          difference: totalDebits - totalCredits,
        },
      });
    }

    if (totalDebits === 0) {
      return res.status(422).json({
        success: false,
        error: 'Journal entry cannot have zero total',
      });
    }

    // === CONSTRAINT: Period Gate (hard gate) ===
    const entryDate = new Date(date);
    const period = await db.abFiscalPeriod.findUnique({
      where: {
        tenantId_year_month: {
          tenantId,
          year: entryDate.getFullYear(),
          month: entryDate.getMonth() + 1,
        },
      },
    });

    if (period && period.status === 'closed') {
      return res.status(422).json({
        success: false,
        error: 'Period gate violated',
        details: {
          constraint: 'period_gate',
          year: entryDate.getFullYear(),
          month: entryDate.getMonth() + 1,
          status: 'closed',
        },
      });
    }

    // === CONSTRAINT: Amount Threshold (escalation) ===
    const config = await db.abTenantConfig.findUnique({ where: { userId: tenantId } });
    const maxAmount = Math.max(totalDebits, totalCredits);
    if (config && maxAmount > config.autoApproveLimitCents) {
      // In a full implementation, this would create an escalation record
      // and return a pending status. For MVP, we warn but allow.
      console.warn(`Amount ${maxAmount} exceeds auto-approve limit ${config.autoApproveLimitCents} for tenant ${tenantId}`);
    }

    // === Verify all account IDs exist ===
    const accountIds = lines.map((l: any) => l.accountId);
    const accounts = await db.abAccount.findMany({
      where: { id: { in: accountIds }, tenantId },
    });
    if (accounts.length !== new Set(accountIds).size) {
      const foundIds = new Set(accounts.map(a => a.id));
      const missing = accountIds.filter((id: string) => !foundIds.has(id));
      return res.status(400).json({
        success: false,
        error: `Account(s) not found: ${missing.join(', ')}`,
      });
    }

    // === Create journal entry with lines in a transaction ===
    // IMPORTANT: Event emission is inside this transaction. If the journal
    // entry or event insert fails, both are rolled back — guaranteeing the
    // audit log is always consistent with ledger state.
    const entry = await db.$transaction(async (tx) => {
      const journalEntry = await tx.abJournalEntry.create({
        data: {
          tenantId,
          date: new Date(date),
          memo,
          sourceType: sourceType || 'manual',
          sourceId,
          verified: true,
          lines: {
            create: lines.map((l: any) => ({
              accountId: l.accountId,
              debitCents: l.debitCents || 0,
              creditCents: l.creditCents || 0,
              description: l.description,
            })),
          },
        },
        include: { lines: true },
      });

      // Emit event
      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'journal_entry.created',
          actor: 'agent',
          action: {
            entry_id: journalEntry.id,
            memo,
            totalDebits,
            totalCredits,
            lineCount: lines.length,
          },
          constraintsPassed: ['balance_invariant', 'period_gate'],
          verificationResult: 'passed',
        },
      });

      return journalEntry;
    });

    res.status(201).json({ success: true, data: entry });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.get('/api/v1/agentbook-core/journal-entries', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate, sourceType, limit = '50', offset = '0' } = req.query;

    const where: any = { tenantId };
    if (startDate) where.date = { ...where.date, gte: new Date(startDate as string) };
    if (endDate) where.date = { ...where.date, lte: new Date(endDate as string) };
    if (sourceType) where.sourceType = sourceType;

    const entries = await db.abJournalEntry.findMany({
      where,
      include: { lines: { include: { account: true } } },
      orderBy: { date: 'desc' },
      take: parseInt(limit as string),
      skip: parseInt(offset as string),
    });

    res.json({ success: true, data: entries });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// === Trial Balance ===
app.get('/api/v1/agentbook-core/trial-balance', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { asOfDate } = req.query;

    const dateFilter = asOfDate ? { lte: new Date(asOfDate as string) } : undefined;

    // Aggregate debits and credits per account
    const accounts = await db.abAccount.findMany({
      where: { tenantId, isActive: true },
      include: {
        journalLines: {
          where: dateFilter ? { entry: { date: dateFilter, tenantId } } : { entry: { tenantId } },
        },
      },
      orderBy: { code: 'asc' },
    });

    const trialBalance = accounts.map(account => {
      const totalDebits = account.journalLines.reduce((sum, l) => sum + l.debitCents, 0);
      const totalCredits = account.journalLines.reduce((sum, l) => sum + l.creditCents, 0);
      return {
        accountId: account.id,
        code: account.code,
        name: account.name,
        accountType: account.accountType,
        totalDebits,
        totalCredits,
        balance: totalDebits - totalCredits,
      };
    }).filter(a => a.totalDebits > 0 || a.totalCredits > 0);

    const sumDebits = trialBalance.reduce((s, a) => s + a.totalDebits, 0);
    const sumCredits = trialBalance.reduce((s, a) => s + a.totalCredits, 0);

    res.json({
      success: true,
      data: {
        accounts: trialBalance,
        totalDebits: sumDebits,
        totalCredits: sumCredits,
        balanced: sumDebits === sumCredits,
        asOfDate: asOfDate || new Date().toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// === Fiscal Periods ===
app.get('/api/v1/agentbook-core/fiscal-periods', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const periods = await db.abFiscalPeriod.findMany({
      where: { tenantId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    res.json({ success: true, data: periods });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post('/api/v1/agentbook-core/fiscal-periods/:year/:month/close', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);

    // Close period + emit event in a transaction for atomicity
    const period = await db.$transaction(async (tx) => {
      const p = await tx.abFiscalPeriod.upsert({
        where: { tenantId_year_month: { tenantId, year, month } },
        update: { status: 'closed', closedAt: new Date(), closedBy: tenantId },
        create: { tenantId, year, month, status: 'closed', closedAt: new Date(), closedBy: tenantId },
      });

      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'period.closed',
          actor: 'human',
          action: { year, month },
        },
      });

      return p;
    });

    res.json({ success: true, data: period });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// === Dashboard Snapshot (for Telegram sharing) ===
app.post('/api/v1/agentbook-core/snapshot', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { type, data } = req.body;

    // Generate a text-based financial highlight summary
    // In Phase 3+, this will render an actual image via Puppeteer/Playwright
    const highlight = {
      type: type || 'dashboard_highlight',
      tenant_id: tenantId,
      generated_at: new Date().toISOString(),
      summary: data,
      // The proactive engine can pick this up and send to Telegram
      // as a formatted message or rendered image
      telegram_message: formatSnapshotMessage(data),
    };

    // Emit event so proactive engine can deliver to Telegram (inside transaction for atomicity)
    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'snapshot.requested',
        actor: 'human',
        action: highlight,
      },
    });

    res.json({ success: true, data: highlight });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

function formatSnapshotMessage(data: any): string {
  const fmt = (cents: number) => {
    const amount = Math.abs(cents || 0) / 100;
    const sign = (cents || 0) < 0 ? '-' : '';
    return `${sign}$${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  };

  return [
    `📊 <b>Financial Snapshot</b>`,
    ``,
    `🏦 Cash: <b>${fmt(data?.assets)}</b>`,
    `📈 Revenue: ${fmt(data?.revenue)}`,
    `📉 Expenses: ${fmt(data?.expenses)}`,
    `💰 Net Income: <b>${fmt(data?.netIncome)}</b>`,
    ``,
    data?.balanced ? `✅ Books balanced` : `⚠️ Books out of balance`,
    ``,
    `<i>Generated ${new Date().toLocaleString()}</i>`,
  ].join('\n');
}

// === MULTI-AGENT CONFIG (Phase 10) ===

app.get('/api/v1/agentbook-core/agents', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;

    const AGENTS = [
      { id: 'bookkeeper', name: 'Bookkeeper', description: 'Expense recording, categorization, reconciliation', skills: ['expense-recording', 'receipt-ocr', 'bank-sync', 'pattern-learning'] },
      { id: 'tax-strategist', name: 'Tax Strategist', description: 'Tax estimation, deductions, quarterly payments, forms', skills: ['tax-estimation', 'deduction-hunting', 'tax-forms', 'year-end-closing'] },
      { id: 'collections', name: 'Collections', description: 'Invoice follow-up, payment prediction, time billing', skills: ['invoice-creation', 'earnings-projection', 'time-tracking'] },
      { id: 'insights', name: 'Insights', description: 'Analytics, patterns, projections, financial advice', skills: ['expense-analytics', 'financial-copilot', 'pattern-learning'] },
    ];

    // Get tenant-specific configs
    const configs = await db.abAgentConfig.findMany({ where: { tenantId } });
    const configMap = new Map(configs.map((c: any) => [c.agentId, c]));

    const result = AGENTS.map(a => ({
      ...a,
      config: configMap.get(a.id) || { aggressiveness: 0.5, autoApprove: false, notificationFrequency: 'daily', modelTier: 'fast', enabled: true },
    }));

    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

app.put('/api/v1/agentbook-core/agents/:agentId/config', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { agentId } = req.params;
    const { aggressiveness, autoApprove, notificationFrequency, modelTier, enabled } = req.body;

    const config = await db.abAgentConfig.upsert({
      where: { tenantId_agentId: { tenantId, agentId } },
      update: {
        ...(aggressiveness !== undefined && { aggressiveness }),
        ...(autoApprove !== undefined && { autoApprove }),
        ...(notificationFrequency && { notificationFrequency }),
        ...(modelTier && { modelTier }),
        ...(enabled !== undefined && { enabled }),
      },
      create: {
        tenantId, agentId,
        aggressiveness: aggressiveness ?? 0.5,
        autoApprove: autoApprove ?? false,
        notificationFrequency: notificationFrequency || 'daily',
        modelTier: modelTier || 'fast',
      },
    });

    res.json({ success: true, data: config });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// === AGENT SKILL BINDINGS (Phase 10 Enhancement) ===

app.get('/api/v1/agentbook-core/agents/:agentId/skills', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { agentId } = req.params;
    const config = await db.abTenantConfig.findUnique({ where: { userId: tenantId } });

    // Dynamic skill loading: base + jurisdiction + industry + marketplace + personalized
    const BASE_SKILLS: Record<string, string[]> = {
      bookkeeper: ['expense-recording', 'receipt-ocr', 'bank-sync', 'pattern-learning', 'anomaly-detection'],
      'tax-strategist': ['tax-estimation', 'deduction-hunting', 'tax-forms', 'year-end-closing'],
      collections: ['invoice-creation', 'time-tracking', 'earnings-projection'],
      insights: ['expense-analytics', 'financial-copilot', 'pattern-learning'],
    };

    const base = (BASE_SKILLS[agentId] || []).map((s: string) => ({ skillName: s, source: 'base', enabled: true }));

    // Get marketplace + personalized from DB
    const dbBindings = await db.abAgentSkillBinding.findMany({
      where: { tenantId, agentId },
      orderBy: { priority: 'desc' },
    });

    const all = [...base, ...dbBindings.map((b: any) => ({ skillName: b.skillName, source: b.source, enabled: b.enabled }))];

    res.json({ success: true, data: { agentId, jurisdiction: config?.jurisdiction || 'us', skills: all } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

app.post('/api/v1/agentbook-core/agents/:agentId/skills', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { agentId } = req.params;
    const { skillName, source, priority } = req.body;

    const binding = await db.abAgentSkillBinding.upsert({
      where: { tenantId_agentId_skillName: { tenantId, agentId, skillName } },
      update: { source, priority, enabled: true },
      create: { tenantId, agentId, skillName, source: source || 'marketplace', priority: priority || 50 },
    });

    res.json({ success: true, data: binding });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// === LEARNING EVENTS ===

app.get('/api/v1/agentbook-core/agents/:agentId/learning', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { agentId } = req.params;
    const events = await db.abLearningEvent.findMany({
      where: { tenantId, agentId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const corrections = events.filter((e: any) => e.eventType === 'correction').length;
    const confirmations = events.filter((e: any) => e.eventType === 'confirmation').length;
    const accuracy = events.length > 0 ? confirmations / events.length : 1;

    res.json({ success: true, data: { events, stats: { total: events.length, corrections, confirmations, accuracy } } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// === AGI FEATURES (7 Core Differentiators) ===

// Feature 2: Conversational Financial Memory — Ask anything
app.post('/api/v1/agentbook-core/ask', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { question } = req.body;
    if (!question) return res.status(400).json({ success: false, error: 'question is required' });

    // Log question for conversation context
    await db.abEvent.create({
      data: { tenantId, eventType: 'ask.question', actor: 'human', action: { question } },
    });

    // Pattern-matched queries (MVP — LLM-generated queries in production)
    const q = question.toLowerCase();
    let answer = '';
    let data: any = null;

    if (q.includes('revenue') || q.includes('income') || q.includes('earn')) {
      const accounts = await db.abAccount.findMany({ where: { tenantId, accountType: 'revenue' } });
      const lines = await db.abJournalLine.findMany({
        where: { accountId: { in: accounts.map((a: any) => a.id) }, entry: { tenantId } },
      });
      const total = lines.reduce((s: number, l: any) => s + l.creditCents, 0);
      answer = `Your total revenue is $${(total / 100).toLocaleString()}.`;
      data = { totalRevenueCents: total };
    } else if (q.includes('spend') || q.includes('expense')) {
      const expenses = await db.abExpense.findMany({ where: { tenantId, isPersonal: false } });
      const total = expenses.reduce((s: number, e: any) => s + e.amountCents, 0);
      answer = `Total expenses: $${(total / 100).toLocaleString()} across ${expenses.length} transactions.`;
      data = { totalCents: total, count: expenses.length };
    } else if (q.includes('tax') || q.includes('owe')) {
      const estimate = await db.abTaxEstimate.findFirst({ where: { tenantId }, orderBy: { calculatedAt: 'desc' } });
      if (estimate) {
        answer = `Estimated tax: $${(estimate.totalTaxCents / 100).toLocaleString()}. Effective rate: ${(estimate.effectiveRate * 100).toFixed(1)}%.`;
        data = estimate;
      } else { answer = 'No tax estimate yet.'; }
    } else if (q.includes('cash') || q.includes('balance')) {
      const cash = await db.abAccount.findFirst({ where: { tenantId, code: '1000' } });
      if (cash) {
        const lines = await db.abJournalLine.findMany({ where: { accountId: cash.id, entry: { tenantId } } });
        const balance = lines.reduce((s: number, l: any) => s + l.debitCents - l.creditCents, 0);
        answer = `Cash balance: $${(balance / 100).toLocaleString()}.`;
        data = { balanceCents: balance };
      } else { answer = 'No cash account found.'; }
    } else if (q.includes('client')) {
      const clients = await db.abClient.findMany({ where: { tenantId } });
      const outstanding = clients.reduce((s: number, c: any) => s + (c.totalBilledCents - c.totalPaidCents), 0);
      answer = `${clients.length} clients. Outstanding: $${(outstanding / 100).toLocaleString()}.`;
      data = { clients: clients.length, outstandingCents: outstanding };
    } else {
      // LLM fallback: use Gemini for complex questions
      const llmConfig = await db.abLLMProviderConfig.findFirst({ where: { enabled: true, isDefault: true } });
      if (llmConfig && llmConfig.provider === 'gemini') {
        try {
          // Get financial context for LLM
          const revenueAccounts = await db.abAccount.findMany({ where: { tenantId, accountType: 'revenue' } });
          const revLines = await db.abJournalLine.findMany({
            where: { accountId: { in: revenueAccounts.map((a: any) => a.id) }, entry: { tenantId } },
          });
          const totalRevenue = revLines.reduce((s: number, l: any) => s + l.creditCents, 0);

          const expenseCount = await db.abExpense.count({ where: { tenantId, isPersonal: false } });
          const expenses = await db.abExpense.aggregate({ where: { tenantId, isPersonal: false }, _sum: { amountCents: true } });
          const totalExpenses = expenses._sum.amountCents || 0;

          const clients = await db.abClient.findMany({ where: { tenantId } });
          const config = await db.abTenantConfig.findUnique({ where: { userId: tenantId } });

          const context = `Financial context for ${config?.jurisdiction || 'us'} business:
Revenue: $${(totalRevenue / 100).toFixed(2)}
Expenses: $${(totalExpenses / 100).toFixed(2)} across ${expenseCount} transactions
Net income: $${((totalRevenue - totalExpenses) / 100).toFixed(2)}
Clients: ${clients.map((c: any) => `${c.name} (billed: $${(c.totalBilledCents / 100).toFixed(2)})`).join(', ') || 'None'}
Currency: ${config?.currency || 'USD'}
Jurisdiction: ${config?.jurisdiction || 'us'}`;

          const model = llmConfig.modelFast || 'gemini-2.0-flash';
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${llmConfig.apiKey}`;

          const llmRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: 'You are AgentBook, an AI accounting agent. Answer financial questions concisely using the provided context. If you cannot answer from the data, say so clearly. Always include dollar amounts.' }] },
              contents: [{ role: 'user', parts: [{ text: `${context}\n\nQuestion: ${question}` }] }],
              generationConfig: { maxOutputTokens: 300, temperature: 0.3 },
            }),
          });

          if (llmRes.ok) {
            const llmData = await llmRes.json();
            const llmAnswer = llmData.candidates?.[0]?.content?.parts?.[0]?.text || '';
            answer = llmAnswer;
            data = { source: 'gemini', model, context: 'financial_summary' };
          } else {
            answer = `I can answer about revenue, expenses, taxes, cash balance, and clients. Try: "How much revenue this year?"`;
          }
        } catch (llmErr) {
          console.warn('LLM fallback failed:', llmErr);
          answer = `I can answer about revenue, expenses, taxes, cash balance, and clients. Try: "How much revenue this year?"`;
        }
      } else {
        answer = `I can answer about revenue, expenses, taxes, cash balance, and clients. Try: "How much revenue this year?"`;
      }
    }

    // Get recent conversation context
    const recentQuestions = await db.abEvent.findMany({
      where: { tenantId, eventType: 'ask.question' },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { action: true },
    });
    const conversationContext = recentQuestions.map((e: any) => (e.action as any)?.question).filter(Boolean);

    res.json({ success: true, data: { question, answer, data, conversationContext } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// Feature 3: Proactive Money Moves
app.get('/api/v1/agentbook-core/money-moves', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const moves: any[] = [];

    // Cash cushion check
    const cash = await db.abAccount.findFirst({ where: { tenantId, code: '1000' } });
    if (cash) {
      const lines = await db.abJournalLine.findMany({ where: { accountId: cash.id, entry: { tenantId } } });
      const balance = lines.reduce((s: number, l: any) => s + l.debitCents - l.creditCents, 0);
      const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const expenses = await db.abExpense.aggregate({
        where: { tenantId, isPersonal: false, date: { gte: threeMonthsAgo } },
        _sum: { amountCents: true },
      });
      const monthlyExp = (expenses._sum.amountCents || 0) / 3;
      if (monthlyExp > 0 && balance / monthlyExp < 2) {
        moves.push({ type: 'cash_cushion', urgency: balance / monthlyExp < 1 ? 'critical' : 'important',
          title: 'Cash cushion thin', description: `${(balance / monthlyExp).toFixed(1)} months runway`, impactCents: Math.round(monthlyExp * 3 - balance) });
      }
    }

    // Revenue concentration
    const clients = await db.abClient.findMany({ where: { tenantId } });
    const totalRev = clients.reduce((s: number, c: any) => s + c.totalBilledCents, 0);
    if (totalRev > 0) {
      const top = clients.sort((a: any, b: any) => b.totalBilledCents - a.totalBilledCents)[0];
      if (top && top.totalBilledCents / totalRev > 0.5) {
        moves.push({ type: 'revenue_cliff', urgency: 'important',
          title: `${top.name} = ${Math.round(top.totalBilledCents / totalRev * 100)}% of revenue`,
          description: 'Diversification recommended', impactCents: top.totalBilledCents });
      }
    }

    // Move 5: Bracket proximity timing advice
    const config = await db.abTenantConfig.findUnique({ where: { userId: tenantId } });
    const estimate = await db.abTaxEstimate.findFirst({ where: { tenantId }, orderBy: { calculatedAt: 'desc' } });
    if (estimate && estimate.netIncomeCents > 0) {
      const jurisdiction = config?.jurisdiction || 'us';
      // Simplified bracket check
      const brackets = jurisdiction === 'ca'
        ? [{ min: 0, max: 5737500, rate: 0.15 }, { min: 5737500, max: 11475000, rate: 0.205 }, { min: 11475000, max: 15846800, rate: 0.26 }, { min: 15846800, max: 22170800, rate: 0.29 }, { min: 22170800, max: null as number | null, rate: 0.33 }]
        : [{ min: 0, max: 1160000, rate: 0.10 }, { min: 1160000, max: 4712500, rate: 0.12 }, { min: 4712500, max: 10052500, rate: 0.22 }, { min: 10052500, max: 19190000, rate: 0.24 }, { min: 19190000, max: null as number | null, rate: 0.32 }];

      for (let i = 0; i < brackets.length - 1; i++) {
        const b = brackets[i];
        if (b.max && estimate.netIncomeCents > b.min && estimate.netIncomeCents < b.max) {
          const gap = b.max - estimate.netIncomeCents;
          if (gap < 500000 && gap > 0) { // Within $5,000 of next bracket
            const nextRate = brackets[i + 1].rate;
            const savings = Math.round(gap * (nextRate - b.rate));
            moves.push({
              type: 'optimal_timing', urgency: 'informational',
              title: `$${(gap / 100).toFixed(0)} from next tax bracket`,
              description: `Prepay $${(gap / 100).toFixed(0)} in deductible expenses before year-end to stay in the ${(b.rate * 100).toFixed(0)}% bracket and save ~$${(savings / 100).toFixed(0)}.`,
              impactCents: savings,
            });
            break;
          }
        }
      }
    }

    res.json({ success: true, data: moves });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// Feature 4: Tax Package Generation
app.get('/api/v1/agentbook-core/tax-package', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const taxYear = parseInt(req.query.year as string) || new Date().getFullYear();
    const config = await db.abTenantConfig.findUnique({ where: { userId: tenantId } });
    const yearStart = new Date(taxYear, 0, 1);
    const yearEnd = new Date(taxYear, 11, 31);

    const revenueAccounts = await db.abAccount.findMany({ where: { tenantId, accountType: 'revenue' } });
    const revLines = await db.abJournalLine.findMany({
      where: { accountId: { in: revenueAccounts.map((a: any) => a.id) }, entry: { tenantId, date: { gte: yearStart, lte: yearEnd } } },
    });
    const gross = revLines.reduce((s: number, l: any) => s + l.creditCents, 0);

    const expenseAccounts = await db.abAccount.findMany({ where: { tenantId, accountType: 'expense' } });
    const categories: any[] = [];
    let totalExp = 0;
    for (const a of expenseAccounts) {
      const lines = await db.abJournalLine.findMany({
        where: { accountId: a.id, entry: { tenantId, date: { gte: yearStart, lte: yearEnd } } },
      });
      const amount = lines.reduce((s: number, l: any) => s + l.debitCents, 0);
      if (amount > 0) { categories.push({ category: a.taxCategory || a.name, amountCents: amount }); totalExp += amount; }
    }

    const allExp = await db.abExpense.count({ where: { tenantId, date: { gte: yearStart, lte: yearEnd }, isPersonal: false } });
    const withReceipts = await db.abExpense.count({ where: { tenantId, date: { gte: yearStart, lte: yearEnd }, isPersonal: false, receiptUrl: { not: null } } });
    const missing: string[] = [];
    if (allExp > 0 && withReceipts / allExp < 0.8) missing.push(`${allExp - withReceipts} expenses without receipts`);
    if (gross === 0) missing.push('No revenue recorded');

    res.json({ success: true, data: {
      jurisdiction: config?.jurisdiction || 'us', taxYear, grossIncomeCents: gross, totalExpensesCents: totalExp,
      netIncomeCents: gross - totalExp, expensesByCategory: categories.sort((a: any, b: any) => b.amountCents - a.amountCents),
      receiptCoverage: allExp > 0 ? withReceipts / allExp : 0, readyToFile: missing.length === 0, missingItems: missing,
    }});
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// Feature 4 Enhancement: Tax Package as HTML (downloadable/printable)
app.get('/api/v1/agentbook-core/tax-package/html', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const taxYear = parseInt(req.query.year as string) || new Date().getFullYear();
    const config = await db.abTenantConfig.findUnique({ where: { userId: tenantId } });
    const yearStart = new Date(taxYear, 0, 1);
    const yearEnd = new Date(taxYear, 11, 31);

    // Get data (same as tax-package endpoint)
    const revenueAccounts = await db.abAccount.findMany({ where: { tenantId, accountType: 'revenue' } });
    const revLines = await db.abJournalLine.findMany({
      where: { accountId: { in: revenueAccounts.map((a: any) => a.id) }, entry: { tenantId, date: { gte: yearStart, lte: yearEnd } } },
    });
    const gross = revLines.reduce((s: number, l: any) => s + l.creditCents, 0);

    const expenseAccounts = await db.abAccount.findMany({ where: { tenantId, accountType: 'expense' } });
    const categories: { category: string; amount: string; cents: number }[] = [];
    let totalExp = 0;
    for (const a of expenseAccounts) {
      const lines = await db.abJournalLine.findMany({
        where: { accountId: a.id, entry: { tenantId, date: { gte: yearStart, lte: yearEnd } } },
      });
      const amount = lines.reduce((s: number, l: any) => s + l.debitCents, 0);
      if (amount > 0) { categories.push({ category: a.taxCategory || a.name, amount: `$${(amount/100).toFixed(2)}`, cents: amount }); totalExp += amount; }
    }

    const net = gross - totalExp;
    const estimate = await db.abTaxEstimate.findFirst({ where: { tenantId }, orderBy: { calculatedAt: 'desc' } });
    const jurisdiction = config?.jurisdiction || 'us';
    const formName = jurisdiction === 'ca' ? 'T2125 — Statement of Business Activities' : 'Schedule C — Profit or Loss from Business';
    const currency = config?.currency || 'USD';
    const fmt = (cents: number) => `${currency === 'CAD' ? 'C' : ''}$${(cents/100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    const allExp = await db.abExpense.count({ where: { tenantId, date: { gte: yearStart, lte: yearEnd }, isPersonal: false } });
    const withReceipts = await db.abExpense.count({ where: { tenantId, date: { gte: yearStart, lte: yearEnd }, isPersonal: false, receiptUrl: { not: null } } });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AgentBook Tax Package — ${taxYear}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a; }
    h1 { font-size: 24px; border-bottom: 2px solid #10b981; padding-bottom: 8px; }
    h2 { font-size: 18px; color: #374151; margin-top: 32px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { background: #f9fafb; font-weight: 600; }
    td.amount { text-align: right; font-family: 'SF Mono', monospace; }
    .total-row { font-weight: 700; border-top: 2px solid #1a1a1a; }
    .summary-box { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 20px; margin: 24px 0; }
    .summary-box h3 { margin: 0 0 12px 0; color: #166534; }
    .meta { color: #6b7280; font-size: 14px; }
    .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
    @media print { body { padding: 0; } .no-print { display: none; } }
  </style>
</head>
<body>
  <h1>AgentBook Tax Package — ${taxYear}</h1>
  <p class="meta">Prepared for: Tenant ${tenantId} · Jurisdiction: ${jurisdiction.toUpperCase()} · Currency: ${currency}</p>
  <p class="meta">Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} by AgentBook AI</p>

  <h2>${formName}</h2>

  <div class="summary-box">
    <h3>Summary</h3>
    <table>
      <tr><td>Gross Business Income</td><td class="amount">${fmt(gross)}</td></tr>
      <tr><td>Total Business Expenses</td><td class="amount">${fmt(totalExp)}</td></tr>
      <tr class="total-row"><td>Net Business Income</td><td class="amount">${fmt(net)}</td></tr>
    </table>
  </div>

  ${estimate ? `
  <h2>Tax Estimate</h2>
  <table>
    <tr><td>${jurisdiction === 'ca' ? 'CPP Self-Employed' : 'Self-Employment Tax'}</td><td class="amount">${fmt(estimate.seTaxCents)}</td></tr>
    <tr><td>Income Tax</td><td class="amount">${fmt(estimate.incomeTaxCents)}</td></tr>
    <tr class="total-row"><td>Total Estimated Tax</td><td class="amount">${fmt(estimate.totalTaxCents)}</td></tr>
    <tr><td>Effective Tax Rate</td><td class="amount">${(estimate.effectiveRate * 100).toFixed(1)}%</td></tr>
  </table>
  ` : ''}

  <h2>Expense Detail by ${jurisdiction === 'ca' ? 'T2125' : 'Schedule C'} Category</h2>
  <table>
    <thead><tr><th>Category</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>
      ${categories.sort((a, b) => b.cents - a.cents).map(c => `<tr><td>${c.category}</td><td class="amount">${c.amount}</td></tr>`).join('\n      ')}
      <tr class="total-row"><td>Total Expenses</td><td class="amount">${fmt(totalExp)}</td></tr>
    </tbody>
  </table>

  <h2>Documentation Status</h2>
  <table>
    <tr><td>Total Expenses</td><td class="amount">${allExp}</td></tr>
    <tr><td>With Receipts</td><td class="amount">${withReceipts}</td></tr>
    <tr><td>Missing Receipts</td><td class="amount">${allExp - withReceipts}</td></tr>
    <tr><td>Receipt Coverage</td><td class="amount">${allExp > 0 ? Math.round(withReceipts / allExp * 100) : 0}%</td></tr>
  </table>

  <div class="footer">
    <p>© ${taxYear} AgentBook · This document is generated from your accounting records. It is not a filed tax return.</p>
    <p>Consult a qualified tax professional before filing. AgentBook is not a CPA or tax advisor.</p>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// Feature 5: Client Intelligence
app.get('/api/v1/agentbook-core/client-health', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const clients = await db.abClient.findMany({ where: { tenantId } });
    const totalBilled = clients.reduce((s: number, c: any) => s + c.totalBilledCents, 0);

    const result = await Promise.all(clients.map(async (c: any) => {
      const share = totalBilled > 0 ? c.totalBilledCents / totalBilled : 0;
      const outstanding = c.totalBilledCents - c.totalPaidCents;

      // Effective hourly rate from time entries
      const timeEntries = await db.abTimeEntry.findMany({
        where: { tenantId, clientId: c.id, endedAt: { not: null } },
      });
      const totalMinutes = timeEntries.reduce((s: number, e: any) => s + (e.durationMinutes || 0), 0);
      const totalHours = totalMinutes / 60;
      const effectiveRateCents = totalHours > 0 ? Math.round(c.totalBilledCents / totalHours) : 0;

      // Payment reliability from invoices
      const paidInvoices = await db.abInvoice.findMany({
        where: { tenantId, clientId: c.id, status: 'paid' },
        include: { payments: true },
      });
      const onTime = paidInvoices.filter((inv: any) => {
        if (!inv.payments.length) return false;
        return new Date(inv.payments[0].date) <= new Date(inv.dueDate);
      }).length;
      const reliability = paidInvoices.length > 0 ? onTime / paidInvoices.length : 1;
      const daysList = paidInvoices.filter((inv: any) => inv.payments.length > 0).map((inv: any) =>
        Math.ceil((new Date(inv.payments[0].date).getTime() - new Date(inv.issuedDate).getTime()) / (1000*60*60*24))
      );
      const avgDays = daysList.length > 0 ? Math.round(daysList.reduce((s: number, d: number) => s + d, 0) / daysList.length) : 30;

      let risk: string = 'low';
      let recommendation = `${c.name} is a healthy client.`;
      if (effectiveRateCents > 0 && effectiveRateCents < (totalBilled / Math.max(1, clients.length)) * 0.7) {
        risk = 'high'; recommendation = `Effective rate below average. Consider rate increase.`;
      } else if (reliability < 0.7) {
        risk = 'moderate'; recommendation = `Payment reliability ${Math.round(reliability*100)}%. Consider shorter terms.`;
      }

      return {
        clientId: c.id, clientName: c.name, lifetimeValueCents: c.totalBilledCents,
        outstandingCents: outstanding, revenueShare: share,
        effectiveRateCents, totalHours: Math.round(totalHours * 10) / 10,
        paymentReliability: reliability, avgDaysToPay: avgDays,
        riskLevel: risk, recommendation,
      };
    }));

    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// Feature 7: Autopilot Status
app.get('/api/v1/agentbook-core/autopilot', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const config = await db.abTenantConfig.findUnique({ where: { userId: tenantId } });
    const monthsActive = config ? Math.floor((Date.now() - new Date(config.createdAt).getTime()) / (30 * 24 * 60 * 60 * 1000)) : 0;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const corrections = await db.abLearningEvent.count({ where: { tenantId, eventType: 'correction', createdAt: { gte: thirtyDaysAgo } } });
    const confirmations = await db.abLearningEvent.count({ where: { tenantId, eventType: 'confirmation', createdAt: { gte: thirtyDaysAgo } } });
    const total = corrections + confirmations;
    const accuracy = total > 0 ? confirmations / total : 0.5;
    const trustLevel = Math.min(1, monthsActive / 6) * 0.4 + accuracy * 0.6;
    const phase = trustLevel > 0.9 ? 'autopilot' : trustLevel > 0.7 ? 'confident' : trustLevel > 0.4 ? 'learning' : 'training';

    // Auto-adjust bookkeeper agent based on trust phase
    if (phase === 'confident' || phase === 'autopilot') {
      await db.abAgentConfig.upsert({
        where: { tenantId_agentId: { tenantId, agentId: 'bookkeeper' } },
        update: { autoApprove: true },
        create: { tenantId, agentId: 'bookkeeper', autoApprove: true },
      });
    } else if (phase === 'training') {
      await db.abAgentConfig.upsert({
        where: { tenantId_agentId: { tenantId, agentId: 'bookkeeper' } },
        update: { autoApprove: false },
        create: { tenantId, agentId: 'bookkeeper', autoApprove: false },
      });
    }

    res.json({ success: true, data: { trustLevel, trustPhase: phase, accuracy, monthsActive, corrections, confirmations } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// === IMMUTABILITY GUARD: Journal entries cannot be modified once created ===
// Per SKILL.md: "Corrections are made via reversing entries, never by editing existing records."
app.put('/api/v1/agentbook-core/journal-entries/:id', async (_req, res) => {
  res.status(403).json({
    success: false,
    error: 'Journal entries are immutable. Create a reversing entry instead.',
    constraint: 'immutability_invariant',
  });
});

app.patch('/api/v1/agentbook-core/journal-entries/:id', async (_req, res) => {
  res.status(403).json({
    success: false,
    error: 'Journal entries are immutable. Create a reversing entry instead.',
    constraint: 'immutability_invariant',
  });
});

app.delete('/api/v1/agentbook-core/journal-entries/:id', async (_req, res) => {
  res.status(403).json({
    success: false,
    error: 'Journal entries cannot be deleted. Create a reversing entry instead.',
    constraint: 'immutability_invariant',
  });
});

// === ONBOARDING (Phase 6) ===

app.get('/api/v1/agentbook-core/onboarding', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    let progress = await db.abOnboardingProgress.findUnique({ where: { tenantId } });
    if (!progress) {
      progress = await db.abOnboardingProgress.create({ data: { tenantId } });
    }

    const STEPS = [
      { id: 'business_type', title: 'Choose your business type', description: 'Freelancer, sole proprietor, or consultant?', order: 0 },
      { id: 'jurisdiction', title: 'Set your country & region', description: 'US, Canada, UK, or Australia?', order: 1 },
      { id: 'currency', title: 'Set your currency', description: 'USD, CAD, GBP, EUR, or AUD?', order: 2 },
      { id: 'accounts', title: 'Set up chart of accounts', description: 'Based on your tax jurisdiction', order: 3 },
      { id: 'bank', title: 'Connect your bank', description: 'Link via Plaid for auto-import', order: 4 },
      { id: 'first_expense', title: 'Record your first expense', description: 'Snap a receipt or type an expense', order: 5 },
      { id: 'telegram', title: 'Connect Telegram', description: 'Proactive notifications on the go', order: 6 },
    ];

    const completedSet = new Set(progress.completedSteps);
    const steps = STEPS.map(s => ({ ...s, completed: completedSet.has(s.id) }));
    const completedCount = steps.filter(s => s.completed).length;

    res.json({
      success: true,
      data: {
        steps,
        currentStep: progress.currentStep,
        percentComplete: STEPS.length > 0 ? completedCount / STEPS.length : 0,
        isComplete: completedCount === STEPS.length,
      },
    });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

app.post('/api/v1/agentbook-core/onboarding/complete-step', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { stepId } = req.body;

    let progress = await db.abOnboardingProgress.findUnique({ where: { tenantId } });
    if (!progress) {
      progress = await db.abOnboardingProgress.create({ data: { tenantId } });
    }

    const completedSteps = [...new Set([...progress.completedSteps, stepId])];
    const currentStep = Math.min(completedSteps.length, 6);

    await db.abOnboardingProgress.update({
      where: { tenantId },
      data: {
        completedSteps,
        currentStep,
        ...(stepId === 'bank' && { bankConnected: true }),
        ...(stepId === 'accounts' && { accountsSeeded: true }),
        ...(stepId === 'first_expense' && { firstExpense: true }),
        ...(stepId === 'telegram' && { telegramConnected: true }),
        ...(completedSteps.length === 7 && { completedAt: new Date() }),
      },
    });

    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

app.post('/api/v1/agentbook-core/accounts/seed-jurisdiction', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const config = await db.abTenantConfig.findUnique({ where: { userId: tenantId } });
    const jurisdiction = config?.jurisdiction || 'us';

    // Default chart of accounts based on jurisdiction
    const US_ACCOUNTS = [
      { code: '1000', name: 'Cash', accountType: 'asset' },
      { code: '1100', name: 'Accounts Receivable', accountType: 'asset' },
      { code: '1200', name: 'Business Checking', accountType: 'asset' },
      { code: '2000', name: 'Accounts Payable', accountType: 'liability' },
      { code: '2100', name: 'Sales Tax Payable', accountType: 'liability' },
      { code: '3000', name: "Owner's Equity", accountType: 'equity' },
      { code: '4000', name: 'Service Revenue', accountType: 'revenue', taxCategory: 'Line 1' },
      { code: '5000', name: 'Advertising', accountType: 'expense', taxCategory: 'Line 8' },
      { code: '5100', name: 'Car & Truck', accountType: 'expense', taxCategory: 'Line 9' },
      { code: '5200', name: 'Commissions & Fees', accountType: 'expense', taxCategory: 'Line 10' },
      { code: '5300', name: 'Contract Labor', accountType: 'expense', taxCategory: 'Line 11' },
      { code: '5400', name: 'Insurance', accountType: 'expense', taxCategory: 'Line 15' },
      { code: '5700', name: 'Legal & Professional', accountType: 'expense', taxCategory: 'Line 17' },
      { code: '5800', name: 'Office Expenses', accountType: 'expense', taxCategory: 'Line 18' },
      { code: '5900', name: 'Rent', accountType: 'expense', taxCategory: 'Line 20b' },
      { code: '6100', name: 'Supplies', accountType: 'expense', taxCategory: 'Line 22' },
      { code: '6300', name: 'Travel', accountType: 'expense', taxCategory: 'Line 24a' },
      { code: '6400', name: 'Meals', accountType: 'expense', taxCategory: 'Line 24b' },
      { code: '6500', name: 'Utilities', accountType: 'expense', taxCategory: 'Line 25' },
      { code: '6600', name: 'Software & Subscriptions', accountType: 'expense', taxCategory: 'Line 27a' },
      { code: '6700', name: 'Bank Fees', accountType: 'expense', taxCategory: 'Line 27a' },
    ];

    const accounts = US_ACCOUNTS; // TODO: Select based on jurisdiction

    const created = await db.$transaction(
      accounts.map(a => db.abAccount.upsert({
        where: { tenantId_code: { tenantId, code: a.code } },
        update: { name: a.name, accountType: a.accountType, taxCategory: (a as any).taxCategory },
        create: { tenantId, ...a },
      }))
    );

    res.json({ success: true, data: { count: created.length } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// === CPA COLLABORATION (Phase 6) ===

app.get('/api/v1/agentbook-core/cpa/notes', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const notes = await db.abCPANote.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ success: true, data: notes });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

app.post('/api/v1/agentbook-core/cpa/notes', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { content, attachedTo, attachedType } = req.body;
    const note = await db.abCPANote.create({
      data: { tenantId, authorId: tenantId, content, attachedTo, attachedType },
    });
    res.json({ success: true, data: note });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

app.post('/api/v1/agentbook-core/cpa/generate-link', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { email } = req.body;
    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await db.abTenantAccess.create({
      data: {
        tenantId,
        userId: `cpa-${token.slice(0, 8)}`,
        email: email || 'cpa@example.com',
        role: 'cpa',
        accessToken: token,
        expiresAt,
      },
    });

    res.json({ success: true, data: { token, expiresAt } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// === ADMIN: LLM PROVIDER CONFIG (Phase 8) ===

app.get('/api/v1/agentbook-core/admin/llm-configs', async (req, res) => {
  try {
    const configs = await db.abLLMProviderConfig.findMany({ orderBy: { createdAt: 'asc' } });
    res.json({ success: true, data: configs });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

app.post('/api/v1/agentbook-core/admin/llm-configs', async (req, res) => {
  try {
    const { name, provider, apiKey, baseUrl, modelFast, modelStandard, modelPremium, modelVision, isDefault } = req.body;

    // If setting as default, unset others
    if (isDefault) {
      await db.abLLMProviderConfig.updateMany({ data: { isDefault: false } });
    }

    const config = await db.abLLMProviderConfig.create({
      data: { name, provider, apiKey, baseUrl, modelFast, modelStandard, modelPremium, modelVision, isDefault: isDefault || false },
    });
    res.status(201).json({ success: true, data: config });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

app.post('/api/v1/agentbook-core/admin/llm-configs/:id/set-default', async (req, res) => {
  try {
    await db.abLLMProviderConfig.updateMany({ data: { isDefault: false } });
    await db.abLLMProviderConfig.update({ where: { id: req.params.id }, data: { isDefault: true } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

app.delete('/api/v1/agentbook-core/admin/llm-configs/:id', async (req, res) => {
  try {
    await db.abLLMProviderConfig.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

app.post('/api/v1/agentbook-core/admin/llm-configs/:id/test', async (req, res) => {
  try {
    const config = await db.abLLMProviderConfig.findUnique({ where: { id: req.params.id } });
    if (!config) return res.status(404).json({ success: false, error: 'Config not found' });

    // Test with Gemini API (direct call for testing)
    if (config.provider === 'gemini') {
      const model = config.modelFast || 'gemini-2.0-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;

      const start = Date.now();
      const apiRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Say "AgentBook LLM connection successful!" in one sentence.' }] }],
          generationConfig: { maxOutputTokens: 50 },
        }),
      });
      const latencyMs = Date.now() - start;

      if (!apiRes.ok) {
        const error = await apiRes.text();
        return res.json({ success: false, error: `API error: ${error.slice(0, 200)}` });
      }

      const data = await apiRes.json();
      const response = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      return res.json({ success: true, data: { model, response, latencyMs } });
    }

    // Generic test for other providers
    res.json({ success: true, data: { model: 'test', response: 'Provider test not implemented yet', latencyMs: 0 } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

start();
