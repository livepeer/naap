import type { ChartOfAccountsTemplate, Account } from '../interfaces.js';

// Self Assessment aligned accounts for UK sole traders
const SA_ACCOUNTS: Account[] = [
  // Assets
  { code: '1000', name: 'Cash', type: 'asset' },
  { code: '1100', name: 'Accounts Receivable', type: 'asset' },
  { code: '1200', name: 'Business Current Account', type: 'asset' },
  { code: '1300', name: 'Business Savings Account', type: 'asset' },
  // Liabilities
  { code: '2000', name: 'Accounts Payable', type: 'liability' },
  { code: '2100', name: 'VAT Payable', type: 'liability' },
  { code: '2200', name: 'PAYE/NI Payable', type: 'liability' },
  { code: '2300', name: 'Credit Card', type: 'liability' },
  // Equity
  { code: '3000', name: "Owner's Equity", type: 'equity' },
  { code: '3100', name: "Owner's Drawings", type: 'equity' },
  // Revenue
  { code: '4000', name: 'Sales/Turnover', type: 'revenue', taxCategory: 'SA103 - Turnover' },
  { code: '4100', name: 'Other Business Income', type: 'revenue', taxCategory: 'SA103 - Other income' },
  // Expenses (Self Assessment SA103 aligned)
  { code: '5000', name: 'Cost of Goods Sold', type: 'expense', taxCategory: 'SA103 - Cost of goods' },
  { code: '5100', name: 'Employee Costs', type: 'expense', taxCategory: 'SA103 - Employee costs' },
  { code: '5200', name: 'Premises Costs', type: 'expense', taxCategory: 'SA103 - Premises costs' },
  { code: '5300', name: 'Repairs & Renewals', type: 'expense', taxCategory: 'SA103 - Repairs' },
  { code: '5400', name: 'General Administrative', type: 'expense', taxCategory: 'SA103 - Admin costs' },
  { code: '5500', name: 'Motor Expenses', type: 'expense', taxCategory: 'SA103 - Motor expenses' },
  { code: '5600', name: 'Travel & Subsistence', type: 'expense', taxCategory: 'SA103 - Travel costs' },
  { code: '5700', name: 'Advertising & Marketing', type: 'expense', taxCategory: 'SA103 - Advertising' },
  { code: '5800', name: 'Interest & Bank Charges', type: 'expense', taxCategory: 'SA103 - Interest' },
  { code: '5900', name: 'Accountancy & Legal Fees', type: 'expense', taxCategory: 'SA103 - Legal and professional' },
  { code: '6000', name: 'Phone, Fax, Stationery', type: 'expense', taxCategory: 'SA103 - Phone and stationery' },
  { code: '6100', name: 'Other Business Expenses', type: 'expense', taxCategory: 'SA103 - Other expenses' },
  { code: '6200', name: 'Capital Allowances', type: 'expense', taxCategory: 'SA103 - Capital allowances' },
  { code: '6300', name: 'Depreciation', type: 'expense', taxCategory: 'SA103 - Depreciation (disallowable)' },
  { code: '6400', name: 'Use of Home as Office', type: 'expense', taxCategory: 'SA103 - Use of home' },
  { code: '6500', name: 'Software & Subscriptions', type: 'expense', taxCategory: 'SA103 - Other expenses' },
];

export const ukChartOfAccounts: ChartOfAccountsTemplate = {
  getDefaultAccounts(businessType: string): Account[] {
    return SA_ACCOUNTS;
  },
  getTaxCategoryMapping(): Record<string, string> {
    const mapping: Record<string, string> = {};
    for (const acct of SA_ACCOUNTS) {
      if (acct.taxCategory) mapping[acct.code] = acct.taxCategory;
    }
    return mapping;
  },
};
