import type { CalendarDeadlineProvider, CalendarDeadline } from '../interfaces.js';

export const usCalendarDeadlines: CalendarDeadlineProvider = {
  getDeadlines(taxYear: number, region: string): CalendarDeadline[] {
    return [
      { titleKey: 'calendar.q1_estimated_tax_due', date: `${taxYear}-04-15`, urgency: 'critical', actionUrl: 'https://www.irs.gov/payments/direct-pay', actionLabelKey: 'calendar.action_pay_now', recurrence: 'annual' },
      { titleKey: 'calendar.q2_estimated_tax_due', date: `${taxYear}-06-15`, urgency: 'critical', actionUrl: 'https://www.irs.gov/payments/direct-pay', actionLabelKey: 'calendar.action_pay_now', recurrence: 'annual' },
      { titleKey: 'calendar.q3_estimated_tax_due', date: `${taxYear}-09-15`, urgency: 'critical', actionUrl: 'https://www.irs.gov/payments/direct-pay', actionLabelKey: 'calendar.action_pay_now', recurrence: 'annual' },
      { titleKey: 'calendar.q4_estimated_tax_due', date: `${taxYear + 1}-01-15`, urgency: 'critical', actionUrl: 'https://www.irs.gov/payments/direct-pay', actionLabelKey: 'calendar.action_pay_now', recurrence: 'annual' },
      { titleKey: 'calendar.annual_tax_filing_due', date: `${taxYear + 1}-04-15`, urgency: 'critical', recurrence: 'annual' },
      { titleKey: 'calendar.contractor_report_due', date: `${taxYear + 1}-01-31`, urgency: 'important', recurrence: 'annual' },
      { titleKey: 'calendar.fiscal_quarter_close', date: `${taxYear}-03-31`, urgency: 'informational', recurrence: 'quarterly' },
      { titleKey: 'calendar.fiscal_quarter_close', date: `${taxYear}-06-30`, urgency: 'informational', recurrence: 'quarterly' },
      { titleKey: 'calendar.fiscal_quarter_close', date: `${taxYear}-09-30`, urgency: 'informational', recurrence: 'quarterly' },
      { titleKey: 'calendar.year_end_close', date: `${taxYear}-12-31`, urgency: 'important', recurrence: 'annual' },
    ];
  },
};
