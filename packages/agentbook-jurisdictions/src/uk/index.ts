import type { JurisdictionPack } from '../loader.js';
import { ukTaxBrackets } from './tax-brackets.js';
import { ukSelfEmploymentTax } from './self-employment-tax.js';
import { ukSalesTax } from './sales-tax.js';
import { ukChartOfAccounts } from './chart-of-accounts.js';
import { ukInstallmentSchedule } from './installment-schedule.js';
import { ukContractorReport } from './contractor-report.js';
import { ukMileageRate } from './mileage-rate.js';
import { ukDeductions } from './deductions.js';
import { ukCalendarDeadlines } from './calendar-deadlines.js';

export const ukPack: JurisdictionPack = {
  id: 'uk',
  name: 'United Kingdom',
  taxBrackets: ukTaxBrackets,
  selfEmploymentTax: ukSelfEmploymentTax,
  salesTax: ukSalesTax,
  chartOfAccounts: ukChartOfAccounts,
  installmentSchedule: ukInstallmentSchedule,
  contractorReport: ukContractorReport,
  mileageRate: ukMileageRate,
  deductions: ukDeductions,
  calendarDeadlines: ukCalendarDeadlines,
};
