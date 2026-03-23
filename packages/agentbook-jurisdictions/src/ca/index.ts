import type { JurisdictionPack } from '../loader.js';
import { caTaxBrackets } from './tax-brackets.js';
import { caSelfEmploymentTax } from './self-employment-tax.js';
import { caSalesTax } from './sales-tax.js';
import { caChartOfAccounts } from './chart-of-accounts.js';
import { caInstallmentSchedule } from './installment-schedule.js';
import { caContractorReport } from './contractor-report.js';
import { caMileageRate } from './mileage-rate.js';
import { caDeductions } from './deductions.js';
import { caCalendarDeadlines } from './calendar-deadlines.js';

export const caPack: JurisdictionPack = {
  id: 'ca',
  name: 'Canada',
  taxBrackets: caTaxBrackets,
  selfEmploymentTax: caSelfEmploymentTax,
  salesTax: caSalesTax,
  chartOfAccounts: caChartOfAccounts,
  installmentSchedule: caInstallmentSchedule,
  contractorReport: caContractorReport,
  mileageRate: caMileageRate,
  deductions: caDeductions,
  calendarDeadlines: caCalendarDeadlines,
};
