import type { CalendarDeadlineProvider, CalendarDeadline } from '../interfaces.js';

export const ukCalendarDeadlines: CalendarDeadlineProvider = {
  getDeadlines(taxYear: number, region: string): CalendarDeadline[] {
    return [
      // Self Assessment — paper return deadline (Oct 31)
      { titleKey: 'calendar.sa_paper_return_due', date: `${taxYear}-10-31`, urgency: 'important', recurrence: 'annual' },
      // Self Assessment — online return deadline (Jan 31)
      { titleKey: 'calendar.sa_online_return_due', date: `${taxYear + 1}-01-31`, urgency: 'critical', actionUrl: 'https://www.gov.uk/log-in-file-self-assessment-tax-return', actionLabelKey: 'calendar.action_file_now', recurrence: 'annual' },
      // Balancing payment + first payment on account (Jan 31)
      { titleKey: 'calendar.sa_balancing_payment_due', date: `${taxYear + 1}-01-31`, urgency: 'critical', actionUrl: 'https://www.gov.uk/pay-self-assessment-tax-bill', actionLabelKey: 'calendar.action_pay_now', recurrence: 'annual' },
      // Second payment on account (Jul 31)
      { titleKey: 'calendar.sa_second_payment_on_account', date: `${taxYear + 1}-07-31`, urgency: 'critical', actionUrl: 'https://www.gov.uk/pay-self-assessment-tax-bill', actionLabelKey: 'calendar.action_pay_now', recurrence: 'annual' },
      // VAT Return deadlines (Making Tax Digital — quarterly)
      { titleKey: 'calendar.vat_q1_return_due', date: `${taxYear}-05-07`, urgency: 'important', recurrence: 'quarterly' },
      { titleKey: 'calendar.vat_q2_return_due', date: `${taxYear}-08-07`, urgency: 'important', recurrence: 'quarterly' },
      { titleKey: 'calendar.vat_q3_return_due', date: `${taxYear}-11-07`, urgency: 'important', recurrence: 'quarterly' },
      { titleKey: 'calendar.vat_q4_return_due', date: `${taxYear + 1}-02-07`, urgency: 'important', recurrence: 'quarterly' },
      // Tax year end
      { titleKey: 'calendar.tax_year_end', date: `${taxYear + 1}-04-05`, urgency: 'informational', recurrence: 'annual' },
      // Register for Self Assessment (new business deadline: Oct 5)
      { titleKey: 'calendar.sa_registration_deadline', date: `${taxYear + 1}-10-05`, urgency: 'informational', recurrence: 'annual' },
      // Fiscal quarter closes
      { titleKey: 'calendar.fiscal_quarter_close', date: `${taxYear}-06-30`, urgency: 'informational', recurrence: 'quarterly' },
      { titleKey: 'calendar.fiscal_quarter_close', date: `${taxYear}-09-30`, urgency: 'informational', recurrence: 'quarterly' },
      { titleKey: 'calendar.fiscal_quarter_close', date: `${taxYear}-12-31`, urgency: 'informational', recurrence: 'quarterly' },
      { titleKey: 'calendar.fiscal_quarter_close', date: `${taxYear + 1}-03-31`, urgency: 'informational', recurrence: 'quarterly' },
    ];
  },
};
