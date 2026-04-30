import { usPack } from './us/index.js';
import { caPack } from './ca/index.js';
import { ukPack } from './uk/index.js';
import { auPack } from './au/index.js';

export interface JurisdictionPack {
  id: string;
  name: string;
  taxBrackets: import('./interfaces.js').TaxBracketProvider;
  selfEmploymentTax: import('./interfaces.js').SelfEmploymentTaxCalculator;
  salesTax: import('./interfaces.js').SalesTaxEngine;
  chartOfAccounts: import('./interfaces.js').ChartOfAccountsTemplate;
  installmentSchedule: import('./interfaces.js').InstallmentSchedule;
  contractorReport: import('./interfaces.js').ContractorReportGenerator;
  mileageRate: import('./interfaces.js').MileageRateProvider;
  deductions: import('./interfaces.js').DeductionRuleSet;
  calendarDeadlines: import('./interfaces.js').CalendarDeadlineProvider;
}

const packs: Map<string, JurisdictionPack> = new Map();

export function loadJurisdictionPack(pack: JurisdictionPack): void {
  packs.set(pack.id, pack);
}

export function getJurisdictionPack(jurisdictionId: string): JurisdictionPack | undefined {
  return packs.get(jurisdictionId);
}

/** Load all built-in packs */
export function loadBuiltInPacks(): void {
  loadJurisdictionPack(usPack);
  loadJurisdictionPack(caPack);
  loadJurisdictionPack(ukPack);
  loadJurisdictionPack(auPack);
}
