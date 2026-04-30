import type { ChartOfAccountsTemplate, Account } from '../interfaces.js';

// ATO Business Activity Statement (BAS) aligned accounts for Australian sole traders
const BAS_ACCOUNTS: Account[] = [
  // Assets
  { code: '1000', name: 'Cash', type: 'asset' },
  { code: '1100', name: 'Accounts Receivable', type: 'asset' },
  { code: '1200', name: 'Business Transaction Account', type: 'asset' },
  { code: '1300', name: 'Business Savings Account', type: 'asset' },
  { code: '1400', name: 'Term Deposits', type: 'asset' },
  // Liabilities
  { code: '2000', name: 'Accounts Payable', type: 'liability' },
  { code: '2100', name: 'GST Payable', type: 'liability' },
  { code: '2200', name: 'PAYG Withholding Payable', type: 'liability' },
  { code: '2300', name: 'Superannuation Payable', type: 'liability' },
  { code: '2400', name: 'Credit Card', type: 'liability' },
  // Equity
  { code: '3000', name: "Owner's Equity", type: 'equity' },
  { code: '3100', name: "Owner's Drawings", type: 'equity' },
  // Revenue
  { code: '4000', name: 'Sales Revenue', type: 'revenue', taxCategory: 'BAS - Total sales' },
  { code: '4100', name: 'Service Revenue', type: 'revenue', taxCategory: 'BAS - Total sales' },
  { code: '4200', name: 'Other Income', type: 'revenue', taxCategory: 'ITR - Other income' },
  // Expenses
  { code: '5000', name: 'Cost of Goods Sold', type: 'expense', taxCategory: 'ITR - Cost of sales' },
  { code: '5100', name: 'Advertising & Marketing', type: 'expense', taxCategory: 'ITR - All other expenses' },
  { code: '5200', name: 'Motor Vehicle Expenses', type: 'expense', taxCategory: 'ITR - Motor vehicle expenses' },
  { code: '5300', name: 'Travel Expenses', type: 'expense', taxCategory: 'ITR - Travel expenses' },
  { code: '5400', name: 'Rent', type: 'expense', taxCategory: 'ITR - Rent expenses' },
  { code: '5500', name: 'Repairs & Maintenance', type: 'expense', taxCategory: 'ITR - Repairs and maintenance' },
  { code: '5600', name: 'Office Supplies', type: 'expense', taxCategory: 'ITR - All other expenses' },
  { code: '5700', name: 'Insurance', type: 'expense', taxCategory: 'ITR - All other expenses' },
  { code: '5800', name: 'Interest & Bank Charges', type: 'expense', taxCategory: 'ITR - Interest expenses' },
  { code: '5900', name: 'Accounting & Legal Fees', type: 'expense', taxCategory: 'ITR - All other expenses' },
  { code: '6000', name: 'Telephone & Internet', type: 'expense', taxCategory: 'ITR - All other expenses' },
  { code: '6100', name: 'Depreciation', type: 'expense', taxCategory: 'ITR - Depreciation expenses' },
  { code: '6200', name: 'Superannuation', type: 'expense', taxCategory: 'ITR - Superannuation expenses' },
  { code: '6300', name: 'Wages & Salaries', type: 'expense', taxCategory: 'ITR - Salary and wage expenses' },
  { code: '6400', name: 'Contractor Payments', type: 'expense', taxCategory: 'ITR - Contractor expenses' },
  { code: '6500', name: 'Software & Subscriptions', type: 'expense', taxCategory: 'ITR - All other expenses' },
  { code: '6600', name: 'Home Office Expenses', type: 'expense', taxCategory: 'ITR - Home office expenses' },
  { code: '6700', name: 'Other Expenses', type: 'expense', taxCategory: 'ITR - All other expenses' },
];

export const auChartOfAccounts: ChartOfAccountsTemplate = {
  getDefaultAccounts(businessType: string): Account[] {
    return BAS_ACCOUNTS;
  },
  getTaxCategoryMapping(): Record<string, string> {
    const mapping: Record<string, string> = {};
    for (const acct of BAS_ACCOUNTS) {
      if (acct.taxCategory) mapping[acct.code] = acct.taxCategory;
    }
    return mapping;
  },
};
