/**
 * AgentBook Core Backend — Double-entry ledger with constraint engine.
 * Every financial action produces a balanced journal entry.
 * The constraint engine is code, not LLM prompts.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createPluginServer } from '@naap/plugin-server-sdk';
import { db } from './db/client.js';

const pluginConfig = JSON.parse(
  readFileSync(new URL('../../plugin.json', import.meta.url), 'utf8')
);

const { app, start } = createPluginServer(pluginConfig);

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

    const period = await db.abFiscalPeriod.upsert({
      where: { tenantId_year_month: { tenantId, year, month } },
      update: { status: 'closed', closedAt: new Date(), closedBy: tenantId },
      create: { tenantId, year, month, status: 'closed', closedAt: new Date(), closedBy: tenantId },
    });

    // Emit event
    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'period.closed',
        actor: 'human',
        action: { year, month },
      },
    });

    res.json({ success: true, data: period });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

start();
