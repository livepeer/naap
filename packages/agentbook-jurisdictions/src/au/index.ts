import type { JurisdictionPack } from '../loader.js';
import { auTaxBrackets } from './tax-brackets.js';
import { auSelfEmploymentTax } from './self-employment-tax.js';
import { auSalesTax } from './sales-tax.js';
import { auChartOfAccounts } from './chart-of-accounts.js';
import { auInstallmentSchedule } from './installment-schedule.js';
import { auContractorReport } from './contractor-report.js';
import { auMileageRate } from './mileage-rate.js';
import { auDeductions } from './deductions.js';
import { auCalendarDeadlines } from './calendar-deadlines.js';

export const auPack: JurisdictionPack = {
  id: 'au',
  name: 'Australia',
  taxBrackets: auTaxBrackets,
  selfEmploymentTax: auSelfEmploymentTax,
  salesTax: auSalesTax,
  chartOfAccounts: auChartOfAccounts,
  installmentSchedule: auInstallmentSchedule,
  contractorReport: auContractorReport,
  mileageRate: auMileageRate,
  deductions: auDeductions,
  calendarDeadlines: auCalendarDeadlines,
};
