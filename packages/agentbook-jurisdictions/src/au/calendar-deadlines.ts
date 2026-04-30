import type { CalendarDeadlineProvider, CalendarDeadline } from '../interfaces.js';

export const auCalendarDeadlines: CalendarDeadlineProvider = {
  getDeadlines(taxYear: number, region: string): CalendarDeadline[] {
    // Australian financial year: July 1 — June 30
    // taxYear refers to the start year (e.g., 2025 = FY 2025-26)
    return [
      // Individual tax return due (Oct 31, or later if using a tax agent)
      { titleKey: 'calendar.individual_tax_return_due', date: `${taxYear + 1}-10-31`, urgency: 'critical', actionUrl: 'https://www.ato.gov.au/Individuals/Lodging-your-tax-return/', actionLabelKey: 'calendar.action_lodge_now', recurrence: 'annual' },
      // BAS quarterly deadlines
      { titleKey: 'calendar.bas_q1_due', date: `${taxYear}-10-28`, urgency: 'critical', actionUrl: 'https://www.ato.gov.au/Business/Business-activity-statements-(BAS)/', actionLabelKey: 'calendar.action_lodge_bas', recurrence: 'quarterly' },
      { titleKey: 'calendar.bas_q2_due', date: `${taxYear + 1}-02-28`, urgency: 'critical', actionUrl: 'https://www.ato.gov.au/Business/Business-activity-statements-(BAS)/', actionLabelKey: 'calendar.action_lodge_bas', recurrence: 'quarterly' },
      { titleKey: 'calendar.bas_q3_due', date: `${taxYear + 1}-04-28`, urgency: 'critical', actionUrl: 'https://www.ato.gov.au/Business/Business-activity-statements-(BAS)/', actionLabelKey: 'calendar.action_lodge_bas', recurrence: 'quarterly' },
      { titleKey: 'calendar.bas_q4_due', date: `${taxYear + 1}-07-28`, urgency: 'critical', actionUrl: 'https://www.ato.gov.au/Business/Business-activity-statements-(BAS)/', actionLabelKey: 'calendar.action_lodge_bas', recurrence: 'quarterly' },
      // PAYG instalment deadlines (same as BAS)
      { titleKey: 'calendar.payg_q1_instalment', date: `${taxYear}-10-28`, urgency: 'important', recurrence: 'quarterly' },
      { titleKey: 'calendar.payg_q2_instalment', date: `${taxYear + 1}-02-28`, urgency: 'important', recurrence: 'quarterly' },
      { titleKey: 'calendar.payg_q3_instalment', date: `${taxYear + 1}-04-28`, urgency: 'important', recurrence: 'quarterly' },
      { titleKey: 'calendar.payg_q4_instalment', date: `${taxYear + 1}-07-28`, urgency: 'important', recurrence: 'quarterly' },
      // Superannuation guarantee due dates (28th of month following quarter end)
      { titleKey: 'calendar.super_q1_due', date: `${taxYear}-10-28`, urgency: 'critical', recurrence: 'quarterly' },
      { titleKey: 'calendar.super_q2_due', date: `${taxYear + 1}-01-28`, urgency: 'critical', recurrence: 'quarterly' },
      { titleKey: 'calendar.super_q3_due', date: `${taxYear + 1}-04-28`, urgency: 'critical', recurrence: 'quarterly' },
      { titleKey: 'calendar.super_q4_due', date: `${taxYear + 1}-07-28`, urgency: 'critical', recurrence: 'quarterly' },
      // TPAR (Taxable Payments Annual Report) due Aug 28
      { titleKey: 'calendar.tpar_due', date: `${taxYear + 1}-08-28`, urgency: 'important', recurrence: 'annual' },
      // Financial year end
      { titleKey: 'calendar.financial_year_end', date: `${taxYear + 1}-06-30`, urgency: 'informational', recurrence: 'annual' },
    ];
  },
};
