/**
 * Jurisdiction interfaces — implemented by each country pack.
 * Adding a new country = implement these interfaces. Zero framework changes.
 */

export interface TaxBracket {
  min: number;      // income threshold in cents
  max: number | null;
  rate: number;     // decimal (0.10 = 10%)
}

export interface TaxCalculation {
  taxCents: number;
  effectiveRate: number;
  marginalRate: number;
  bracketBreakdown: { bracket: TaxBracket; taxCents: number }[];
}

export interface TaxBracketProvider {
  jurisdiction: string;
  region?: string;
  getTaxBrackets(taxYear: number): TaxBracket[];
  calculateTax(taxableIncomeCents: number, taxYear: number): TaxCalculation;
}

export interface SelfEmploymentTaxResult {
  amountCents: number;
  deductiblePortionCents: number;
  breakdown: Record<string, number>;
}

export interface SelfEmploymentTaxCalculator {
  calculate(netSelfEmploymentIncomeCents: number, taxYear: number): SelfEmploymentTaxResult;
}

export interface SalesTaxRate {
  region: string;
  taxType: string;    // 'state' | 'GST' | 'HST' | 'PST'
  rate: number;       // decimal
  name: string;
}

export interface SalesTaxResult {
  totalRate: number;
  totalCents: number;
  components: { type: string; rate: number; amountCents: number }[];
}

export interface SalesTaxEngine {
  getRates(region: string): SalesTaxRate[];
  calculateTax(amountCents: number, region: string): SalesTaxResult;
  getFilingDeadlines(region: string, taxYear: number): Date[];
}

export interface TaxFormData {
  formId: string;
  taxYear: number;
  fields: Record<string, string | number>;
}

export interface TaxFormGenerator {
  formId: string;
  generate(ledgerSummary: Record<string, number>, taxYear: number): TaxFormData;
}

export interface InstallmentDeadline {
  quarter: number;
  deadline: Date;
  label: string;
}

export interface InstallmentSchedule {
  getDeadlines(taxYear: number): InstallmentDeadline[];
  calculateAmount(method: string, yearToDateIncomeCents: number, priorYearTaxCents: number): number;
}

export interface ContractorReport {
  contractorName: string;
  totalPaidCents: number;
  formId: string;
}

export interface ContractorReportGenerator {
  threshold: number;     // cents: US = 60000, CA = 50000
  formId: string;
  generate(payments: { name: string; totalCents: number }[], taxYear: number): ContractorReport[];
}

export interface Account {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  taxCategory?: string;
  parent?: string;
}

export interface ChartOfAccountsTemplate {
  getDefaultAccounts(businessType: string): Account[];
  getTaxCategoryMapping(): Record<string, string>;
}

export interface MileageRate {
  rate: number;
  unit: 'mile' | 'km';
  tierDescription?: string;
}

export interface MileageRateProvider {
  getRate(taxYear: number, totalDistance: number): MileageRate;
}

export interface DeductionRule {
  id: string;
  name: string;
  description: string;
  category: string;
}

export interface DeductionRuleSet {
  getAvailableDeductions(businessType: string): DeductionRule[];
  calculateDeduction(ruleId: string, inputs: Record<string, number>): number;
}

export interface CalendarDeadline {
  titleKey: string;
  date: string;       // ISO date
  urgency: 'critical' | 'important' | 'informational';
  actionUrl?: string;
  actionLabelKey?: string;
  recurrence: 'annual' | 'quarterly' | 'monthly' | 'once';
}

export interface CalendarDeadlineProvider {
  getDeadlines(taxYear: number, region: string): CalendarDeadline[];
}
