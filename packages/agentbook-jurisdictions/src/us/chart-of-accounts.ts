import type { ChartOfAccountsTemplate, Account } from '../interfaces.js';

const SCHEDULE_C_ACCOUNTS: Account[] = [
  // Assets
  { code: '1000', name: 'Cash', type: 'asset' },
  { code: '1100', name: 'Accounts Receivable', type: 'asset' },
  { code: '1200', name: 'Business Checking', type: 'asset' },
  { code: '1300', name: 'Business Savings', type: 'asset' },
  // Liabilities
  { code: '2000', name: 'Accounts Payable', type: 'liability' },
  { code: '2100', name: 'Sales Tax Payable', type: 'liability' },
  { code: '2200', name: 'Credit Card', type: 'liability' },
  // Equity
  { code: '3000', name: "Owner's Equity", type: 'equity' },
  { code: '3100', name: "Owner's Draw", type: 'equity' },
  // Revenue
  { code: '4000', name: 'Service Revenue', type: 'revenue', taxCategory: 'Line 1 - Gross receipts' },
  { code: '4100', name: 'Product Revenue', type: 'revenue', taxCategory: 'Line 1 - Gross receipts' },
  { code: '4200', name: 'Other Income', type: 'revenue', taxCategory: 'Line 6 - Other income' },
  // Expenses (Schedule C lines)
  { code: '5000', name: 'Advertising', type: 'expense', taxCategory: 'Line 8 - Advertising' },
  { code: '5100', name: 'Car & Truck Expenses', type: 'expense', taxCategory: 'Line 9 - Car and truck expenses' },
  { code: '5200', name: 'Commissions & Fees', type: 'expense', taxCategory: 'Line 10 - Commissions and fees' },
  { code: '5300', name: 'Contract Labor', type: 'expense', taxCategory: 'Line 11 - Contract labor' },
  { code: '5400', name: 'Insurance', type: 'expense', taxCategory: 'Line 15 - Insurance' },
  { code: '5500', name: 'Interest (Mortgage)', type: 'expense', taxCategory: 'Line 16a - Interest (mortgage)' },
  { code: '5600', name: 'Interest (Other)', type: 'expense', taxCategory: 'Line 16b - Interest (other)' },
  { code: '5700', name: 'Legal & Professional Services', type: 'expense', taxCategory: 'Line 17 - Legal and professional' },
  { code: '5800', name: 'Office Expenses', type: 'expense', taxCategory: 'Line 18 - Office expense' },
  { code: '5900', name: 'Rent or Lease', type: 'expense', taxCategory: 'Line 20b - Rent (other)' },
  { code: '6000', name: 'Repairs & Maintenance', type: 'expense', taxCategory: 'Line 21 - Repairs and maintenance' },
  { code: '6100', name: 'Supplies', type: 'expense', taxCategory: 'Line 22 - Supplies' },
  { code: '6200', name: 'Taxes & Licenses', type: 'expense', taxCategory: 'Line 23 - Taxes and licenses' },
  { code: '6300', name: 'Travel', type: 'expense', taxCategory: 'Line 24a - Travel' },
  { code: '6400', name: 'Meals', type: 'expense', taxCategory: 'Line 24b - Meals' },
  { code: '6500', name: 'Utilities', type: 'expense', taxCategory: 'Line 25 - Utilities' },
  { code: '6600', name: 'Software & Subscriptions', type: 'expense', taxCategory: 'Line 27a - Other expenses' },
  { code: '6700', name: 'Bank Fees & Processing', type: 'expense', taxCategory: 'Line 27a - Other expenses' },
  { code: '6800', name: 'Depreciation', type: 'expense', taxCategory: 'Line 13 - Depreciation' },
  { code: '6900', name: 'Other Expenses', type: 'expense', taxCategory: 'Line 27a - Other expenses' },
];

export const usChartOfAccounts: ChartOfAccountsTemplate = {
  getDefaultAccounts(businessType: string): Account[] {
    return SCHEDULE_C_ACCOUNTS;
  },
  getTaxCategoryMapping(): Record<string, string> {
    const mapping: Record<string, string> = {};
    for (const acct of SCHEDULE_C_ACCOUNTS) {
      if (acct.taxCategory) mapping[acct.code] = acct.taxCategory;
    }
    return mapping;
  },
};
