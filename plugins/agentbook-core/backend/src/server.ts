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
