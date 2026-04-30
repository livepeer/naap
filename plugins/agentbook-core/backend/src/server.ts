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
import { handleAgentMessage } from './agent-brain.js';

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

// === Multi-Currency Formatter ===
function fmtCurrency(cents: number, currency?: string): string {
  const symbols: Record<string, string> = { USD: '$', CAD: 'CA$', GBP: '\u00a3', EUR: '\u20ac', AUD: 'A$' };
  const sym = symbols[currency || 'USD'] || (currency || 'USD') + ' ';
  return `${sym}${(cents / 100).toFixed(2)}`;
}

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
    const { businessType, jurisdiction, region, currency, locale, timezone, fiscalYearStart, autoApproveLimitCents, autoRemindEnabled, autoRemindDays } = req.body;
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
        ...(autoRemindEnabled !== undefined && { autoRemindEnabled }),
        ...(autoRemindDays !== undefined && { autoRemindDays }),
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

// === Telegram Bot Configuration ===

// POST /telegram/setup — Configure Telegram bot for this tenant
app.post('/api/v1/agentbook-core/telegram/setup', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { botToken } = req.body;

    if (!botToken || !botToken.includes(':')) {
      return res.status(400).json({ success: false, error: 'Valid Telegram bot token required (format: 123456:ABC...)' });
    }

    // Verify the token with Telegram
    let botInfo: any;
    try {
      const verifyRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const verifyData = await verifyRes.json() as any;
      if (!verifyData.ok) {
        return res.status(400).json({ success: false, error: 'Invalid bot token — Telegram rejected it. Get a valid token from @BotFather.' });
      }
      botInfo = verifyData.result;
    } catch {
      return res.status(400).json({ success: false, error: 'Could not verify token with Telegram. Check your internet connection.' });
    }

    // Generate webhook secret
    const webhookSecret = crypto.randomUUID().replace(/-/g, '');

    // Determine webhook URL
    const baseUrl = process.env.TELEGRAM_WEBHOOK_BASE_URL || process.env.NEXTAUTH_URL || '';
    const webhookUrl = baseUrl ? `${baseUrl}/api/v1/agentbook/telegram/webhook` : '';

    // Upsert bot config
    const botConfig = await db.abTelegramBot.upsert({
      where: { tenantId },
      update: {
        botToken,
        botUsername: botInfo.username || null,
        webhookSecret,
        webhookUrl,
        enabled: true,
      },
      create: {
        tenantId,
        botToken,
        botUsername: botInfo.username || null,
        webhookSecret,
        webhookUrl,
        chatIds: [],
        enabled: true,
      },
    });

    // Register webhook with Telegram if we have a base URL
    let webhookRegistered = false;
    if (webhookUrl) {
      try {
        const regRes = await fetch(
          `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}&secret_token=${webhookSecret}&allowed_updates=${encodeURIComponent(JSON.stringify(['message', 'callback_query']))}`
        );
        const regData = await regRes.json() as any;
        webhookRegistered = regData.ok;
      } catch { /* webhook registration failed — user can do it manually */ }
    }

    res.json({
      success: true,
      data: {
        botUsername: botInfo.username,
        botName: botInfo.first_name,
        webhookRegistered,
        webhookUrl: webhookUrl || 'Not configured — set TELEGRAM_WEBHOOK_BASE_URL env var or register manually',
        instructions: webhookRegistered
          ? `Your bot @${botInfo.username} is connected! Send it a message to start.`
          : `Bot @${botInfo.username} saved. To complete setup:\n1. Set up a tunnel: ./agentbook/keep-tunnel-alive.sh\n2. Register webhook: curl "https://api.telegram.org/bot${botToken.slice(0, 10)}..../setWebhook?url=YOUR_TUNNEL_URL/api/v1/agentbook/telegram/webhook&secret_token=${webhookSecret}"`,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// GET /telegram/status — Check Telegram bot configuration
app.get('/api/v1/agentbook-core/telegram/status', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const botConfig = await db.abTelegramBot.findUnique({ where: { tenantId } });
    if (!botConfig) {
      return res.json({ success: true, data: { configured: false, instructions: 'Send your Telegram bot token to connect. Get one from @BotFather in Telegram.' } });
    }

    // Check webhook status
    let webhookInfo: any = null;
    try {
      const infoRes = await fetch(`https://api.telegram.org/bot${botConfig.botToken}/getWebhookInfo`);
      webhookInfo = ((await infoRes.json()) as any).result;
    } catch { /* can't reach telegram */ }

    res.json({
      success: true,
      data: {
        configured: true,
        enabled: botConfig.enabled,
        botUsername: botConfig.botUsername,
        chatIds: botConfig.chatIds,
        webhookUrl: webhookInfo?.url || botConfig.webhookUrl,
        webhookActive: webhookInfo ? !webhookInfo.last_error_message : null,
        lastError: webhookInfo?.last_error_message || null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// POST /telegram/resolve-chat — Internal: resolve chat ID to tenant (called by webhook adapter)
app.post('/api/v1/agentbook-core/telegram/resolve-chat', async (req, res) => {
  try {
    const { chatId, botToken } = req.body;
    if (!chatId) return res.status(400).json({ success: false, error: 'chatId required' });

    // Find bot config that has this chatId in its chatIds array, or by botToken
    let botConfig: any = null;
    if (botToken) {
      botConfig = await db.abTelegramBot.findFirst({ where: { botToken, enabled: true } });
    }
    if (!botConfig) {
      // Search all bots for this chatId
      const allBots = await db.abTelegramBot.findMany({ where: { enabled: true } });
      botConfig = allBots.find((b: any) => {
        const ids = (b.chatIds as string[]) || [];
        return ids.includes(String(chatId));
      });
    }

    if (botConfig) {
      // Auto-register this chatId if not already in the list
      const ids = (botConfig.chatIds as string[]) || [];
      if (!ids.includes(String(chatId))) {
        ids.push(String(chatId));
        await db.abTelegramBot.update({ where: { id: botConfig.id }, data: { chatIds: ids as any } });
      }
      return res.json({ success: true, data: { tenantId: botConfig.tenantId } });
    }

    res.json({ success: true, data: { tenantId: null } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// DELETE /telegram/disconnect — Remove Telegram bot
app.delete('/api/v1/agentbook-core/telegram/disconnect', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const botConfig = await db.abTelegramBot.findUnique({ where: { tenantId } });
    if (botConfig) {
      // Remove webhook from Telegram
      try {
        await fetch(`https://api.telegram.org/bot${botConfig.botToken}/deleteWebhook`);
      } catch { /* best effort */ }
      await db.abTelegramBot.delete({ where: { tenantId } });
    }
    res.json({ success: true, data: { disconnected: true } });
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

// ============================================
// Phase 12: ENHANCED CONVERSATIONAL FINANCIAL MEMORY
// ============================================

// Helper: build comprehensive financial context for LLM
async function buildFinancialContext(tenantId: string) {
  const config = await db.abTenantConfig.findFirst({ where: { userId: tenantId } });

  // Revenue
  const revenueAccounts = await db.abAccount.findMany({ where: { tenantId, accountType: 'revenue' } });
  const revLines = await db.abJournalLine.findMany({
    where: { accountId: { in: revenueAccounts.map((a: any) => a.id) }, entry: { tenantId } },
  });
  const totalRevenue = revLines.reduce((s: number, l: any) => s + l.creditCents, 0);

  // Expenses
  const expenses = await db.abExpense.findMany({ where: { tenantId, isPersonal: false }, include: { vendor: true } });
  const totalExpenses = expenses.reduce((s: number, e: any) => s + e.amountCents, 0);

  // Expenses by category
  const categories: Record<string, number> = {};
  for (const e of expenses) {
    const cat = e.categoryId || 'uncategorized';
    categories[cat] = (categories[cat] || 0) + e.amountCents;
  }

  // By vendor
  const vendors: Record<string, { total: number; count: number }> = {};
  for (const e of expenses) {
    const v = e.vendor?.name || 'Unknown';
    if (!vendors[v]) vendors[v] = { total: 0, count: 0 };
    vendors[v].total += e.amountCents;
    vendors[v].count++;
  }
  const topVendors = Object.entries(vendors).sort((a, b) => b[1].total - a[1].total).slice(0, 10);

  // Clients
  const clients = await db.abClient.findMany({ where: { tenantId } });
  const clientSummary = clients.map((c: any) => ({
    name: c.name, billedCents: c.totalBilledCents, paidCents: c.totalPaidCents,
    outstandingCents: c.totalBilledCents - c.totalPaidCents,
  }));

  // Invoices
  const invoices = await db.abInvoice.findMany({ where: { tenantId }, orderBy: { issuedDate: 'desc' }, take: 20 });
  const invoiceSummary = invoices.map((i: any) => ({
    number: i.number, clientId: i.clientId, amountCents: i.amountCents,
    currency: i.currency, status: i.status, issuedDate: i.issuedDate, dueDate: i.dueDate,
  }));

  // Tax estimate
  const taxEstimate = await db.abTaxEstimate.findFirst({ where: { tenantId }, orderBy: { calculatedAt: 'desc' } });

  // Cash balance
  const cashAccount = await db.abAccount.findFirst({ where: { tenantId, code: '1000' } });
  let cashBalance = 0;
  if (cashAccount) {
    const cashLines = await db.abJournalLine.findMany({ where: { accountId: cashAccount.id, entry: { tenantId } } });
    cashBalance = cashLines.reduce((s: number, l: any) => s + l.debitCents - l.creditCents, 0);
  }

  // Recurring expenses
  const recurring = await db.abRecurringRule.findMany({ where: { tenantId, active: true } });

  return {
    jurisdiction: config?.jurisdiction || 'us',
    currency: config?.currency || 'USD',
    businessName: config?.businessName || 'Unknown',
    totalRevenueCents: totalRevenue,
    totalExpenseCents: totalExpenses,
    netIncomeCents: totalRevenue - totalExpenses,
    cashBalanceCents: cashBalance,
    expenseCount: expenses.length,
    topVendors: topVendors.map(([name, d]) => ({ name, totalCents: d.total, count: d.count })),
    clients: clientSummary,
    recentInvoices: invoiceSummary,
    taxEstimate: taxEstimate ? {
      totalTaxCents: taxEstimate.totalTaxCents,
      effectiveRate: taxEstimate.effectiveRate,
      netIncomeCents: taxEstimate.netIncomeCents,
    } : null,
    recurringExpenses: recurring.length,
    monthlyBurnCents: Math.round(totalExpenses / Math.max(1, Math.ceil(expenses.length / 30) || 1)),
  };
}

// Helper: call Gemini LLM
async function callGemini(systemPrompt: string, userMessage: string, maxTokens: number = 500): Promise<string | null> {
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
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

// POST /ask — Enhanced conversational memory with LLM + pattern matching + conversation history
app.post('/api/v1/agentbook-core/ask', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { question } = req.body;
    if (!question) return res.status(400).json({ success: false, error: 'question is required' });

    const start = Date.now();
    const q = question.toLowerCase();
    let answer = '';
    let data: any = null;
    let queryType = 'pattern';

    // === PATTERN MATCHING (fast path for common questions) ===
    if (q.includes('revenue') || q.includes('income') || q.includes('earn')) {
      const accounts = await db.abAccount.findMany({ where: { tenantId, accountType: 'revenue' } });
      const lines = await db.abJournalLine.findMany({
        where: { accountId: { in: accounts.map((a: any) => a.id) }, entry: { tenantId } },
      });
      const total = lines.reduce((s: number, l: any) => s + l.creditCents, 0);
      answer = `Your total revenue is $${(total / 100).toLocaleString()}.`;
      data = { totalRevenueCents: total };
    } else if (q.includes('spend') || q.includes('expense') || q.includes('cost')) {
      // Enhanced: detect time period + category
      const now = new Date();
      let since = new Date(now.getFullYear(), 0, 1); // default: this year
      if (q.includes('last month')) { since = new Date(now); since.setMonth(since.getMonth() - 1); }
      else if (q.includes('last quarter') || q.includes('this quarter')) { since = new Date(now); since.setMonth(since.getMonth() - 3); }
      else if (q.includes('this month')) { since = new Date(now.getFullYear(), now.getMonth(), 1); }

      const expenses = await db.abExpense.findMany({
        where: { tenantId, isPersonal: false, date: { gte: since } },
        include: { vendor: true },
      });
      const total = expenses.reduce((s: number, e: any) => s + e.amountCents, 0);

      // Vendor breakdown
      const byVendor: Record<string, number> = {};
      for (const e of expenses) { byVendor[e.vendor?.name || 'Other'] = (byVendor[e.vendor?.name || 'Other'] || 0) + e.amountCents; }
      const topVendors = Object.entries(byVendor).sort((a, b) => b[1] - a[1]).slice(0, 5);

      answer = `You spent $${(total / 100).toLocaleString()} across ${expenses.length} transactions.`;
      if (topVendors.length > 0) {
        answer += ` Top spending: ${topVendors.map(([v, a]) => `${v} ($${(a / 100).toLocaleString()})`).join(', ')}.`;
      }
      data = { totalCents: total, count: expenses.length, topVendors: topVendors.map(([n, a]) => ({ name: n, cents: a })) };
    } else if ((q.includes('tax') || q.includes('owe')) && !q.includes('owe me') && !q.includes('owes me')) {
      const estimate = await db.abTaxEstimate.findFirst({ where: { tenantId }, orderBy: { calculatedAt: 'desc' } });
      if (estimate) {
        answer = `Estimated tax: $${(estimate.totalTaxCents / 100).toLocaleString()}. Effective rate: ${(estimate.effectiveRate * 100).toFixed(1)}%. Net income: $${(estimate.netIncomeCents / 100).toLocaleString()}.`;
        data = estimate;
      } else { answer = 'No tax estimate yet. Record some revenue and expenses first.'; }
    } else if ((q.includes('cash') || q.includes('balance') || q.includes('money')) && !q.includes('owe') && !q.includes('who')) {
      const cash = await db.abAccount.findFirst({ where: { tenantId, code: '1000' } });
      if (cash) {
        const lines = await db.abJournalLine.findMany({ where: { accountId: cash.id, entry: { tenantId } } });
        const balance = lines.reduce((s: number, l: any) => s + l.debitCents - l.creditCents, 0);

        // Enhanced: add runway calculation
        const expenses = await db.abExpense.aggregate({ where: { tenantId, isPersonal: false }, _sum: { amountCents: true } });
        const totalExp = expenses._sum.amountCents || 1;
        const expCount = await db.abExpense.count({ where: { tenantId, isPersonal: false } });
        const avgMonthly = expCount > 0 ? Math.round(totalExp / Math.max(1, expCount / 30)) : 0;
        const runway = avgMonthly > 0 ? (balance / avgMonthly).toFixed(1) : 'N/A';

        answer = `Cash balance: $${(balance / 100).toLocaleString()}. Monthly burn: ~$${(avgMonthly / 100).toLocaleString()}. Runway: ${runway} months.`;
        data = { balanceCents: balance, monthlyBurnCents: avgMonthly, runwayMonths: parseFloat(runway as string) || 0 };
      } else { answer = 'No cash account found.'; }
    } else if (q.includes('client') || q.includes('outstanding') || q.includes('owe me') || q.includes('owes me') || q.includes('who owes')) {
      const clients = await db.abClient.findMany({ where: { tenantId } });
      const outstanding = clients.reduce((s: number, c: any) => s + (c.totalBilledCents - c.totalPaidCents), 0);
      const clientDetails = clients
        .map((c: any) => ({ name: c.name, outstanding: c.totalBilledCents - c.totalPaidCents }))
        .filter(c => c.outstanding > 0)
        .sort((a, b) => b.outstanding - a.outstanding);

      answer = `${clients.length} clients. Total outstanding: $${(outstanding / 100).toLocaleString()}.`;
      if (clientDetails.length > 0) {
        answer += ` Overdue: ${clientDetails.map(c => `${c.name} ($${(c.outstanding / 100).toLocaleString()})`).join(', ')}.`;
      }
      data = { clients: clients.length, outstandingCents: outstanding, clientDetails };
    } else {
      // === LLM PATH (complex questions) ===
      queryType = 'llm';
      const context = await buildFinancialContext(tenantId);

      // Get recent conversation for continuity
      const recentConvo = await db.abConversation.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      const convoHistory = recentConvo.reverse().map((c: any) => `Q: ${c.question}\nA: ${c.answer}`).join('\n\n');

      const contextStr = JSON.stringify(context, null, 2);
      const llmAnswer = await callGemini(
        `You are AgentBook, an AI-powered financial agent. Answer questions using the financial data provided. Be concise, specific, and always include dollar amounts. If comparing periods, calculate the difference. If the data doesn't support an answer, say so clearly. Currency: ${context.currency}. Jurisdiction: ${context.jurisdiction}.`,
        `${convoHistory ? `Recent conversation:\n${convoHistory}\n\n` : ''}Financial data:\n${contextStr}\n\nNew question: ${question}`,
        500,
      );

      if (llmAnswer) {
        answer = llmAnswer;
        data = { source: 'gemini', contextUsed: Object.keys(context) };
      } else {
        answer = `Your finances: Revenue $${(context.totalRevenueCents / 100).toLocaleString()}, Expenses $${(context.totalExpenseCents / 100).toLocaleString()}, Net $${(context.netIncomeCents / 100).toLocaleString()}, Cash $${(context.cashBalanceCents / 100).toLocaleString()}. Ask about revenue, expenses, taxes, cash, or clients for details.`;
        queryType = 'fallback';
      }
    }

    const latencyMs = Date.now() - start;

    // Save to conversation history (Phase 12: memory continuity)
    await db.abConversation.create({
      data: { tenantId, question, answer, queryType, data: data || {}, latencyMs },
    });

    // Also log as event for audit
    await db.abEvent.create({
      data: { tenantId, eventType: 'ask.question', actor: 'human', action: { question, queryType, latencyMs } },
    });

    // Get recent conversation for context display
    const recentQuestions = await db.abConversation.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { question: true, answer: true, queryType: true, createdAt: true },
    });

    res.json({ success: true, data: { question, answer, data, queryType, latencyMs, conversationHistory: recentQuestions } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// GET /conversations — Get conversation history
app.get('/api/v1/agentbook-core/conversations', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const limit = parseInt(req.query.limit as string) || 20;
    const conversations = await db.abConversation.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json({ success: true, data: conversations });
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

// ============================================
// Phase 12: AUTONOMOUS WORKFLOW COMPOSITION ENGINE
// ============================================

// POST /automations — Create a new workflow automation
app.post('/api/v1/agentbook-core/automations', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { name, description, trigger, conditions, actions } = req.body;

    if (!name || !trigger || !actions) {
      return res.status(400).json({ success: false, error: 'name, trigger, and actions are required' });
    }

    // Validate trigger type
    const validTriggers = ['schedule', 'event', 'condition'];
    if (!validTriggers.includes(trigger.type)) {
      return res.status(400).json({ success: false, error: `trigger.type must be: ${validTriggers.join(', ')}` });
    }

    // Validate actions
    const validActions = ['send_reminder', 'create_invoice', 'notify', 'categorize_expense', 'update_status', 'send_email', 'escalate'];
    for (const action of actions) {
      if (!validActions.includes(action.type)) {
        return res.status(400).json({ success: false, error: `Invalid action type: ${action.type}. Valid: ${validActions.join(', ')}` });
      }
    }

    const automation = await db.abAutomation.create({
      data: { tenantId, name, description, trigger, conditions: conditions || null, actions, status: 'active' },
    });

    await db.abEvent.create({
      data: {
        tenantId, eventType: 'automation.created', actor: 'user',
        action: { automationId: automation.id, name, triggerType: trigger.type, actionCount: actions.length },
      },
    });

    res.status(201).json({ success: true, data: automation });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// GET /automations — List all automations
app.get('/api/v1/agentbook-core/automations', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const automations = await db.abAutomation.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: automations });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// PUT /automations/:id — Update automation
app.put('/api/v1/agentbook-core/automations/:id', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const existing = await db.abAutomation.findFirst({ where: { id: req.params.id, tenantId } });
    if (!existing) return res.status(404).json({ success: false, error: 'Automation not found' });

    const updated = await db.abAutomation.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json({ success: true, data: updated });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// DELETE /automations/:id — Delete automation
app.delete('/api/v1/agentbook-core/automations/:id', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const existing = await db.abAutomation.findFirst({ where: { id: req.params.id, tenantId } });
    if (!existing) return res.status(404).json({ success: false, error: 'Automation not found' });

    await db.abAutomation.delete({ where: { id: req.params.id } });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// POST /automations/:id/run — Manually trigger an automation
app.post('/api/v1/agentbook-core/automations/:id/run', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const automation = await db.abAutomation.findFirst({ where: { id: req.params.id, tenantId } });
    if (!automation) return res.status(404).json({ success: false, error: 'Automation not found' });
    if (automation.status !== 'active') return res.status(422).json({ success: false, error: `Automation is ${automation.status}` });

    const results: any[] = [];
    const actions = automation.actions as any[];

    for (const action of actions) {
      const actionResult: any = { type: action.type, status: 'executed' };

      switch (action.type) {
        case 'notify':
          actionResult.message = action.config?.message || `Automation "${automation.name}" triggered`;
          // In production: send via Telegram/email
          break;

        case 'send_reminder': {
          // Find overdue invoices and send reminders
          const overdue = await db.abInvoice.findMany({
            where: { tenantId, status: { in: ['sent', 'overdue'] }, dueDate: { lt: new Date() } },
            include: { client: true },
            take: action.config?.limit || 5,
          });
          actionResult.overdueCount = overdue.length;
          actionResult.invoices = overdue.map((i: any) => ({ number: i.number, client: i.client.name, amountCents: i.amountCents }));
          break;
        }

        case 'categorize_expense': {
          const uncategorized = await db.abExpense.count({ where: { tenantId, categoryId: null } });
          actionResult.uncategorized = uncategorized;
          break;
        }

        case 'escalate':
          actionResult.escalatedTo = action.config?.to || 'owner';
          actionResult.reason = action.config?.reason || 'Automation escalation';
          break;

        default:
          actionResult.status = 'skipped';
          actionResult.reason = `Action type ${action.type} execution pending implementation`;
      }

      results.push(actionResult);
    }

    // Update automation run stats
    await db.abAutomation.update({
      where: { id: automation.id },
      data: { lastRun: new Date(), runCount: { increment: 1 } },
    });

    // Check if max runs reached
    if (automation.maxRuns && automation.runCount + 1 >= automation.maxRuns) {
      await db.abAutomation.update({ where: { id: automation.id }, data: { status: 'completed' } });
    }

    await db.abEvent.create({
      data: {
        tenantId, eventType: 'automation.executed', actor: 'system',
        action: { automationId: automation.id, name: automation.name, actionResults: results },
      },
    });

    res.json({ success: true, data: { automationId: automation.id, name: automation.name, results, runCount: automation.runCount + 1 } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// POST /automations/from-description — Create automation from natural language (LLM-powered)
app.post('/api/v1/agentbook-core/automations/from-description', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { description } = req.body;
    if (!description) return res.status(400).json({ success: false, error: 'description is required' });

    const prompt = `Convert this workflow description into a JSON automation definition.
Valid trigger types: schedule, event, condition
Valid action types: send_reminder, create_invoice, notify, categorize_expense, update_status, send_email, escalate

Respond with ONLY valid JSON (no markdown), in this exact format:
{"name": "...", "trigger": {"type": "schedule|event|condition", "config": {...}}, "conditions": [...], "actions": [{"type": "...", "config": {...}}]}

Description: ${description}`;

    const llmResult = await callGemini(
      'You are a workflow automation builder. Convert natural language descriptions into structured JSON workflow definitions. Always respond with valid JSON only.',
      prompt,
      500,
    );

    if (llmResult) {
      try {
        // Clean potential markdown wrapping
        const cleaned = llmResult.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const workflow = JSON.parse(cleaned);

        const automation = await db.abAutomation.create({
          data: {
            tenantId,
            name: workflow.name || 'Auto-generated workflow',
            description,
            trigger: workflow.trigger,
            conditions: workflow.conditions || null,
            actions: workflow.actions,
            status: 'active',
          },
        });

        res.status(201).json({ success: true, data: { automation, generatedFrom: 'llm', originalDescription: description } });
      } catch (parseErr) {
        // LLM output wasn't valid JSON — return a simple default
        const automation = await db.abAutomation.create({
          data: {
            tenantId, name: description.slice(0, 100),
            description,
            trigger: { type: 'schedule', config: { cron: '0 9 * * 1' } },
            actions: [{ type: 'notify', config: { message: description } }],
            status: 'active',
          },
        });
        res.status(201).json({ success: true, data: { automation, generatedFrom: 'fallback', parseError: true } });
      }
    } else {
      // No LLM available — create simple notification automation
      const automation = await db.abAutomation.create({
        data: {
          tenantId, name: description.slice(0, 100), description,
          trigger: { type: 'schedule', config: { cron: '0 9 * * 1' } },
          actions: [{ type: 'notify', config: { message: description } }],
          status: 'active',
        },
      });
      res.status(201).json({ success: true, data: { automation, generatedFrom: 'default' } });
    }
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ============================================
// Phase 12: FINANCIAL DIGITAL TWIN (What-If Simulator)
// ============================================

// POST /simulate — Run financial what-if scenarios
app.post('/api/v1/agentbook-core/simulate', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { scenario } = req.body;
    if (!scenario) return res.status(400).json({ success: false, error: 'scenario is required (object or text)' });

    // Get current financial state
    const context = await buildFinancialContext(tenantId);

    // If scenario is a string, try LLM interpretation
    let scenarioObj = typeof scenario === 'string' ? null : scenario;

    if (typeof scenario === 'string') {
      const llmResult = await callGemini(
        'Convert a financial scenario description to JSON. Types: add_expense (monthly recurring), add_revenue (monthly), lose_client (clientName), hire (monthlyCostCents), buy_equipment (amountCents, depreciationYears). Respond with ONLY valid JSON: {"type": "...", "params": {...}}',
        scenario,
        200,
      );
      if (llmResult) {
        try {
          const cleaned = llmResult.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          scenarioObj = JSON.parse(cleaned);
        } catch { scenarioObj = null; }
      }
      if (!scenarioObj) {
        scenarioObj = { type: 'custom', description: scenario };
      }
    }

    // Base state
    const monthlyRevenue = context.totalRevenueCents / 12;
    const monthlyExpenses = context.monthlyBurnCents;
    const currentCash = context.cashBalanceCents;
    const currentNetMonthly = monthlyRevenue - monthlyExpenses;

    // Apply scenario
    let newMonthlyExpenses = monthlyExpenses;
    let newMonthlyRevenue = monthlyRevenue;
    let oneTimeCost = 0;
    let scenarioDescription = '';

    switch (scenarioObj.type) {
      case 'add_expense':
        newMonthlyExpenses += (scenarioObj.params?.monthlyCostCents || 0);
        scenarioDescription = `Add recurring expense of $${((scenarioObj.params?.monthlyCostCents || 0) / 100).toLocaleString()}/month`;
        break;
      case 'add_revenue':
        newMonthlyRevenue += (scenarioObj.params?.monthlyCostCents || scenarioObj.params?.monthlyRevenueCents || 0);
        scenarioDescription = `Add revenue of $${((scenarioObj.params?.monthlyRevenueCents || scenarioObj.params?.monthlyCostCents || 0) / 100).toLocaleString()}/month`;
        break;
      case 'lose_client': {
        const clientName = scenarioObj.params?.clientName || 'Unknown';
        const client = context.clients.find((c: any) => c.name.toLowerCase().includes(clientName.toLowerCase()));
        if (client) {
          const monthlyFromClient = Math.round(client.billedCents / 12);
          newMonthlyRevenue -= monthlyFromClient;
          scenarioDescription = `Lose client ${client.name} ($${(monthlyFromClient / 100).toLocaleString()}/month)`;
        } else {
          scenarioDescription = `Lose client ${clientName} (not found — no revenue impact calculated)`;
        }
        break;
      }
      case 'hire':
        newMonthlyExpenses += (scenarioObj.params?.monthlyCostCents || 0);
        scenarioDescription = `Hire at $${((scenarioObj.params?.monthlyCostCents || 0) / 100).toLocaleString()}/month`;
        break;
      case 'buy_equipment':
        oneTimeCost = scenarioObj.params?.amountCents || 0;
        const depYears = scenarioObj.params?.depreciationYears || 5;
        const monthlyDep = Math.round(oneTimeCost / (depYears * 12));
        newMonthlyExpenses += monthlyDep;
        scenarioDescription = `Buy equipment $${(oneTimeCost / 100).toLocaleString()} (depreciated over ${depYears} years: $${(monthlyDep / 100).toLocaleString()}/month)`;
        break;
      default:
        scenarioDescription = scenarioObj.description || 'Custom scenario';
    }

    const newNetMonthly = newMonthlyRevenue - newMonthlyExpenses;
    const newCash = currentCash - oneTimeCost;
    const newRunway = newMonthlyExpenses > 0 ? newCash / newMonthlyExpenses : Infinity;

    // 12-month cash projection
    const projection = [];
    let runningCash = newCash;
    for (let m = 1; m <= 12; m++) {
      runningCash += newNetMonthly;
      projection.push({ month: m, cashCents: runningCash, positiveFlow: newNetMonthly > 0 });
    }

    // Tax impact estimate (rough)
    const currentAnnualNet = currentNetMonthly * 12;
    const newAnnualNet = newNetMonthly * 12;
    const taxRate = context.taxEstimate?.effectiveRate || 0.25;
    const currentTax = Math.round(currentAnnualNet * taxRate);
    const newTax = Math.round(newAnnualNet * taxRate);

    // Cash danger month (when cash goes negative)
    const dangerMonth = projection.find(p => p.cashCents < 0)?.month || null;

    const result = {
      scenario: scenarioDescription,
      scenarioInput: scenarioObj,
      current: {
        monthlyRevenueCents: Math.round(monthlyRevenue),
        monthlyExpensesCents: monthlyExpenses,
        monthlyNetCents: Math.round(currentNetMonthly),
        cashCents: currentCash,
        annualTaxCents: currentTax,
        runwayMonths: monthlyExpenses > 0 ? parseFloat((currentCash / monthlyExpenses).toFixed(1)) : Infinity,
      },
      projected: {
        monthlyRevenueCents: Math.round(newMonthlyRevenue),
        monthlyExpensesCents: newMonthlyExpenses,
        monthlyNetCents: Math.round(newNetMonthly),
        cashCents: newCash,
        annualTaxCents: newTax,
        runwayMonths: parseFloat(newRunway.toFixed(1)),
        oneTimeCostCents: oneTimeCost,
      },
      impact: {
        monthlyNetChangeCents: Math.round(newNetMonthly - currentNetMonthly),
        annualTaxChangeCents: newTax - currentTax,
        runwayChangemonths: parseFloat((newRunway - (monthlyExpenses > 0 ? currentCash / monthlyExpenses : 0)).toFixed(1)),
        cashDangerMonth: dangerMonth,
      },
      cashProjection12Months: projection,
    };

    // Use LLM for narrative summary if available
    let narrative = '';
    const llmNarrative = await callGemini(
      'You are a financial advisor. Given a what-if scenario simulation result, provide a 2-3 sentence assessment. Be direct about risks and opportunities. Use dollar amounts.',
      `Scenario: ${scenarioDescription}\nCurrent monthly net: $${(currentNetMonthly / 100).toFixed(2)}\nProjected monthly net: $${(newNetMonthly / 100).toFixed(2)}\nCash now: $${(currentCash / 100).toFixed(2)}\nProjected cash: $${(newCash / 100).toFixed(2)}\nRunway change: ${(newRunway - (currentCash / monthlyExpenses || 0)).toFixed(1)} months\nTax change: $${((newTax - currentTax) / 100).toFixed(2)}/year`,
      200,
    );
    if (llmNarrative) narrative = llmNarrative;
    else {
      narrative = newNetMonthly > currentNetMonthly
        ? `This scenario improves your monthly net by $${(Math.abs(newNetMonthly - currentNetMonthly) / 100).toLocaleString()}.`
        : `This scenario reduces your monthly net by $${(Math.abs(newNetMonthly - currentNetMonthly) / 100).toLocaleString()}.`;
      if (dangerMonth) narrative += ` Warning: cash goes negative in month ${dangerMonth}.`;
    }

    res.json({ success: true, data: { ...result, narrative } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// GET /financial-snapshot — Get current financial snapshot
app.get('/api/v1/agentbook-core/financial-snapshot', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const context = await buildFinancialContext(tenantId);

    // Store snapshot
    await db.abFinancialSnapshot.create({
      data: {
        tenantId,
        snapshotDate: new Date(),
        cashBalanceCents: context.cashBalanceCents,
        totalRevenueCents: context.totalRevenueCents,
        totalExpenseCents: context.totalExpenseCents,
        netIncomeCents: context.netIncomeCents,
        arOutstandingCents: context.clients.reduce((s: number, c: any) => s + c.outstandingCents, 0),
        monthlyBurnCents: context.monthlyBurnCents,
        runwayMonths: context.monthlyBurnCents > 0 ? context.cashBalanceCents / context.monthlyBurnCents : 0,
        clientCount: context.clients.length,
        topClients: context.clients.slice(0, 5).map((c: any) => ({
          name: c.name, revenueCents: c.billedCents,
          percentage: context.totalRevenueCents > 0 ? Math.round(c.billedCents / context.totalRevenueCents * 100) : 0,
        })),
        categoryBreakdown: context.topVendors,
      },
    });

    res.json({ success: true, data: context });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// GET /financial-snapshots — Get historical snapshots for trend analysis
app.get('/api/v1/agentbook-core/financial-snapshots', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const limit = parseInt(req.query.limit as string) || 30;
    const snapshots = await db.abFinancialSnapshot.findMany({
      where: { tenantId },
      orderBy: { snapshotDate: 'desc' },
      take: limit,
    });
    res.json({ success: true, data: snapshots });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ============================================
// Phase 12: PERSONALIZED CFO PERSONALITY
// ============================================

// GET /personality — Get agent personality settings
app.get('/api/v1/agentbook-core/personality', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { agentId } = req.query;

    if (agentId) {
      const personality = await db.abAgentPersonality.findFirst({
        where: { tenantId, agentId: agentId as string },
      });
      if (!personality) {
        // Return defaults
        return res.json({
          success: true, data: {
            tenantId, agentId,
            communicationStyle: 'auto', proactiveLevel: 'balanced',
            riskTolerance: 'moderate', industryContext: null, customInstructions: null,
          },
        });
      }
      return res.json({ success: true, data: personality });
    }

    // Return all agent personalities
    const personalities = await db.abAgentPersonality.findMany({ where: { tenantId } });

    // Fill defaults for missing agents
    const agentIds = ['bookkeeper', 'tax-strategist', 'collections', 'insights'];
    const result = agentIds.map(aid => {
      const existing = personalities.find((p: any) => p.agentId === aid);
      return existing || {
        tenantId, agentId: aid,
        communicationStyle: 'auto', proactiveLevel: 'balanced',
        riskTolerance: 'moderate', industryContext: null, customInstructions: null,
      };
    });

    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// PUT /personality — Update agent personality
app.put('/api/v1/agentbook-core/personality', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { agentId, communicationStyle, proactiveLevel, riskTolerance, industryContext, customInstructions } = req.body;

    if (!agentId) return res.status(400).json({ success: false, error: 'agentId is required' });

    const validStyles = ['concise', 'detailed', 'auto'];
    const validLevels = ['minimal', 'balanced', 'aggressive'];
    const validRisk = ['conservative', 'moderate', 'aggressive'];

    if (communicationStyle && !validStyles.includes(communicationStyle)) {
      return res.status(400).json({ success: false, error: `communicationStyle must be: ${validStyles.join(', ')}` });
    }
    if (proactiveLevel && !validLevels.includes(proactiveLevel)) {
      return res.status(400).json({ success: false, error: `proactiveLevel must be: ${validLevels.join(', ')}` });
    }
    if (riskTolerance && !validRisk.includes(riskTolerance)) {
      return res.status(400).json({ success: false, error: `riskTolerance must be: ${validRisk.join(', ')}` });
    }

    const personality = await db.abAgentPersonality.upsert({
      where: { tenantId_agentId: { tenantId, agentId } },
      update: {
        ...(communicationStyle && { communicationStyle }),
        ...(proactiveLevel && { proactiveLevel }),
        ...(riskTolerance && { riskTolerance }),
        ...(industryContext !== undefined && { industryContext }),
        ...(customInstructions !== undefined && { customInstructions }),
      },
      create: {
        tenantId, agentId,
        communicationStyle: communicationStyle || 'auto',
        proactiveLevel: proactiveLevel || 'balanced',
        riskTolerance: riskTolerance || 'moderate',
        industryContext: industryContext || null,
        customInstructions: customInstructions || null,
      },
    });

    await db.abEvent.create({
      data: {
        tenantId, eventType: 'personality.updated', actor: 'user',
        action: { agentId, communicationStyle, proactiveLevel, riskTolerance },
      },
    });

    res.json({ success: true, data: personality });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// POST /personality/auto-adapt — Agent self-adapts based on user engagement patterns
app.post('/api/v1/agentbook-core/personality/auto-adapt', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { agentId } = req.body;
    if (!agentId) return res.status(400).json({ success: false, error: 'agentId is required' });

    // Analyze engagement patterns from events
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const events = await db.abEvent.findMany({
      where: { tenantId, createdAt: { gte: thirtyDaysAgo } },
      orderBy: { createdAt: 'desc' },
    });

    // Count corrections (indicates agent needs more confirmation)
    const corrections = events.filter((e: any) => (e.eventType as string).includes('correction') || (e.eventType as string).includes('corrected')).length;

    // Count questions asked (indicates preferred interaction style)
    const questions = events.filter((e: any) => e.eventType === 'ask.question').length;

    // Count automation runs (indicates desire for automation)
    const automationRuns = events.filter((e: any) => (e.eventType as string).includes('automation')).length;

    // Determine adaptations
    const adaptations: Record<string, string> = {};

    // High corrections → more cautious
    if (corrections > 10) {
      adaptations.proactiveLevel = 'minimal';
    } else if (corrections < 3 && events.length > 20) {
      adaptations.proactiveLevel = 'aggressive';
    }

    // Many questions → user prefers detailed responses
    if (questions > 15) {
      adaptations.communicationStyle = 'detailed';
    } else if (questions < 3 && events.length > 20) {
      adaptations.communicationStyle = 'concise';
    }

    // Apply adaptations
    if (Object.keys(adaptations).length > 0) {
      await db.abAgentPersonality.upsert({
        where: { tenantId_agentId: { tenantId, agentId } },
        update: adaptations,
        create: {
          tenantId, agentId,
          communicationStyle: adaptations.communicationStyle || 'auto',
          proactiveLevel: adaptations.proactiveLevel || 'balanced',
          riskTolerance: 'moderate',
        },
      });
    }

    await db.abEvent.create({
      data: {
        tenantId, eventType: 'personality.auto_adapted', actor: 'system',
        action: { agentId, corrections, questions, automationRuns, adaptations },
      },
    });

    res.json({
      success: true,
      data: {
        agentId,
        analysisWindow: '30 days',
        metrics: { corrections, questions, automationRuns, totalEvents: events.length },
        adaptations,
        adapted: Object.keys(adaptations).length > 0,
      },
    });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// =====================================================
// AGENT BRAIN — Skills, Memory, and Message Processing
// =====================================================

const BUILT_IN_SKILLS = [
  {
    name: 'record-expense', description: 'Record a business or personal expense', category: 'bookkeeping',
    triggerPatterns: ['\\$\\d', 'spent ', 'paid ', 'bought ', 'purchased '],
    parameters: { amountCents: { type: 'number', required: true, extractHint: 'dollar amount times 100' }, vendor: { type: 'string', required: false, extractHint: 'business name' }, description: { type: 'string', required: false }, date: { type: 'date', required: false, default: 'today' } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-expense/expenses' },
    responseTemplate: 'Recorded: {{amountFormatted}} — {{description}} [{{categoryName}}]',
  },
  {
    name: 'query-expenses', description: 'Query, search, list, or ask questions about expenses', category: 'bookkeeping',
    triggerPatterns: ['show.*expense', 'list.*expense', 'last \\d+ expense', 'how much.*spen', 'recent expense', 'summary.*expense'],
    parameters: { question: { type: 'string', required: true, extractHint: 'the full user message' } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-expense/advisor/ask' },
  },
  {
    name: 'query-finance', description: 'Ask about cash balance, revenue, profit, tax, clients, or general financial questions', category: 'finance',
    triggerPatterns: ['balance', 'revenue', 'profit', 'loss', 'tax', 'client.*owe', 'outstanding', 'income', 'net '],
    parameters: { question: { type: 'string', required: true, extractHint: 'the full user message' } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-core/ask' },
  },
  {
    name: 'scan-receipt', description: 'Scan and process a receipt photo', category: 'bookkeeping',
    triggerPatterns: [],
    parameters: { imageUrl: { type: 'string', required: true, extractHint: 'attachment URL' } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-expense/receipts/ocr' },
  },
  {
    name: 'scan-document', description: 'Process a PDF document (receipt or statement)', category: 'bookkeeping',
    triggerPatterns: [],
    parameters: { imageUrl: { type: 'string', required: true, extractHint: 'attachment URL' } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-expense/receipts/ocr' },
  },
  {
    name: 'create-invoice', description: 'Create an invoice for a client', category: 'invoicing',
    triggerPatterns: ['invoice .+ \\$'],
    parameters: { clientName: { type: 'string', required: true }, amountCents: { type: 'number', required: true }, description: { type: 'string', required: false, default: 'Services' } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-invoice/invoices' },
  },
  {
    name: 'simulate-scenario', description: 'Run a what-if financial simulation', category: 'planning',
    triggerPatterns: ['what if', 'what.?if', 'simulate', 'scenario', 'hire.*\\$', 'lose.*client'],
    parameters: { scenario: { type: 'string', required: true, extractHint: 'the full user message' } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-core/simulate' },
  },
  {
    name: 'proactive-alerts', description: 'Check for alerts, notifications, or things needing attention', category: 'insights',
    triggerPatterns: ['alert', 'notification', 'check.?up', 'anything.*know', 'what.?s new'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-expense/advisor/proactive-alerts', queryParams: [] },
  },
  {
    name: 'expense-breakdown', description: 'Show spending breakdown by category as a chart', category: 'insights',
    triggerPatterns: ['breakdown', 'categor.*chart', 'pie chart', 'bar chart', 'spending chart'],
    parameters: { chartType: { type: 'string', required: false, default: 'bar' } },
    endpoint: { method: 'GET', url: '/api/v1/agentbook-expense/advisor/chart', queryParams: ['startDate', 'endDate', 'chartType'] },
  },
  {
    name: 'categorize-expenses', description: 'Auto-categorize uncategorized expenses into the right expense categories', category: 'bookkeeping',
    triggerPatterns: ['categorize', 'classify', 'organize.*expense', 'fix.*categor', 'uncategorized', 'auto.?categor'],
    parameters: {},
    endpoint: { method: 'INTERNAL', url: '' },  // handled inline by agent brain
  },
  {
    name: 'edit-expense', description: 'Edit an existing expense — change amount, category, vendor, date, or description', category: 'bookkeeping',
    triggerPatterns: ['change.*expense', 'edit.*expense', 'update.*expense', 'fix.*expense', 'correct.*expense'],
    parameters: { expenseId: { type: 'string', required: false, extractHint: 'expense ID or "last"' } },
    endpoint: { method: 'PUT', url: '/api/v1/agentbook-expense/expenses/:id' },
    confirmBefore: true,
  },
  {
    name: 'split-expense', description: 'Split an expense into business and personal portions', category: 'bookkeeping',
    triggerPatterns: ['split.*expense', 'part.*business.*personal', 'half.*personal'],
    parameters: { expenseId: { type: 'string', required: false }, businessPercent: { type: 'number', required: false, default: 50 } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-expense/expenses/:id/split' },
    confirmBefore: true,
  },
  {
    name: 'review-queue', description: 'Show expenses that need human review — low confidence, pending, or flagged', category: 'bookkeeping',
    triggerPatterns: ['review', 'pending.*review', 'need.*attention', 'flagged'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-expense/review-queue' },
  },
  {
    name: 'manage-recurring', description: 'View or manage recurring expense patterns — subscriptions, rent, monthly charges', category: 'bookkeeping',
    triggerPatterns: ['recurring', 'subscription', 'monthly.*expense', 'regular.*payment'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-expense/recurring-suggestions' },
  },
  {
    name: 'vendor-insights', description: 'Show spending patterns by vendor — who you spend most with, trends', category: 'insights',
    triggerPatterns: ['vendor.*spend', 'who.*spend.*most', 'top.*vendor', 'vendor.*pattern'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-expense/vendors' },
  },
  {
    name: 'query-invoices', description: 'List, search, or ask about invoices — outstanding, overdue, by client, by status', category: 'invoicing',
    triggerPatterns: ['show.*invoice', 'list.*invoice', 'outstanding.*invoice', 'unpaid.*invoice', 'overdue.*invoice', 'invoice.*status', 'my invoice'],
    parameters: { status: { type: 'string', required: false }, clientName: { type: 'string', required: false } },
    endpoint: { method: 'GET', url: '/api/v1/agentbook-invoice/invoices', queryParams: ['status', 'clientId', 'limit'] },
  },
  {
    name: 'aging-report', description: 'Show accounts receivable aging — who owes money and how overdue', category: 'invoicing',
    triggerPatterns: ['aging', 'who.*owe', 'accounts.*receivable', 'ar report', 'overdue.*client', 'owe.*money'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-invoice/aging-report' },
  },
  {
    name: 'query-estimates', description: 'List estimates — pending, approved, converted', category: 'invoicing',
    triggerPatterns: ['show.*estimate', 'list.*estimate', 'pending.*estimate', 'my estimate'],
    parameters: { status: { type: 'string', required: false } },
    endpoint: { method: 'GET', url: '/api/v1/agentbook-invoice/estimates', queryParams: ['status', 'clientId'] },
  },
  {
    name: 'query-clients', description: 'List clients or show client details — billing history, outstanding balance', category: 'invoicing',
    triggerPatterns: ['show.*client', 'list.*client', 'client.*detail', 'client.*balance', 'my client'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-invoice/clients' },
  },
  {
    name: 'timer-status', description: 'Check if a time tracking timer is running and how long', category: 'invoicing',
    triggerPatterns: ['timer.*status', 'timer.*running', 'is.*timer', 'how long.*timer'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-invoice/timer/status' },
  },
  {
    name: 'unbilled-summary', description: 'Show unbilled time by client — hours logged but not yet invoiced', category: 'invoicing',
    triggerPatterns: ['unbilled', 'not.*invoiced', 'billable.*time', 'hours.*not.*billed'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-invoice/unbilled-summary' },
  },
  {
    name: 'send-invoice', description: 'Send a draft or created invoice to the client via email', category: 'invoicing',
    triggerPatterns: ['send.*invoice', 'email.*invoice', 'deliver.*invoice', 'send.*that.*invoice'],
    parameters: { invoiceId: { type: 'string', required: false, extractHint: 'invoice ID, number like INV-YYYY-NNNN, or "last"' } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-invoice/invoices/:id/send' },
    confirmBefore: true,
  },
  {
    name: 'record-payment', description: 'Record a payment received for an invoice', category: 'invoicing',
    triggerPatterns: ['got.*paid', 'received.*payment', 'record.*payment', 'got.*\\$.*from', 'payment.*received'],
    parameters: { invoiceId: { type: 'string', required: false }, amountCents: { type: 'number', required: false }, clientName: { type: 'string', required: false }, method: { type: 'string', required: false, default: 'manual' } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-invoice/payments' },
    confirmBefore: true,
  },
  {
    name: 'create-estimate', description: 'Create a project estimate or quote for a client', category: 'invoicing',
    triggerPatterns: ['estimate.*\\$', 'quote.*\\$', 'proposal.*\\$', 'create.*estimate'],
    parameters: { clientName: { type: 'string', required: true }, amountCents: { type: 'number', required: true }, description: { type: 'string', required: true } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-invoice/estimates' },
  },
  {
    name: 'start-timer', description: 'Start a time tracking timer for a project or client', category: 'invoicing',
    triggerPatterns: ['start.*timer', 'track.*time', 'clock.*in', 'begin.*timer'],
    parameters: { description: { type: 'string', required: false }, clientName: { type: 'string', required: false }, projectName: { type: 'string', required: false } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-invoice/timer/start' },
  },
  {
    name: 'stop-timer', description: 'Stop the running time tracker', category: 'invoicing',
    triggerPatterns: ['stop.*timer', 'clock.*out', 'end.*timer', 'pause.*timer'],
    parameters: {},
    endpoint: { method: 'POST', url: '/api/v1/agentbook-invoice/timer/stop' },
  },
  {
    name: 'send-reminder', description: 'Send payment reminder for overdue invoices', category: 'invoicing',
    triggerPatterns: ['send.*remind', 'remind.*overdue', 'follow.*up.*invoice', 'chase.*payment', 'nudge.*client', 'remind.*payment'],
    parameters: { invoiceId: { type: 'string', required: false, extractHint: 'invoice ID or "all" for all overdue' } },
    endpoint: { method: 'INTERNAL', url: '' },
  },
  {
    name: 'tax-estimate', description: 'Show tax estimate — income tax, self-employment tax, effective rate', category: 'tax',
    triggerPatterns: ['tax.*estimate', 'how much.*tax', 'tax.*owe', 'tax.*situation', 'tax.*liability'],
    parameters: { period: { type: 'string', required: false, default: 'ytd' } },
    endpoint: { method: 'GET', url: '/api/v1/agentbook-tax/tax/estimate', queryParams: ['startDate', 'endDate'] },
  },
  {
    name: 'quarterly-payments', description: 'Show quarterly tax payment schedule and status', category: 'tax',
    triggerPatterns: ['quarterly.*payment', 'quarterly.*tax', 'estimated.*payment', 'quarterly.*due'],
    parameters: { year: { type: 'string', required: false } },
    endpoint: { method: 'GET', url: '/api/v1/agentbook-tax/tax/quarterly', queryParams: ['year'] },
  },
  {
    name: 'tax-deductions', description: 'Show potential tax deductions and savings opportunities', category: 'tax',
    triggerPatterns: ['deduction', 'tax.*saving', 'write.*off', 'deductible', 'tax.*break'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-tax/tax/deductions' },
  },
  {
    name: 'pnl-report', description: 'Show profit & loss report — revenue, expenses, net income', category: 'tax',
    triggerPatterns: ['p.?&?.?l', 'profit.*loss', 'income.*statement', 'net.*income', 'how.*much.*profit'],
    parameters: { startDate: { type: 'string', required: false }, endDate: { type: 'string', required: false } },
    endpoint: { method: 'GET', url: '/api/v1/agentbook-tax/reports/pnl', queryParams: ['startDate', 'endDate'] },
  },
  {
    name: 'balance-sheet', description: 'Show balance sheet — assets, liabilities, equity', category: 'tax',
    triggerPatterns: ['balance.*sheet', 'asset.*liabilit', 'net.*worth', 'equity'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-tax/reports/balance-sheet', queryParams: ['asOfDate'] },
  },
  {
    name: 'cashflow-report', description: 'Show cash flow statement or projection — inflows, outflows, runway', category: 'tax',
    triggerPatterns: ['cash.*flow', 'cash.*projection', 'runway', 'burn.*rate', 'how long.*cash.*last'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-tax/cashflow/projection' },
  },
  {
    name: 'financial-snapshot', description: 'Quick financial summary — cash, revenue, expenses, profit at a glance', category: 'finance',
    triggerPatterns: ['financial.*summary', 'financial.*snapshot', 'overview', 'dashboard', 'how.*doing.*financially', 'financial.*health'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-core/financial-snapshot' },
  },
  {
    name: 'money-moves', description: 'Proactive money moves and action items — things you should do with your money', category: 'finance',
    triggerPatterns: ['money.*move', 'action.*item', 'what.*should.*do', 'suggestion', 'recommend', 'advice.*money'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-core/money-moves' },
  },
  {
    name: 'bank-reconciliation', description: 'Check bank reconciliation status — matched vs unmatched transactions', category: 'bookkeeping',
    triggerPatterns: ['reconcil', 'unmatched.*transaction', 'bank.*match', 'bank.*status'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-expense/reconciliation-summary' },
  },
  {
    name: 'cpa-notes', description: 'Add or view notes for CPA/accountant — tax questions, review items', category: 'finance',
    triggerPatterns: ['cpa.*note', 'accountant.*note', 'note.*cpa', 'note.*accountant', 'tell.*cpa', 'ask.*cpa'],
    parameters: { note: { type: 'string', required: false, extractHint: 'the note content' } },
    endpoint: { method: 'GET', url: '/api/v1/agentbook-core/cpa/notes' },
  },
  {
    name: 'cpa-share', description: 'Generate a secure access link to share financial data with CPA/accountant', category: 'finance',
    triggerPatterns: ['share.*cpa', 'share.*accountant', 'cpa.*access', 'cpa.*link', 'give.*cpa.*access'],
    parameters: {},
    endpoint: { method: 'POST', url: '/api/v1/agentbook-core/cpa/generate-link' },
  },
  {
    name: 'create-automation', description: 'Create an automation rule from natural language — triggers, conditions, actions', category: 'finance',
    triggerPatterns: ['automat', 'when.*then', 'alert.*when', 'notify.*when', 'rule.*when'],
    parameters: { description: { type: 'string', required: true, extractHint: 'natural language rule description' } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-core/automations/from-description' },
  },
  {
    name: 'list-automations', description: 'Show active automation rules', category: 'finance',
    triggerPatterns: ['show.*automat', 'list.*automat', 'my.*automat', 'active.*rule'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-core/automations' },
  },
  {
    name: 'tax-filing-start', description: 'Start tax filing — create filing session, auto-populate from books, identify missing fields', category: 'tax',
    triggerPatterns: ['start.*tax.*fil', 'file.*my.*tax', 'begin.*return', 'prepare.*tax.*return', 'tax.*return'],
    parameters: { taxYear: { type: 'number', required: false, default: 2025 } },
    endpoint: { method: 'INTERNAL', url: '' },
  },
  {
    name: 'tax-filing-status', description: 'Check tax filing progress — completeness by form, what is missing', category: 'tax',
    triggerPatterns: ['tax.*filing.*status', 'filing.*progress', 'what.*missing.*tax', 'tax.*complete', 'filing.*complete'],
    parameters: { taxYear: { type: 'number', required: false, default: 2025 } },
    endpoint: { method: 'GET', url: '/api/v1/agentbook-tax/tax-filing/2025' },
  },
  {
    name: 'tax-slip-scan', description: 'Upload and scan a tax slip (T4, T5, RRSP, TFSA, bank statement) for OCR extraction', category: 'tax',
    triggerPatterns: ['upload.*slip', 'scan.*t4', 'scan.*t5', 'scan.*rrsp', 'scan.*slip', 'tax.*document'],
    parameters: { imageUrl: { type: 'string', required: false } },
    endpoint: { method: 'INTERNAL', url: '' },
  },
  {
    name: 'tax-slip-list', description: 'Show uploaded tax slips and their status', category: 'tax',
    triggerPatterns: ['show.*slip', 'list.*slip', 'uploaded.*slip', 'my.*slip', 'tax.*slip'],
    parameters: { taxYear: { type: 'number', required: false, default: 2025 } },
    endpoint: { method: 'GET', url: '/api/v1/agentbook-tax/tax-slips', queryParams: ['taxYear'] },
  },
  {
    name: 'ca-t2125-review', description: 'Review T2125 Statement of Business Income — revenue, expenses, vehicle, home office', category: 'tax',
    triggerPatterns: ['review.*t2125', 'business.*income.*form', 't2125', 'statement.*business'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-tax/tax-filing/2025' },
  },
  {
    name: 'ca-t1-review', description: 'Review T1 General personal income tax return — income sources, deductions, credits', category: 'tax',
    triggerPatterns: ['review.*t1', 'personal.*return', 't1.*general', 't1.*review'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-tax/tax-filing/2025' },
  },
  {
    name: 'ca-gst-hst-review', description: 'Review GST/HST return — collected tax, input tax credits, net tax', category: 'tax',
    triggerPatterns: ['review.*gst', 'review.*hst', 'sales.*tax.*return', 'gst.*hst.*review', 'gst.*return'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-tax/tax-filing/2025' },
  },
  {
    name: 'ca-schedule-1-review', description: 'Review Schedule 1 federal tax calculation', category: 'tax',
    triggerPatterns: ['schedule.*1', 'federal.*tax.*calc'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-tax/tax-filing/2025' },
  },
  {
    name: 'tax-filing-field', description: 'Provide a value for a missing tax filing field', category: 'tax',
    triggerPatterns: [],
    parameters: { formCode: { type: 'string', required: true }, fieldId: { type: 'string', required: true }, value: { type: 'string', required: true } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-tax/tax-filing/2025/field' },
  },
  {
    name: 'tax-filing-validate', description: 'Run validation rules on tax return — check for errors before filing', category: 'tax',
    triggerPatterns: ['validate.*tax', 'check.*tax.*error', 'verify.*return', 'tax.*ready.*file', 'any.*error.*tax'],
    parameters: { taxYear: { type: 'number', required: false, default: 2025 } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-tax/tax-filing/2025/validate' },
  },
  {
    name: 'tax-filing-export', description: 'Generate and export tax forms — PDF or JSON format', category: 'tax',
    triggerPatterns: ['export.*tax', 'generate.*tax.*form', 'download.*return', 'create.*tax.*file', 'print.*tax', 'pdf.*tax'],
    parameters: { format: { type: 'string', required: false, default: 'json' } },
    endpoint: { method: 'INTERNAL', url: '' },
  },
  {
    name: 'tax-filing-submit', description: 'Submit tax return to CRA via certified partner API — e-file your return', category: 'tax',
    triggerPatterns: ['submit.*tax', 'submit.*cra', 'efile', 'netfile', 'submit.*return', 'file.*return.*cra', 'send.*cra'],
    parameters: { taxYear: { type: 'number', required: false, default: 2025 } },
    endpoint: { method: 'INTERNAL', url: '' },
    confirmBefore: true,
  },
  {
    name: 'tax-filing-check', description: 'Check e-filing status — accepted, rejected, or pending by CRA', category: 'tax',
    triggerPatterns: ['filing.*status.*cra', 'cra.*accept', 'return.*status.*cra', 'check.*filing.*status', 'did.*cra.*accept'],
    parameters: { taxYear: { type: 'number', required: false, default: 2025 } },
    endpoint: { method: 'GET', url: '/api/v1/agentbook-tax/tax-filing/2025/status' },
  },
  {
    name: 'telegram-setup', description: 'Configure Telegram bot — connect your own bot by providing the API token from @BotFather', category: 'finance',
    triggerPatterns: ['setup.*telegram', 'connect.*telegram', 'telegram.*bot.*token', 'configure.*telegram', 'my.*bot.*token'],
    parameters: { botToken: { type: 'string', required: false, extractHint: 'Telegram bot API token from @BotFather' } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-core/telegram/setup' },
  },
  {
    name: 'telegram-status', description: 'Check Telegram bot connection status', category: 'finance',
    triggerPatterns: ['telegram.*status', 'bot.*connected', 'telegram.*config'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-core/telegram/status' },
  },
  {
    name: 'convert-estimate', description: 'Convert an approved estimate into an invoice', category: 'invoicing',
    triggerPatterns: ['convert.*estimate', 'estimate.*invoice', 'turn.*estimate.*invoice'],
    parameters: { estimateId: { type: 'string', required: false, extractHint: 'estimate ID or "last"' } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-invoice/estimates/:id/convert' },
  },
  {
    name: 'void-invoice', description: 'Void/cancel an invoice — reverses journal entries', category: 'invoicing',
    triggerPatterns: ['void.*invoice', 'cancel.*invoice', 'delete.*invoice'],
    parameters: { invoiceId: { type: 'string', required: false, extractHint: 'invoice ID, number, or "last"' } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-invoice/invoices/:id/void' },
    confirmBefore: true,
  },
  {
    name: 'create-credit-note', description: 'Issue a credit note against an invoice — partial refund or adjustment', category: 'invoicing',
    triggerPatterns: ['credit.*note', 'credit.*invoice', 'issue.*credit', 'refund.*invoice'],
    parameters: { invoiceId: { type: 'string', required: false }, amountCents: { type: 'number', required: false }, reason: { type: 'string', required: false } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-invoice/credit-notes' },
    confirmBefore: true,
  },
  {
    name: 'create-payment-link', description: 'Generate a Stripe payment link for an invoice so clients can pay online', category: 'invoicing',
    triggerPatterns: ['payment.*link', 'pay.*link', 'stripe.*link', 'online.*pay', 'pay.*online', 'generate.*link'],
    parameters: { invoiceId: { type: 'string', required: false } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-invoice/invoices/:id/payment-link' },
  },
  {
    name: 'toggle-auto-reminders', description: 'Enable or disable automatic payment reminders for overdue invoices', category: 'invoicing',
    triggerPatterns: ['auto.*remind', 'automatic.*remind', 'enable.*remind', 'disable.*remind'],
    parameters: { enabled: { type: 'boolean', required: false } },
    endpoint: { method: 'PUT', url: '/api/v1/agentbook-core/tenant-config' },
  },
  {
    name: 'set-budget', description: 'Set a monthly budget — total or per category', category: 'bookkeeping',
    triggerPatterns: ['set.*budget', 'budget.*\\$', 'monthly.*budget', 'spending.*limit'],
    parameters: { amountCents: { type: 'number', required: true }, category: { type: 'string', required: false }, period: { type: 'string', required: false, default: 'monthly' } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-expense/budgets' },
  },
  {
    name: 'query-budget', description: 'Check budget status — spending vs budget by category', category: 'bookkeeping',
    triggerPatterns: ['budget.*status', 'over.*budget', 'under.*budget', 'how.*budget', 'spending.*vs.*budget', 'check.*budget'],
    parameters: {},
    endpoint: { method: 'GET', url: '/api/v1/agentbook-expense/budgets/status' },
  },
  {
    name: 'expense-report', description: 'Generate an expense report for a date range', category: 'bookkeeping',
    triggerPatterns: ['expense.*report', 'generate.*report', 'expense.*pdf', 'print.*expense', 'download.*expense'],
    parameters: { startDate: { type: 'string', required: false }, endDate: { type: 'string', required: false } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-expense/reports/expense-pdf' },
  },
  {
    name: 'general-question', description: 'Answer any general financial or accounting question', category: 'finance',
    triggerPatterns: [],
    parameters: { question: { type: 'string', required: true, extractHint: 'the full user message' } },
    endpoint: { method: 'POST', url: '/api/v1/agentbook-core/ask' },
  },
];

// --- 1. Seed Skills Endpoint ---
app.post('/api/v1/agentbook-core/agent/seed-skills', async (_req, res) => {
  try {
    let created = 0;
    let updated = 0;
    for (const skill of BUILT_IN_SKILLS) {
      const existing = await db.abSkillManifest.findFirst({
        where: { tenantId: null, name: skill.name },
      });
      if (existing) {
        await db.abSkillManifest.update({
          where: { id: existing.id },
          data: {
            description: skill.description,
            category: skill.category,
            triggerPatterns: skill.triggerPatterns,
            parameters: skill.parameters as any,
            endpoint: skill.endpoint as any,
            responseTemplate: (skill as any).responseTemplate || null,
            source: 'built_in',
          },
        });
        updated++;
      } else {
        await db.abSkillManifest.create({
          data: {
            tenantId: null,
            name: skill.name,
            description: skill.description,
            category: skill.category,
            triggerPatterns: skill.triggerPatterns,
            parameters: skill.parameters as any,
            endpoint: skill.endpoint as any,
            responseTemplate: (skill as any).responseTemplate || null,
            source: 'built_in',
            enabled: true,
          },
        });
        created++;
      }
    }
    res.json({ success: true, data: { created, updated, total: BUILT_IN_SKILLS.length } });
  } catch (err) {
    console.error('Seed skills error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// --- 2. Skills CRUD ---
app.get('/api/v1/agentbook-core/agent/skills', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const skills = await db.abSkillManifest.findMany({
      where: {
        enabled: true,
        OR: [{ tenantId: null }, { tenantId }],
      },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: skills });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post('/api/v1/agentbook-core/agent/skills', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { name, description, category, triggerPatterns, parameters, endpoint, responseTemplate } = req.body;
    if (!name || !description) {
      return res.status(400).json({ success: false, error: 'name and description required' });
    }
    const skill = await db.abSkillManifest.create({
      data: {
        tenantId,
        name,
        description,
        category: category || 'custom',
        triggerPatterns: triggerPatterns || [],
        parameters: parameters || {},
        endpoint: endpoint || {},
        responseTemplate: responseTemplate || null,
        source: 'user',
        enabled: true,
      },
    });
    res.json({ success: true, data: skill });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// --- 3. Memory CRUD ---
app.get('/api/v1/agentbook-core/agent/memory', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const typeFilter = req.query.type as string | undefined;
    const where: any = { tenantId };
    if (typeFilter) where.type = typeFilter;
    const memories = await db.abUserMemory.findMany({
      where,
      orderBy: { lastUsed: 'desc' },
    });
    res.json({ success: true, data: memories });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post('/api/v1/agentbook-core/agent/memory', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { key, value, type, confidence, expiresAt } = req.body;
    if (!key || !value) {
      return res.status(400).json({ success: false, error: 'key and value required' });
    }
    // Upsert by tenantId + key
    const existing = await db.abUserMemory.findFirst({
      where: { tenantId, key },
    });
    let memory;
    if (existing) {
      memory = await db.abUserMemory.update({
        where: { id: existing.id },
        data: {
          value,
          type: type || existing.type,
          confidence: confidence ?? existing.confidence,
          expiresAt: expiresAt ? new Date(expiresAt) : existing.expiresAt,
          lastUsed: new Date(),
        },
      });
    } else {
      memory = await db.abUserMemory.create({
        data: {
          tenantId,
          key,
          value,
          type: type || 'context',
          confidence: confidence ?? 0.8,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          lastUsed: new Date(),
        },
      });
    }
    res.json({ success: true, data: memory });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.delete('/api/v1/agentbook-core/agent/memory/:id', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { id } = req.params;
    const memory = await db.abUserMemory.findFirst({ where: { id, tenantId } });
    if (!memory) {
      return res.status(404).json({ success: false, error: 'Memory not found' });
    }
    await db.abUserMemory.delete({ where: { id } });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// --- Helper: resolve or create a client by name ---
async function resolveOrCreateClient(invoiceBase: string, tenantId: string, clientName: string): Promise<any> {
  const H = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
  const clientsRes = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/clients`, { headers: H });
  const clientsData = await clientsRes.json() as any;
  let client = (clientsData.data || []).find((c: any) => c.name.toLowerCase().includes(clientName.toLowerCase()));
  if (!client) {
    const createRes = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/clients`, {
      method: 'POST', headers: H, body: JSON.stringify({ name: clientName }),
    });
    client = ((await createRes.json()) as any).data;
  }
  return client;
}

// --- 4. Agent Brain: classifyAndExecuteV1 (extracted from inline handler) ---
async function classifyAndExecuteV1(
  text: string, tenantId: string, channel: string,
  attachments?: any[], memory?: any[], skills?: any[],
  conversation?: any[], tenantConfig?: any,
): Promise<any> {
  const startTime = Date.now();

  // If context params not provided, fetch them (backward compatibility)
  if (!memory || !skills || !conversation || tenantConfig === undefined) {
    const [tc, conv, mem, sk] = await Promise.all([
      tenantConfig !== undefined ? Promise.resolve(tenantConfig) : db.abTenantConfig.findFirst({ where: { userId: tenantId } }),
      conversation || db.abConversation.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 10 }),
      memory || db.abUserMemory.findMany({
        where: { tenantId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        orderBy: { lastUsed: 'desc' }, take: 50,
      }),
      skills || db.abSkillManifest.findMany({
        where: { enabled: true, OR: [{ tenantId: null }, { tenantId }] },
      }),
    ]);
    tenantConfig = tc;
    conversation = conv;
    memory = mem;
    skills = sk;
  }

  // === 2. INTENT CLASSIFICATION ===
  let selectedSkill: any = null;
  let extractedParams: any = {};
  let confidence = 0;
  const lower = (text || '').toLowerCase();

  // Handle attachments first
  if (attachments?.length > 0) {
    const att = attachments[0];
    if (att.type === 'photo') {
      selectedSkill = skills.find((s: any) => s.name === 'scan-receipt');
      extractedParams = { imageUrl: att.url };
      confidence = 1.0;
    } else if (att.type === 'pdf' || att.type === 'document') {
      selectedSkill = skills.find((s: any) => s.name === 'scan-document');
      extractedParams = { imageUrl: att.url };
      confidence = 1.0;
    }
  }

  if (!selectedSkill && text) {
    // Stage 1: User memory shortcuts
    const shortcuts = memory.filter((m: any) => m.type === 'shortcut');
    for (const sc of shortcuts) {
      if (lower.includes(sc.key.replace('shortcut:', ''))) {
        try {
          const parsed = JSON.parse(sc.value);
          selectedSkill = skills.find((s: any) => s.name === parsed.skill);
          extractedParams = parsed.params || { question: text };
          confidence = sc.confidence;
          // Update usage
          await db.abUserMemory.update({ where: { id: sc.id }, data: { usageCount: { increment: 1 }, lastUsed: new Date() } });
          break;
        } catch { /* invalid shortcut */ }
      }
    }

    // Stage 2: Regex fast path
    if (!selectedSkill) {
      // Apply vendor aliases from memory
      let processedText = text;
      const aliases = memory.filter((m: any) => m.type === 'vendor_alias');
      for (const alias of aliases) {
        const aliasKey = alias.key.replace('vendor_alias:', '');
        if (lower.includes(aliasKey)) {
          processedText = processedText.replace(new RegExp(aliasKey, 'gi'), alias.value);
        }
      }

      // Check trigger patterns — but for record-expense, also require a dollar amount
      for (const skill of skills) {
        const patterns = (skill.triggerPatterns as string[]) || [];
        if (patterns.length === 0) continue;

        for (const pattern of patterns) {
          try {
            if (new RegExp(pattern, 'i').test(lower)) {
              // Special check: query-finance should not match tax-specific queries that have dedicated skills
              if (skill.name === 'query-finance') {
                if (/tax.*estimate|how much.*tax|tax.*owe|tax.*situation|tax.*liability|quarterly.*tax|quarterly.*payment|estimated.*payment|deduction|write.*off|tax.*saving|tax.*break|p.?&?.?l|profit.*loss|income.*statement|net.*income|how.*much.*profit|balance.*sheet|net.*worth|equity|cash.*flow|cash.*projection|runway|burn.*rate|how long.*cash.*last|financial.*summary|financial.*snapshot|how.*doing.*financially|financial.*health|money.*move|action.*item|what.*should.*do|advice.*money|reconcil|unmatched.*transaction|bank.*match|bank.*status|tax.*fil|start.*fil|file.*tax|review.*t[12]|t2125|schedule.*1|gst.*return|tax.*slip|validate.*tax|check.*tax.*error|verify.*return|tax.*ready|export.*tax|generate.*tax.*form|download.*return|create.*tax.*file|print.*tax|pdf.*tax|submit.*cra|efile|netfile|filing.*status.*cra/i.test(lower)) continue;
              }
              // Special check: record-expense needs a $ amount and should not match invoice/simulation commands
              if (skill.name === 'record-expense') {
                // Must contain a dollar amount ($X, X dollars, or bare number after expense verb)
                if (!/\$\s*[\d,]+\.?\d{0,2}|\d+\s*(?:dollars|bucks)/i.test(text)
                    && !/(?:spent|paid|bought|purchased|cost)\s+\$?[\d,]+\.?\d{0,2}/i.test(text)) continue;
                if (/^invoice\s/i.test(lower)) continue;
                if (/what\s*if\b/i.test(lower)) continue;
                if (/got.*\$.*from/i.test(lower)) continue;
                if (/alert.*when|notify.*when|automat/i.test(lower)) continue;  // automation, not expense
                if (/received.*payment/i.test(lower)) continue;
                if (/^(?:estimate|quote|proposal)\s/i.test(lower)) continue;  // estimate, not expense
              }
              // Special check: proactive-alerts should not match automation creation commands
              if (skill.name === 'proactive-alerts') {
                if (/alert.*when|notify.*when|automat/i.test(lower)) continue;  // automation, not alert check
              }
              // Special check: review-queue should not match tax form reviews
              if (skill.name === 'review-queue') {
                if (/review.*t[12]|t2125|t1.*general|t1.*review|gst.*review|hst.*review|schedule.*1|review.*gst|review.*hst/i.test(lower)) continue;
              }
              // Special check: create-automation should not match listing/showing automations
              if (skill.name === 'create-automation') {
                if (/^(?:show|list|get|view|display|what|my)\s.*automat|^automat.*(?:show|list|get)|show.*my.*automat|list.*automat|my.*automat|active.*rule/i.test(lower)) continue;
              }
              selectedSkill = skill;
              confidence = 0.85;
              break;
            }
          } catch { /* invalid regex */ }
        }
        if (selectedSkill) break;
      }

      // Extract params for regex-matched skills
      if (selectedSkill) {
        const params = selectedSkill.parameters as Record<string, any>;
        if (params.question) extractedParams.question = text;
        if (params.scenario) extractedParams.scenario = text;
        if (params.amountCents) {
          // Try $X.XX, then bare number after expense verb, then N bucks/dollars, then X.XX standalone
          const amtMatch = processedText.match(/\$\s*([\d,]+\.?\d{0,2})/)
            || processedText.match(/(?:spent|paid|bought|purchased|cost|was)\s+\$?([\d,]+\.?\d{0,2})/i)
            || processedText.match(/([\d,]+\.?\d{0,2})\s*(?:dollars|bucks|cad|usd)/i)
            || processedText.match(/\b([\d,]+\.\d{2})\b/);
          if (amtMatch) extractedParams.amountCents = Math.round(parseFloat(amtMatch[1].replace(/,/g, '')) * 100);
        }
        if (params.vendor) {
          // Try "at/from/@ Vendor", then "on/for description"
          const vendorMatch = processedText.match(/(?:at|from|@)\s+([A-Z][A-Za-z\s&']+)/)
            || processedText.match(/(?:on|for)\s+(.+?)(?:\s+today|\s+yesterday|\s*$)/i);
          if (vendorMatch) extractedParams.vendor = vendorMatch[1].trim();
        }
        if (params.clientName) {
          const invoiceMatch = text.match(/invoice\s+(.+?)\s+\$/i);
          if (invoiceMatch) extractedParams.clientName = invoiceMatch[1].trim();
          // estimate/quote pattern: "estimate TechCorp $3000 ..."
          if (!extractedParams.clientName) {
            const estMatch = text.match(/(?:estimate|quote|proposal)\s+(.+?)\s+\$/i);
            if (estMatch) extractedParams.clientName = estMatch[1].trim();
          }
          // payment pattern: "got $5000 from Acme"
          if (!extractedParams.clientName) {
            const payMatch = text.match(/from\s+([A-Z][A-Za-z\s&']+)/i);
            if (payMatch) extractedParams.clientName = payMatch[1].trim();
          }
          // timer pattern: "start timer for TechCorp"
          if (!extractedParams.clientName) {
            const timerMatch = text.match(/timer\s+(?:for\s+)?(.+?)(?:\s+project)?$/i);
            if (timerMatch) extractedParams.clientName = timerMatch[1].trim();
          }
        }
        if (params.description && !extractedParams.description) extractedParams.description = text;
      }
    }

    // Stage 3: LLM classification
    if (!selectedSkill) {
      const skillDescriptions = skills.map((s: any) => `- ${s.name}: ${s.description}`).join('\n');
      const recentConvo = conversation.slice(0, 5).reverse().map((c: any) => `User: ${c.question}\nAgent: ${c.answer}`).join('\n');
      const memoryContext = memory.filter((m: any) => m.type === 'context').map((m: any) => `${m.key}: ${m.value}`).join('\n');

      const llmResult = await callGemini(
        `You are an intent classifier for AgentBook, an AI accounting agent.
Given the user's message, conversation history, and available skills, determine:
1. Which skill to invoke (by name)
2. What parameters to extract
3. Your confidence (0-1)

Available skills:
${skillDescriptions}

Respond as JSON only: { "skill": "skill-name", "parameters": { ... }, "confidence": 0.9 }
If no skill matches well, use "general-question" with parameter "question" = the user's message.`,
        `${recentConvo ? 'Recent conversation:\n' + recentConvo + '\n\n' : ''}${memoryContext ? 'User context:\n' + memoryContext + '\n\n' : ''}User message: ${text}`,
        300,
      );

      if (llmResult) {
        try {
          const cleaned = llmResult.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          const parsed = JSON.parse(cleaned);
          selectedSkill = skills.find((s: any) => s.name === parsed.skill);
          extractedParams = parsed.parameters || { question: text };
          confidence = parsed.confidence || 0.7;
          // Ensure skills get required params from the original text
          if (selectedSkill) {
            const skillParams = selectedSkill.parameters as Record<string, any>;
            if (skillParams.question && !extractedParams.question) extractedParams.question = text;
            if (skillParams.scenario && !extractedParams.scenario) extractedParams.scenario = text;
            // For expense/invoice skills, extract amount from text if LLM didn't provide it
            if (skillParams.amountCents && !extractedParams.amountCents) {
              const amtMatch = text.match(/\$\s*([\d,]+\.?\d{0,2})/)
                || text.match(/(?:spent|paid|bought|purchased|cost|was)\s+\$?([\d,]+\.?\d{0,2})/i)
                || text.match(/([\d,]+\.?\d{0,2})\s*(?:dollars|bucks|cad|usd)/i)
                || text.match(/\b([\d,]+\.\d{2})\b/);
              if (amtMatch) extractedParams.amountCents = Math.round(parseFloat(amtMatch[1].replace(/,/g, '')) * 100);
            }
            if (skillParams.description && !extractedParams.description) extractedParams.description = text;
          }
        } catch { /* LLM parse failure */ }
      }

      // Ultimate fallback
      if (!selectedSkill) {
        selectedSkill = skills.find((s: any) => s.name === 'general-question');
        extractedParams = { question: text };
        confidence = 0.3;
      }
    }
  }

  if (!selectedSkill) {
    return null;
  }

  // === 3. SKILL EXECUTION ===
  const endpoint = selectedSkill.endpoint as any;
  const baseUrls: Record<string, string> = {
    '/api/v1/agentbook-expense': process.env.AGENTBOOK_EXPENSE_URL || 'http://localhost:4051',
    '/api/v1/agentbook-core': process.env.AGENTBOOK_CORE_URL || 'http://localhost:4050',
    '/api/v1/agentbook-invoice': process.env.AGENTBOOK_INVOICE_URL || 'http://localhost:4052',
    '/api/v1/agentbook-tax': process.env.AGENTBOOK_TAX_URL || 'http://localhost:4053',
  };

  // Resolve base URL
  let targetUrl = endpoint.url;
  for (const [prefix, base] of Object.entries(baseUrls)) {
    if (endpoint.url.startsWith(prefix)) {
      targetUrl = base + endpoint.url;
      break;
    }
  }

  // Special pre-processing for record-expense: auto-categorize from description/vendor
  if (selectedSkill.name === 'record-expense' && !extractedParams.categoryId) {
    try {
      // Load expense category accounts for this tenant
      const expenseAccounts = await db.abAccount.findMany({
        where: { tenantId, accountType: 'expense', isActive: true },
        select: { id: true, name: true, code: true },
      });
      if (expenseAccounts.length > 0) {
        const desc = (text || '').toLowerCase();
        // Keyword → category mapping (code-based for speed, no LLM needed)
        const categoryKeywords: Record<string, string[]> = {
          'Meals': ['lunch', 'dinner', 'breakfast', 'coffee', 'food', 'meal', 'restaurant', 'starbucks', 'mcdonald', 'uber eats', 'doordash', 'grubhub', 'snack', 'cafe', 'pizza', 'sushi', 'taco', 'burger'],
          'Travel': ['flight', 'hotel', 'airbnb', 'uber', 'lyft', 'taxi', 'cab', 'train', 'bus', 'parking', 'gas', 'fuel', 'toll', 'rental car', 'travel', 'trip'],
          'Software & Subscriptions': ['software', 'subscription', 'saas', 'aws', 'azure', 'gcp', 'github', 'figma', 'slack', 'zoom', 'notion', 'adobe', 'dropbox', 'heroku', 'vercel', 'netlify', 'hosting', 'domain', 'app', 'license'],
          'Office Expenses': ['office', 'desk', 'chair', 'monitor', 'keyboard', 'mouse', 'printer', 'paper', 'ink', 'stapler', 'pens', 'notebook', 'whiteboard'],
          'Supplies': ['supplies', 'supply', 'equipment', 'tool', 'hardware'],
          'Advertising': ['advertising', 'marketing', 'facebook ads', 'google ads', 'promotion', 'campaign', 'sponsor'],
          'Rent': ['rent', 'lease', 'coworking', 'wework', 'office space'],
          'Utilities': ['electric', 'water', 'internet', 'phone', 'utility', 'utilities', 'wifi', 'cell', 'mobile plan'],
          'Insurance': ['insurance', 'premium', 'coverage', 'liability'],
          'Legal & Professional': ['lawyer', 'legal', 'attorney', 'accountant', 'cpa', 'consultant', 'audit', 'professional', 'notary'],
          'Contract Labor': ['contractor', 'freelancer', 'freelance', 'subcontract', 'contract labor', 'outsource'],
          'Commissions & Fees': ['commission', 'fee', 'stripe', 'paypal', 'processing', 'transaction fee', 'platform fee'],
          'Bank Fees': ['bank fee', 'wire fee', 'overdraft', 'atm fee', 'monthly fee', 'service charge'],
          'Car & Truck': ['car', 'truck', 'vehicle', 'mileage', 'oil change', 'tire', 'repair', 'auto'],
        };
        for (const [catName, keywords] of Object.entries(categoryKeywords)) {
          if (keywords.some(kw => desc.includes(kw))) {
            const account = expenseAccounts.find(a => a.name === catName);
            if (account) {
              extractedParams.categoryId = account.id;
              break;
            }
          }
        }
      }
    } catch (err) { console.warn('Auto-categorize error:', err); }
  }

  // Pre-processing: query-invoices — resolve clientName to clientId
  if (selectedSkill.name === 'query-invoices' && extractedParams.clientName) {
    try {
      const invoiceBase = baseUrls['/api/v1/agentbook-invoice'] || 'http://localhost:4052';
      const clientsRes = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/clients`, { headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId } });
      const clientsData = await clientsRes.json() as any;
      const client = (clientsData.data || []).find((c: any) => c.name.toLowerCase().includes(extractedParams.clientName.toLowerCase()));
      if (client) extractedParams.clientId = client.id;
      delete extractedParams.clientName;
    } catch (err) { console.warn('Invoice client resolution error:', err); }
  }

  // Special pre-processing for create-invoice (supports multi-line items)
  if (selectedSkill.name === 'create-invoice' && extractedParams.clientName) {
    try {
      const invoiceBase = baseUrls['/api/v1/agentbook-invoice'] || 'http://localhost:4052';
      const client = await resolveOrCreateClient(invoiceBase, tenantId, extractedParams.clientName);
      if (client) {
        const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 30);

        // Parse multi-line items: "consulting $3000, design $2000, hosting $500"
        let lines: any[] = [];
        const lineText = extractedParams.description || text;

        // Pattern: match segments like "description $amount" separated by commas
        const multiLineMatch = lineText.match(/[^,$]*\$[\d,]+\.?\d{0,2}/gi);
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

        // Single item (existing behavior)
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

  // Pre-processing: edit-expense — resolve "last" or recent expense
  if (selectedSkill.name === 'edit-expense') {
    try {
      const expenseBase = baseUrls['/api/v1/agentbook-expense'] || 'http://localhost:4051';
      const EH = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
      if (!extractedParams.expenseId || extractedParams.expenseId === 'last') {
        // Find most recent expense
        const res = await fetch(`${expenseBase}/api/v1/agentbook-expense/expenses?limit=1`, { headers: EH });
        const data = await res.json() as any;
        if (data.data?.[0]) extractedParams.expenseId = data.data[0].id;
      }
      // Also try to resolve "that" from last conversation
      if (!extractedParams.expenseId) {
        const lastConvo = await db.abConversation.findFirst({ where: { tenantId, skillUsed: 'record-expense' }, orderBy: { createdAt: 'desc' } });
        const lastData = lastConvo?.data as any;
        if (lastData?.params?.expenseId || lastData?.id) extractedParams.expenseId = lastData.params?.expenseId || lastData.id;
      }
    } catch (err) { console.warn('Edit-expense resolution error:', err); }
  }

  // Pre-processing: split-expense — resolve expense ID
  if (selectedSkill.name === 'split-expense') {
    try {
      if (!extractedParams.expenseId || extractedParams.expenseId === 'last') {
        const expenseBase = baseUrls['/api/v1/agentbook-expense'] || 'http://localhost:4051';
        const res = await fetch(`${expenseBase}/api/v1/agentbook-expense/expenses?limit=1`, { headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId } });
        const data = await res.json() as any;
        if (data.data?.[0]) extractedParams.expenseId = data.data[0].id;
      }
    } catch (err) { console.warn('Split-expense resolution error:', err); }
  }

  // Pre-processing: send-invoice — resolve invoice reference
  if (selectedSkill.name === 'send-invoice') {
    try {
      const invoiceBase = baseUrls['/api/v1/agentbook-invoice'] || 'http://localhost:4052';
      const H = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
      let invoiceId = extractedParams.invoiceId;
      if (!invoiceId || invoiceId === 'last' || invoiceId === 'that') {
        // Find most recent invoice
        const listRes = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/invoices?limit=1`, { headers: H });
        const listData = await listRes.json() as any;
        const invoices = listData.data || [];
        if (invoices.length > 0) invoiceId = invoices[0].id;
      } else if (invoiceId.startsWith('INV-')) {
        // Look up by number
        const listRes = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/invoices?number=${encodeURIComponent(invoiceId)}`, { headers: H });
        const listData = await listRes.json() as any;
        const invoices = listData.data || [];
        if (invoices.length > 0) invoiceId = invoices[0].id;
      }
      if (!invoiceId) {
        await db.abConversation.create({ data: { tenantId, question: text || '[send-invoice]', answer: "I couldn't find an invoice to send. Please specify an invoice number.", queryType: 'agent', channel, skillUsed: 'send-invoice' } });
        return {
          selectedSkill, extractedParams, confidence, skillUsed: selectedSkill.name, skillResponse: null,
          responseData: { message: "I couldn't find an invoice to send. Please specify an invoice number.", skillUsed: 'send-invoice', confidence, latencyMs: Date.now() - startTime },
        };
      }
      targetUrl = targetUrl.replace(':id', invoiceId);
      extractedParams = {};
    } catch (err) { console.warn('Send-invoice resolution error:', err); }
  }

  // Pre-processing: create-payment-link — resolve invoice ID (same pattern as send-invoice)
  if (selectedSkill.name === 'create-payment-link') {
    try {
      const invoiceBase = baseUrls['/api/v1/agentbook-invoice'] || 'http://localhost:4052';
      const H = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
      let invoiceId = extractedParams.invoiceId;
      if (!invoiceId || invoiceId === 'last' || invoiceId === 'that') {
        const listRes = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/invoices?limit=1`, { headers: H });
        const listData = await listRes.json() as any;
        const invoices = listData.data || [];
        if (invoices.length > 0) invoiceId = invoices[0].id;
      } else if (invoiceId.startsWith('INV-')) {
        const listRes = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/invoices?number=${encodeURIComponent(invoiceId)}`, { headers: H });
        const listData = await listRes.json() as any;
        const invoices = listData.data || [];
        if (invoices.length > 0) invoiceId = invoices[0].id;
      }
      if (invoiceId) {
        targetUrl = targetUrl.replace(':id', invoiceId);
        extractedParams = {};
      }
    } catch (err) { console.warn('Create-payment-link resolution error:', err); }
  }

  // Pre-processing: toggle-auto-reminders — parse enable/disable from text
  if (selectedSkill.name === 'toggle-auto-reminders') {
    const enable = /enable|turn on|activate|start/i.test(text);
    extractedParams = { autoRemindEnabled: enable };
  }

  // Pre-processing: convert-estimate — resolve "last" estimate
  if (selectedSkill.name === 'convert-estimate') {
    try {
      const invoiceBase = baseUrls['/api/v1/agentbook-invoice'] || 'http://localhost:4052';
      if (!extractedParams.estimateId || extractedParams.estimateId === 'last') {
        const res = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/estimates?status=approved&limit=1`, { headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId } });
        const data = await res.json() as any;
        if (data.data?.[0]) extractedParams.estimateId = data.data[0].id;
      }
    } catch (err) { console.warn('Convert-estimate resolution error:', err); }
  }

  // Pre-processing: void-invoice — resolve invoice reference
  if (selectedSkill.name === 'void-invoice') {
    try {
      const invoiceBase = baseUrls['/api/v1/agentbook-invoice'] || 'http://localhost:4052';
      const IH = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
      let invoiceId = extractedParams.invoiceId;
      if (!invoiceId || invoiceId === 'last') {
        const res = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/invoices?limit=1`, { headers: IH });
        const data = await res.json() as any;
        invoiceId = data.data?.[0]?.id;
      } else if (invoiceId.startsWith('INV-')) {
        const res = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/invoices`, { headers: IH });
        const data = await res.json() as any;
        const match = data.data?.find((i: any) => i.number === invoiceId);
        invoiceId = match?.id;
      }
      if (invoiceId) extractedParams.invoiceId = invoiceId;
    } catch (err) { console.warn('Void-invoice resolution error:', err); }
  }

  // Pre-processing: create-credit-note — resolve invoice reference
  if (selectedSkill.name === 'create-credit-note' && !extractedParams.invoiceId) {
    try {
      const invoiceBase = baseUrls['/api/v1/agentbook-invoice'] || 'http://localhost:4052';
      const res = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/invoices?limit=1`, { headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId } });
      const data = await res.json() as any;
      if (data.data?.[0]) extractedParams.invoiceId = data.data[0].id;
      if (!extractedParams.reason) extractedParams.reason = 'Credit adjustment';
    } catch (err) { console.warn('Credit-note resolution error:', err); }
  }

  // Pre-processing: record-payment — resolve client → outstanding invoice → amount
  if (selectedSkill.name === 'record-payment') {
    try {
      const invoiceBase = baseUrls['/api/v1/agentbook-invoice'] || 'http://localhost:4052';
      const H = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
      if (extractedParams.clientName) {
        const client = await resolveOrCreateClient(invoiceBase, tenantId, extractedParams.clientName);
        if (client) {
          // Find outstanding sent invoice for this client
          const invRes = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/invoices?clientId=${client.id}&status=sent`, { headers: H });
          const invData = await invRes.json() as any;
          const invoices = invData.data || [];
          if (invoices.length > 0) {
            extractedParams.invoiceId = invoices[0].id;
            if (!extractedParams.amountCents) extractedParams.amountCents = invoices[0].amountCents;
          }
        }
        delete extractedParams.clientName;
      }
      if (!extractedParams.date) extractedParams.date = new Date().toISOString().slice(0, 10);
    } catch (err) { console.warn('Record-payment resolution error:', err); }
  }

  // Pre-processing: create-estimate — resolve client
  if (selectedSkill.name === 'create-estimate' && extractedParams.clientName) {
    try {
      const invoiceBase = baseUrls['/api/v1/agentbook-invoice'] || 'http://localhost:4052';
      const client = await resolveOrCreateClient(invoiceBase, tenantId, extractedParams.clientName);
      if (client) {
        const validUntil = new Date(); validUntil.setDate(validUntil.getDate() + 30);
        extractedParams.clientId = client.id;
        if (!extractedParams.validUntil) extractedParams.validUntil = validUntil.toISOString().slice(0, 10);
        delete extractedParams.clientName;
      }
    } catch (err) { console.warn('Create-estimate resolution error:', err); }
  }

  // Pre-processing: cpa-notes — switch to POST if note content provided
  if (selectedSkill.name === 'cpa-notes' && extractedParams.note) {
    endpoint = { method: 'POST', url: '/api/v1/agentbook-core/cpa/notes' };
    targetUrl = (baseUrls['/api/v1/agentbook-core'] || 'http://localhost:4050') + '/api/v1/agentbook-core/cpa/notes';
  }

  // Pre-processing: start-timer — resolve client/project names to IDs
  if (selectedSkill.name === 'start-timer') {
    try {
      const invoiceBase = baseUrls['/api/v1/agentbook-invoice'] || 'http://localhost:4052';
      const H = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
      if (extractedParams.clientName) {
        const clientsRes = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/clients`, { headers: H });
        const clientsData = await clientsRes.json() as any;
        const client = (clientsData.data || []).find((c: any) => c.name.toLowerCase().includes(extractedParams.clientName.toLowerCase()));
        if (client) extractedParams.clientId = client.id;
        delete extractedParams.clientName;
      }
      if (extractedParams.projectName) {
        const projRes = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/projects`, { headers: H });
        const projData = await projRes.json() as any;
        const project = (projData.data || []).find((p: any) => p.name.toLowerCase().includes(extractedParams.projectName.toLowerCase()));
        if (project) extractedParams.projectId = project.id;
        delete extractedParams.projectName;
      }
    } catch (err) { console.warn('Start-timer resolution error:', err); }
  }

  // Special inline handler: send-reminder (INTERNAL — batch overdue reminders)
  if (selectedSkill.name === 'send-reminder') {
    try {
      const invoiceBase = baseUrls['/api/v1/agentbook-invoice'] || 'http://localhost:4052';
      const H = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
      let message = '';

      if (extractedParams.invoiceId && extractedParams.invoiceId !== 'all') {
        // Specific invoice reminder
        const remindRes = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/invoices/${extractedParams.invoiceId}/remind`, { method: 'POST', headers: H });
        const remindData = await remindRes.json() as any;
        message = remindData.success ? 'Payment reminder sent!' : "Couldn't send reminder — invoice may not be overdue.";
      } else {
        // All overdue invoices
        const listRes = await fetch(`${invoiceBase}/api/v1/agentbook-invoice/invoices?status=overdue`, { headers: H });
        const listData = await listRes.json() as any;
        const overdue = listData.data || [];

        if (overdue.length === 0) {
          message = 'No overdue invoices found. All clients are up to date!';
        } else {
          let sent = 0;
          for (const inv of overdue) {
            try {
              await fetch(`${invoiceBase}/api/v1/agentbook-invoice/invoices/${inv.id}/remind`, { method: 'POST', headers: H });
              sent++;
            } catch { /* skip failed */ }
          }
          message = `Sent payment reminders for ${sent} of ${overdue.length} overdue invoices.`;
        }
      }

      await db.abConversation.create({ data: { tenantId, question: text || '[send-reminder]', answer: message, queryType: 'agent', channel, skillUsed: 'send-reminder' } });
      await db.abEvent.create({ data: { tenantId, eventType: 'agent.message', actor: 'user', action: { skillUsed: 'send-reminder', channel } } });
      return {
        selectedSkill, extractedParams, confidence, skillUsed: selectedSkill.name, skillResponse: null,
        responseData: { message, skillUsed: 'send-reminder', confidence, latencyMs: Date.now() - startTime },
      };
    } catch (err) {
      console.error('Send-reminder error:', err);
      return {
        selectedSkill, extractedParams, confidence: 0, skillUsed: 'send-reminder', skillResponse: null,
        responseData: { message: "I couldn't send reminders. Please try again.", skillUsed: 'send-reminder', confidence: 0, latencyMs: Date.now() - startTime },
      };
    }
  }

  // INTERNAL handler: tax-filing-start
  // INTERNAL handler: tax-slip-scan — upload attachment → OCR → extract fields
  if (selectedSkill.name === 'tax-slip-scan') {
    try {
      const taxBase = baseUrls['/api/v1/agentbook-tax'] || 'http://localhost:4053';
      const IH = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };

      // Get image URL from attachments or params
      let imageUrl = extractedParams.imageUrl;
      if (!imageUrl && attachments?.length > 0) {
        imageUrl = attachments[0].url;
      }
      if (!imageUrl) {
        return { selectedSkill, extractedParams, confidence, skillUsed: 'tax-slip-scan', skillResponse: null,
          responseData: { message: 'Please send a photo or PDF of your tax slip (T4, T5, RRSP, etc.).', actions: [], chartData: null, skillUsed: 'tax-slip-scan', confidence, latencyMs: Date.now() - startTime } };
      }

      const ocrRes = await fetch(`${taxBase}/api/v1/agentbook-tax/tax-slips/ocr`, {
        method: 'POST', headers: IH,
        body: JSON.stringify({ imageUrl, taxYear: 2025 }),
      });
      const ocrData = await ocrRes.json() as any;

      let message: string;
      if (ocrData.success && ocrData.data?.slipType && ocrData.data.slipType !== 'unknown') {
        const d = ocrData.data;
        message = `\u{1F9FE} **${d.slipType}** scanned${d.issuer ? ` from ${d.issuer}` : ''}\n`;
        message += `Confidence: ${Math.round((d.confidence || 0) * 100)}%\n\n`;
        // Show extracted fields
        const fields = d.extractedData || {};
        for (const [k, v] of Object.entries(fields)) {
          if (v && v !== 0) {
            const label = k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
            const display = typeof v === 'number' && k.includes('income') || k.includes('amount') || k.includes('deducted') || k.includes('contributions') || k.includes('premiums')
              ? `$${(Number(v) / 100).toFixed(2)}` : String(v);
            message += `\u2022 ${label}: ${display}\n`;
          }
        }
        message += '\nConfirm this is correct? (yes/no)';

        // Auto-confirm for high confidence
        if (d.confidence >= 0.8) {
          await fetch(`${taxBase}/api/v1/agentbook-tax/tax-slips/${d.id}/confirm`, { method: 'POST', headers: IH });
          message += '\n\n\u2705 Auto-confirmed (high confidence). Re-populate your filing to update fields.';
        }
      } else {
        message = "I couldn't read that tax slip. Please try a clearer photo, or make sure it's a Canadian tax document (T4, T5, RRSP receipt, etc.).";
      }

      await db.abConversation.create({ data: { tenantId, question: text || '[tax slip]', answer: message, queryType: 'agent', channel, skillUsed: 'tax-slip-scan' } });
      return { selectedSkill, extractedParams, confidence, skillUsed: 'tax-slip-scan', skillResponse: ocrData,
        responseData: { message, actions: [], chartData: null, skillUsed: 'tax-slip-scan', confidence, latencyMs: Date.now() - startTime } };
    } catch (err) {
      console.error('Tax slip scan error:', err);
      return { selectedSkill, extractedParams, confidence, skillUsed: 'tax-slip-scan', skillResponse: null,
        responseData: { message: "I couldn't process that tax slip. Please try again.", actions: [], chartData: null, skillUsed: 'tax-slip-scan', confidence: 0, latencyMs: Date.now() - startTime } };
    }
  }

  if (selectedSkill.name === 'tax-filing-start') {
    try {
      const taxBase = baseUrls['/api/v1/agentbook-tax'] || 'http://localhost:4053';
      const IH = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
      const taxYear = extractedParams.taxYear || 2025;

      // Seed forms
      await fetch(`${taxBase}/api/v1/agentbook-tax/tax-forms/seed`, { method: 'POST', headers: IH });

      // Populate filing
      const res = await fetch(`${taxBase}/api/v1/agentbook-tax/tax-filing/${taxYear}`, { headers: IH });
      const data = await res.json() as any;

      if (!data.success) throw new Error(data.error || 'Filing failed');

      const filing = data.data;
      let message = `**Tax Filing ${taxYear} — ${(filing.jurisdiction || 'ca').toUpperCase()}**\n\n`;
      message += `Overall completeness: **${Math.round((filing.completeness || 0) * 100)}%**\n\n`;

      for (const form of (filing.forms || [])) {
        const icon = form.completeness >= 100 ? '\u2705' : form.completeness >= 50 ? '\u{1F7E1}' : '\u{1F534}';
        message += `${icon} **${form.formCode}**: ${form.completeness}% complete\n`;
      }

      if (filing.missingFields?.length > 0) {
        const manualFields = filing.missingFields.filter((f: any) => f.source === 'manual');
        const slipFields = filing.missingFields.filter((f: any) => f.source === 'slip');
        message += `\n**Missing:**\n`;
        if (manualFields.length > 0) message += `- ${manualFields.length} fields need your input\n`;
        if (slipFields.length > 0) message += `- ${slipFields.length} fields need tax slips (T4, T5, RRSP, etc.)\n`;
        message += `\nSend tax slips as photos/PDFs, or ask me about a specific form.`;
      } else {
        message += `\nAll fields populated! Review each form or export when ready.`;
      }

      await db.abConversation.create({ data: { tenantId, question: text || '[tax filing]', answer: message, queryType: 'agent', channel, skillUsed: 'tax-filing-start' } });
      return { selectedSkill, extractedParams, confidence, skillUsed: 'tax-filing-start', skillResponse: data,
        responseData: { message, actions: [], chartData: null, skillUsed: 'tax-filing-start', confidence, latencyMs: Date.now() - startTime } };
    } catch (err) {
      console.error('Tax filing start error:', err);
      return { selectedSkill, extractedParams, confidence: 0, skillUsed: 'tax-filing-start', skillResponse: null,
        responseData: { message: "I couldn't start the tax filing. Please try again.", actions: [], chartData: null, skillUsed: 'tax-filing-start', confidence: 0, latencyMs: Date.now() - startTime } };
    }
  }

  // INTERNAL handler: tax-filing-export
    if (selectedSkill.name === 'tax-filing-export') {
      try {
        const taxBase = baseUrls['/api/v1/agentbook-tax'] || 'http://localhost:4053';
        const IH = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
        const format = extractedParams.format || 'json';
        const res = await fetch(`${taxBase}/api/v1/agentbook-tax/tax-filing/2025/export`, {
          method: 'POST', headers: IH, body: JSON.stringify({ format }),
        });
        const data = format === 'pdf' ? { success: true, format: 'pdf' } : await res.json() as any;
        let message: string;
        if (format === 'pdf' && res.ok) {
          message = 'Tax return PDF generated! Your return is ready for review and printing.';
        } else if (data.success) {
          message = '**Tax Return Exported** in JSON format.';
          if (data.data?.validation?.warnings?.length > 0) {
            message += `\n\n**Warnings:**\n`;
            data.data.validation.warnings.forEach((w: any) => { message += `- ${w.message}\n`; });
          }
        } else {
          message = data.error || 'Export failed.';
          if (data.data?.validation?.errors?.length > 0) {
            message += `\n\n**Errors:**\n`;
            data.data.validation.errors.forEach((e: any) => { message += `- ${e.message}\n`; });
          }
        }
        await db.abConversation.create({ data: { tenantId, question: text || '[export]', answer: message, queryType: 'agent', channel, skillUsed: 'tax-filing-export' } });
        return { selectedSkill, extractedParams, confidence, skillUsed: 'tax-filing-export', skillResponse: data,
          responseData: { message, actions: [], chartData: null, skillUsed: 'tax-filing-export', confidence, latencyMs: Date.now() - startTime } };
      } catch (err) {
        console.error('Tax export error:', err);
        return { selectedSkill, extractedParams, confidence, skillUsed: 'tax-filing-export', skillResponse: null,
          responseData: { message: "Export failed. Please try again.", actions: [], chartData: null, skillUsed: 'tax-filing-export', confidence: 0, latencyMs: Date.now() - startTime } };
      }
    }

  // INTERNAL handler: tax-filing-submit
    if (selectedSkill.name === 'tax-filing-submit') {
      try {
        const taxBase = baseUrls['/api/v1/agentbook-tax'] || 'http://localhost:4053';
        const IH = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
        const taxYear = extractedParams.taxYear || 2025;
        const res = await fetch(`${taxBase}/api/v1/agentbook-tax/tax-filing/${taxYear}/submit`, { method: 'POST', headers: IH });
        const data = await res.json() as any;
        let message: string;
        if (data.success) {
          message = `\u2705 **${data.data.message}**`;
        } else {
          message = `\u274C **Filing Failed**\n\n${data.error}`;
          if (data.data?.validation?.errors?.length > 0) {
            message += '\n\n**Fix these errors first:**\n';
            data.data.validation.errors.forEach((e: any) => { message += `- ${e.message}\n`; });
          }
        }
        await db.abConversation.create({ data: { tenantId, question: text || '[submit]', answer: message, queryType: 'agent', channel, skillUsed: 'tax-filing-submit' } });
        return { selectedSkill, extractedParams, confidence, skillUsed: 'tax-filing-submit', skillResponse: data,
          responseData: { message, actions: [], chartData: null, skillUsed: 'tax-filing-submit', confidence, latencyMs: Date.now() - startTime } };
      } catch (err) {
        console.error('Tax submit error:', err);
        return { selectedSkill, extractedParams, confidence, skillUsed: 'tax-filing-submit', skillResponse: null,
          responseData: { message: "Filing submission failed. Please try again.", actions: [], chartData: null, skillUsed: 'tax-filing-submit', confidence: 0, latencyMs: Date.now() - startTime } };
      }
    }

  // Pre-processing: set-budget — resolve category name to ID
  if (selectedSkill.name === 'set-budget' && extractedParams.category) {
    try {
      const account = await db.abAccount.findFirst({
        where: { tenantId, accountType: 'expense', name: { contains: extractedParams.category, mode: 'insensitive' } },
      });
      if (account) {
        extractedParams.categoryId = account.id;
        extractedParams.categoryName = account.name;
      }
      delete extractedParams.category;
    } catch { /* ignore */ }
  }

  // Special inline handler: categorize-expenses (no external endpoint)
  if (selectedSkill.name === 'categorize-expenses') {
    try {
      const expenseBase = baseUrls['/api/v1/agentbook-expense'] || 'http://localhost:4051';
      const H = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };

      // Fetch uncategorized expenses
      const listRes = await fetch(`${expenseBase}/api/v1/agentbook-expense/expenses?limit=100`, { headers: H });
      const listData = await listRes.json() as any;
      const uncategorized = (listData.data || []).filter((e: any) => !e.categoryId);

      if (uncategorized.length === 0) {
        const totalCount = (listData.data || []).length;
        await db.abConversation.create({ data: { tenantId, question: text || '[categorize]', answer: 'All expenses are already categorized!', queryType: 'agent', channel, skillUsed: 'categorize-expenses' } });
        return {
          selectedSkill, extractedParams, confidence, skillUsed: selectedSkill.name, skillResponse: null,
          responseData: { message: `All ${totalCount} expenses are already categorized!`, skillUsed: 'categorize-expenses', confidence, latencyMs: Date.now() - startTime },
        };
      }

      // Load expense category accounts
      const expenseAccounts = await db.abAccount.findMany({
        where: { tenantId, accountType: 'expense', isActive: true },
        select: { id: true, name: true },
      });

      const categoryKeywords: Record<string, string[]> = {
        'Meals': ['lunch', 'dinner', 'breakfast', 'coffee', 'food', 'meal', 'restaurant', 'starbucks', 'mcdonald', 'uber eats', 'doordash', 'grubhub', 'snack', 'cafe', 'pizza', 'sushi', 'taco', 'burger'],
        'Travel': ['flight', 'hotel', 'airbnb', 'uber', 'lyft', 'taxi', 'cab', 'train', 'bus', 'parking', 'gas', 'fuel', 'toll', 'rental car', 'travel', 'trip'],
        'Software & Subscriptions': ['software', 'subscription', 'saas', 'aws', 'azure', 'gcp', 'github', 'figma', 'slack', 'zoom', 'notion', 'adobe', 'dropbox', 'heroku', 'vercel', 'netlify', 'hosting', 'domain', 'app', 'license'],
        'Office Expenses': ['office', 'desk', 'chair', 'monitor', 'keyboard', 'mouse', 'printer', 'paper', 'ink', 'stapler', 'pens', 'notebook', 'whiteboard'],
        'Supplies': ['supplies', 'supply', 'equipment', 'tool', 'hardware'],
        'Advertising': ['advertising', 'marketing', 'facebook ads', 'google ads', 'promotion', 'campaign', 'sponsor'],
        'Rent': ['rent', 'lease', 'coworking', 'wework', 'office space'],
        'Utilities': ['electric', 'water', 'internet', 'phone', 'utility', 'utilities', 'wifi', 'cell', 'mobile plan'],
        'Insurance': ['insurance', 'premium', 'coverage', 'liability'],
        'Legal & Professional': ['lawyer', 'legal', 'attorney', 'accountant', 'cpa', 'consultant', 'audit', 'professional', 'notary'],
        'Contract Labor': ['contractor', 'freelancer', 'freelance', 'subcontract', 'contract labor', 'outsource'],
        'Commissions & Fees': ['commission', 'fee', 'stripe', 'paypal', 'processing', 'transaction fee', 'platform fee'],
        'Bank Fees': ['bank fee', 'wire fee', 'overdraft', 'atm fee', 'monthly fee', 'service charge'],
        'Car & Truck': ['car', 'truck', 'vehicle', 'mileage', 'oil change', 'tire', 'repair', 'auto'],
      };

      let categorized = 0;
      let skipped = 0;
      const results: string[] = [];

      for (const exp of uncategorized) {
        const desc = ((exp.description || '') + ' ' + (exp.vendorName || '')).toLowerCase();
        let matchedCatId: string | null = null;
        let matchedCatName: string | null = null;

        for (const [catName, keywords] of Object.entries(categoryKeywords)) {
          if (keywords.some(kw => desc.includes(kw))) {
            const account = expenseAccounts.find(a => a.name === catName);
            if (account) {
              matchedCatId = account.id;
              matchedCatName = catName;
              break;
            }
          }
        }

        if (matchedCatId) {
          await fetch(`${expenseBase}/api/v1/agentbook-expense/expenses/${exp.id}/categorize`, {
            method: 'POST', headers: H,
            body: JSON.stringify({ categoryId: matchedCatId, source: 'agent_auto' }),
          });
          const amt = (exp.amountCents / 100).toFixed(2);
          results.push(`$${amt} ${exp.description || exp.vendorName || 'expense'} → **${matchedCatName}**`);
          categorized++;
        } else {
          skipped++;
        }
      }

      let message = `Categorized **${categorized}** of ${uncategorized.length} uncategorized expenses.`;
      if (skipped > 0) message += ` ${skipped} couldn't be auto-categorized — you can categorize them manually.`;
      if (results.length > 0) message += '\n\n' + results.slice(0, 15).join('\n');
      if (results.length > 15) message += `\n...and ${results.length - 15} more.`;

      await db.abConversation.create({ data: { tenantId, question: text || '[categorize]', answer: message, queryType: 'agent', channel, skillUsed: 'categorize-expenses' } });
      await db.abEvent.create({ data: { tenantId, eventType: 'agent.message', actor: 'user', action: { skillUsed: 'categorize-expenses', categorized, skipped, channel } } });

      return {
        selectedSkill, extractedParams, confidence, skillUsed: selectedSkill.name, skillResponse: null,
        responseData: { message, skillUsed: 'categorize-expenses', confidence, latencyMs: Date.now() - startTime },
      };
    } catch (err) {
      console.error('Categorize expenses error:', err);
      return {
        selectedSkill, extractedParams, confidence: 0, skillUsed: 'categorize-expenses', skillResponse: null,
        responseData: { message: "I couldn't categorize the expenses. Please try again.", skillUsed: 'categorize-expenses', confidence: 0, latencyMs: Date.now() - startTime },
      };
    }
  }

  let skillResponse: any = null;
  let skillError = false;
  try {
    if (endpoint.method === 'GET') {
      const queryParams = (endpoint.queryParams || []) as string[];
      const qs = new URLSearchParams();
      for (const p of queryParams) {
        if (extractedParams[p]) qs.set(p, String(extractedParams[p]));
      }
      const getUrl = qs.toString() ? `${targetUrl}?${qs}` : targetUrl;
      const getRes = await fetch(getUrl, { headers: { 'x-tenant-id': tenantId } });
      skillResponse = await getRes.json();
    } else {
      // Resolve :id or {id} path parameters in URL
      let resolvedUrl = targetUrl;
      const paramsCopy = { ...extractedParams };
      resolvedUrl = resolvedUrl.replace(/:(\w+)|\{(\w+)\}/g, (_: string, p1: string, p2: string) => {
        const key = p1 || p2;
        if (key === 'id' && !paramsCopy[key]) {
          // Try expenseId, invoiceId, or generic id
          const idVal = paramsCopy.expenseId || paramsCopy.invoiceId || paramsCopy.id;
          if (idVal) { delete paramsCopy.expenseId; delete paramsCopy.invoiceId; delete paramsCopy.id; return encodeURIComponent(String(idVal)); }
        }
        if (paramsCopy[key]) { const val = paramsCopy[key]; delete paramsCopy[key]; return encodeURIComponent(String(val)); }
        return _;
      });

      const fetchRes = await fetch(resolvedUrl, {
        method: endpoint.method || 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify(paramsCopy),
      });
      skillResponse = await fetchRes.json();
    }
  } catch (err) {
    console.error('Skill execution error:', err);
    skillError = true;
  }

  // Post-processing: resolve category name for newly created expenses
  if (selectedSkill.name === 'record-expense' && skillResponse?.success && skillResponse.data?.categoryId) {
    try {
      const cat = await db.abAccount.findFirst({ where: { id: skillResponse.data.categoryId } });
      if (cat) skillResponse.data.categoryName = cat.name;
    } catch { /* ignore */ }
  }

  // === 4. RESPONSE FORMATTING ===
  let message = '';
  let actions: any[] = [];
  let chartData: any = null;

  if (skillError || !skillResponse?.success) {
    // Provide specific error feedback based on skill and what went wrong
    const errorDetail = skillResponse?.error || '';
    if (selectedSkill.name === 'record-expense') {
      if (!extractedParams.amountCents) {
        message = "I couldn't find the amount. Try including a number, e.g.:\n• \"Spent $45 on lunch\"\n• \"Paid 132.99 for gas\"";
      } else {
        message = `I couldn't record that expense. ${errorDetail ? 'Error: ' + errorDetail : 'Please try again.'}`;
      }
    } else if (selectedSkill.name === 'create-invoice' || selectedSkill.name === 'create-estimate') {
      if (!extractedParams.clientName && !extractedParams.clientId) {
        message = "I need a client name and amount. Try:\n• \"Invoice Acme $5000 for consulting\"\n• \"Estimate TechCorp $3000 for web design\"";
      } else {
        message = `I couldn't create that. ${errorDetail ? 'Error: ' + errorDetail : 'Please check the client name and amount.'}`;
      }
    } else if (selectedSkill.name === 'record-payment') {
      message = "I couldn't record the payment. I need a client or invoice reference:\n• \"Got $5000 from Acme\"\n• \"Record payment for INV-2026-0001\"";
    } else if (selectedSkill.name === 'send-invoice') {
      message = "I couldn't find an invoice to send. Try:\n• \"Send invoice INV-2026-0001\"\n• Create one first: \"Invoice Acme $5000\"";
    } else if (errorDetail) {
      message = `I couldn't complete that action. ${errorDetail}`;
    } else {
      message = `I couldn't complete that action (skill: ${selectedSkill.name}). Please try rephrasing or type /help ${selectedSkill.category || ''} for guidance.`;
    }
  } else {
    const data = skillResponse.data;

    // Use response template if available
    if (selectedSkill.responseTemplate && data) {
      message = (selectedSkill.responseTemplate as string).replace(/\{\{(\w+)\}\}/g, (_: any, key: string) => {
        if (key === 'amount' || key === 'amountFormatted') return fmtCurrency(data.amountCents || 0, data.currency);
        return data[key] || '';
      });
      // Clean up empty brackets from optional template fields
      message = message.replace(/\s*\[\s*\]\s*/g, '').trim();
    } else if (data?.answer) {
      message = data.answer;
    } else if (data?.alerts) {
      message = data.alerts.length > 0
        ? data.alerts.slice(0, 5).map((a: any) => `${a.severity === 'critical' ? '\u{1F534}' : a.severity === 'important' ? '\u{1F7E1}' : '\u{1F7E2}'} **${a.title}**\n${a.message}`).join('\n\n')
        : 'All clear! No alerts right now.';
    } else if (data?.narrative) {
      message = data.narrative;
      if (data.impact) {
        message += `\n\nImpact: Monthly net change $${(data.impact.monthlyNetChangeCents / 100).toLocaleString()}`;
      }
    } else if (data?.annotation) {
      message = data.annotation;
      chartData = { type: data.chartType || 'bar', data: data.data || [] };

    // Receipt OCR result
    } else if (data?.status && (data.status.startsWith('processed_by_') || data.status === 'gemini_parse_error' || data.status === 'gemini_error' || data.status === 'no_llm_configured')) {
      if (data.amount_cents > 0 && data.autoRecorded) {
        const amt = (data.amount_cents / 100).toFixed(2);
        message = `\u2705 **Receipt recorded!**\n\n\u{1F4B0} **$${amt}**${data.vendor ? ` at ${data.vendor}` : ''}`;
        if (data.date) message += `\n\u{1F4C5} ${data.date}`;
        if (data.items) message += `\n\u{1F4DD} ${data.items}`;
        message += `\n\u{1F50D} Confidence: ${Math.round((data.confidence || 0) * 100)}%`;
      } else if (data.amount_cents > 0) {
        const amt = (data.amount_cents / 100).toFixed(2);
        message = `\u{1F9FE} **Receipt scanned** (needs review)\n\n\u{1F4B0} $${amt}${data.vendor ? ` \u2014 ${data.vendor}` : ''}`;
        if (data.date) message += `\n\u{1F4C5} ${data.date}`;
        message += `\n\u{1F50D} Low confidence (${Math.round((data.confidence || 0) * 100)}%)`;
        message += `\n\nConfirm or type the correct amount.`;
      } else {
        message = `\u{1F9FE} I couldn't read the amount from that receipt.`;
        if (data.vendor) message += ` I can see it's from **${data.vendor}**.`;
        message += `\n\nPlease type the expense, e.g.: "Spent $45 on lunch at ${data.vendor || 'store'}"`;
        if (data.status === 'gemini_parse_error') message += `\n\n_(The image was processed but the result couldn't be parsed. Try a clearer photo.)_`;
        if (data.status === 'no_llm_configured') message += `\n\n_(Receipt scanning requires LLM configuration.)_`;
      }

    // Invoice list
    } else if (Array.isArray(data) && data.length > 0 && data[0]?.number && data[0]?.status) {
      message = data.slice(0, 10).map((inv: any) => {
        const icon = inv.status === 'paid' ? '\u2705' : inv.status === 'overdue' ? '\u{1F534}' : '\u{1F7E1}';
        return `${icon} ${inv.number} \u2014 ${fmtCurrency(inv.amountCents, inv.currency)} (${inv.client?.name || 'Unknown'}) [${inv.status}]`;
      }).join('\n');
      if (data.length > 10) message += `\n...and ${data.length - 10} more.`;

    // Aging report
    } else if (data?.buckets) {
      message = '**Accounts Receivable Aging**\n';
      const buckets = data.buckets;
      for (const [label, invoices] of Object.entries(buckets)) {
        const inv = invoices as any[];
        if (inv.length > 0) {
          const totalCents = inv.reduce((s: number, i: any) => s + (i.balanceDueCents || i.amountCents || 0), 0);
          message += `\n**${label}**: ${fmtCurrency(totalCents)} (${inv.length} invoices)`;
        }
      }
      if (data.totalOutstandingCents !== undefined) {
        message += `\n\n**Total Outstanding:** ${fmtCurrency(data.totalOutstandingCents)}`;
      }

    // Client list
    } else if (Array.isArray(data) && data.length > 0 && data[0]?.name && data[0]?.totalBilledCents !== undefined) {
      message = data.slice(0, 10).map((c: any) => {
        const balance = ((c.totalBilledCents - c.totalPaidCents) / 100).toFixed(2);
        return `\u2022 **${c.name}**${c.email ? ` (${c.email})` : ''} \u2014 outstanding: $${balance}`;
      }).join('\n');

    // Estimate list
    } else if (Array.isArray(data) && data.length > 0 && data[0]?.validUntil && data[0]?.amountCents) {
      message = data.slice(0, 10).map((e: any) => {
        const icon = e.status === 'approved' ? '\u2705' : e.status === 'declined' ? '\u274C' : '\u{1F7E1}';
        return `${icon} $${(e.amountCents / 100).toFixed(2)} \u2014 ${e.description} (${e.client?.name || 'Unknown'}) [${e.status}]`;
      }).join('\n');

    // Timer status
    } else if (data?.running !== undefined) {
      message = data.running
        ? `Timer running: ${data.entry?.description || 'untitled'} (${data.elapsedMinutes || 0} min)`
        : 'No timer running.';

    // Unbilled summary
    } else if (Array.isArray(data) && data.length > 0 && data[0]?.unbilledAmountCents !== undefined) {
      message = '**Unbilled Time**\n';
      let total = 0;
      for (const item of data) {
        message += `\n\u2022 **${item.clientName || 'Unknown'}**: ${item.totalHours?.toFixed(1) || 0}h \u2014 $${(item.unbilledAmountCents / 100).toFixed(2)}`;
        total += item.unbilledAmountCents;
      }
      message += `\n\n**Total Unbilled:** $${(total / 100).toFixed(2)}`;

    // Send invoice response
    } else if (selectedSkill.name === 'send-invoice' && data) {
      message = data.message || data.status === 'sent' ? `Invoice sent to client!` : `Invoice marked as sent.`;

    // Record payment response
    } else if (selectedSkill.name === 'record-payment' && data) {
      const amt = data.amountCents ? `$${(data.amountCents / 100).toFixed(2)}` : '';
      message = `Payment recorded${amt ? ': ' + amt : ''}. Invoice updated.`;

    // Create estimate response
    } else if (selectedSkill.name === 'create-estimate' && data) {
      const amt = data.amountCents ? `$${(data.amountCents / 100).toFixed(2)}` : '';
      message = `Estimate created${amt ? ' for ' + amt : ''}${data.client?.name ? ' (' + data.client.name + ')' : ''}.`;

    // Start timer response
    } else if (selectedSkill.name === 'start-timer' && data) {
      message = `Timer started${data.description ? ': ' + data.description : ''}.`;

    // Stop timer response
    } else if (selectedSkill.name === 'stop-timer' && data) {
      const mins = data.durationMinutes || data.elapsedMinutes || 0;
      message = `Timer stopped. Duration: ${mins} minutes.`;

    // Tax estimate
    } else if (data?.totalTaxCents !== undefined && data?.effectiveRate !== undefined) {
      message = '**Tax Estimate**\n';
      if (data.grossRevenueCents) message += `\nGross Revenue: $${(data.grossRevenueCents / 100).toFixed(2)}`;
      if (data.totalExpensesCents) message += `\nExpenses: $${(data.totalExpensesCents / 100).toFixed(2)}`;
      if (data.netIncomeCents !== undefined) message += `\nNet Income: $${(data.netIncomeCents / 100).toFixed(2)}`;
      message += `\n\n**Taxes:**`;
      if (data.selfEmploymentTaxCents) message += `\nSE Tax: $${(data.selfEmploymentTaxCents / 100).toFixed(2)}`;
      if (data.incomeTaxCents) message += `\nIncome Tax: $${(data.incomeTaxCents / 100).toFixed(2)}`;
      message += `\n**Total Tax: $${(data.totalTaxCents / 100).toFixed(2)}**`;
      message += `\nEffective Rate: ${(data.effectiveRate * 100).toFixed(1)}%`;

    // Quarterly payments
    } else if (data?.quarters && Array.isArray(data.quarters)) {
      message = '**Quarterly Tax Payments**\n';
      for (const q of data.quarters) {
        const icon = q.status === 'paid' ? '\u2705' : q.status === 'due' ? '\u{1F534}' : '\u{1F7E1}';
        message += `\n${icon} Q${q.quarter}: $${(q.amountDueCents / 100).toFixed(2)}`;
        if (q.amountPaidCents > 0) message += ` (paid: $${(q.amountPaidCents / 100).toFixed(2)})`;
        message += ` [${q.status}]`;
      }
      if (data.summary) {
        message += `\n\nTotal Due: $${(data.summary.totalDueCents / 100).toFixed(2)} | Paid: $${(data.summary.totalPaidCents / 100).toFixed(2)} | Remaining: $${(data.summary.remainingCents / 100).toFixed(2)}`;
      }

    // Deductions
    } else if (data?.deductions && Array.isArray(data.deductions)) {
      message = '**Tax Deductions**\n';
      for (const d of data.deductions.slice(0, 10)) {
        const icon = d.status === 'applied' ? '\u2705' : d.status === 'dismissed' ? '\u274C' : '\u{1F4A1}';
        message += `\n${icon} ${d.description}: $${(d.amountCents / 100).toFixed(2)} [${d.status}]`;
      }
      if (data.summary) {
        message += `\n\n**Estimated Savings: $${(data.summary.estimatedSavingsCents / 100).toFixed(2)}**`;
      }

    // Budget status
    } else if (data?.budgets && Array.isArray(data.budgets) && data.budgets[0]?.amountCents) {
      message = '**Budget Status**\n';
      for (const b of data.budgets) {
        const pct = b.percent || 0;
        const icon = pct > 100 ? '\u{1F534}' : pct > (b.alertPercent || 80) ? '\u{1F7E1}' : '\u{1F7E2}';
        message += `\n${icon} **${b.categoryName || 'Total'}**: ${fmtCurrency(b.spentCents, b.currency)} / ${fmtCurrency(b.amountCents, b.currency)} (${pct}%)`;
      }

    // Expense report
    } else if (data?.html && data?.expenseCount !== undefined) {
      message = `**Expense Report** generated\n\n${data.expenseCount} expenses, total: ${fmtCurrency(data.totalCents, data.currency)}`;
      if (data.categories?.length > 0) {
        message += '\n';
        for (const cat of data.categories.slice(0, 8)) {
          message += `\n\u2022 ${cat.name}: ${fmtCurrency(cat.total, data.currency)} (${cat.count})`;
        }
      }

    // P&L report
    } else if (data?.grossRevenueCents !== undefined && data?.totalExpensesCents !== undefined && data?.netIncomeCents !== undefined && !data?.totalTaxCents) {
      message = '**Profit & Loss**\n';
      message += `\nRevenue: ${fmtCurrency(data.grossRevenueCents, data.currency)}`;
      message += `\nExpenses: ${fmtCurrency(data.totalExpensesCents, data.currency)}`;
      message += `\n**Net Income: ${fmtCurrency(data.netIncomeCents, data.currency)}**`;
      if (data.revenueLines?.length) {
        message += '\n\nRevenue Breakdown:';
        data.revenueLines.forEach((l: any) => { message += `\n  \u2022 ${l.name}: ${fmtCurrency(l.amountCents, data.currency)}`; });
      }
      if (data.expenseLines?.length) {
        message += '\n\nExpense Breakdown:';
        data.expenseLines.slice(0, 8).forEach((l: any) => { message += `\n  \u2022 ${l.name}: ${fmtCurrency(l.amountCents, data.currency)}`; });
      }

    // Balance sheet
    } else if (data?.totalAssetsCents !== undefined && data?.totalLiabilitiesCents !== undefined) {
      message = '**Balance Sheet**\n';
      message += `\nAssets: $${(data.totalAssetsCents / 100).toFixed(2)}`;
      message += `\nLiabilities: $${(data.totalLiabilitiesCents / 100).toFixed(2)}`;
      message += `\n**Equity: $${((data.totalAssetsCents - data.totalLiabilitiesCents) / 100).toFixed(2)}**`;

    // Cashflow projection
    } else if (data?.currentBalanceCents !== undefined && data?.projections) {
      message = '**Cash Flow Projection**\n';
      message += `\nCurrent Cash: $${(data.currentBalanceCents / 100).toFixed(2)}`;
      if (data.outstandingInvoicesCents) message += `\nOutstanding Invoices: $${(data.outstandingInvoicesCents / 100).toFixed(2)}`;
      if (data.recurringExpensesCents) message += `\nMonthly Recurring: $${(data.recurringExpensesCents / 100).toFixed(2)}`;
      if (data.projections) {
        message += '\n\nProjections:';
        if (data.projections.days30) message += `\n  30 days: $${(data.projections.days30.balanceCents / 100).toFixed(2)}`;
        if (data.projections.days60) message += `\n  60 days: $${(data.projections.days60.balanceCents / 100).toFixed(2)}`;
        if (data.projections.days90) message += `\n  90 days: $${(data.projections.days90.balanceCents / 100).toFixed(2)}`;
      }

    // Financial snapshot
    } else if (data?.snapshot || (data?.cashBalanceCents !== undefined && data?.revenueThisMonthCents !== undefined)) {
      const s = data.snapshot || data;
      message = '**Financial Summary**\n';
      if (s.cashBalanceCents !== undefined) message += `\nCash: $${(s.cashBalanceCents / 100).toFixed(2)}`;
      if (s.revenueThisMonthCents !== undefined) message += `\nRevenue (this month): $${(s.revenueThisMonthCents / 100).toFixed(2)}`;
      if (s.expensesThisMonthCents !== undefined) message += `\nExpenses (this month): $${(s.expensesThisMonthCents / 100).toFixed(2)}`;
      if (s.profitThisMonthCents !== undefined) message += `\n**Profit: $${(s.profitThisMonthCents / 100).toFixed(2)}**`;
      if (s.outstandingInvoicesCents !== undefined) message += `\nOutstanding Invoices: $${(s.outstandingInvoicesCents / 100).toFixed(2)}`;

    // Money moves / suggestions
    } else if (data?.moves && Array.isArray(data.moves)) {
      message = '**Money Moves**\n';
      for (const m of data.moves.slice(0, 8)) {
        const icon = m.priority === 'high' ? '\u{1F534}' : m.priority === 'medium' ? '\u{1F7E1}' : '\u{1F7E2}';
        message += `\n${icon} **${m.title}**\n  ${m.description}`;
        if (m.savingsCents) message += ` (save $${(m.savingsCents / 100).toFixed(2)})`;
      }

    // Reconciliation summary
    } else if (data?.matched !== undefined && data?.unmatched !== undefined) {
      message = '**Bank Reconciliation**\n';
      message += `\nMatched: ${data.matched} transactions`;
      message += `\nUnmatched: ${data.unmatched} transactions`;
      if (data.totalMatchedCents) message += `\nMatched Amount: $${(data.totalMatchedCents / 100).toFixed(2)}`;
      if (data.totalUnmatchedCents) message += `\nUnmatched Amount: $${(data.totalUnmatchedCents / 100).toFixed(2)}`;

    // CPA notes
    } else if (Array.isArray(data) && data.length > 0 && data[0]?.note) {
      message = '**CPA Notes**\n';
      for (const n of data.slice(0, 10)) {
        message += `\n\u2022 ${n.note}`;
        if (n.createdAt) message += ` _(${new Date(n.createdAt).toLocaleDateString()})_`;
      }

    // CPA share link
    } else if (data?.token || data?.link || data?.accessUrl) {
      const link = data.accessUrl || data.link || `Access token: ${data.token}`;
      message = `**CPA Access Link Generated**\n\n${link}\n\nValid for ${data.expiresInDays || 30} days.`;

    // Automations list
    } else if (Array.isArray(data) && data.length > 0 && data[0]?.trigger) {
      message = '**Active Automations**\n';
      for (const a of data.slice(0, 10)) {
        const icon = a.enabled ? '\u2705' : '\u23F8\uFE0F';
        message += `\n${icon} **${a.name || a.description}**\n  When: ${a.trigger} \u2192 Then: ${a.action}`;
      }

    // Created automation
    } else if (data?.trigger && data?.action && data?.id) {
      message = `**Automation Created**\n\nWhen: ${data.trigger}\nThen: ${data.action}`;
      if (data.description) message += `\n\n${data.description}`;

    // Tax validation result
    } else if (data?.valid !== undefined && (data?.errors || data?.warnings)) {
      if (data.valid) {
        message = '\u2705 **Tax Return Validated — Ready to file!**\n';
      } else {
        message = '\u274C **Validation Failed**\n\n**Errors:**\n';
        for (const e of (data.errors || [])) { message += `- ${e.message} (${e.formCode})\n`; }
      }
      if (data.warnings?.length > 0) {
        message += `\n**Warnings:**\n`;
        for (const w of (data.warnings || [])) { message += `- ${w.message} (${w.formCode})\n`; }
      }

    // Tax filing status
    } else if (data?.filingId && data?.completeness !== undefined && data?.forms) {
      message = `**Tax Filing ${data.taxYear || '2025'}**\n\n`;
      message += `Overall: **${Math.round((data.completeness || 0) * 100)}%** complete\n\n`;
      for (const form of (data.forms || [])) {
        const icon = form.completeness >= 100 ? '\u2705' : form.completeness >= 50 ? '\u{1F7E1}' : '\u{1F534}';
        message += `${icon} **${form.formCode}**: ${form.completeness}%\n`;
      }
      if (data.missingFields?.length > 0) {
        message += `\n${data.missingFields.length} fields still needed.`;
      }

    // Tax slips list
    } else if (Array.isArray(data) && data.length > 0 && data[0]?.slipType && data[0]?.extractedData !== undefined) {
      message = '**Tax Slips**\n';
      for (const s of data) {
        const icon = s.status === 'confirmed' ? '\u2705' : '\u{1F7E1}';
        message += `\n${icon} **${s.slipType}**${s.issuer ? ` from ${s.issuer}` : ''} [${s.status}] (${Math.round((s.confidence || 0) * 100)}% confidence)`;
      }

    } else if (data?.confirmationNumber && data?.filedAt) {
      message = data.message || `Filing status: ${data.status}\nConfirmation: ${data.confirmationNumber}`;

    } else if (data?.id && data?.amountCents !== undefined) {
      const catLabel = data.categoryName ? ` [${data.categoryName}]` : '';
      message = `Recorded: ${fmtCurrency(data.amountCents, data.currency)} — ${data.description || data.number || 'Item'}${catLabel}`;
    } else if (data?.number) {
      message = `Invoice ${data.number} created — ${fmtCurrency(data.amountCents, data.currency)}`;
      if (data.lines?.length > 1) {
        message += '\n\nLine items:';
        data.lines.forEach((l: any) => {
          message += `\n• ${l.description}: ${fmtCurrency(l.amountCents, data.currency)}`;
        });
      }
    } else {
      message = JSON.stringify(data).slice(0, 300);
    }

    // Extract chart data if available
    if (data?.chartData) chartData = data.chartData;
    if (data?.data && Array.isArray(data.data) && data.data[0]?.name && data.data[0]?.value) {
      chartData = chartData || { type: 'bar', data: data.data };
    }

    // Extract actions
    if (data?.actions) actions = data.actions;
  }

  const latencyMs = Date.now() - startTime;

  // === 5. LEARNING ===
  // Save conversation
  await db.abConversation.create({
    data: { tenantId, question: text || '[attachment]', answer: message, queryType: 'agent', channel, skillUsed: selectedSkill.name, data: { params: extractedParams }, latencyMs },
  });

  // Log event
  await db.abEvent.create({
    data: { tenantId, eventType: 'agent.message', actor: 'user', action: { text: (text || '').slice(0, 100), skillUsed: selectedSkill.name, confidence, channel, latencyMs } },
  });

  return {
    selectedSkill,
    extractedParams,
    confidence,
    skillUsed: selectedSkill.name,
    skillResponse,
    responseData: { message, actions, chartData, skillUsed: selectedSkill.name, confidence, latencyMs },
  };
}

// --- 5. Agent Brain: Message Processing (thin wrapper) ---
app.post('/api/v1/agentbook-core/agent/message', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { text, channel = 'api', attachments, sessionAction, feedback } = req.body;
    if (!text && (!attachments || attachments.length === 0) && !sessionAction) {
      return res.status(400).json({ success: false, error: 'text, attachments, or sessionAction required' });
    }

    const baseUrls: Record<string, string> = {
      '/api/v1/agentbook-expense': process.env.AGENTBOOK_EXPENSE_URL || 'http://localhost:4051',
      '/api/v1/agentbook-core': process.env.AGENTBOOK_CORE_URL || 'http://localhost:4050',
      '/api/v1/agentbook-invoice': process.env.AGENTBOOK_INVOICE_URL || 'http://localhost:4052',
      '/api/v1/agentbook-tax': process.env.AGENTBOOK_TAX_URL || 'http://localhost:4053',
    };

    const result = await handleAgentMessage(
      { text: text || '', tenantId, channel, attachments, sessionAction, feedback },
      {
        skills: await db.abSkillManifest.findMany({
          where: { enabled: true, OR: [{ tenantId: null }, { tenantId }] },
        }),
        callGemini,
        baseUrls,
        classifyAndExecuteV1,
      },
    );

    res.json(result);
  } catch (err) {
    console.error('Agent message error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

start();
