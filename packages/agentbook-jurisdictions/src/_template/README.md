# Adding a New Jurisdiction Pack

Follow these steps to add support for a new country/jurisdiction. No core framework changes are needed.

## 1. Create the directory

```
src/<country-code>/
```

Use the ISO 3166-1 alpha-2 country code in lowercase (e.g., `us`, `ca`, `gb`, `au`, `de`).

## 2. Implement all required modules

Create the following files in your new directory, each implementing the corresponding interface from `../interfaces.ts`:

| File                     | Interface(s)                  | Purpose                                      |
|--------------------------|-------------------------------|----------------------------------------------|
| `tax-brackets.ts`        | `TaxBracketProvider`          | Federal/national income tax brackets          |
| `self-employment-tax.ts` | `SelfEmploymentTaxCalculator` | Self-employment / social contributions        |
| `sales-tax.ts`           | `SalesTaxEngine`              | Sales tax / VAT / GST by region               |
| `chart-of-accounts.ts`   | `ChartOfAccountsTemplate`     | Default accounts mapped to tax form lines     |
| `installment-schedule.ts`| `InstallmentSchedule`         | Quarterly estimated tax payment deadlines     |
| `contractor-report.ts`   | `ContractorReportGenerator`   | Contractor payment reporting thresholds/forms |
| `mileage-rate.ts`        | `MileageRateProvider`         | Official mileage/km reimbursement rates       |
| `deductions.ts`          | `DeductionRuleSet`            | Available business deductions and calculators |
| `calendar-deadlines.ts`  | `CalendarDeadlineProvider`    | Tax deadlines and important dates             |

## 3. Create the pack index

Create `src/<country-code>/index.ts` that assembles all modules into a `JurisdictionPack`:

```typescript
import type { JurisdictionPack } from '../loader.js';
// import all your modules...

export const xxPack: JurisdictionPack = {
  id: 'xx',           // ISO country code
  name: 'Country Name',
  taxBrackets: xxTaxBrackets,
  selfEmploymentTax: xxSelfEmploymentTax,
  salesTax: xxSalesTax,
  chartOfAccounts: xxChartOfAccounts,
  installmentSchedule: xxInstallmentSchedule,
  contractorReport: xxContractorReport,
  mileageRate: xxMileageRate,
  deductions: xxDeductions,
  calendarDeadlines: xxCalendarDeadlines,
};
```

## 4. Register the pack

1. Import your pack in `src/loader.ts` and add it to `loadBuiltInPacks()`.
2. Re-export it from `src/index.ts`.

## Key conventions

- **All monetary values are in cents** (integer arithmetic avoids floating-point errors).
- **Tax years are integers** (e.g., 2025).
- **Regions use standard codes** (US states: 2-letter; CA provinces: 2-letter; etc.).
- **Calendar deadline `titleKey`** values are i18n keys (e.g., `calendar.q1_estimated_tax_due`).
- **Deadline `urgency`** levels: `critical` (must act), `important` (should act soon), `informational` (awareness).
- Use the existing US (`src/us/`) and Canadian (`src/ca/`) packs as reference implementations.
