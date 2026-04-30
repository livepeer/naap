/**
 * AgentBook Tax & Reports Backend - v1.0
 *
 * Full implementation:
 * - Tax estimation (US/CA brackets, SE tax)
 * - Quarterly installment tracking
 * - Deduction suggestions
 * - Financial reports (P&L, Balance Sheet, Cash Flow, Trial Balance)
 * - Cash flow projection (30/60/90 day)
 * - Tax configuration
 *
 * Uses unified database schema (packages/database) with plugin_agentbook_tax schema.
 * Reads from agentbook-core (accounts, journal entries, events, tenant config).
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createPluginServer } from '@naap/plugin-server-sdk';
import { db } from './db/client.js';
import { seedCanadianForms } from './tax-forms.js';
import { populateFiling, updateFilingField } from './tax-filing.js';
import { processSlipOCR, confirmSlip, listSlips } from './tax-slips.js';
import { validateFiling, exportFiling } from './tax-export.js';
import { submitFiling, checkFilingStatus, seedMockPartner } from './tax-efiling.js';

const pluginConfig = JSON.parse(
  readFileSync(new URL('../../plugin.json', import.meta.url), 'utf8')
);

// ============================================
// TAX BRACKET DEFINITIONS
// ============================================

/** US 2025 Federal single filer brackets (amounts in cents) */
const US_FEDERAL_BRACKETS = [
  { upTo: 11_600_00, rate: 0.10 },
  { upTo: 47_150_00, rate: 0.12 },
  { upTo: 100_525_00, rate: 0.22 },
  { upTo: 191_950_00, rate: 0.24 },
  { upTo: 243_725_00, rate: 0.32 },
  { upTo: 609_350_00, rate: 0.35 },
  { upTo: Infinity, rate: 0.37 },
];

/** CA 2025 Federal brackets (amounts in cents) */
const CA_FEDERAL_BRACKETS = [
  { upTo: 57_375_00, rate: 0.15 },
  { upTo: 114_750_00, rate: 0.205 },
  { upTo: 158_468_00, rate: 0.26 },
  { upTo: 221_708_00, rate: 0.29 },
  { upTo: Infinity, rate: 0.33 },
];

/**
 * Calculate progressive income tax from brackets.
 * All amounts in cents.
 */
function calcProgressiveTax(
  incomeCents: number,
  brackets: { upTo: number; rate: number }[],
): number {
  if (incomeCents <= 0) return 0;
  let remaining = incomeCents;
  let tax = 0;
  let prev = 0;
  for (const bracket of brackets) {
    const width = bracket.upTo === Infinity ? remaining : bracket.upTo - prev;
    const taxable = Math.min(remaining, width);
    tax += Math.round(taxable * bracket.rate);
    remaining -= taxable;
    prev = bracket.upTo;
    if (remaining <= 0) break;
  }
  return tax;
}

/**
 * Calculate self-employment tax.
 * US: 15.3% on 92.35% of net SE income
 * CA: CPP at 11.9% of net SE income (simplified)
 */
function calcSelfEmploymentTax(
  netIncomeCents: number,
  jurisdiction: string,
): number {
  if (netIncomeCents <= 0) return 0;
  if (jurisdiction === 'us') {
    // 92.35% of net income is subject to 15.3% SE tax
    return Math.round(netIncomeCents * 0.9235 * 0.153);
  }
  if (jurisdiction === 'ca') {
    // CPP self-employed contribution: 11.9%
    return Math.round(netIncomeCents * 0.119);
  }
  return 0;
}

/**
 * Select income tax brackets by jurisdiction.
 */
function getBrackets(jurisdiction: string) {
  if (jurisdiction === 'ca') return CA_FEDERAL_BRACKETS;
  return US_FEDERAL_BRACKETS; // default to US
}

// ============================================
// US QUARTERLY DEADLINES
// ============================================

function getQuarterlyDeadlines(year: number, jurisdiction: string) {
  if (jurisdiction === 'ca') {
    // Canada: Mar 15, Jun 15, Sep 15, Dec 15
    return [
      { quarter: 1, deadline: new Date(`${year}-03-15`) },
      { quarter: 2, deadline: new Date(`${year}-06-15`) },
      { quarter: 3, deadline: new Date(`${year}-09-15`) },
      { quarter: 4, deadline: new Date(`${year}-12-15`) },
    ];
  }
  // US: Apr 15, Jun 15, Sep 15, Jan 15 of next year
  return [
    { quarter: 1, deadline: new Date(`${year}-04-15`) },
    { quarter: 2, deadline: new Date(`${year}-06-15`) },
    { quarter: 3, deadline: new Date(`${year}-09-15`) },
    { quarter: 4, deadline: new Date(`${year + 1}-01-15`) },
  ];
}

// ============================================
// HELPERS
// ============================================

type TenantRequest = { tenantId: string };

function getTenantId(req: any): string {
  // From auth middleware x-tenant-id header, or user id as tenant
  return req.headers['x-tenant-id'] as string || req.user?.id || 'default';
}

function currentPeriod(): string {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `${now.getFullYear()}-Q${q}`;
}

function currentYear(): number {
  return new Date().getFullYear();
}

function parseDate(val: string | undefined, fallback: Date): Date {
  if (!val) return fallback;
  const d = new Date(val);
  return isNaN(d.getTime()) ? fallback : d;
}

// ============================================
// CREATE SERVER
// ============================================

const server = createPluginServer({
  name: 'agentbook-tax',
  port: parseInt(process.env.PORT || String(pluginConfig.backend?.devPort || 4053), 10),
  prisma: db,
  requireAuth: process.env.NODE_ENV === 'production',
  publicRoutes: ['/healthz', '/api/v1/agentbook-tax'],
});

const { router } = server;

// Tenant isolation middleware for all plugin routes
router.use((req: any, _res, next) => {
  req.tenantId = getTenantId(req);
  next();
});

// ============================================
// TAX ESTIMATION
// ============================================

router.get('/agentbook-tax/tax/estimate', async (req: any, res) => {
  try {
    const tenantId: string = req.tenantId;

    // 1. Read tenant config for jurisdiction + region
    const tenantConfig = await db.abTenantConfig.findUnique({
      where: { userId: tenantId },
    });
    const jurisdiction = tenantConfig?.jurisdiction || 'us';
    const region = tenantConfig?.region || '';

    // 2. Aggregate revenue and expenses from journal lines
    // Revenue accounts = accountType 'revenue', Expense accounts = accountType 'expense'
    const revenueAccounts = await db.abAccount.findMany({
      where: { tenantId, accountType: 'revenue', isActive: true },
    });
    const expenseAccounts = await db.abAccount.findMany({
      where: { tenantId, accountType: 'expense', isActive: true },
    });

    const revenueIds = revenueAccounts.map((a) => a.id);
    const expenseIds = expenseAccounts.map((a) => a.id);

    // Optional date filtering
    const startDate = parseDate(req.query.startDate as string, new Date(currentYear(), 0, 1));
    const endDate = parseDate(req.query.endDate as string, new Date());

    // Sum revenue (credit - debit for revenue accounts)
    const revenueAgg = revenueIds.length > 0
      ? await db.abJournalLine.aggregate({
          where: {
            accountId: { in: revenueIds },
            entry: { tenantId, date: { gte: startDate, lte: endDate } },
          },
          _sum: { creditCents: true, debitCents: true },
        })
      : { _sum: { creditCents: 0, debitCents: 0 } };

    // Sum expenses (debit - credit for expense accounts)
    const expenseAgg = expenseIds.length > 0
      ? await db.abJournalLine.aggregate({
          where: {
            accountId: { in: expenseIds },
            entry: { tenantId, date: { gte: startDate, lte: endDate } },
          },
          _sum: { creditCents: true, debitCents: true },
        })
      : { _sum: { creditCents: 0, debitCents: 0 } };

    const grossRevenueCents = (revenueAgg._sum.creditCents || 0) - (revenueAgg._sum.debitCents || 0);
    const expensesCents = (expenseAgg._sum.debitCents || 0) - (expenseAgg._sum.creditCents || 0);
    const netIncomeCents = grossRevenueCents - expensesCents;

    // 3. Calculate self-employment tax
    const seTaxCents = calcSelfEmploymentTax(netIncomeCents, jurisdiction);

    // 4. Calculate income tax using progressive brackets
    // For US: SE tax deduction = 50% of SE tax
    const seDeduction = jurisdiction === 'us' ? Math.round(seTaxCents / 2) : 0;
    const taxableIncomeCents = Math.max(0, netIncomeCents - seDeduction);
    const brackets = getBrackets(jurisdiction);
    const incomeTaxCents = calcProgressiveTax(taxableIncomeCents, brackets);
    const totalTaxCents = seTaxCents + incomeTaxCents;

    const period = req.query.period as string || currentPeriod();

    // 5. Store result in AbTaxEstimate
    const estimate = await db.abTaxEstimate.create({
      data: {
        tenantId,
        period,
        jurisdiction,
        region,
        grossRevenueCents,
        expensesCents,
        netIncomeCents,
        seTaxCents,
        incomeTaxCents,
        totalTaxCents,
      },
    });

    // Audit trail
    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'tax.estimate.calculated',
        actor: 'agent',
        action: {
          estimateId: estimate.id,
          period,
          jurisdiction,
          region,
          grossRevenueCents,
          expensesCents,
          netIncomeCents,
          seTaxCents,
          incomeTaxCents,
          totalTaxCents,
        },
      },
    });

    // 6. Return breakdown
    res.json({
      success: true,
      data: {
        id: estimate.id,
        period,
        jurisdiction,
        region,
        grossRevenueCents,
        expensesCents,
        netIncomeCents,
        seTaxCents,
        incomeTaxCents,
        totalTaxCents,
        effectiveRate: netIncomeCents > 0
          ? parseFloat((totalTaxCents / netIncomeCents * 100).toFixed(2))
          : 0,
        calculatedAt: estimate.calculatedAt,
        dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
      },
    });
  } catch (err) {
    console.error('[tax/estimate] Error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ============================================
// QUARTERLY INSTALLMENTS
// ============================================

router.get('/agentbook-tax/tax/quarterly', async (req: any, res) => {
  try {
    const tenantId: string = req.tenantId;
    const year = parseInt(req.query.year as string) || currentYear();

    const tenantConfig = await db.abTenantConfig.findUnique({
      where: { userId: tenantId },
    });
    const jurisdiction = tenantConfig?.jurisdiction || 'us';

    // Get or create quarterly payment records for the year
    let payments = await db.abQuarterlyPayment.findMany({
      where: { tenantId, year, jurisdiction },
      orderBy: { quarter: 'asc' },
    });

    // If no records exist for this year, create them from latest estimate
    if (payments.length === 0) {
      const latestEstimate = await db.abTaxEstimate.findFirst({
        where: { tenantId },
        orderBy: { calculatedAt: 'desc' },
      });

      const annualTax = latestEstimate?.totalTaxCents || 0;
      const quarterlyAmount = Math.ceil(annualTax / 4);
      const deadlines = getQuarterlyDeadlines(year, jurisdiction);

      for (const dl of deadlines) {
        await db.abQuarterlyPayment.upsert({
          where: {
            tenantId_year_quarter_jurisdiction: {
              tenantId,
              year,
              quarter: dl.quarter,
              jurisdiction,
            },
          },
          update: { amountDueCents: quarterlyAmount },
          create: {
            tenantId,
            year,
            quarter: dl.quarter,
            jurisdiction,
            amountDueCents: quarterlyAmount,
            deadline: dl.deadline,
          },
        });
      }

      payments = await db.abQuarterlyPayment.findMany({
        where: { tenantId, year, jurisdiction },
        orderBy: { quarter: 'asc' },
      });
    }

    const totalDue = payments.reduce((s, p) => s + p.amountDueCents, 0);
    const totalPaid = payments.reduce((s, p) => s + p.amountPaidCents, 0);

    res.json({
      success: true,
      data: {
        year,
        jurisdiction,
        payments,
        summary: { totalDueCents: totalDue, totalPaidCents: totalPaid, remainingCents: totalDue - totalPaid },
      },
    });
  } catch (err) {
    console.error('[tax/quarterly] Error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

router.post('/agentbook-tax/tax/quarterly/:year/:quarter/record-payment', async (req: any, res) => {
  try {
    const tenantId: string = req.tenantId;
    const year = parseInt(req.params.year);
    const quarter = parseInt(req.params.quarter);
    const { amountPaidCents } = req.body;

    if (!year || !quarter || quarter < 1 || quarter > 4) {
      return res.status(400).json({ success: false, error: 'Invalid year or quarter (1-4)' });
    }
    if (!amountPaidCents || amountPaidCents <= 0) {
      return res.status(400).json({ success: false, error: 'amountPaidCents must be a positive integer' });
    }

    const tenantConfig = await db.abTenantConfig.findUnique({
      where: { userId: tenantId },
    });
    const jurisdiction = tenantConfig?.jurisdiction || 'us';

    const payment = await db.abQuarterlyPayment.findUnique({
      where: {
        tenantId_year_quarter_jurisdiction: { tenantId, year, quarter, jurisdiction },
      },
    });

    if (!payment) {
      return res.status(404).json({ success: false, error: 'Quarterly payment record not found. Run GET /tax/quarterly first.' });
    }

    const updated = await db.abQuarterlyPayment.update({
      where: { id: payment.id },
      data: {
        amountPaidCents: payment.amountPaidCents + amountPaidCents,
        paidAt: new Date(),
      },
    });

    // Audit trail
    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'tax.quarterly.payment_recorded',
        actor: req.user?.id || 'agent',
        action: {
          paymentId: updated.id,
          year,
          quarter,
          jurisdiction,
          amountPaidCents,
          newTotalPaid: updated.amountPaidCents,
        },
      },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('[tax/quarterly/record-payment] Error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ============================================
// DEDUCTIONS
// ============================================

router.get('/agentbook-tax/tax/deductions', async (req: any, res) => {
  try {
    const tenantId: string = req.tenantId;
    const status = req.query.status as string || undefined;

    const where: any = { tenantId };
    if (status) where.status = status;

    const deductions = await db.abDeductionSuggestion.findMany({
      where,
      orderBy: { estimatedSavingsCents: 'desc' },
    });

    const totalSavingsCents = deductions
      .filter((d) => d.status !== 'dismissed')
      .reduce((s, d) => s + d.estimatedSavingsCents, 0);

    res.json({
      success: true,
      data: {
        deductions,
        summary: {
          total: deductions.length,
          suggested: deductions.filter((d) => d.status === 'suggested').length,
          applied: deductions.filter((d) => d.status === 'applied').length,
          dismissed: deductions.filter((d) => d.status === 'dismissed').length,
          totalEstimatedSavingsCents: totalSavingsCents,
        },
      },
    });
  } catch (err) {
    console.error('[tax/deductions] Error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ============================================
// REPORTS — PROFIT & LOSS
// ============================================

router.get('/agentbook-tax/reports/pnl', async (req: any, res) => {
  try {
    const tenantId: string = req.tenantId;
    const startDate = parseDate(req.query.startDate as string, new Date(currentYear(), 0, 1));
    const endDate = parseDate(req.query.endDate as string, new Date());

    // 1. Get all revenue and expense accounts
    const revenueAccounts = await db.abAccount.findMany({
      where: { tenantId, accountType: 'revenue', isActive: true },
    });
    const expenseAccounts = await db.abAccount.findMany({
      where: { tenantId, accountType: 'expense', isActive: true },
    });

    // 2. For each account, sum journal lines in date range
    const buildLines = async (accounts: typeof revenueAccounts, isRevenue: boolean) => {
      const lines = [];
      for (const acct of accounts) {
        const agg = await db.abJournalLine.aggregate({
          where: {
            accountId: acct.id,
            entry: { tenantId, date: { gte: startDate, lte: endDate } },
          },
          _sum: { debitCents: true, creditCents: true },
        });
        // Revenue: credit - debit; Expense: debit - credit
        const amount = isRevenue
          ? (agg._sum.creditCents || 0) - (agg._sum.debitCents || 0)
          : (agg._sum.debitCents || 0) - (agg._sum.creditCents || 0);
        if (amount !== 0) {
          lines.push({
            accountId: acct.id,
            code: acct.code,
            name: acct.name,
            amountCents: amount,
          });
        }
      }
      return lines;
    };

    const revenueLines = await buildLines(revenueAccounts, true);
    const expenseLines = await buildLines(expenseAccounts, false);

    const grossRevenueCents = revenueLines.reduce((s, l) => s + l.amountCents, 0);
    const totalExpensesCents = expenseLines.reduce((s, l) => s + l.amountCents, 0);
    const netIncomeCents = grossRevenueCents - totalExpensesCents;

    // Audit trail
    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'report.pnl.generated',
        actor: req.user?.id || 'agent',
        action: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          grossRevenueCents,
          totalExpensesCents,
          netIncomeCents,
        },
      },
    });

    res.json({
      success: true,
      data: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        revenue: revenueLines,
        expenses: expenseLines,
        grossRevenueCents,
        totalExpensesCents,
        netIncomeCents,
      },
    });
  } catch (err) {
    console.error('[reports/pnl] Error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ============================================
// REPORTS — BALANCE SHEET
// ============================================

router.get('/agentbook-tax/reports/balance-sheet', async (req: any, res) => {
  try {
    const tenantId: string = req.tenantId;
    const asOfDate = parseDate(req.query.asOfDate as string, new Date());

    // 1. Get all asset, liability, equity accounts
    const accounts = await db.abAccount.findMany({
      where: {
        tenantId,
        accountType: { in: ['asset', 'liability', 'equity'] },
        isActive: true,
      },
    });

    // 2. Sum journal lines up to asOfDate
    const lines: { accountId: string; code: string; name: string; accountType: string; balanceCents: number }[] = [];
    for (const acct of accounts) {
      const agg = await db.abJournalLine.aggregate({
        where: {
          accountId: acct.id,
          entry: { tenantId, date: { lte: asOfDate } },
        },
        _sum: { debitCents: true, creditCents: true },
      });
      // Asset: debit - credit (debit normal)
      // Liability & Equity: credit - debit (credit normal)
      const balance = acct.accountType === 'asset'
        ? (agg._sum.debitCents || 0) - (agg._sum.creditCents || 0)
        : (agg._sum.creditCents || 0) - (agg._sum.debitCents || 0);

      if (balance !== 0) {
        lines.push({
          accountId: acct.id,
          code: acct.code,
          name: acct.name,
          accountType: acct.accountType,
          balanceCents: balance,
        });
      }
    }

    const assets = lines.filter((l) => l.accountType === 'asset');
    const liabilities = lines.filter((l) => l.accountType === 'liability');
    const equity = lines.filter((l) => l.accountType === 'equity');

    const totalAssetsCents = assets.reduce((s, l) => s + l.balanceCents, 0);
    const totalLiabilitiesCents = liabilities.reduce((s, l) => s + l.balanceCents, 0);
    const totalEquityCents = equity.reduce((s, l) => s + l.balanceCents, 0);

    // Also include net income from revenue/expense for retained earnings
    // (P&L accounts through asOfDate)
    const revAccounts = await db.abAccount.findMany({ where: { tenantId, accountType: 'revenue', isActive: true } });
    const expAccounts = await db.abAccount.findMany({ where: { tenantId, accountType: 'expense', isActive: true } });
    const revIds = revAccounts.map((a) => a.id);
    const expIds = expAccounts.map((a) => a.id);

    const revAgg = revIds.length > 0
      ? await db.abJournalLine.aggregate({
          where: { accountId: { in: revIds }, entry: { tenantId, date: { lte: asOfDate } } },
          _sum: { creditCents: true, debitCents: true },
        })
      : { _sum: { creditCents: 0, debitCents: 0 } };
    const expAgg = expIds.length > 0
      ? await db.abJournalLine.aggregate({
          where: { accountId: { in: expIds }, entry: { tenantId, date: { lte: asOfDate } } },
          _sum: { creditCents: true, debitCents: true },
        })
      : { _sum: { creditCents: 0, debitCents: 0 } };

    const retainedEarningsCents =
      ((revAgg._sum.creditCents || 0) - (revAgg._sum.debitCents || 0)) -
      ((expAgg._sum.debitCents || 0) - (expAgg._sum.creditCents || 0));

    const totalEquityWithRetainedCents = totalEquityCents + retainedEarningsCents;

    // Audit trail
    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'report.balance_sheet.generated',
        actor: req.user?.id || 'agent',
        action: {
          asOfDate: asOfDate.toISOString(),
          totalAssetsCents,
          totalLiabilitiesCents,
          totalEquityCents: totalEquityWithRetainedCents,
        },
      },
    });

    res.json({
      success: true,
      data: {
        asOfDate: asOfDate.toISOString(),
        assets,
        liabilities,
        equity,
        retainedEarningsCents,
        totalAssetsCents,
        totalLiabilitiesCents,
        totalEquityCents: totalEquityWithRetainedCents,
        balanced: totalAssetsCents === totalLiabilitiesCents + totalEquityWithRetainedCents,
      },
    });
  } catch (err) {
    console.error('[reports/balance-sheet] Error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ============================================
// REPORTS — CASH FLOW
// ============================================

router.get('/agentbook-tax/reports/cashflow', async (req: any, res) => {
  try {
    const tenantId: string = req.tenantId;
    const startDate = parseDate(req.query.startDate as string, new Date(currentYear(), 0, 1));
    const endDate = parseDate(req.query.endDate as string, new Date());

    // 1. Get cash account (code 1000)
    const cashAccount = await db.abAccount.findUnique({
      where: { tenantId_code: { tenantId, code: '1000' } },
    });

    if (!cashAccount) {
      return res.json({
        success: true,
        data: { months: [], message: 'No cash account (code 1000) found.' },
      });
    }

    // 2. Get all journal lines for cash account within range
    const cashLines = await db.abJournalLine.findMany({
      where: {
        accountId: cashAccount.id,
        entry: { tenantId, date: { gte: startDate, lte: endDate } },
      },
      include: { entry: { select: { date: true } } },
    });

    // 3. Group by month
    const monthlyMap = new Map<string, { inCents: number; outCents: number }>();

    for (const line of cashLines) {
      const d = line.entry.date;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyMap.has(key)) {
        monthlyMap.set(key, { inCents: 0, outCents: 0 });
      }
      const bucket = monthlyMap.get(key)!;
      bucket.inCents += line.debitCents;    // Cash in = debit to cash account
      bucket.outCents += line.creditCents;  // Cash out = credit to cash account
    }

    // Sort by month key
    const months = Array.from(monthlyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month,
        inCents: data.inCents,
        outCents: data.outCents,
        netCents: data.inCents - data.outCents,
      }));

    // Audit trail
    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'report.cashflow.generated',
        actor: req.user?.id || 'agent',
        action: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          monthCount: months.length,
        },
      },
    });

    res.json({
      success: true,
      data: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        months,
        totalInCents: months.reduce((s, m) => s + m.inCents, 0),
        totalOutCents: months.reduce((s, m) => s + m.outCents, 0),
        totalNetCents: months.reduce((s, m) => s + m.netCents, 0),
      },
    });
  } catch (err) {
    console.error('[reports/cashflow] Error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ============================================
// REPORTS — TRIAL BALANCE
// ============================================

router.get('/agentbook-tax/reports/trial-balance', async (req: any, res) => {
  try {
    const tenantId: string = req.tenantId;
    const asOfDate = parseDate(req.query.asOfDate as string, new Date());

    const accounts = await db.abAccount.findMany({
      where: { tenantId, isActive: true },
      orderBy: { code: 'asc' },
    });

    const lines = [];
    let totalDebitCents = 0;
    let totalCreditCents = 0;

    for (const acct of accounts) {
      const agg = await db.abJournalLine.aggregate({
        where: {
          accountId: acct.id,
          entry: { tenantId, date: { lte: asOfDate } },
        },
        _sum: { debitCents: true, creditCents: true },
      });

      const totalDebits = agg._sum.debitCents || 0;
      const totalCredits = agg._sum.creditCents || 0;
      const netBalance = totalDebits - totalCredits;

      if (totalDebits !== 0 || totalCredits !== 0) {
        const debitBalance = netBalance > 0 ? netBalance : 0;
        const creditBalance = netBalance < 0 ? Math.abs(netBalance) : 0;

        lines.push({
          accountId: acct.id,
          code: acct.code,
          name: acct.name,
          accountType: acct.accountType,
          debitCents: debitBalance,
          creditCents: creditBalance,
        });

        totalDebitCents += debitBalance;
        totalCreditCents += creditBalance;
      }
    }

    // Audit trail
    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'report.trial_balance.generated',
        actor: req.user?.id || 'agent',
        action: {
          asOfDate: asOfDate.toISOString(),
          accountCount: lines.length,
          totalDebitCents,
          totalCreditCents,
          balanced: totalDebitCents === totalCreditCents,
        },
      },
    });

    res.json({
      success: true,
      data: {
        asOfDate: asOfDate.toISOString(),
        lines,
        totalDebitCents,
        totalCreditCents,
        balanced: totalDebitCents === totalCreditCents,
      },
    });
  } catch (err) {
    console.error('[reports/trial-balance] Error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ============================================
// CASH FLOW PROJECTION
// ============================================

router.get('/agentbook-tax/cashflow/projection', async (req: any, res) => {
  try {
    const tenantId: string = req.tenantId;
    const now = new Date();

    // 1. Current cash balance — cash account (code 1000)
    const cashAccount = await db.abAccount.findUnique({
      where: { tenantId_code: { tenantId, code: '1000' } },
    });

    let currentCashCents = 0;
    if (cashAccount) {
      const cashAgg = await db.abJournalLine.aggregate({
        where: {
          accountId: cashAccount.id,
          entry: { tenantId, date: { lte: now } },
        },
        _sum: { debitCents: true, creditCents: true },
      });
      currentCashCents = (cashAgg._sum.debitCents || 0) - (cashAgg._sum.creditCents || 0);
    }

    // 2. Known recurring expenses (from AbRecurringRule in expense schema)
    const recurringRules = await db.abRecurringRule.findMany({
      where: { tenantId, active: true },
    });

    // Calculate expected expenses for 30/60/90 day windows
    const calcRecurringExpenses = (days: number): number => {
      let total = 0;
      const windowEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

      for (const rule of recurringRules) {
        let nextDate = new Date(rule.nextExpected);
        while (nextDate <= windowEnd) {
          if (nextDate >= now) {
            total += rule.amountCents;
          }
          // Advance to next occurrence
          switch (rule.frequency) {
            case 'weekly':
              nextDate = new Date(nextDate.getTime() + 7 * 24 * 60 * 60 * 1000);
              break;
            case 'biweekly':
              nextDate = new Date(nextDate.getTime() + 14 * 24 * 60 * 60 * 1000);
              break;
            case 'monthly':
              nextDate = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, nextDate.getDate());
              break;
            case 'annual':
              nextDate = new Date(nextDate.getFullYear() + 1, nextDate.getMonth(), nextDate.getDate());
              break;
            default:
              // Unknown frequency, skip to avoid infinite loop
              nextDate = new Date(windowEnd.getTime() + 1);
          }
        }
      }
      return total;
    };

    // 3. Outstanding invoices expected to be paid
    const outstandingInvoices = await db.abInvoice.findMany({
      where: {
        tenantId,
        status: { in: ['sent', 'viewed', 'overdue'] },
      },
    });

    const calcExpectedIncome = (days: number): { totalCents: number; invoiceCount: number } => {
      const windowEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      let total = 0;
      let count = 0;
      for (const inv of outstandingInvoices) {
        // Expect payment by due date (or now if overdue)
        const expectedPayDate = inv.status === 'overdue' ? now : inv.dueDate;
        if (expectedPayDate <= windowEnd) {
          total += inv.amountCents;
          count++;
        }
      }
      return { totalCents: total, invoiceCount: count };
    };

    const projection30 = {
      days: 30,
      expectedIncome: calcExpectedIncome(30),
      expectedExpenses: calcRecurringExpenses(30),
      projectedCashCents: 0,
    };
    projection30.projectedCashCents = currentCashCents + projection30.expectedIncome.totalCents - projection30.expectedExpenses;

    const projection60 = {
      days: 60,
      expectedIncome: calcExpectedIncome(60),
      expectedExpenses: calcRecurringExpenses(60),
      projectedCashCents: 0,
    };
    projection60.projectedCashCents = currentCashCents + projection60.expectedIncome.totalCents - projection60.expectedExpenses;

    const projection90 = {
      days: 90,
      expectedIncome: calcExpectedIncome(90),
      expectedExpenses: calcRecurringExpenses(90),
      projectedCashCents: 0,
    };
    projection90.projectedCashCents = currentCashCents + projection90.expectedIncome.totalCents - projection90.expectedExpenses;

    // Audit trail
    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'cashflow.projection.generated',
        actor: req.user?.id || 'agent',
        action: {
          currentCashCents,
          recurringRuleCount: recurringRules.length,
          outstandingInvoiceCount: outstandingInvoices.length,
        },
      },
    });

    res.json({
      success: true,
      data: {
        asOfDate: now.toISOString(),
        currentCashCents,
        outstandingInvoices: outstandingInvoices.map((inv) => ({
          id: inv.id,
          number: inv.number,
          amountCents: inv.amountCents,
          dueDate: inv.dueDate,
          status: inv.status,
        })),
        recurringExpenses: recurringRules.map((r) => ({
          id: r.id,
          amountCents: r.amountCents,
          frequency: r.frequency,
          nextExpected: r.nextExpected,
        })),
        projections: [projection30, projection60, projection90],
      },
    });
  } catch (err) {
    console.error('[cashflow/projection] Error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ============================================
// TAX CONFIG
// ============================================

router.get('/agentbook-tax/tax/config', async (req: any, res) => {
  try {
    const tenantId: string = req.tenantId;

    const config = await db.abTaxConfig.findUnique({
      where: { tenantId },
    });

    if (!config) {
      // Return defaults
      return res.json({
        success: true,
        data: {
          tenantId,
          filingStatus: 'single',
          region: '',
          retirementType: null,
          homeOfficeMethod: null,
        },
      });
    }

    res.json({ success: true, data: config });
  } catch (err) {
    console.error('[tax/config] GET Error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

router.put('/agentbook-tax/tax/config', async (req: any, res) => {
  try {
    const tenantId: string = req.tenantId;
    const { filingStatus, region, retirementType, homeOfficeMethod } = req.body;

    const config = await db.abTaxConfig.upsert({
      where: { tenantId },
      update: {
        ...(filingStatus !== undefined && { filingStatus }),
        ...(region !== undefined && { region }),
        ...(retirementType !== undefined && { retirementType }),
        ...(homeOfficeMethod !== undefined && { homeOfficeMethod }),
      },
      create: {
        tenantId,
        filingStatus: filingStatus || 'single',
        region: region || '',
        retirementType: retirementType || null,
        homeOfficeMethod: homeOfficeMethod || null,
      },
    });

    // Audit trail
    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'tax.config.updated',
        actor: req.user?.id || 'agent',
        action: {
          filingStatus: config.filingStatus,
          region: config.region,
          retirementType: config.retirementType,
          homeOfficeMethod: config.homeOfficeMethod,
        },
      },
    });

    res.json({ success: true, data: config });
  } catch (err) {
    console.error('[tax/config] PUT Error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ============================================
// ADDITIONAL REPORTS (Phase 6)
// ============================================

// 1. AR Aging Detail — Detailed aging with per-client breakdown
server.app.get('/api/v1/agentbook-tax/reports/ar-aging-detail', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const invoices = await db.abInvoice.findMany({
      where: { tenantId, status: { in: ['sent', 'viewed', 'overdue'] } },
      include: { client: true, payments: true },
      orderBy: { dueDate: 'asc' },
    });

    const now = new Date();
    const detail = invoices.map((inv: any) => {
      const paidCents = inv.payments.reduce((s: number, p: any) => s + p.amountCents, 0);
      const balanceCents = inv.amountCents - paidCents;
      const daysOverdue = Math.max(0, Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24)));
      const bucket = daysOverdue <= 0 ? 'current' : daysOverdue <= 30 ? '1-30' : daysOverdue <= 60 ? '31-60' : daysOverdue <= 90 ? '61-90' : '90+';
      return { invoiceNumber: inv.number, clientName: inv.client?.name, amountCents: inv.amountCents, paidCents, balanceCents, dueDate: inv.dueDate, daysOverdue, bucket };
    });

    const buckets: Record<string, number> = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    for (const d of detail) buckets[d.bucket] = (buckets[d.bucket] || 0) + d.balanceCents;

    res.json({ success: true, data: { detail, buckets, totalOutstandingCents: detail.reduce((s: number, d: any) => s + d.balanceCents, 0) } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// 2. Expense by Vendor — Top vendors with spend breakdown
server.app.get('/api/v1/agentbook-tax/reports/expense-by-vendor', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = req.query;
    const where: any = { tenantId, isPersonal: false };
    if (startDate) where.date = { ...where.date, gte: new Date(startDate as string) };
    if (endDate) where.date = { ...where.date, lte: new Date(endDate as string) };

    const expenses = await db.abExpense.findMany({ where, select: { vendorId: true, amountCents: true } });
    const vendorTotals: Map<string, number> = new Map();
    const vendorCounts: Map<string, number> = new Map();
    for (const e of expenses) {
      if (!e.vendorId) continue;
      vendorTotals.set(e.vendorId, (vendorTotals.get(e.vendorId) || 0) + e.amountCents);
      vendorCounts.set(e.vendorId, (vendorCounts.get(e.vendorId) || 0) + 1);
    }

    const vendorIds = Array.from(vendorTotals.keys());
    const vendors = await db.abVendor.findMany({ where: { id: { in: vendorIds } } });
    const nameMap = new Map(vendors.map((v: any) => [v.id, v.name]));

    const result = Array.from(vendorTotals.entries())
      .map(([id, total]) => ({ vendorId: id, vendorName: nameMap.get(id) || 'Unknown', totalCents: total, count: vendorCounts.get(id) || 0 }))
      .sort((a, b) => b.totalCents - a.totalCents);

    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// 3. Income by Client — Revenue per client
server.app.get('/api/v1/agentbook-tax/reports/income-by-client', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const clients = await db.abClient.findMany({ where: { tenantId } });
    const result = clients.map((c: any) => ({
      clientId: c.id, clientName: c.name,
      totalBilledCents: c.totalBilledCents, totalPaidCents: c.totalPaidCents,
      outstandingCents: c.totalBilledCents - c.totalPaidCents,
    })).sort((a: any, b: any) => b.totalBilledCents - a.totalBilledCents);

    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// 4. Tax Summary by Category — Expenses grouped by tax category (Schedule C / T2125 lines)
server.app.get('/api/v1/agentbook-tax/reports/tax-summary', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { taxYear } = req.query;
    const year = parseInt(taxYear as string) || new Date().getFullYear();
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);

    const accounts = await db.abAccount.findMany({ where: { tenantId, accountType: 'expense', isActive: true } });
    const result: { taxCategory: string; accountName: string; totalCents: number }[] = [];

    for (const acct of accounts) {
      const lines = await db.abJournalLine.findMany({
        where: { accountId: acct.id, entry: { tenantId, date: { gte: yearStart, lte: yearEnd } } },
      });
      const total = lines.reduce((s: number, l: any) => s + l.debitCents, 0);
      if (total > 0) {
        result.push({ taxCategory: acct.taxCategory || 'Other', accountName: acct.name, totalCents: total });
      }
    }

    res.json({ success: true, data: { taxYear: year, categories: result.sort((a, b) => b.totalCents - a.totalCents), totalCents: result.reduce((s, r) => s + r.totalCents, 0) } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// 5. Monthly Expense Trend — Last 12 months spending
server.app.get('/api/v1/agentbook-tax/reports/monthly-expense-trend', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const months: { month: string; totalCents: number }[] = [];
    const now = new Date();

    for (let i = 11; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      const expenses = await db.abExpense.findMany({
        where: { tenantId, isPersonal: false, date: { gte: start, lte: end } },
        select: { amountCents: true },
      });
      months.push({ month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`, totalCents: expenses.reduce((s: number, e: any) => s + e.amountCents, 0) });
    }

    res.json({ success: true, data: months });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// 6. Quarterly Comparison — Compare quarters YoY
server.app.get('/api/v1/agentbook-tax/reports/quarterly-comparison', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const quarters: { quarter: string; revenueCents: number; expensesCents: number; netCents: number }[] = [];

    for (let q = 1; q <= 4; q++) {
      const start = new Date(year, (q - 1) * 3, 1);
      const end = new Date(year, q * 3, 0);

      const revenueAccts = await db.abAccount.findMany({ where: { tenantId, accountType: 'revenue' } });
      const expenseAccts = await db.abAccount.findMany({ where: { tenantId, accountType: 'expense' } });

      let rev = 0;
      for (const a of revenueAccts) {
        const lines = await db.abJournalLine.findMany({ where: { accountId: a.id, entry: { tenantId, date: { gte: start, lte: end } } } });
        rev += lines.reduce((s: number, l: any) => s + l.creditCents, 0);
      }

      let exp = 0;
      for (const a of expenseAccts) {
        const lines = await db.abJournalLine.findMany({ where: { accountId: a.id, entry: { tenantId, date: { gte: start, lte: end } } } });
        exp += lines.reduce((s: number, l: any) => s + l.debitCents, 0);
      }

      quarters.push({ quarter: `Q${q} ${year}`, revenueCents: rev, expensesCents: exp, netCents: rev - exp });
    }

    res.json({ success: true, data: quarters });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// 7. Annual Summary — Full year at a glance
server.app.get('/api/v1/agentbook-tax/reports/annual-summary', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);

    const expenseCount = await db.abExpense.count({ where: { tenantId, date: { gte: yearStart, lte: yearEnd }, isPersonal: false } });
    const invoiceCount = await db.abInvoice.count({ where: { tenantId, issuedDate: { gte: yearStart, lte: yearEnd } } });
    const clientCount = await db.abClient.count({ where: { tenantId } });
    const vendorCount = await db.abVendor.count({ where: { tenantId } });

    // Get P&L summary
    const revenueAccts = await db.abAccount.findMany({ where: { tenantId, accountType: 'revenue' } });
    const expenseAccts = await db.abAccount.findMany({ where: { tenantId, accountType: 'expense' } });

    let totalRevenue = 0;
    for (const a of revenueAccts) {
      const lines = await db.abJournalLine.findMany({ where: { accountId: a.id, entry: { tenantId, date: { gte: yearStart, lte: yearEnd } } } });
      totalRevenue += lines.reduce((s: number, l: any) => s + l.creditCents, 0);
    }

    let totalExpenses = 0;
    for (const a of expenseAccts) {
      const lines = await db.abJournalLine.findMany({ where: { accountId: a.id, entry: { tenantId, date: { gte: yearStart, lte: yearEnd } } } });
      totalExpenses += lines.reduce((s: number, l: any) => s + l.debitCents, 0);
    }

    res.json({
      success: true,
      data: { year, revenueCents: totalRevenue, expensesCents: totalExpenses, netIncomeCents: totalRevenue - totalExpenses, expenseCount, invoiceCount, clientCount, vendorCount },
    });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// 8. Receipt Audit Log — Expenses with/without receipt documentation
server.app.get('/api/v1/agentbook-tax/reports/receipt-audit', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { startDate, endDate } = req.query;
    const where: any = { tenantId, isPersonal: false };
    if (startDate) where.date = { ...where.date, gte: new Date(startDate as string) };
    if (endDate) where.date = { ...where.date, lte: new Date(endDate as string) };

    const expenses = await db.abExpense.findMany({ where, orderBy: { date: 'desc' } });
    const withReceipt = expenses.filter((e: any) => e.receiptUrl);
    const withoutReceipt = expenses.filter((e: any) => !e.receiptUrl);

    res.json({
      success: true,
      data: {
        total: expenses.length,
        withReceipt: withReceipt.length,
        withoutReceipt: withoutReceipt.length,
        coveragePercent: expenses.length > 0 ? withReceipt.length / expenses.length : 0,
        missingReceipts: withoutReceipt.map((e: any) => ({ id: e.id, date: e.date, amountCents: e.amountCents, description: e.description })),
      },
    });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// 9. Bank Reconciliation Detail — Matched vs unmatched transactions
server.app.get('/api/v1/agentbook-tax/reports/bank-reconciliation', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const [total, matched, exceptions, pending] = await Promise.all([
      db.abBankTransaction.count({ where: { tenantId } }),
      db.abBankTransaction.count({ where: { tenantId, matchStatus: 'matched' } }),
      db.abBankTransaction.count({ where: { tenantId, matchStatus: 'exception' } }),
      db.abBankTransaction.count({ where: { tenantId, matchStatus: 'pending' } }),
    ]);

    const unmatched = await db.abBankTransaction.findMany({
      where: { tenantId, matchStatus: 'exception' },
      orderBy: { date: 'desc' },
      take: 20,
    });

    res.json({
      success: true,
      data: { total, matched, exceptions, pending, matchRate: total > 0 ? matched / total : 0, unmatchedDetail: unmatched },
    });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// 10. Earnings Projection — Annual projection with confidence bands
server.app.get('/api/v1/agentbook-tax/reports/earnings-projection', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const year = new Date().getFullYear();
    const yearStart = new Date(year, 0, 1);
    const now = new Date();
    const monthsElapsed = now.getMonth() + (now.getDate() / 30);

    const revenueAccts = await db.abAccount.findMany({ where: { tenantId, accountType: 'revenue' } });
    const revIds = revenueAccts.map((a: any) => a.id);
    const lines = await db.abJournalLine.findMany({
      where: { accountId: { in: revIds }, entry: { tenantId, date: { gte: yearStart } } },
    });
    const ytdRevenue = lines.reduce((s: number, l: any) => s + l.creditCents, 0);

    const monthlyRate = monthsElapsed > 0 ? ytdRevenue / monthsElapsed : 0;
    const projected = Math.round(monthlyRate * 12);
    const uncertainty = Math.max(0.05, 0.20 * (1 - monthsElapsed / 12));

    res.json({
      success: true,
      data: {
        ytdRevenueCents: ytdRevenue,
        projectedAnnualCents: projected,
        confidenceLow: Math.round(projected * (1 - uncertainty)),
        confidenceHigh: Math.round(projected * (1 + uncertainty)),
        monthsOfData: Math.floor(monthsElapsed),
        methodology: `Linear extrapolation from ${Math.floor(monthsElapsed)} months (±${Math.round(uncertainty * 100)}%)`,
      },
    });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ============================================
// TAX FORMS — SEED
// ============================================

server.app.post('/api/v1/agentbook-tax/tax-forms/seed', async (req, res) => {
  try {
    const result = await seedCanadianForms();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ============================================
// TAX FILING — SESSION + FIELDS
// ============================================

server.app.get('/api/v1/agentbook-tax/tax-filing/:year', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { year } = req.params;
    const result = await populateFiling(tenantId, parseInt(year));
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

server.app.post('/api/v1/agentbook-tax/tax-filing/:year/field', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { year } = req.params;
    const { formCode, fieldId, value } = req.body;
    if (!formCode || !fieldId) {
      return res.status(400).json({ success: false, error: 'formCode and fieldId are required' });
    }
    const result = await updateFilingField(tenantId, parseInt(year, 10), formCode, fieldId, value);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ============================================
// TAX SLIPS — OCR, CONFIRM, LIST
// ============================================

server.app.post('/api/v1/agentbook-tax/tax-slips/ocr', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { taxYear, imageUrl, filingId } = req.body;
    if (!imageUrl) {
      return res.status(400).json({ success: false, error: 'imageUrl is required' });
    }
    const callGemini = async (_sys: string, _user: string, _max?: number): Promise<string | null> => null;
    const result = await processSlipOCR(tenantId, taxYear, imageUrl, filingId, callGemini);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

server.app.post('/api/v1/agentbook-tax/tax-slips/:id/confirm', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const { id } = req.params;
    const result = await confirmSlip(tenantId, id);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

server.app.get('/api/v1/agentbook-tax/tax-slips', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const taxYear = parseInt(req.query.taxYear as string) || 2025;
    const result = await listSlips(tenantId, taxYear);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// ============================================
// TAX FILING VALIDATION & EXPORT
// ============================================

server.app.post('/api/v1/agentbook-tax/tax-filing/:year/validate', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const taxYear = parseInt(req.params.year, 10);
    const filing = await db.abTaxFiling.findFirst({ where: { tenantId, taxYear, filingType: 'personal_return' } });
    if (!filing) return res.status(404).json({ success: false, error: 'No filing found' });
    const result = validateFiling((filing.forms as any) || {});
    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

server.app.post('/api/v1/agentbook-tax/tax-filing/:year/export', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const taxYear = parseInt(req.params.year, 10);
    const format = (req.body.format || 'json') as 'pdf' | 'json';
    const result = await exportFiling(tenantId, taxYear, format);
    if (result.success && format === 'pdf' && result.data?.html) {
      res.setHeader('Content-Type', 'text/html');
      return res.send(result.data.html);
    }
    res.json(result);
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ============================================
// E-FILING ENDPOINTS
// ============================================

server.app.post('/api/v1/agentbook-tax/tax-filing/:year/submit', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const taxYear = parseInt(req.params.year, 10);
    const result = await submitFiling(tenantId, taxYear);
    res.json(result);
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

server.app.get('/api/v1/agentbook-tax/tax-filing/:year/status', async (req, res) => {
  try {
    const tenantId = (req as any).tenantId;
    const taxYear = parseInt(req.params.year, 10);
    const result = await checkFilingStatus(tenantId, taxYear);
    res.json(result);
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ============================================
// START SERVER
// ============================================

server.start().catch((err) => {
  console.error('Failed to start agentbook-tax-svc:', err);
  process.exit(1);
});
