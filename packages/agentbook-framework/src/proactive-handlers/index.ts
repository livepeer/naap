/**
 * Proactive Engagement Handlers — Phase 1 & 2
 *
 * These handlers make the agent feel like a 24/7 accounting firm.
 * Each handler is triggered by either a schedule (cron) or an event.
 */

// Phase 1
export { handleDailyPulse } from './daily-pulse.js';
export { handleWeeklyReview } from './weekly-review.js';
export { handleInvoiceFollowUp } from './invoice-followup.js';
export { handlePaymentReceived } from './payment-received.js';
export { handleRecurringAnomaly } from './recurring-anomaly.js';
export { handleReceiptReminder } from './receipt-reminder.js';

// Phase 2
export { handleTaxDeadline } from './tax-deadline.js';
export { handleDeductionAlert } from './deduction-alert.js';
export { handleBankAnomaly } from './bank-anomaly.js';
export { handleReconciliationNudge } from './reconciliation-nudge.js';
