import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDailyPulse } from '../proactive-handlers/daily-pulse.js';
import { handleWeeklyReview } from '../proactive-handlers/weekly-review.js';
import { handleInvoiceFollowUp } from '../proactive-handlers/invoice-followup.js';
import { handlePaymentReceived } from '../proactive-handlers/payment-received.js';
import { handleRecurringAnomaly } from '../proactive-handlers/recurring-anomaly.js';
import { handleReceiptReminder } from '../proactive-handlers/receipt-reminder.js';

// ---------------------------------------------------------------------------
// handleDailyPulse
// ---------------------------------------------------------------------------
describe('handleDailyPulse', () => {
  const baseData = {
    tenantId: 'tenant-1',
    incomeTodayCents: 34000,
    expensesTodayCents: 12700,
    cashBalanceCents: 1245000,
    invoicesDueSoon: 1,
    pendingEscalations: 0,
    missingReceipts: 0,
  };

  it('returns correct category', () => {
    const msg = handleDailyPulse(baseData);
    expect(msg.category).toBe('daily_pulse');
    expect(msg.tenant_id).toBe('tenant-1');
    expect(msg.title_key).toBe('proactive.daily_pulse');
    expect(msg.body_key).toBe('proactive.daily_pulse');
  });

  it('urgency is informational when actionCount <= 3', () => {
    const msg = handleDailyPulse({ ...baseData, invoicesDueSoon: 1, pendingEscalations: 1, missingReceipts: 1 });
    expect(msg.urgency).toBe('informational');
  });

  it('urgency is important when actionCount > 3', () => {
    const msg = handleDailyPulse({ ...baseData, invoicesDueSoon: 2, pendingEscalations: 1, missingReceipts: 1 });
    expect(msg.urgency).toBe('important');
  });

  it('includes income, expenses, balance, and action_count in body_params', () => {
    const msg = handleDailyPulse(baseData);
    expect(msg.body_params).toEqual({
      income: 34000,
      expenses: 12700,
      balance: 1245000,
      action_count: 1,
    });
  });

  it('includes upload_receipts action when missingReceipts > 0', () => {
    const msg = handleDailyPulse({ ...baseData, missingReceipts: 3 });
    const uploadAction = msg.actions.find(a => a.callback_data === 'action:upload_receipts');
    expect(uploadAction).toBeDefined();
    expect(uploadAction!.style).toBe('primary');
  });

  it('does not include upload_receipts action when missingReceipts is 0', () => {
    const msg = handleDailyPulse({ ...baseData, missingReceipts: 0 });
    const uploadAction = msg.actions.find(a => a.callback_data === 'action:upload_receipts');
    expect(uploadAction).toBeUndefined();
  });

  it('always includes view_dashboard action', () => {
    const msg = handleDailyPulse(baseData);
    const dashAction = msg.actions.find(a => a.callback_data === 'action:view_dashboard');
    expect(dashAction).toBeDefined();
  });

  it('generates id containing tenant id and date', () => {
    const msg = handleDailyPulse(baseData);
    expect(msg.id).toContain('daily-pulse-tenant-1');
  });
});

// ---------------------------------------------------------------------------
// handleWeeklyReview
// ---------------------------------------------------------------------------
describe('handleWeeklyReview', () => {
  const baseData = {
    tenantId: 'tenant-2',
    revenueCents: 420000,
    expensesCents: 134000,
    topCategory: 'Software',
    topCategoryAmountCents: 42000,
    effectiveTaxRate: 0.225,
    revenueChangePercent: 12.5,
  };

  it('returns correct category and urgency', () => {
    const msg = handleWeeklyReview(baseData);
    expect(msg.category).toBe('weekly_review');
    expect(msg.urgency).toBe('informational');
  });

  it('includes all expected fields in body_params', () => {
    const msg = handleWeeklyReview(baseData);
    expect(msg.body_params).toEqual({
      revenue: 420000,
      expenses: 134000,
      top_category: 'Software',
      top_amount: 42000,
      tax_rate: '22.5%',
    });
  });

  it('formats tax_rate as percentage string', () => {
    const msg = handleWeeklyReview({ ...baseData, effectiveTaxRate: 0.1 });
    expect(msg.body_params.tax_rate).toBe('10.0%');
  });

  it('includes view_reports action', () => {
    const msg = handleWeeklyReview(baseData);
    expect(msg.actions).toHaveLength(1);
    expect(msg.actions[0].callback_data).toBe('action:view_reports');
  });
});

// ---------------------------------------------------------------------------
// handleInvoiceFollowUp
// ---------------------------------------------------------------------------
describe('handleInvoiceFollowUp', () => {
  const baseData = {
    tenantId: 'tenant-3',
    invoiceId: 'inv-100',
    invoiceNumber: 'INV-100',
    clientName: 'Acme Corp',
    amountCents: 500000,
    daysOverdue: 5,
  };

  it('urgency is informational for <= 7 days overdue', () => {
    const msg = handleInvoiceFollowUp({ ...baseData, daysOverdue: 5 });
    expect(msg.urgency).toBe('informational');
  });

  it('urgency is important for > 7 days overdue', () => {
    const msg = handleInvoiceFollowUp({ ...baseData, daysOverdue: 14 });
    expect(msg.urgency).toBe('important');
  });

  it('urgency is critical for > 30 days overdue', () => {
    const msg = handleInvoiceFollowUp({ ...baseData, daysOverdue: 45 });
    expect(msg.urgency).toBe('critical');
  });

  it('includes send_reminder, wait, and skip actions', () => {
    const msg = handleInvoiceFollowUp(baseData);
    expect(msg.actions).toHaveLength(3);

    const labels = msg.actions.map(a => a.label_key);
    expect(labels).toContain('invoice.send_reminder');
    expect(labels).toContain('invoice.wait');
    expect(labels).toContain('invoice.skip');
  });

  it('send_reminder action has primary style and correct callback_data', () => {
    const msg = handleInvoiceFollowUp(baseData);
    const reminder = msg.actions.find(a => a.label_key === 'invoice.send_reminder');
    expect(reminder!.style).toBe('primary');
    expect(reminder!.callback_data).toBe('send_reminder:inv-100');
  });

  it('includes client, days, and amount in body_params', () => {
    const msg = handleInvoiceFollowUp(baseData);
    expect(msg.body_params).toEqual({
      client: 'Acme Corp',
      days: 5,
      amount: 500000,
    });
  });

  it('returns correct category', () => {
    const msg = handleInvoiceFollowUp(baseData);
    expect(msg.category).toBe('invoice_followup');
  });
});

// ---------------------------------------------------------------------------
// handlePaymentReceived
// ---------------------------------------------------------------------------
describe('handlePaymentReceived', () => {
  const baseData = {
    tenantId: 'tenant-4',
    clientName: 'Acme Corp',
    invoiceNumber: 'INV-200',
    amountCents: 500000,
    feesCents: 14550,
    netAmountCents: 485450,
    method: 'stripe',
  };

  it('returns informational urgency', () => {
    const msg = handlePaymentReceived(baseData);
    expect(msg.urgency).toBe('informational');
  });

  it('includes client, amount, and net_amount in body_params', () => {
    const msg = handlePaymentReceived(baseData);
    expect(msg.body_params).toEqual({
      client: 'Acme Corp',
      amount: 500000,
      net_amount: 485450,
    });
  });

  it('returns correct category', () => {
    const msg = handlePaymentReceived(baseData);
    expect(msg.category).toBe('payment_received');
  });

  it('includes view_invoice action', () => {
    const msg = handlePaymentReceived(baseData);
    expect(msg.actions).toHaveLength(1);
    expect(msg.actions[0].callback_data).toBe('view:invoice-INV-200');
  });
});

// ---------------------------------------------------------------------------
// handleRecurringAnomaly
// ---------------------------------------------------------------------------
describe('handleRecurringAnomaly', () => {
  const baseData = {
    tenantId: 'tenant-5',
    vendorName: 'Figma',
    expectedAmountCents: 4999,
    actualAmountCents: 5999,
    expenseId: 'exp-300',
    ruleId: 'rule-10',
  };

  it('detects price increase and includes vendor, actual, expected in body_params', () => {
    const msg = handleRecurringAnomaly(baseData);
    expect(msg.body_params).toEqual({
      vendor: 'Figma',
      actual: 5999,
      expected: 4999,
    });
  });

  it('includes accept_new_amount and investigate actions', () => {
    const msg = handleRecurringAnomaly(baseData);
    expect(msg.actions).toHaveLength(2);

    const labels = msg.actions.map(a => a.label_key);
    expect(labels).toContain('proactive.accept_new_amount');
    expect(labels).toContain('proactive.investigate');
  });

  it('accept action has primary style and correct callback_data', () => {
    const msg = handleRecurringAnomaly(baseData);
    const accept = msg.actions.find(a => a.label_key === 'proactive.accept_new_amount');
    expect(accept!.style).toBe('primary');
    expect(accept!.callback_data).toBe(`accept_recurring:rule-10:5999`);
  });

  it('urgency is informational when diff <= $10 (1000 cents)', () => {
    const msg = handleRecurringAnomaly({ ...baseData, actualAmountCents: 5999, expectedAmountCents: 4999 });
    expect(msg.urgency).toBe('informational');
  });

  it('urgency is important when diff > $10 (1000 cents)', () => {
    const msg = handleRecurringAnomaly({ ...baseData, actualAmountCents: 7000, expectedAmountCents: 4999 });
    // diff = 2001 > 1000
    expect(msg.urgency).toBe('important');
  });

  it('urgency is important for price decrease > $10', () => {
    const msg = handleRecurringAnomaly({ ...baseData, actualAmountCents: 2000, expectedAmountCents: 4999 });
    // diff = -2999, abs = 2999 > 1000
    expect(msg.urgency).toBe('important');
  });

  it('returns correct category', () => {
    const msg = handleRecurringAnomaly(baseData);
    expect(msg.category).toBe('recurring_anomaly');
  });
});

// ---------------------------------------------------------------------------
// handleReceiptReminder
// ---------------------------------------------------------------------------
describe('handleReceiptReminder', () => {
  const baseData = {
    tenantId: 'tenant-6',
    missingCount: 3,
    totalAmountCents: 15000,
  };

  it('returns null when missingCount is 0', () => {
    const result = handleReceiptReminder({ ...baseData, missingCount: 0 });
    expect(result).toBeNull();
  });

  it('returns a message when missingCount > 0', () => {
    const msg = handleReceiptReminder(baseData);
    expect(msg).not.toBeNull();
    expect(msg!.category).toBe('receipt_reminder');
    expect(msg!.body_params.count).toBe(3);
  });

  it('urgency is informational when missingCount <= 5', () => {
    const msg = handleReceiptReminder({ ...baseData, missingCount: 5 });
    expect(msg!.urgency).toBe('informational');
  });

  it('urgency is important when missingCount > 5', () => {
    const msg = handleReceiptReminder({ ...baseData, missingCount: 6 });
    expect(msg!.urgency).toBe('important');
  });

  it('includes upload_now and remind_later actions', () => {
    const msg = handleReceiptReminder(baseData)!;
    expect(msg.actions).toHaveLength(2);

    const labels = msg.actions.map(a => a.label_key);
    expect(labels).toContain('proactive.upload_now');
    expect(labels).toContain('proactive.remind_later');
  });

  it('upload_now action has primary style', () => {
    const msg = handleReceiptReminder(baseData)!;
    const upload = msg.actions.find(a => a.label_key === 'proactive.upload_now');
    expect(upload!.style).toBe('primary');
  });
});
