/**
 * Message formatters for Telegram.
 * All strings should come from i18n, but these provide the HTML structure.
 */

export interface ExpenseData {
  amount: string;        // Pre-formatted by i18n: "$45.00" or "45,00 $"
  vendor?: string;
  category?: string;
  date: string;          // Pre-formatted by i18n
  subtotal?: string;
  tax?: string;
  tip?: string;
  confidence?: number;
}

/**
 * Format expense confirmation message (the standard response).
 */
export function formatExpenseConfirmation(data: ExpenseData): string {
  let msg = `📝 <b>${data.amount}</b>`;
  if (data.vendor) msg += ` — ${data.vendor}`;
  msg += `\n📅 ${data.date}`;

  if (data.subtotal || data.tax || data.tip) {
    msg += '\n';
    if (data.subtotal) msg += `\nSubtotal: ${data.subtotal}`;
    if (data.tax) msg += ` | Tax: ${data.tax}`;
    if (data.tip) msg += ` | Tip: ${data.tip}`;
  }

  if (data.category) {
    msg += `\nCategory: ${data.category}`;
  }

  return msg;
}

/**
 * Format receipt OCR result.
 */
export function formatReceiptResult(data: ExpenseData & { isLowConfidence?: boolean }): string {
  if (data.isLowConfidence) {
    let msg = `🧾 I read this receipt but I'm not very confident:\n\n`;
    msg += `<b>${data.amount}</b>`;
    if (data.vendor) msg += ` — ${data.vendor}`;
    msg += `\n📅 ${data.date}`;
    if (data.confidence) {
      msg += `\n\nI'm ${Math.round(data.confidence * 100)}% sure this is <b>${data.category}</b>.`;
    }
    return msg;
  }

  let msg = `🧾 <b>${data.amount}</b>`;
  if (data.vendor) msg += ` — ${data.vendor}`;
  msg += `\n📅 ${data.date}`;

  if (data.subtotal || data.tax || data.tip) {
    const parts: string[] = [];
    if (data.subtotal) parts.push(`Subtotal: ${data.subtotal}`);
    if (data.tax) parts.push(`Tax: ${data.tax}`);
    if (data.tip) parts.push(`Tip: ${data.tip}`);
    msg += `\n${parts.join(' | ')}`;
  }

  if (data.category) msg += `\nCategory: <b>${data.category}</b>`;

  return msg;
}

/**
 * Format daily pulse message.
 */
export function formatDailyPulse(data: {
  income: string;
  expenses: string;
  balance: string;
  actionCount: number;
}): string {
  let msg = `☀️ <b>Daily Pulse</b>\n\n`;
  msg += `💰 In: ${data.income}\n`;
  msg += `💸 Out: ${data.expenses}\n`;
  msg += `🏦 Balance: <b>${data.balance}</b>`;

  if (data.actionCount > 0) {
    msg += `\n\n📋 ${data.actionCount} item${data.actionCount > 1 ? 's' : ''} need${data.actionCount === 1 ? 's' : ''} your attention.`;
  }

  return msg;
}

/**
 * Format weekly review message.
 */
export function formatWeeklyReview(data: {
  revenue: string;
  expenses: string;
  topCategory: string;
  topAmount: string;
  taxRate: string;
}): string {
  let msg = `📊 <b>Weekly Review</b>\n\n`;
  msg += `Revenue: ${data.revenue}\n`;
  msg += `Expenses: ${data.expenses}\n`;
  msg += `Top spend: ${data.topCategory} (${data.topAmount})\n`;
  msg += `Effective tax rate: ${data.taxRate}`;
  return msg;
}

/**
 * Format payment received celebration.
 */
export function formatPaymentReceived(data: {
  client: string;
  amount: string;
  netAmount: string;
}): string {
  return `🎉 <b>${data.client}</b> just paid <b>${data.amount}</b>!\nNet after fees: ${data.netAmount}`;
}

/**
 * Format tax deadline reminder.
 */
export function formatTaxDeadline(data: {
  days: number;
  amount: string;
  quarter: string;
}): string {
  return `🗓️ <b>Tax Deadline</b>\n\nQuarterly payment due in <b>${data.days} days</b>.\nI calculated <b>${data.amount}</b> for ${data.quarter}.`;
}
