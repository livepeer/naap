import type { CalendarDeadlineProvider, CalendarDeadline } from '../interfaces.js';

export const caCalendarDeadlines: CalendarDeadlineProvider = {
  getDeadlines(taxYear: number, region: string): CalendarDeadline[] {
    return [
      // RRSP deadline — 60 days after year end
      { titleKey: 'calendar.rrsp_deadline', date: `${taxYear + 1}-03-01`, urgency: 'critical', recurrence: 'annual' },
      // T4A filing deadline
      { titleKey: 'calendar.t4a_filing_due', date: `${taxYear + 1}-02-28`, urgency: 'important', recurrence: 'annual' },
      // Quarterly instalments
      { titleKey: 'calendar.q1_instalment_due', date: `${taxYear}-03-15`, urgency: 'critical', actionUrl: 'https://www.canada.ca/en/revenue-agency/services/e-services/payment-save-time-pay-online.html', actionLabelKey: 'calendar.action_pay_now', recurrence: 'annual' },
      { titleKey: 'calendar.q2_instalment_due', date: `${taxYear}-06-15`, urgency: 'critical', actionUrl: 'https://www.canada.ca/en/revenue-agency/services/e-services/payment-save-time-pay-online.html', actionLabelKey: 'calendar.action_pay_now', recurrence: 'annual' },
      { titleKey: 'calendar.q3_instalment_due', date: `${taxYear}-09-15`, urgency: 'critical', actionUrl: 'https://www.canada.ca/en/revenue-agency/services/e-services/payment-save-time-pay-online.html', actionLabelKey: 'calendar.action_pay_now', recurrence: 'annual' },
      { titleKey: 'calendar.q4_instalment_due', date: `${taxYear}-12-15`, urgency: 'critical', actionUrl: 'https://www.canada.ca/en/revenue-agency/services/e-services/payment-save-time-pay-online.html', actionLabelKey: 'calendar.action_pay_now', recurrence: 'annual' },
      // T1 filing deadline — April 30 (employees) or June 15 (self-employed)
      { titleKey: 'calendar.t1_filing_due', date: `${taxYear + 1}-04-30`, urgency: 'critical', recurrence: 'annual' },
      { titleKey: 'calendar.se_filing_extension', date: `${taxYear + 1}-06-15`, urgency: 'important', recurrence: 'annual' },
      // Tax payment deadline (even with SE extension, payment is due April 30)
      { titleKey: 'calendar.tax_payment_due', date: `${taxYear + 1}-04-30`, urgency: 'critical', actionUrl: 'https://www.canada.ca/en/revenue-agency/services/e-services/payment-save-time-pay-online.html', actionLabelKey: 'calendar.action_pay_now', recurrence: 'annual' },
      // GST/HST annual filing (if applicable)
      { titleKey: 'calendar.gst_hst_annual_filing', date: `${taxYear + 1}-06-15`, urgency: 'important', recurrence: 'annual' },
      // Fiscal quarter closes
      { titleKey: 'calendar.fiscal_quarter_close', date: `${taxYear}-03-31`, urgency: 'informational', recurrence: 'quarterly' },
      { titleKey: 'calendar.fiscal_quarter_close', date: `${taxYear}-06-30`, urgency: 'informational', recurrence: 'quarterly' },
      { titleKey: 'calendar.fiscal_quarter_close', date: `${taxYear}-09-30`, urgency: 'informational', recurrence: 'quarterly' },
      { titleKey: 'calendar.year_end_close', date: `${taxYear}-12-31`, urgency: 'important', recurrence: 'annual' },
    ];
  },
};
