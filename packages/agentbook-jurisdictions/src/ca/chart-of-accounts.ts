import type { ChartOfAccountsTemplate, Account } from '../interfaces.js';

// T2125 (Statement of Business or Professional Activities) aligned accounts
const T2125_ACCOUNTS: Account[] = [
  // Assets
  { code: '1000', name: 'Cash', type: 'asset' },
  { code: '1100', name: 'Accounts Receivable', type: 'asset' },
  { code: '1200', name: 'Business Chequing', type: 'asset' },
  { code: '1300', name: 'Business Savings', type: 'asset' },
  // Liabilities
  { code: '2000', name: 'Accounts Payable', type: 'liability' },
  { code: '2100', name: 'GST/HST Payable', type: 'liability' },
  { code: '2200', name: 'PST/QST Payable', type: 'liability' },
  { code: '2300', name: 'Credit Card', type: 'liability' },
  // Equity
  { code: '3000', name: "Owner's Equity", type: 'equity' },
  { code: '3100', name: "Owner's Drawings", type: 'equity' },
  // Revenue
  { code: '4000', name: 'Professional Income', type: 'revenue', taxCategory: 'Line 8000 - Professional income' },
  { code: '4100', name: 'Sales Revenue', type: 'revenue', taxCategory: 'Line 8000 - Professional income' },
  { code: '4200', name: 'Other Income', type: 'revenue', taxCategory: 'Line 8230 - Other income' },
  // Expenses (T2125 lines)
  { code: '5000', name: 'Advertising', type: 'expense', taxCategory: 'Line 8521 - Advertising' },
  { code: '5100', name: 'Meals & Entertainment', type: 'expense', taxCategory: 'Line 8523 - Meals and entertainment' },
  { code: '5200', name: 'Office Expenses', type: 'expense', taxCategory: 'Line 8810 - Office expenses' },
  { code: '5300', name: 'Supplies', type: 'expense', taxCategory: 'Line 8811 - Office stationery and supplies' },
  { code: '5400', name: 'Rent', type: 'expense', taxCategory: 'Line 8910 - Rent' },
  { code: '5500', name: 'Travel', type: 'expense', taxCategory: 'Line 8520 - Travel' },
  { code: '5600', name: 'Vehicle Expenses', type: 'expense', taxCategory: 'Line 9281 - Motor vehicle expenses' },
  { code: '5700', name: 'Insurance', type: 'expense', taxCategory: 'Line 8690 - Insurance' },
  { code: '5800', name: 'Interest & Bank Charges', type: 'expense', taxCategory: 'Line 8710 - Interest and bank charges' },
  { code: '5900', name: 'Professional Fees', type: 'expense', taxCategory: 'Line 8860 - Professional fees' },
  { code: '6000', name: 'Utilities', type: 'expense', taxCategory: 'Line 8945 - Utilities' },
  { code: '6100', name: 'Telephone & Internet', type: 'expense', taxCategory: 'Line 8220 - Telephone and internet' },
  { code: '6200', name: 'Capital Cost Allowance', type: 'expense', taxCategory: 'Line 9936 - Capital cost allowance' },
  { code: '6300', name: 'Subcontracts', type: 'expense', taxCategory: 'Line 8870 - Management and admin fees' },
  { code: '6400', name: 'Repairs & Maintenance', type: 'expense', taxCategory: 'Line 8960 - Maintenance and repairs' },
  { code: '6500', name: 'Taxes, Fees & Licences', type: 'expense', taxCategory: 'Line 8760 - Business tax, fees, licences' },
  { code: '6600', name: 'Software & Subscriptions', type: 'expense', taxCategory: 'Line 9270 - Other expenses' },
  { code: '6700', name: 'Delivery & Freight', type: 'expense', taxCategory: 'Line 8730 - Delivery, freight and express' },
  { code: '6800', name: 'Salary & Wages', type: 'expense', taxCategory: 'Line 9060 - Salaries, wages, and benefits' },
  { code: '6900', name: 'Other Expenses', type: 'expense', taxCategory: 'Line 9270 - Other expenses' },
];

export const caChartOfAccounts: ChartOfAccountsTemplate = {
  getDefaultAccounts(businessType: string): Account[] {
    return T2125_ACCOUNTS;
  },
  getTaxCategoryMapping(): Record<string, string> {
    const mapping: Record<string, string> = {};
    for (const acct of T2125_ACCOUNTS) {
      if (acct.taxCategory) mapping[acct.code] = acct.taxCategory;
    }
    return mapping;
  },
};
