import type { JurisdictionPack } from '../loader.js';
import { usTaxBrackets } from './tax-brackets.js';
import { usSelfEmploymentTax } from './self-employment-tax.js';
import { usSalesTax } from './sales-tax.js';
import { usChartOfAccounts } from './chart-of-accounts.js';
import { usInstallmentSchedule } from './installment-schedule.js';
import { usContractorReport } from './contractor-report.js';
import { usMileageRate } from './mileage-rate.js';
import { usDeductions } from './deductions.js';
import { usCalendarDeadlines } from './calendar-deadlines.js';

export const usPack: JurisdictionPack = {
  id: 'us',
  name: 'United States',
  taxBrackets: usTaxBrackets,
  selfEmploymentTax: usSelfEmploymentTax,
  salesTax: usSalesTax,
  chartOfAccounts: usChartOfAccounts,
  installmentSchedule: usInstallmentSchedule,
  contractorReport: usContractorReport,
  mileageRate: usMileageRate,
  deductions: usDeductions,
  calendarDeadlines: usCalendarDeadlines,
};
