# AgentBook — MVP Implementation Plan for A3P

> **Governing documents:** This plan MUST be implemented in compliance with:
> - `architecture.md` — Component design, quality system, data architecture
> - `SKILL.md` — Code patterns, constraints, testing standards, LLM prompt standards
> - `requirements-v2.md` — Feature requirements, competitive positioning, acceptance criteria
> - `phased-plan.md` — Phase sequencing, exit criteria, risk register

---

## Overview

AgentBook is an agent-based accounting system implemented as a set of A3P plugins. Rather than a single monolithic plugin, the MVP is decomposed into **four cooperating plugins** that map to the core accounting domains, plus an **agent framework** with a decoupled **skill system** that allows the agent to be upgraded by improving skills without changing the framework.

**The MVP ships with full support for the United States and Canada.** The architecture is jurisdiction-aware from day one so that adding new countries (UK, EU, Australia, etc.) requires only a new **jurisdiction pack** — a bundle of tax rules, chart-of-accounts templates, form generators, and locale config — with zero changes to the core framework, plugins, or database schema.

This approach lets each domain evolve independently, enables granular permissions, and follows the A3P plugin-per-domain architecture principle.

---

## Core Design Philosophy: Your 24/7 Accounting Firm

> **AgentBook is not a tool you use. It is a professional that works for you.**
>
> A great accounting firm doesn't wait for you to call. It monitors your bank activity, flags unusual charges, reminds you about upcoming deadlines, hunts for tax savings, follows up on overdue invoices, and surfaces insights you didn't know to ask for. AgentBook does the same — proactively, around the clock, via Telegram messages that feel like a thoughtful partner checking in.
>
> **The architecture has two equal halves:**
> 1. **Reactive path** — user sends a receipt, asks a question, requests a report. Agent responds.
> 2. **Proactive path** — agent monitors data, detects opportunities/risks, initiates contact. User responds (or ignores).
>
> Both paths use the same skill system, constraint engine, and verification pipeline. The proactive path is not a bolt-on — it is a **first-class architectural component** built from Phase 0.

---

## Agent Architecture: Framework + Skills (Decoupled)

### Design Principle
The agent framework is a **generic orchestration engine** with two execution modes: **reactive** (responding to user messages) and **proactive** (self-initiated based on schedules, events, and data analysis). All domain knowledge lives in **loadable, updatable skills**. The system can be iterated/upgraded by improving agent skills without changing the agent framework.

### Agent Framework (stable, rarely changes)
```
AgentFramework/
  ├── orchestrator.ts        # Intent routing, DAG planning, execution loop
  ├── constraint-engine.ts   # Hard gates, escalation gates, soft checks
  ├── verifier.ts            # Independent verification pass
  ├── context-assembler.ts   # Typed context loading per intent
  ├── escalation-router.ts   # Human-in-the-loop routing
  ├── skill-registry.ts      # Discovers, loads, validates, hot-reloads skills
  ├── event-emitter.ts       # Kafka event emission
  └── proactive-engine.ts    # Scheduled + event-driven proactive engagement
```

### Proactive Engagement Engine (the differentiator)

This is the component that makes AgentBook feel like a professional firm, not a passive app. It runs continuously alongside the reactive path.

**Architecture:**
```
ProactiveEngine/
  ├── scheduler.ts           # Cron-based triggers (daily digest, weekly review, deadline reminders)
  ├── event-watcher.ts       # Kafka consumer: reacts to data changes in real-time
  ├── insight-generator.ts   # LLM-powered analysis: detects opportunities, risks, anomalies
  ├── priority-ranker.ts     # Ranks insights by urgency/value to avoid notification fatigue
  ├── delivery-manager.ts    # Routes notifications: Telegram, web dashboard, email digest
  └── engagement-tracker.ts  # Tracks which notifications user acts on (feedback loop for relevance)
```

**Four trigger types:**

| Trigger | Example | Mechanism |
|---------|---------|-----------|
| **Scheduled** | Weekly financial summary, daily pulse | Cron job per tenant (timezone-aware) |
| **Calendar-driven** | Tax deadline, fiscal quarter close, year-end | Calendar & Deadline Engine (see below) |
| **Event-driven** | Payment received, bank transaction imported, invoice overdue | Kafka consumer on `agentbooks.execution_events` |
| **Analysis-driven** | Cash flow warning, deduction opportunity, spending anomaly | Periodic LLM analysis of tenant ledger data |

### Calendar & Deadline Engine (always on the clock)

The agent maintains a **living calendar** of every date that matters for each tenant's financial life. This is not a static config or hardcoded reminder list — deadlines, holidays, and critical dates are **discovered and populated by skills and tools**, the same way the agent learns everything else. Skills can add, update, and remove calendar events dynamically as data changes.

**Calendar is populated by skills (not config):**

Each skill that knows about dates registers a `CalendarProvider` tool. The calendar engine calls all registered providers periodically and on relevant events to keep the calendar current.

```typescript
// Skills register calendar providers — the engine discovers dates via tools, not config
interface CalendarProvider {
  name: string;                    // "us-tax-deadlines" | "invoice-due-dates" | "pattern-renewals"
  skill: string;                   // which skill owns this provider
  getEvents(tenant: TenantContext, dateRange: DateRange): CalendarEvent[];
}

// The jurisdiction pack skill registers its calendar provider
// Example: US pack's tax deadline skill
{
  "name": "us-tax-calendar",
  "skill": "jurisdiction-us",
  "tool": "get_tax_deadlines",     // standard tool interface, callable like any other tool
  "refresh": "daily"               // how often the engine re-queries this provider
}
```

**Skill-provided calendar sources:**

| Skill | Events Provided | Refresh |
|-------|----------------|---------|
| **jurisdiction-us** (tax deadline tool) | Apr 15 annual, Jun/Sep/Jan quarterly, Jan 31 1099 filing, state-specific deadlines | Daily + on tax year change |
| **jurisdiction-ca** (tax deadline tool) | Apr 30 annual, Mar/Jun/Sep/Dec installments, Feb 28 T4A, RRSP deadline Mar 1 | Daily + on tax year change |
| **jurisdiction-{x}** (sales tax tool) | Sales tax filing deadlines per state/province | Daily |
| **invoice-creation** (due date tool) | All outstanding invoice due dates, projected payment dates from client patterns | On invoice create/pay/edit |
| **expense-recording** (recurring tool) | Subscription renewal dates, recurring charge expected dates | On pattern detection |
| **bank-reconciliation** (cash flow tool) | Projected dates where balance drops below threshold | On bank sync |
| **market-calendar** skill | Bank holidays (Fed Reserve / Bank of Canada), Stripe payout schedule, market close dates | Weekly sync from public APIs |
| **seasonal-awareness** skill | Tax season (Feb-Apr), year-end planning (Nov), RRSP season (Jan-Mar for CA) | Annual seed |

**Why skills, not config:**
- A new jurisdiction pack automatically brings its deadlines — no manual calendar setup
- When an invoice is created, the invoice skill adds the due date — no separate reminder system
- When a recurring pattern is detected, the expense skill projects the next date — the calendar self-maintains
- When market holidays change, the market-calendar skill fetches updated data — no code deploys
- Custom user dates ("remind me to invoice Acme on the 1st of each month") are just another skill adding events

**Calendar event model:**
```
ab_calendar_events (
  id, tenant_id,
  event_type,                    -- tax_deadline | filing_deadline | quarter_close | market_holiday | invoice_due | renewal | cash_crunch | custom
  title_key,                     -- i18n key: "calendar.q2_estimated_tax_due"
  date, time,
  lead_time_days,                -- when to start alerting (e.g., [7, 3, 1, 0] = alert at 7d, 3d, 1d, day-of)
  urgency,                       -- critical | important | informational
  action_url,                    -- deep link: IRS Direct Pay, CRA My Account, etc.
  action_label_key,              -- i18n key: "calendar.action_pay_now"
  recurrence,                    -- annual | quarterly | monthly | once
  source_skill,                  -- which skill created this event
  source_entity_id,              -- invoice_id, pattern_id, etc. (for updates/deletes)
  status                         -- upcoming | alerted | acted_on | missed | snoozed
)
```

**How it works:**
1. On tenant onboarding, the jurisdiction pack skill's `get_tax_deadlines` tool is called — seeds all government deadlines
2. As invoices are created, the invoice skill's calendar provider adds due dates
3. As patterns are detected, the expense skill projects renewal/charge dates
4. As bank data flows, the cash flow skill calculates crunch dates
5. The proactive engine queries the calendar every hour, fires alerts at configured lead times
6. New tax year -> jurisdiction skill auto-seeds next year's deadlines via the same tool
7. If a skill is updated (new deadline added to jurisdiction pack), the calendar self-updates on next refresh

**Proactive message categories (what the agent initiates):**

| Category | Phase | Examples |
|----------|-------|---------|
| **Money in** | 0 | "Acme Corp just paid $5,000! Net after Stripe fees: $4,854.50." |
| **Money out alerts** | 0 | "Unusual charge: $847 at Best Buy. Office supplies? [Yes] [No] [Split]" |
| **Receipt reminders** | 0 | "You have 3 bank transactions this week without receipts. Want to snap them now?" |
| **Daily pulse** | 0 | "Today: $340 in, $127 out. Cash balance: $12,450. 1 invoice due tomorrow." |
| **Invoice follow-up** | 1 | "Acme Corp is 7 days overdue on $5,000. Want me to send a reminder? [Send] [Wait] [Call instead]" |
| **Recurring anomaly** | 1 | "Your Figma subscription charged $59.99 instead of the usual $49.99. Price increase? [Accept new amount] [Investigate]" |
| **Tax deadline** | 2 | "Quarterly tax payment due in 7 days. I calculated $3,200 for Q2. [Pay now via IRS Direct Pay] [Adjust] [Remind me in 3 days]" |
| **Deduction hunting** | 2 | "You haven't logged home office expenses this year. Do you work from home? You could save ~$1,500 in taxes." |
| **Cash flow warning** | 3 | "Heads up: your cash balance drops to $1,200 on April 3. You have $3,800 in bills but only $2,600 expected income. Follow up on overdue Acme invoice?" |
| **Tax bracket alert** | 3 | "You're $3,000 from the next bracket. If you can prepay January rent or buy that equipment, you'd save ~$660." |
| **Weekly review** | 1 | "This week: $4,200 revenue, $1,340 expenses. Top spend: Software ($420). Your effective tax rate is 28.3%." |
| **Year-end planning** | 4 | "It's November. Here's your year-end tax optimization report: 4 actions could save $2,840. [View report]" |

**Anti-annoyance design:**
- Priority ranking: urgent (tax deadline) > actionable (invoice reminder) > informational (weekly digest)
- User preference learning: if user ignores expense analytics alerts 3x, reduce frequency
- Quiet hours: respect tenant timezone, no messages before 8am or after 9pm
- Consolidation: batch low-priority insights into daily/weekly digest, don't send 10 separate messages
- One-tap actions: every proactive message has inline keyboard buttons — the user should never need to type a response
- Snooze: [Remind me tomorrow] [Remind me next week] [Don't remind me about this]

**Engagement tracking (feedback loop):**
```
ab_engagement_log (
  id, tenant_id, message_type, category, priority,
  sent_at, opened_at, acted_on_at, action_taken,
  snoozed, dismissed, response_time_seconds
)
```
The engine learns: "This tenant acts on invoice reminders within 2 hours but ignores spending anomaly alerts. Increase invoice reminder priority, reduce anomaly alert frequency."

---

## Internationalization (i18n) — Built Into the Core

### Design Principle
Every string the user sees — Telegram messages, web dashboard labels, proactive alerts, PDF reports, error messages, inline keyboard buttons — goes through the i18n layer. **No hardcoded English strings in business logic or UI components.** This is enforced from Phase 0, not retrofitted later.

### Architecture
```
i18n/
  ├── core.ts                  # i18n runtime: t() function, locale resolution, pluralization
  ├── locales/
  │   ├── en/                  # English (default)
  │   │   ├── common.json      # Shared: buttons, labels, errors, units
  │   │   ├── expense.json     # "Receipt saved", "Category: {category}", etc.
  │   │   ├── invoice.json     # "Invoice #{number} sent to {client}"
  │   │   ├── tax.json         # "Quarterly tax due: {amount}", "Deduction found: {description}"
  │   │   ├── proactive.json   # "Daily pulse: {in} in, {out} out", "Acme is {days} days overdue"
  │   │   └── reports.json     # P&L headers, balance sheet labels, column names
  │   ├── fr/                  # French (Canadian French for MVP)
  │   │   ├── common.json
  │   │   ├── expense.json
  │   │   └── ...
  │   └── _template/           # Copy to add a new language
  │       └── README.md
  ├── types.ts                 # TypeScript type-safe i18n keys (compile-time checking)
  └── middleware.ts             # Resolves locale from tenant config for every request
```

### How it works

**1. Every user-facing string uses a translation key:**
```typescript
// WRONG — hardcoded string
await telegram.send("Receipt saved. Journal entry posted.");

// CORRECT — i18n key with interpolation
await telegram.send(t('expense.receipt_saved', { amount: formatCurrency(4500, locale) }));
// en: "Receipt saved. $45.00 recorded."
// fr: "Recu enregistre. 45,00 $ enregistre."
```

**2. Currency, date, and number formatting is locale-aware:**
```typescript
formatCurrency(4500, 'en-US')  // "$45.00"
formatCurrency(4500, 'en-CA')  // "$45.00"  (CAD symbol same, but context differs)
formatCurrency(4500, 'fr-CA')  // "45,00 $"  (comma decimal, symbol after)

formatDate(date, 'en-US')      // "Mar 22, 2026"
formatDate(date, 'fr-CA')      // "22 mars 2026"

formatNumber(1234.56, 'en')    // "1,234.56"
formatNumber(1234.56, 'fr')    // "1 234,56"
```

**3. Telegram inline keyboard buttons are i18n'd:**
```typescript
// Buttons use translation keys
const keyboard = [
  [{ text: t('common.correct'), callback_data: 'confirm' }],
  [{ text: t('expense.change_category'), callback_data: 'change_cat' }],
  [{ text: t('expense.mark_personal'), callback_data: 'personal' }],
];
// en: [Correct] [Change category] [Mark personal]
// fr: [Correct] [Changer la categorie] [Marquer personnel]
```

**4. PDF reports and tax forms use locale-aware templates:**
- Invoice PDFs: locale determines date format, currency format, column headers
- P&L reports: account names from jurisdiction pack (already localized), column labels from i18n
- Tax forms: generated by jurisdiction pack which includes locale-specific field labels

**5. Proactive messages are fully i18n'd:**
```json
// proactive.json (en)
{
  "daily_pulse": "Today: {income} in, {expenses} out. Cash balance: {balance}. {action_count} items need attention.",
  "invoice_overdue": "{client} is {days} days overdue on {amount}. Send a reminder?",
  "tax_deadline": "Quarterly tax payment due in {days} days. I calculated {amount} for {quarter}."
}

// proactive.json (fr)
{
  "daily_pulse": "Aujourd'hui : {income} entrant, {expenses} sortant. Solde : {balance}. {action_count} elements necessitent votre attention.",
  "invoice_overdue": "{client} a {days} jours de retard sur {amount}. Envoyer un rappel ?",
  "tax_deadline": "Paiement d'impot trimestriel du dans {days} jours. J'ai calcule {amount} pour {quarter}."
}
```

**6. Locale resolution chain:**
1. Tenant config `locale` field (e.g., `fr-CA`) — primary
2. User browser `Accept-Language` header — fallback for web
3. Telegram user `language_code` — fallback for Telegram
4. Default: `en`

### MVP languages
- **`en`** — English (US + CA, default)
- **`fr`** — French (Canadian French, for Quebec users)

### Adding a new language
1. Copy `i18n/locales/_template/` to `i18n/locales/{lang}/`
2. Translate all JSON files (can be LLM-assisted with human review)
3. Register in locale config
4. No code changes — the i18n runtime discovers new locales automatically

### Compile-time safety
TypeScript types are auto-generated from the `en` locale files. If a translation key is missing in any locale, the build warns. If code references a non-existent key, it fails at compile time.

---

### Skill System (evolves independently)
```
skills/
  ├── skill-manifest.json    # Declares: name, version, tools, constraints, prompts
  ├── expense-recording/
  │   ├── skill.json         # Tool definitions, input/output schemas, constraints
  │   ├── prompts/           # Versioned prompt templates (intent parsing, categorization)
  │   ├── handlers/          # Tool execution logic
  │   └── tests/             # Skill-specific test suite
  ├── invoice-creation/
  ├── tax-estimation/
  ├── report-generation/
  ├── bank-reconciliation/
  └── ...
```

### Skill Manifest Schema
```json
{
  "name": "expense-recording",
  "version": "1.2.0",
  "description": "Record, categorize, and manage expenses",
  "intents": ["record_expense", "categorize_expense", "edit_expense"],
  "tools": [
    {
      "name": "record_expense",
      "inputSchema": { ... },
      "outputSchema": { ... },
      "constraints": ["balance_invariant", "amount_threshold"],
      "compensation": "void_expense",
      "modelTier": "haiku"
    }
  ],
  "prompts": {
    "intent_parse": { "version": "1.3", "file": "prompts/intent-parse.md" },
    "categorize": { "version": "2.1", "file": "prompts/categorize.md" }
  },
  "dependencies": ["agentbook-core"]
}
```

### Skill Lifecycle
- **Discovery:** Framework scans `skills/` directory on startup
- **Validation:** Each skill manifest is validated against the skill schema
- **Registration:** Tools, constraints, and prompts registered in the skill registry
- **Hot-reload:** Skills can be updated at runtime without restarting the framework
- **Versioning:** Multiple skill versions can coexist; A/B testing supported
- **Specialization:** New accounting specializations (e.g., Canadian tax, EU VAT, crypto) are added as new skills, not framework changes

---

## Multi-Jurisdiction Architecture (US + Canada, extensible)

### Design Principle
Every component that touches tax rules, form generation, chart-of-accounts defaults, sales tax, fiscal year conventions, or locale formatting is **parameterized by jurisdiction**. The core framework and plugins never contain hardcoded US or Canadian logic — they delegate to a **jurisdiction pack** loaded at tenant configuration time.

### What varies by jurisdiction

| Concern | US | Canada | Abstraction |
|---------|-----|--------|-------------|
| Income tax form | Schedule C (1040) | T2125 (T1) | `TaxFormGenerator` interface |
| Self-employment tax | SE tax (15.3%) | CPP/EI self-employed contributions | `SelfEmploymentTaxCalculator` interface |
| Tax brackets | Federal + state progressive | Federal + provincial progressive | `TaxBracketProvider` with year-versioned rates |
| Quarterly installments | Estimated tax (Apr/Jun/Sep/Jan) | Quarterly installments (Mar/Jun/Sep/Dec) | `InstallmentSchedule` interface |
| Sales tax | State/county/city sales tax | GST (5%) + HST or PST by province | `SalesTaxEngine` interface |
| Contractor reporting | 1099-NEC ($600 threshold) | T4A ($500 threshold) | `ContractorReportGenerator` interface |
| Chart of accounts defaults | Schedule C line-aligned | T2125 category-aligned | `ChartOfAccountsTemplate` per jurisdiction |
| Currency | USD | CAD | `tenant_config.currency` + multi-currency amounts |
| Fiscal year | Calendar year (most sole props) | Calendar year (most sole props) | `tenant_config.fiscal_year_start` |
| Mileage rate | IRS standard ($0.70/mile 2025) | CRA rate ($0.72/km first 5000, $0.66 after) | `MileageRateProvider` with year-versioned rates |
| Receipt language | English | English + French | `locale` on tenant config |
| Deduction categories | Home office (simplified/regular), Section 179 | Business-use-of-home, CCA classes | `DeductionRuleSet` per jurisdiction |

### Jurisdiction Pack Structure

A jurisdiction pack is a **skill bundle** that plugs into the agent's skill registry. Adding a new country = adding a new pack. No framework or plugin changes required.

```
jurisdiction-packs/
  ├── us/
  │   ├── pack.json              # Declares: jurisdiction_id, supported_regions, tax_year
  │   ├── tax-brackets/          # Federal + 50 state bracket tables (JSON, year-versioned)
  │   ├── sales-tax/             # State/county rate tables
  │   ├── forms/
  │   │   ├── schedule-c.ts      # Implements TaxFormGenerator
  │   │   ├── schedule-se.ts     # Implements SelfEmploymentTaxCalculator
  │   │   ├── form-1099-nec.ts   # Implements ContractorReportGenerator
  │   │   └── quarterly-estimates.ts  # Implements InstallmentSchedule
  │   ├── chart-of-accounts.json # Default CoA template (Schedule C aligned)
  │   ├── deductions.json        # Deduction rules (home office, Section 179, etc.)
  │   ├── mileage-rates.json     # IRS rates by year
  │   └── prompts/               # US-specific prompt overlays for categorization
  │
  ├── ca/
  │   ├── pack.json
  │   ├── tax-brackets/          # Federal + 13 province/territory bracket tables
  │   ├── sales-tax/             # GST/HST/PST rates by province
  │   ├── forms/
  │   │   ├── t2125.ts           # Implements TaxFormGenerator
  │   │   ├── cpp-ei.ts          # Implements SelfEmploymentTaxCalculator
  │   │   ├── t4a.ts             # Implements ContractorReportGenerator
  │   │   └── quarterly-installments.ts  # Implements InstallmentSchedule
  │   ├── chart-of-accounts.json # Default CoA template (T2125 aligned)
  │   ├── deductions.json        # CRA deduction rules (business-use-of-home, CCA)
  │   ├── mileage-rates.json     # CRA rates by year
  │   └── prompts/               # Canadian-specific prompt overlays
  │
  └── _template/                 # Copy this to add a new country
      ├── pack.json
      └── README.md              # Instructions for implementing each interface
```

### Jurisdiction Interfaces (implemented by each pack)

```typescript
// Every interface is parameterized by tax_year for annual rate updates

interface TaxBracketProvider {
  jurisdiction: string;              // "us" | "ca" | "uk" | ...
  region?: string;                   // state/province/nil
  getTaxBrackets(taxYear: number): TaxBracket[];
  calculateTax(taxableIncome: number, taxYear: number): TaxCalculation;
}

interface SelfEmploymentTaxCalculator {
  calculate(netSelfEmploymentIncome: number, taxYear: number): {
    amount: number;
    deductiblePortion: number;      // US: half of SE tax; CA: enhanced CPP
    breakdown: Record<string, number>;
  };
}

interface SalesTaxEngine {
  getRates(region: string): SalesTaxRate[];
  calculateTax(amount: number, region: string): SalesTaxResult;
  getFilingDeadlines(region: string, taxYear: number): Date[];
}

interface TaxFormGenerator {
  formId: string;                    // "schedule-c" | "t2125" | ...
  generate(ledgerData: LedgerSummary, taxYear: number): TaxFormData;
  exportPDF(formData: TaxFormData): Buffer;
  exportMachineReadable(formData: TaxFormData): string; // TXF, EFILE, etc.
}

interface InstallmentSchedule {
  getDeadlines(taxYear: number): InstallmentDeadline[];
  calculateAmount(method: string, yearToDateIncome: number, priorYearTax: number): number;
}

interface ContractorReportGenerator {
  threshold: number;                 // US: 600, CA: 500
  formId: string;                    // "1099-nec" | "t4a"
  generate(contractorPayments: ContractorPayment[], taxYear: number): ContractorReport[];
}

interface ChartOfAccountsTemplate {
  getDefaultAccounts(businessType: string): Account[];
  getTaxCategoryMapping(): Record<string, string>; // account -> tax form line
}

interface MileageRateProvider {
  getRate(taxYear: number, totalKmOrMiles: number): { rate: number; unit: 'mile' | 'km' };
}

interface DeductionRuleSet {
  getAvailableDeductions(businessType: string): DeductionRule[];
  calculateDeduction(rule: string, inputs: Record<string, number>): number;
}
```

### How it works at runtime

1. **Tenant onboarding:** User selects country + region (state/province). Stored in `ab_tenant_config.jurisdiction` and `ab_tenant_config.region`.
2. **Pack loading:** The skill registry loads the jurisdiction pack matching the tenant's config. All tax/form/sales-tax interfaces resolve to the pack's implementations.
3. **Core plugins are jurisdiction-agnostic:** `agentbook-core` stores journal entries, chart of accounts, and amounts in cents. It never references Schedule C, T2125, GST, or any jurisdiction-specific concept.
4. **Tax plugin delegates:** `agentbook-tax` calls `TaxBracketProvider.calculateTax()`, `SelfEmploymentTaxCalculator.calculate()`, etc. It doesn't know whether it's computing IRS or CRA taxes.
5. **Adding a new country:** Implement the interfaces in a new pack directory. Register it. Done. Zero changes to framework, plugins, or schema.

### Multi-currency support

- All amounts stored as integer cents in the **tenant's base currency** (USD or CAD for MVP).
- Foreign currency transactions store both `amount_cents` (base) and `original_amount_cents` + `original_currency` + `exchange_rate`.
- Exchange rates fetched at transaction date from a rate provider.
- Reports always display in tenant base currency; drill-down shows original currency.
- Adding a new base currency = adding a currency config, not a schema change.

### What is NOT jurisdiction-specific (shared across all countries)

- Double-entry ledger mechanics (debits = credits is universal)
- Receipt OCR and expense categorization (LLM-based, locale-aware prompts)
- Invoice creation and PDF generation (template uses tenant locale/currency)
- Bank connection via Plaid (supports US + Canada natively)
- Stripe payment processing (supports both countries)
- Pattern memory and learning
- Agent framework, skill registry, constraint engine, verification pass
- Audit trail and event sourcing
- Dashboard UI (renders jurisdiction-specific data via the pack)

---

## Plugin Decomposition

### 1. `agentbook-core` — Ledger & Chart of Accounts
**Purpose:** The financial backbone. Double-entry ledger, chart of accounts, journal entries, tenant configuration, and the constraint engine that enforces accounting invariants. **Jurisdiction-agnostic** — all country-specific logic lives in jurisdiction packs.

**Key tools:**
- `create_journal_entry` — balanced debit/credit entry (hard-gated: sum(debits) == sum(credits))
- `get_trial_balance` — real-time trial balance
- `manage_chart_of_accounts` — CRUD for accounts (defaults loaded from jurisdiction pack's `ChartOfAccountsTemplate`)
- `close_period` / `open_period` — fiscal period management

**Database schema:** `plugin_agentbook_core`
- `ab_accounts` (chart of accounts — structure is universal, default categories from jurisdiction pack)
- `ab_journal_entries` (header: date, memo, source, verified)
- `ab_journal_lines` (entry_id, account_id, debit_cents, credit_cents)
- `ab_fiscal_periods` (year, month, status: open/closed)
- `ab_tenant_config` (business_type, **jurisdiction** [us|ca|...], **region** [state|province], **currency** [USD|CAD|...], locale, auto_approve_limit)

**Constraints (programmatic, never LLM — per SKILL.md):**
- Balance invariant: `CHECK (debit_total = credit_total)` at DB level
- Period gate: reject entries to closed periods
- Amount threshold: escalate if amount > tenant auto-approve limit

**Routes:** `/agentbook`, `/agentbook/ledger`, `/agentbook/accounts`

---

### 2. `agentbook-expense` — Expense Tracking & Categorization
**Purpose:** Capture, categorize, and manage expenses. Receipt OCR, auto-categorization with confidence scoring, recurring expense detection, business/personal separation.

**Key tools:**
- `record_expense` — create expense from text, photo, or forwarded receipt
- `categorize_expense` — LLM-based categorization against chart of accounts
- `detect_recurring` — background pattern detection on expense stream
- `manage_vendors` — vendor memory and per-vendor category rules

**Database schema:** `plugin_agentbook_expense`
- `ab_expenses` (amount_cents, vendor_id, category_id, date, receipt_url, confidence, is_personal)
- `ab_vendors` (name, normalized_name, default_category_id, transaction_count)
- `ab_patterns` (vendor_pattern, category_id, confidence, source, usage_count)
- `ab_recurring_rules` (vendor_id, amount_cents, frequency, next_expected, active)

**Integration with core:** Every recorded expense triggers a journal entry via `agentbook-core.create_journal_entry` (debit: expense account, credit: cash/bank account).

**Routes:** `/agentbook/expenses`, `/agentbook/receipts`, `/agentbook/vendors`

---

### 3. `agentbook-invoice` — Invoicing & Accounts Receivable
**Purpose:** Create, send, and track invoices. Payment collection via Stripe. Client management. Payment follow-up automation.

**Key tools:**
- `create_invoice` — natural language -> structured invoice -> PDF
- `send_invoice` — email delivery with payment link
- `record_payment` — manual or Stripe webhook payment recording
- `manage_clients` — client records with payment pattern learning
- `get_aging_report` — AR aging (current, 30, 60, 90+ days)

**Database schema:** `plugin_agentbook_invoice`
- `ab_clients` (name, email, address, default_terms, avg_days_to_pay)
- `ab_invoices` (client_id, number, amount_cents, issued_date, due_date, status, pdf_url)
- `ab_invoice_lines` (invoice_id, description, quantity, rate_cents, amount_cents)
- `ab_payments` (invoice_id, amount_cents, method, date, stripe_payment_id, fees_cents)
- `ab_estimates` (client_id, amount_cents, status, validity_period)

**Integration with core:** Invoice creation -> journal entry (debit: AR, credit: revenue). Payment -> journal entry (debit: cash, credit: AR; debit: fees expense, credit: cash).

**Routes:** `/agentbook/invoices`, `/agentbook/clients`, `/agentbook/estimates`

---

### 4. `agentbook-tax` — Tax Planning & Reporting
**Purpose:** Real-time tax estimation, quarterly payment management, deduction optimization, tax form generation, and financial reporting (P&L, balance sheet, cash flow). **All tax logic delegates to the tenant's jurisdiction pack** — the plugin itself is jurisdiction-agnostic.

**Key tools:**
- `estimate_tax` — calls `TaxBracketProvider` + `SelfEmploymentTaxCalculator` from jurisdiction pack
- `suggest_deductions` — calls `DeductionRuleSet` from jurisdiction pack for gap analysis
- `calculate_quarterly` — calls `InstallmentSchedule` from jurisdiction pack
- `generate_tax_forms` — calls `TaxFormGenerator` from jurisdiction pack (Schedule C for US, T2125 for CA)
- `generate_report` — P&L, balance sheet, cash flow (universal, not jurisdiction-specific)
- `project_cash_flow` — 30/60/90 day forecast
- `calculate_sales_tax` — calls `SalesTaxEngine` from jurisdiction pack (state tax for US, GST/HST/PST for CA)

**Database schema:** `plugin_agentbook_tax`
- `ab_tax_estimates` (period, jurisdiction, region, gross_revenue_cents, expenses_cents, net_income_cents, se_tax_cents, income_tax_cents, total_cents)
- `ab_quarterly_payments` (year, quarter, jurisdiction, amount_due_cents, amount_paid_cents, deadline)
- `ab_deduction_suggestions` (jurisdiction, category, description, estimated_savings_cents, status)
- `ab_tax_config` (filing_status, region, retirement_type, home_office_method)
- `ab_sales_tax_collected` (invoice_id, jurisdiction, region, tax_type [GST|HST|PST|state], rate, amount_cents)

**Integration with core:** Reads ledger data from `agentbook-core` for all calculations. No direct writes to ledger.

**Routes:** `/agentbook/tax`, `/agentbook/reports`, `/agentbook/cashflow`

---

## Cross-Plugin Communication

Plugins communicate through the A3P event bus and direct tool invocation:

```
Telegram / Web Dashboard
    |
    v
Interface Layer (Telegram bot / Web API)
    |
    +-- Text message: "I spent $45 on lunch"
    |   -> Agent Framework -> skill:expense-recording.record_expense()
    |   -> agentbook-core.create_journal_entry()
    |
    +-- Photo message: [receipt image]
    |   -> Agent Framework -> skill:receipt-ocr.extract_receipt()
    |   -> { amount: 4500, vendor: "Subway", date: "2026-03-22" }
    |   -> skill:expense-recording.record_expense()
    |   -> Telegram: inline keyboard [Correct] [Change] [Edit] [Personal]
    |   -> on confirm: agentbook-core.create_journal_entry()
    |   -> receipt image stored in S3, linked to expense
    |
    +-- Document: [forwarded email receipt / PDF]
    |   -> Agent Framework -> skill:receipt-ocr.extract_document()
    |   -> same flow as photo
    |
    +-- "Invoice Acme $5,000"
    |   -> skill:invoice-creation.create_invoice()
    |   -> agentbook-core.create_journal_entry()
    |
    +-- "What's my tax situation?"
    |   -> skill:tax-estimation.estimate_tax()
    |   -> reads from agentbook-core ledger
    |
    +-- "Show me my P&L"
        -> skill:report-generation.generate_report()
        -> reads from agentbook-core ledger
```

**Event flow:**
- `expense.recorded` -> tax plugin recalculates estimate
- `receipt.uploaded` -> OCR pipeline triggered, expense created on completion
- `invoice.paid` -> core plugin records journal entry -> tax recalculates
- `period.closed` -> expense plugin stops accepting entries for that period

---

## Phase 0: Foundation (2 weeks)

**Goal:** Plugin scaffolds, agent framework with skill system, ledger database, **Telegram bot with receipt photo capture and OCR** — so users experience the magic from day one.

> **UX-first principle:** The core differentiator of AgentBook is "snap a receipt, done." This must work in Phase 0, not be deferred. A text-only Phase 0 would feel no different from a spreadsheet. The photo-to-expense flow is what makes first-time users say "wow."

### Implementation Tasks

**Agent Framework & Plugins**
- [ ] **P0-T01** Scaffold all 4 plugins using A3P plugin template
- [ ] **P0-T02** Implement agent framework: orchestrator, constraint engine, skill registry
- [ ] **P0-T03** `agentbook-core`: PostgreSQL schema with balance CHECK constraint
- [ ] **P0-T04** `agentbook-core`: Tenant config with `jurisdiction`, `region`, `currency`, `locale` fields
- [ ] **P0-T05** `agentbook-core`: `create_journal_entry` tool with constraint engine
- [ ] **P0-T06** Docker Compose: add `plugin_agentbook_*` schemas

**Jurisdiction Packs**
- [ ] **P0-T07** Implement jurisdiction pack interfaces (`TaxBracketProvider`, `ChartOfAccountsTemplate`, `SalesTaxEngine`, etc.)
- [ ] **P0-T08** Implement US jurisdiction pack: chart of accounts (Schedule C aligned), federal + state tax brackets (2025)
- [ ] **P0-T09** Implement CA jurisdiction pack: chart of accounts (T2125 aligned), federal + provincial tax brackets (2025)
- [ ] **P0-T10** Jurisdiction pack loader: resolve correct pack from tenant config, validate interfaces
- [ ] **P0-T11** Jurisdiction pack template (`_template/`) with README for adding new countries

**Telegram Bot & Receipt Capture (day-one UX)**
- [ ] **P0-T12** Telegram bot service (Grammy/TypeScript, webhook mode) connected to agent framework
- [ ] **P0-T13** Telegram text expense: "I spent $20 on coffee" -> intent parse -> record expense -> confirm
- [ ] **P0-T14** Telegram photo receipt: user sends photo -> OCR pipeline -> extract amount/vendor/date -> confirm
- [ ] **P0-T15** Receipt OCR skill: photo -> cloud vision API (Google Vision or Claude vision) -> structured fields (amount, vendor, date, line items, tax/tip)
- [ ] **P0-T16** Receipt image storage: S3/cloud storage, linked to expense record, tenant-isolated paths
- [ ] **P0-T17** Telegram inline keyboard confirmation: [Correct] [Change category] [Edit amount] [Mark personal]
- [ ] **P0-T18** Telegram voice note support: speech-to-text -> intent parse -> record expense (stretch goal, can defer to P1 if needed)
- [ ] **P0-T19** Telegram PDF/document receipt: forwarded email receipt or PDF attachment -> parse -> record expense
- [ ] **P0-T20** Confidence-gated flow: if OCR confidence < 80%, agent asks user to confirm amount/vendor before recording

**Expense Recording**
- [ ] **P0-T21** Skill: `expense-recording` with skill manifest (handles text, photo, document intents)
- [ ] **P0-T22** Skill: `receipt-ocr` — photo/PDF -> structured data extraction via LLM vision
- [ ] **P0-T23** `agentbook-expense`: `record_expense` tool (text + photo + document, currency from tenant config)
- [ ] **P0-T24** `agentbook-expense`: Basic auto-categorization with LLM (confidence scoring against jurisdiction-specific CoA)
- [ ] **P0-T25** `agentbook-expense`: Manual category override via Telegram inline keyboard

**Web Dashboard**
- [ ] **P0-T26** Web dashboard: Plugin shell pages with navigation (use `frontend-design` skill for A3P UI compliance)
- [ ] **P0-T27** Web dashboard: receipt upload via drag-and-drop (same OCR pipeline as Telegram)
- [ ] **P0-T28** Web dashboard: recent expenses list with receipt thumbnail preview

**i18n Foundation (Phase 0 — no hardcoded strings from day one)**
- [ ] **P0-T42** i18n runtime: `t()` function, locale resolution chain, pluralization engine
- [ ] **P0-T43** Locale files: `en/common.json`, `en/expense.json`, `en/proactive.json`, `en/calendar.json`
- [ ] **P0-T44** Locale files: `fr/` (Canadian French) — all Phase 0 strings translated
- [ ] **P0-T45** Locale-aware formatters: `formatCurrency()`, `formatDate()`, `formatNumber()` per tenant locale
- [ ] **P0-T46** TypeScript type-safe i18n keys — compile-time error if key missing or misspelled
- [ ] **P0-T47** Telegram inline keyboard buttons use i18n keys, not hardcoded strings
- [ ] **P0-T48** i18n middleware: resolves locale from tenant config on every request
- [ ] **P0-T49** `_template/` locale directory with README for adding new languages

**Calendar & Deadline Engine (Phase 0 — skill-driven, always on the clock)**
- [ ] **P0-T50** Calendar engine: `ab_calendar_events` table, CalendarProvider tool interface
- [ ] **P0-T51** Jurisdiction pack calendar providers: US tax deadlines tool, CA tax deadlines tool
- [ ] **P0-T52** Calendar event lifecycle: upcoming -> alerted -> acted_on/missed/snoozed
- [ ] **P0-T53** Proactive engine calendar integration: query calendar hourly, fire alerts at lead times
- [ ] **P0-T54** Market calendar skill: bank holidays (US Fed Reserve + CA Bank of Canada), sync from public APIs

**Proactive Engagement Engine (Phase 0 — core architecture, not a bolt-on)**
- [ ] **P0-T34** Proactive engine: scheduler (cron per tenant, timezone-aware) + event watcher (Kafka consumer)
- [ ] **P0-T35** Daily pulse message: "Today: $X in, $Y out. Cash balance: $Z. N items need attention."
- [ ] **P0-T36** Receipt reminder: "You have N bank transactions this week without receipts. Snap them now?"
- [ ] **P0-T37** Expense confirmation follow-up: if user doesn't confirm a pending expense within 24h, nudge
- [ ] **P0-T38** Priority ranker: urgent > actionable > informational, with quiet hours (8am-9pm tenant TZ)
- [ ] **P0-T39** Engagement tracking table (`ab_engagement_log`) + feedback loop for notification relevance
- [ ] **P0-T40** One-tap action buttons on every proactive message (no typing required to respond)
- [ ] **P0-T41** Snooze/dismiss: [Remind me tomorrow] [Don't remind me about this] on all proactive messages

**Deployment & Infrastructure (Phase 0 — works locally AND on Vercel from day one)**
- [ ] **P0-T55** Add AgentBook schemas to Prisma datasource block and `docker/init-schemas.sql`
- [ ] **P0-T56** AgentBook Prisma models with `@@schema("plugin_agentbook_*")` decorators
- [ ] **P0-T57** Dual-mode event bus: Kafka (local) / DB table + polling (Vercel), same `emitEvent()` interface
- [ ] **P0-T58** Telegram webhook API route: `/api/v1/agentbook/telegram/webhook` (serverless-compatible)
- [ ] **P0-T59** Vercel cron route: `/api/v1/agentbook/cron/daily-pulse` + vercel.json cron config
- [ ] **P0-T60** Vercel cron route: `/api/v1/agentbook/cron/calendar-check` (hourly)
- [ ] **P0-T61** AgentBook API routes under `apps/web-next/src/app/api/v1/agentbook/` (serverless handlers)
- [ ] **P0-T62** Receipt storage abstraction: Vercel Blob (production) / local filesystem (dev), same interface
- [ ] **P0-T63** Update `apps/web-next/src/lib/plugin-ports.ts` with AgentBook plugin ports
- [ ] **P0-T64** Verify `prisma db push` works on both local Docker and Neon (Vercel Postgres)
- [ ] **P0-T65** Update `vercel.json` with AgentBook cron jobs and function timeouts

**End-to-End Flows**
- [ ] **P0-T29** E2E US text: user types "I spent $20 on coffee" in Telegram -> expense + journal entry in USD
- [ ] **P0-T30** E2E CA text: user types "I spent $20 on coffee" in Telegram -> expense + journal entry in CAD
- [ ] **P0-T31** E2E US photo: user sends receipt photo in Telegram -> OCR -> auto-categorize -> confirm -> journal entry in USD
- [ ] **P0-T32** E2E CA photo: user sends receipt photo in Telegram -> OCR -> auto-categorize -> confirm -> journal entry in CAD
- [ ] **P0-T33** E2E web upload: user drags receipt onto web dashboard -> same OCR flow -> expense created

### Telegram Bot UX Flows (Phase 0)

**Flow 1: Text expense**
```
User: "Spent $45 on lunch with client"
Agent: 📝 Got it!
       $45.00 — Meals & Entertainment
       📅 Today
       [✅ Correct] [📁 Change category] [✏️ Edit] [🏠 Personal]
User: [taps ✅ Correct]
Agent: ✅ Recorded. Journal entry posted.
```

**Flow 2: Receipt photo (the hero flow)**
```
User: [sends photo of restaurant receipt]
Agent: 🧾 Reading your receipt...
       $67.50 — The Keg Steakhouse
       📅 Mar 22, 2026
       Subtotal: $58.26 | Tax: $7.57 | Tip: $1.67
       Category: Meals & Entertainment
       [✅ Correct] [📁 Change category] [✏️ Edit] [🏠 Personal]
User: [taps ✅ Correct]
Agent: ✅ Recorded. Receipt saved. Journal entry posted.
```

**Flow 3: Low confidence**
```
User: [sends blurry receipt photo]
Agent: 🧾 I read this receipt but I'm not very confident:
       $347.00 — AMZN MKTP
       I'm 62% sure this is Office Supplies. Could also be:
       • Software & Subscriptions (25%)
       • Personal (13%)
       [🗂 Office Supplies] [💻 Software] [🏠 Personal] [✏️ Enter manually]
```

**Flow 4: Forwarded email receipt**
```
User: [forwards Amazon order confirmation email]
Agent: 📧 Found your Amazon order:
       $89.50 — Amazon.com
       Order #123-456-789
       Items: USB-C Hub ($39.50), Webcam ($50.00)
       Category: Office Supplies
       [✅ Correct] [📁 Change] [✂️ Split items]
```

### Testing Tasks
- [ ] **P0-TEST-01** Unit tests: constraint engine (balance invariant pass/fail/edge), tool schema validation
- [ ] **P0-TEST-02** Unit tests: skill registry (load, validate, register, reject malformed)
- [ ] **P0-TEST-03** Unit tests: jurisdiction pack loader (US pack loads, CA pack loads, unknown jurisdiction rejected)
- [ ] **P0-TEST-04** Unit tests: US ChartOfAccountsTemplate produces Schedule C-aligned accounts
- [ ] **P0-TEST-05** Unit tests: CA ChartOfAccountsTemplate produces T2125-aligned accounts
- [ ] **P0-TEST-06** Integration test: US tenant text expense via Telegram -> journal entry in USD -> event emitted
- [ ] **P0-TEST-07** Integration test: CA tenant text expense via Telegram -> journal entry in CAD -> event emitted
- [ ] **P0-TEST-08** Integration test: receipt photo via Telegram -> OCR -> expense with correct amount/vendor/date
- [ ] **P0-TEST-09** Integration test: forwarded PDF receipt via Telegram -> parsed -> expense created
- [ ] **P0-TEST-10** Integration test: web dashboard drag-and-drop upload -> OCR -> expense created
- [ ] **P0-TEST-11** OCR accuracy: benchmark against 30+ receipt images (target: 85% field extraction for Phase 0, 90%+ in Phase 1)
- [ ] **P0-TEST-12** Accounting test: trial balance sums to zero after 100 random transactions (both US and CA tenants)
- [ ] **P0-TEST-13** Tenant isolation test: US tenant and CA tenant data completely isolated
- [ ] **P0-TEST-14** Debit/credit rules verified for every account type (per SKILL.md)
- [ ] **P0-TEST-15** Jurisdiction pack interface compliance: all 9 interfaces implemented for US and CA packs
- [ ] **P0-TEST-16** Telegram bot: responds to text, photo, document, and callback_query message types
- [ ] **P0-TEST-17** Receipt storage: images stored in tenant-isolated S3 paths, retrievable, linked to expense
- [ ] **P0-TEST-18** Confidence gating: low-confidence OCR results DO trigger confirmation, high-confidence DON'T
- [ ] **P0-TEST-19** Proactive engine: daily pulse message fires at correct tenant timezone
- [ ] **P0-TEST-20** Proactive engine: receipt reminder fires when unmatched bank transactions exist
- [ ] **P0-TEST-21** Proactive engine: quiet hours respected (no messages outside 8am-9pm tenant TZ)
- [ ] **P0-TEST-22** Proactive engine: engagement tracking logs sent/opened/acted_on correctly
- [ ] **P0-TEST-23** Proactive engine: snooze delays next reminder by configured interval
- [ ] **P0-TEST-24** i18n: all Telegram messages render correctly in `en` and `fr` locales
- [ ] **P0-TEST-25** i18n: `formatCurrency(4500, 'fr-CA')` produces "45,00 $", `en-US` produces "$45.00"
- [ ] **P0-TEST-26** i18n: `formatDate()` produces locale-correct format (en: "Mar 22, 2026", fr: "22 mars 2026")
- [ ] **P0-TEST-27** i18n: TypeScript build fails if a translation key is referenced but doesn't exist in `en`
- [ ] **P0-TEST-28** i18n: adding a mock `es/` locale works without code changes — runtime discovers it
- [ ] **P0-TEST-29** Calendar: US jurisdiction skill seeds correct tax deadlines for 2025/2026
- [ ] **P0-TEST-30** Calendar: CA jurisdiction skill seeds correct tax deadlines including RRSP
- [ ] **P0-TEST-31** Calendar: proactive engine fires alert at correct lead times (7d, 3d, day-of)
- [ ] **P0-TEST-32** Calendar: event titles use i18n keys, render correctly in `en` and `fr`
- [ ] **P0-TEST-33** Deployment: `prisma db push` succeeds on local Docker PostgreSQL with all 7 schemas
- [ ] **P0-TEST-34** Deployment: `prisma db push` succeeds on Neon (Vercel Postgres) with pooled + unpooled URLs
- [ ] **P0-TEST-35** Deployment: Telegram webhook route processes text and photo messages in serverless
- [ ] **P0-TEST-36** Deployment: Vercel cron daily-pulse route executes and sends Telegram messages
- [ ] **P0-TEST-37** Deployment: event bus dual-mode — same test passes with Kafka backend and DB backend
- [ ] **P0-TEST-38** Deployment: `vercel build` completes successfully with AgentBook plugins included
- [ ] **P0-TEST-39** Deployment: receipt upload works with both local filesystem and Vercel Blob

### Quality Gates
- [ ] **P0-QG-01** Code review using `/code-review` plugin on all PRs
- [ ] **P0-QG-02** No TODOs, dead code, or placeholder implementations in merged code
- [ ] **P0-QG-03** All UI components designed with `frontend-design` skill, compliant with A3P UI guidelines
- [ ] **P0-QG-04** Architecture compliance check: verify against architecture.md checklist (Section 7)
- [ ] **P0-QG-05** SKILL.md compliance: all tools follow Tool pattern, all constraints are declarative
- [ ] **P0-QG-06** Telegram bot UX review: all 4 flows (text, photo, low-confidence, forwarded email) tested manually

### Verification Checklist
- [ ] 10 expenses recorded in 5 minutes via Telegram (mix of text and photos, both US and CA tenant)
- [ ] Receipt photo -> categorized expense in < 10 seconds (the hero metric)
- [ ] Every expense creates a balanced journal entry (verified by DB constraint)
- [ ] Receipt images stored and linked, viewable from web dashboard
- [ ] Low-confidence OCR triggers confirmation flow, high-confidence auto-records
- [ ] US tenant gets Schedule C-aligned chart of accounts in USD
- [ ] CA tenant gets T2125-aligned chart of accounts in CAD
- [ ] Events appear in Kafka topic
- [ ] Skill hot-reload: update expense-recording skill -> changes take effect without restart
- [ ] Adding a mock "test-country" jurisdiction pack works without any framework/plugin changes
- [ ] Second tenant data is completely isolated
- [ ] Test coverage >= 85% for all new code
- [ ] Daily pulse message delivered at 8am tenant timezone with correct numbers
- [ ] Receipt reminder fires when bank transactions lack receipts
- [ ] Proactive messages have one-tap action buttons (no typing needed)
- [ ] Snooze works: snoozed reminders come back at the right time
- [ ] All user-facing strings come from i18n — zero hardcoded English in business logic
- [ ] French Canadian user sees all Telegram messages and buttons in French
- [ ] Currency/date/number formatting correct for en-US, en-CA, fr-CA
- [ ] Calendar auto-populated with jurisdiction tax deadlines on tenant onboarding
- [ ] Calendar deadline alert fires 7 days before Q2 estimated tax (US) / installment (CA)
- [ ] Zero lint errors, zero type errors

### Phase 0 Assessment (100 points)

| Category | Max Points | Criteria |
|----------|-----------|----------|
| **Feature Completeness vs QB/Wave** | 10 | Expense entry (text + photo + document) works E2E; receipt OCR exceeds both |
| **Architecture Compliance** | 10 | Agent-guardrail separation, verify-then-commit, event sourcing, plugin-per-domain, skill decoupling |
| **Multi-Jurisdiction** | 10 | US + CA packs load correctly, interfaces validated, adding new country requires zero framework changes |
| **Code Quality** | 15 | No dead code/TODOs, code review passed, test coverage >= 85%, SKILL.md patterns followed |
| **Agent Design** | 15 | Framework/skill decoupled, skill manifest validated, constraint engine is code not prompts |
| **Proactive Engagement** | 20 | Daily pulse works, receipt reminders fire, engagement tracking logs, quiet hours respected, snooze works |
| **UX Quality (Telegram + Web)** | 20 | Receipt photo flow < 10s, inline keyboard confirmations, confidence gating, one-tap proactive actions |

**Pass threshold: 80/100. If below 80, identify gaps and create remediation tasks before proceeding.**

---

## Phase 1: Core Bookkeeping (4 weeks)

**Goal:** Full expense tracking with OCR, invoicing, and basic reporting. Feature parity with Wave free tier for expense and invoice basics.

### Week 1-2: Expense System (build on Phase 0 OCR + Telegram foundation)
- [ ] **P1-T01** Enhance receipt OCR skill: multi-receipt batch processing, handwritten receipt support, foreign currency detection
- [ ] **P1-T02** Expense categorization refinement: improve accuracy to 90%+ using few-shot examples and vendor history
- [ ] **P1-T03** Category confirmation flow in web dashboard (inline buttons) — use `frontend-design` skill
- [ ] **P1-T04** Business vs personal expense separation (per requirements-v2 US-1.2)
- [ ] **P1-T05** Vendor memory and pattern learning (per architecture.md Section 3.5)
- [ ] **P1-T06** Recurring expense detection skill (per requirements-v2 US-1.3)
- [ ] **P1-T07** Custom expense categories (defaults from jurisdiction pack: Schedule C for US, T2125 for CA)

### Week 3: Invoicing
- [ ] **P1-T08** Skill: `invoice-creation` — natural language -> structured invoice -> PDF
- [ ] **P1-T09** PDF generation with professional templates (3 designs per requirements-v2 US-2.1)
- [ ] **P1-T10** Invoice email sending (SendGrid/SES)
- [ ] **P1-T11** Manual payment recording with journal entry
- [ ] **P1-T12** AR tracking and aging report
- [ ] **P1-T13** Client management (per requirements-v2 US-2.6)
- [ ] **P1-T14** Estimates/quotes (per requirements-v2 US-2.2)

### Proactive Engagement (Phase 1 additions)
- [ ] **P1-T21** Proactive invoice follow-up: "Acme is 7 days overdue on $5,000. Send reminder? [Send] [Wait] [Skip]"
- [ ] **P1-T22** Proactive recurring anomaly: "Figma charged $59.99 instead of $49.99. Price increase? [Accept] [Investigate]"
- [ ] **P1-T23** Proactive weekly financial review: "This week: $4,200 revenue, $1,340 expenses. Top spend: Software. Tax rate: 28.3%."
- [ ] **P1-T24** Proactive missing receipt nudge: after bank sync, "5 transactions this week have no receipts. [Upload now] [Remind me later]"
- [ ] **P1-T25** Proactive payment received celebration: "Acme paid $5,000! Your AR is now $2,300. Nice."
- [ ] **P1-T26** Engagement feedback loop: adjust notification frequency based on user action patterns

### Week 4: Reporting & Quality
- [ ] **P1-T15** Skill: `report-generation` — P&L, trial balance
- [ ] **P1-T16** Cash position calculation
- [ ] **P1-T17** Basic tax estimate skill — delegates to jurisdiction pack (US: federal + SE + state; CA: federal + provincial + CPP/EI)
- [ ] **P1-T18** Verification pass (independent re-check per architecture.md Section 3.2)
- [ ] **P1-T19** Saga pattern for multi-step operations (per architecture.md Executor)
- [ ] **P1-T20** Web dashboard: expense list, invoice list, P&L view — use `frontend-design` skill

### Testing Tasks
- [ ] **P1-TEST-01** OCR accuracy improvement: benchmark against 100+ receipt images including edge cases (target: 92%+ field extraction, up from Phase 0's 85%)
- [ ] **P1-TEST-02** Categorization accuracy: benchmark against 200+ labeled expenses (per SKILL.md)
- [ ] **P1-TEST-03** Intent parsing accuracy: benchmark against 100+ diverse messages (per SKILL.md)
- [ ] **P1-TEST-04** Invoice lifecycle: create -> send -> payment -> reconciliation
- [ ] **P1-TEST-05** P&L accuracy: verify against hand-calculated P&L for 5 test scenarios
- [ ] **P1-TEST-06** Saga rollback: failed multi-step operations roll back cleanly with compensation
- [ ] **P1-TEST-07** Verification pass: adversarial test — feed incorrect entries, verify they are caught
- [ ] **P1-TEST-08** Escalation appropriateness: low-confidence DO escalate, high-confidence DON'T
- [ ] **P1-TEST-09** Pattern learning: after 30 vendor transactions, auto-categorization accuracy > 85%
- [ ] **P1-TEST-10** Recurring detection: correctly identifies 3+ similar expenses as recurring

### Quality Gates
- [ ] **P1-QG-01** Code review via `/code-review` on every PR
- [ ] **P1-QG-02** Zero TODOs, dead code, or stub implementations in merged code
- [ ] **P1-QG-03** All UI designed with `frontend-design` skill, A3P UI guidelines enforced
- [ ] **P1-QG-04** Architecture compliance: verify-then-commit pattern implemented for all write paths
- [ ] **P1-QG-05** SKILL.md compliance: all prompt templates versioned, all tools have compensation actions
- [ ] **P1-QG-06** Production readiness: all services have health checks, graceful shutdown, error handling

### Verification Checklist
- [ ] Receipt photo -> categorized expense in < 10 seconds
- [ ] Invoice created and sent in a single action
- [ ] P&L report matches hand-calculated values for test data
- [ ] All journal entries balanced (0 exceptions in full test suite)
- [ ] Failed multi-step operations roll back cleanly
- [ ] New skills can be added without modifying framework code
- [ ] Test coverage >= 85%

### Phase 1 Assessment (100 points)

| Category | Max Points | Criteria |
|----------|-----------|----------|
| **Feature Completeness vs QB/Wave** | 20 | Expense tracking with OCR matches Wave; invoicing matches QB basics; P&L available |
| **Architecture Compliance** | 15 | Verify-then-commit on all writes, constraint engine, event sourcing, LLM via service-gateway |
| **Code Quality** | 15 | Code review passed, >= 85% coverage, no dead code, SKILL.md patterns |
| **Agent Design** | 15 | Skills decoupled, prompt versions tracked, confidence scoring calibrated, pattern learning |
| **Proactive Engagement** | 20 | Invoice follow-up, recurring anomaly, weekly review, payment celebration all work |
| **UI/UX Quality** | 15 | Dashboard A3P compliant, professional invoice PDFs, one-tap proactive actions |

**Pass threshold: 80/100.**

---

## Phase 2: Integrations & Tax (4 weeks)

**Goal:** Connect to real financial services. Add tax planning. Match QB Solopreneur on tax features, exceed Wave.

### Implementation Tasks
- [ ] **P2-T01** Stripe integration skill: OAuth, webhooks, payment matching, fee tracking
- [ ] **P2-T02** Plaid bank connection skill: Link, daily sync, auto-matching
- [ ] **P2-T03** Reconciliation engine: bank transactions <-> recorded expenses (per requirements-v2 US-4.2)
- [ ] **P2-T04** Tax estimation skill: delegates to jurisdiction pack (US: federal + SE + state; CA: federal + provincial + CPP/EI)
- [ ] **P2-T05** Quarterly installment skill: delegates to jurisdiction pack (US: estimated tax Apr/Jun/Sep/Jan; CA: installments Mar/Jun/Sep/Dec)
- [ ] **P2-T06** Tax deduction gap analysis skill: delegates to jurisdiction pack's `DeductionRuleSet`
- [ ] **P2-T12** Sales tax skill: delegates to `SalesTaxEngine` (US: state/county; CA: GST/HST/PST by province)
- [ ] **P2-T07** Full constraint enforcement across all tool calls
- [ ] **P2-T08** Anomaly detection (statistical, per-category, per architecture.md)
- [ ] **P2-T09** Human escalation flow with timeout/reminder logic
- [ ] **P2-T10** Web dashboard: bank connection, tax dashboard — use `frontend-design` skill
- [ ] **P2-T11** Payment follow-up automation skill (per requirements-v2 US-2.5)
- [ ] **P2-T13** Proactive tax deadline reminders: 7 and 3 days before each quarterly deadline (jurisdiction-aware)
- [ ] **P2-T14** Proactive deduction hunting: "You haven't logged home office expenses. Work from home? Save ~$1,500."
- [ ] **P2-T15** Proactive tax bracket alert: "You're $3,000 from the next bracket. Prepay expenses to save $660."
- [ ] **P2-T16** Proactive bank anomaly: "Unusual $847 charge at Best Buy. Office supplies? [Yes] [No] [Split]"
- [ ] **P2-T17** Proactive reconciliation nudge: "3 bank transactions don't match any recorded expenses. Review? [Show them]"

### Testing Tasks
- [ ] **P2-TEST-01** Stripe webhook handling: payment, refund, dispute, payout — all generate correct journal entries
- [ ] **P2-TEST-02** Plaid sync: daily transactions match, 80%+ auto-match on first attempt
- [ ] **P2-TEST-03** US tax estimate within 5% of manual calculation for 5 test scenarios
- [ ] **P2-TEST-04** CA tax estimate within 5% of manual calculation for 5 test scenarios (federal + provincial + CPP/EI)
- [ ] **P2-TEST-05** US quarterly estimate: annualized income vs safe harbor comparison correct
- [ ] **P2-TEST-06B** CA quarterly installments: correct deadlines and amounts
- [ ] **P2-TEST-05B** US deduction gap analysis: correctly identifies 5 common missed deductions (home office, Section 179, etc.)
- [ ] **P2-TEST-05C** CA deduction gap analysis: correctly identifies business-use-of-home, CCA classes
- [ ] **P2-TEST-09** Sales tax: US state tax calculated correctly; CA GST/HST/PST calculated correctly per province
- [ ] **P2-TEST-06** Audit trail: reconstruct books from event log matches direct DB query
- [ ] **P2-TEST-07** Escalation flow: user receives request, taps button, agent proceeds correctly
- [ ] **P2-TEST-08** Anomaly detection: flags amounts > 2 sigma for category

### Quality Gates
- [ ] **P2-QG-01** Code review via `/code-review` on every PR
- [ ] **P2-QG-02** No secrets in code (Plaid/Stripe keys in vault per architecture.md Section 6)
- [ ] **P2-QG-03** All webhook handlers are idempotent (per SKILL.md)
- [ ] **P2-QG-04** Production readiness: graceful degradation when Plaid/Stripe/LLM provider down
- [ ] **P2-QG-05** Skills for Stripe/Plaid are fully decoupled — can be disabled without affecting core

### Verification Checklist
- [ ] Stripe payments auto-record with correct categorization and fee tracking
- [ ] Bank transactions sync daily, 80%+ auto-match
- [ ] Tax estimate within 5% of manual calculation
- [ ] Audit trail test passes: event log reconstruction matches DB
- [ ] Escalation timeout and reminder logic works end-to-end
- [ ] Test coverage >= 85%

### Phase 2 Assessment (100 points)

| Category | Max Points | Criteria |
|----------|-----------|----------|
| **Feature Completeness vs QB/Wave** | 20 | Bank + tax exceeds both; Stripe payments; sales tax US + CA |
| **Architecture Compliance** | 15 | Event sourcing, audit trail, security, LLM via service-gateway, graceful degradation |
| **Code Quality** | 15 | Idempotent webhooks, no secrets in code, >= 85% coverage |
| **Agent Design** | 15 | Tax/bank skills independently deployable, anomaly detection statistical |
| **Proactive Engagement** | 20 | Tax deadline alerts, deduction hunting, bank anomaly alerts, reconciliation nudges all work |
| **UI/UX Quality** | 15 | Bank connection polished, tax dashboard clear, one-tap proactive actions |

**Pass threshold: 80/100.**

---

## Phase 3: Intelligence & Dashboard (4 weeks)

**Goal:** Agent gets smarter over time. Full web dashboard. Exceed both QB and Wave on proactive intelligence.

### Implementation Tasks
- [ ] **P3-T01** Pattern learning skill: vendor categorization auto-confidence, drift detection
- [ ] **P3-T02** Client payment pattern skill: predict payment arrival
- [ ] **P3-T03** Cash flow projection skill: 30/60/90 days (per requirements-v2 US-6.1)
- [ ] **P3-T04** Earnings projection skill: annual revenue with confidence bands (per requirements-v2 US-6.2)
- [ ] **P3-T05** Expense analytics skill: category breakdown, trend analysis, anomaly detection (per requirements-v2 US-6.3)
- [ ] **P3-T06** "What if" scenario support (per requirements-v2 US-6.2)
- [ ] **P3-T07** Full web dashboard: financial overview, transactions, reports, analytics — use `frontend-design` skill
- [ ] **P3-T08** Dashboard: interactive P&L, balance sheet, cash flow with drill-down
- [ ] **P3-T09** Dashboard: expense analytics charts (category breakdown, vendor analysis, trends)
- [ ] **P3-T10** Dashboard: tax dashboard (estimate, quarterly payments, deduction tracking)
- [ ] **P3-T11** Proactive cash flow warning: "Cash drops to $1,200 on April 3. $3,800 bills vs $2,600 income. Follow up on Acme?"
- [ ] **P3-T12** Proactive spending trend alert: "Software subscriptions up 40% vs last quarter — 3 new services totaling $127/mo"
- [ ] **P3-T13** Proactive earnings milestone: "You've hit $100K revenue this year! At this pace, annual projection: $142K."
- [ ] **P3-T14** Proactive client payment prediction: "Based on pattern, Acme will likely pay next Tuesday. WidgetCo usually delays — consider a nudge."
- [ ] **P3-T15** Monthly financial health report (auto-generated, delivered via Telegram as PDF + summary)
- [ ] **P3-T16** Engagement-driven frequency tuning: notifications the user acts on get boosted, ignored ones get demoted

### Testing Tasks
- [ ] **P3-TEST-01** After 30 days simulated use, auto-categorization accuracy > 90%
- [ ] **P3-TEST-02** Cash flow projection within 15% of actual for test scenarios
- [ ] **P3-TEST-03** Pattern drift detection: alert fires when learned pattern accuracy drops below 85%
- [ ] **P3-TEST-04** Dashboard loads in < 2 seconds with 1 year of data (10,000 transactions)
- [ ] **P3-TEST-05** All dashboard data matches API query results exactly
- [ ] **P3-TEST-06** "What if" scenarios produce mathematically correct projections

### Quality Gates
- [ ] **P3-QG-01** Code review via `/code-review`
- [ ] **P3-QG-02** All dashboard components designed with `frontend-design`, A3P UI compliant
- [ ] **P3-QG-03** Dashboard is responsive (desktop + tablet per requirements-v2 US-7.2)
- [ ] **P3-QG-04** No dead code, production ready, performance budgets met (per SKILL.md)

### Phase 3 Assessment (100 points)

| Category | Max Points | Criteria |
|----------|-----------|----------|
| **Feature Completeness vs QB/Wave** | 20 | Pattern learning + cash flow projection + dashboard exceed both competitors |
| **Architecture Compliance** | 10 | Pattern memory per architecture.md, event-driven learning, cache warming |
| **Code Quality** | 15 | Performance budgets met, responsive dashboard, >= 85% coverage |
| **Agent Design** | 15 | Learning skills improve autonomously, scenario modeling correct |
| **Proactive Engagement** | 25 | Cash flow warnings, spending trends, client payment predictions, monthly health report, engagement-driven tuning |
| **UI/UX Quality** | 15 | Dashboard production-grade, charts interactive, proactive insights surfaced in dashboard |

**Pass threshold: 80/100.**

---

## Phase 4: Tax Filing & Advanced Features (4 weeks)

**Goal:** Close the loop on tax season. Multi-user access. Exceed QB Solopreneur on tax preparation.

### Implementation Tasks
- [ ] **P4-T01** US tax form generation: Schedule C, Schedule SE (via US jurisdiction pack's `TaxFormGenerator`)
- [ ] **P4-T02** CA tax form generation: T2125, CPP/EI calculation (via CA jurisdiction pack's `TaxFormGenerator`)
- [ ] **P4-T03** US contractor reporting: 1099-NEC tracking and generation ($600 threshold)
- [ ] **P4-T03B** CA contractor reporting: T4A tracking and generation ($500 threshold)
- [ ] **P4-T04** Tax package export: PDF + jurisdiction-specific machine-readable formats (US: TXF; CA: EFILE-ready CSV)
- [ ] **P4-T05** CPA collaboration: read-only link, notes (per requirements-v2 US-8.1)
- [ ] **P4-T06** Mileage tracking skill — rate from jurisdiction pack's `MileageRateProvider` (US: $/mile; CA: $/km tiered)
- [ ] **P4-T07** Home office deduction skill — delegates to jurisdiction pack's `DeductionRuleSet` (US: simplified/regular; CA: business-use-of-home)
- [ ] **P4-T08** Depreciation/capital cost skill — delegates to jurisdiction pack (US: Section 179; CA: CCA classes)
- [ ] **P4-T09** Multi-user access with roles (per requirements-v2 US-8.2)
- [ ] **P4-T10** Guided onboarding flow (per requirements-v2 US-10.1)
- [ ] **P4-T11** Data export/import: CSV, QBO, migration tools (per requirements-v2 US-9.4)
- [ ] **P4-T12** Year-end closing skill (per requirements-v2 US-5.5)
- [ ] **P4-T13** Proactive year-end planning (November): "4 actions could save $2,840. [View optimization report]"
- [ ] **P4-T14** Proactive 1099/T4A threshold warning: "You've paid Alex $550. Next payment triggers reporting."
- [ ] **P4-T15** Proactive year-end closing checklist: "Ready to close 2026? 2 items need attention first."

### Testing Tasks
- [ ] **P4-TEST-01** US: Schedule C matches hand-prepared for 5 test scenarios
- [ ] **P4-TEST-01B** CA: T2125 matches hand-prepared for 5 test scenarios
- [ ] **P4-TEST-02** US: 1099 threshold alert fires at $550/$600; CA: T4A threshold at $500
- [ ] **P4-TEST-03** Multi-user role isolation: bookkeeper cannot see reports
- [ ] **P4-TEST-04** Data export round-trip: export -> import into fresh instance -> identical state
- [ ] **P4-TEST-05** Year-end close: locks period, carry-forward balances correct
- [ ] **P4-TEST-06** Onboarding completes in < 10 minutes

### Quality Gates
- [ ] **P4-QG-01** Code review via `/code-review`
- [ ] **P4-QG-02** Tax calculations unit-tested against published IRS examples (per SKILL.md)
- [ ] **P4-QG-03** All new UI designed with `frontend-design`, A3P compliant
- [ ] **P4-QG-04** Production readiness: all features fully functional, no stubs

### Phase 4 Assessment (100 points)

| Category | Max Points | Criteria |
|----------|-----------|----------|
| **Feature Completeness vs QB/Wave** | 20 | Tax filing exceeds both; multi-user; CPA portal; data portability |
| **Architecture Compliance** | 10 | RBAC, data export/import clean, year-end closing uses period gate |
| **Code Quality** | 15 | Tax math tested against IRS/CRA, role isolation tested, >= 85% coverage |
| **Agent Design** | 15 | Tax skills independently updatable, onboarding is a skill |
| **Proactive Engagement** | 25 | Year-end optimization report, 1099/T4A threshold warnings, closing checklist — all agent-initiated |
| **UI/UX Quality** | 15 | CPA portal polished, onboarding intuitive, tax package PDF professional |

**Pass threshold: 80/100.**

---

## Phase 5: Scale & Marketplace (ongoing)

**Goal:** Multi-tenant production deployment. Plugin marketplace for third-party domain skills.

### Implementation Tasks
- [ ] **P5-T01** Production deployment on A3P infrastructure
- [ ] **P5-T02** Horizontal scaling: multiple orchestrator instances
- [ ] **P5-T03** Skill marketplace: third-party skills and jurisdiction packs can be published via plugin-publisher
- [ ] **P5-T04** Usage-based billing: per-transaction and per-LLM-call metering
- [ ] **P5-T05** SOC 2 compliance preparation (per requirements-v2 NFR-1)
- [ ] **P5-T06** Full multi-currency support (cross-currency transactions, exchange rate service)
- [ ] **P5-T07** UK jurisdiction pack (Self Assessment, VAT, PAYE, Making Tax Digital)
- [ ] **P5-T08** EU jurisdiction pack starter (Germany/France — EU VAT, local income tax)
- [ ] **P5-T09** Australia jurisdiction pack (BAS, GST, PAYG installments)
- [ ] **P5-T10** Community-contributed jurisdiction packs via marketplace

---

## Deployment Architecture (Local Dev + Vercel + Serverless DB)

### Design Principle
AgentBook follows the same deployment model as the rest of A3P: **Next.js on Vercel for the frontend and API routes, Docker for local dev infrastructure, Vercel Postgres (Neon) for the serverless database.** All AgentBook plugin logic runs as **Next.js API routes (serverless functions)** on Vercel — there are no separate backend processes to host in production.

### Database: Prisma Multi-Schema, Single DB

AgentBook adds 4 new schemas to the existing A3P unified Prisma schema. All schemas share a single PostgreSQL database — no separate databases to manage.

**Updated `packages/database/prisma/schema.prisma` datasource:**
```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")          // Pooled (PgBouncer) for queries
  directUrl = env("DATABASE_URL_UNPOOLED") // Direct for migrations
  schemas   = [
    "public",                    // Core A3P platform
    "plugin_community",          // Community Hub
    "plugin_service_gateway",    // Service Gateway
    // AgentBook schemas (new)
    "plugin_agentbook_core",     // Ledger, chart of accounts, tenant config
    "plugin_agentbook_expense",  // Expenses, vendors, patterns, receipts
    "plugin_agentbook_invoice",  // Invoices, clients, payments, estimates
    "plugin_agentbook_tax",      // Tax estimates, quarterly payments, deductions, sales tax
  ]
}
```

**Updated `docker/init-schemas.sql`:**
```sql
-- Existing
CREATE SCHEMA IF NOT EXISTS plugin_community;
CREATE SCHEMA IF NOT EXISTS plugin_service_gateway;
-- AgentBook (new)
CREATE SCHEMA IF NOT EXISTS plugin_agentbook_core;
CREATE SCHEMA IF NOT EXISTS plugin_agentbook_expense;
CREATE SCHEMA IF NOT EXISTS plugin_agentbook_invoice;
CREATE SCHEMA IF NOT EXISTS plugin_agentbook_tax;
```

**Key constraints:**
- All models use `@@schema("plugin_agentbook_*")` — Prisma multiSchema preview feature (already enabled in A3P)
- Amounts stored as `Int` (cents) — Prisma `Int` maps to PostgreSQL `INTEGER`, no float issues
- Balance CHECK constraint: `CREATE CONSTRAINT ... CHECK (debit_total = credit_total)` via Prisma raw SQL migration
- Cross-schema relations: AgentBook models can reference `public.User` via userId (same DB, same Prisma client)
- `DATABASE_URL` with `?pgbouncer=true&connection_limit=10` for Vercel serverless connection pooling
- `DATABASE_URL_UNPOOLED` for `prisma db push` and `prisma migrate deploy` (Neon requirement)

### Local Development (Docker + Node.js)

```
docker-compose up -d                    # PostgreSQL 16 + Kafka
./bin/start.sh                          # Starts all services:
  ├── Next.js shell (port 3000)
  ├── base-svc (port 4000)
  ├── plugin-server (port 3100)
  ├── Plugin frontends (Vite HMR: 3005, 3006, ...)
  ├── Plugin backends (Express: 4005, 4006, ...)
  ├── AgentBook backends (Express: 4050-4053)
  ├── Telegram bot (webhook via ngrok/localtunnel for dev)
  └── Proactive engine (local cron scheduler)
```

**AgentBook plugin ports (added to plugin.json manifests):**

| Plugin | Frontend devPort | Backend devPort |
|--------|-----------------|----------------|
| agentbook-core | 3050 | 4050 |
| agentbook-expense | 3051 | 4051 |
| agentbook-invoice | 3052 | 4052 |
| agentbook-tax | 3053 | 4053 |

**Local database:** Docker PostgreSQL at `postgresql://postgres:postgres@localhost:5432/naap`
- `prisma db push` creates all schemas and tables
- `init-schemas.sql` creates schemas on first container start
- All 7 schemas (3 existing + 4 AgentBook) in one database

**Kafka (local only):** Used for event bus (`agentbooks.execution_events`). Proactive engine, audit log, pattern learning all consume from Kafka topics locally.

### Vercel Deployment (Production/Preview)

On Vercel, AgentBook has **no separate backend processes**. Everything runs as Next.js API routes (serverless functions).

**How each component maps to Vercel:**

| Component | Local Dev | Vercel Production |
|-----------|-----------|------------------|
| **AgentBook API routes** | Express on ports 4050-4053 | Next.js API routes at `/api/v1/agentbook/*` |
| **Agent framework** | Imported as library by API routes | Same — imported as library, runs in serverless function |
| **Constraint engine** | Same | Same — pure TypeScript, no dependencies |
| **Skill registry** | File-based discovery from `skills/` | Bundled at build time, same skill manifests |
| **Database** | Docker PostgreSQL | Vercel Postgres (Neon) with PgBouncer pooling |
| **Telegram bot** | Webhook via ngrok | Webhook API route: `/api/v1/agentbook/telegram/webhook` |
| **Proactive engine (scheduler)** | Local cron process | **Vercel Cron Jobs** (vercel.json `crons` config) |
| **Proactive engine (events)** | Kafka consumer | **Database polling** + Vercel cron (no Kafka on Vercel) |
| **Receipt storage** | Local S3/MinIO | Vercel Blob Storage (BLOB_READ_WRITE_TOKEN) |
| **Event bus** | Kafka | Database-backed event table (append-only) with polling |
| **LLM calls** | Via service-gateway API | Same — service-gateway has its own Vercel API routes |
| **Calendar engine** | Hourly cron | Vercel cron: `/api/v1/agentbook/cron/calendar-check` |
| **i18n** | Same | Same — JSON files bundled at build time |

**Vercel-specific API routes (added to `apps/web-next/src/app/api/v1/agentbook/`):**
```
api/v1/agentbook/
  ├── telegram/
  │   └── webhook/route.ts       # Telegram bot webhook (receives all messages)
  ├── cron/
  │   ├── daily-pulse/route.ts   # Vercel cron: daily pulse for all tenants
  │   ├── calendar-check/route.ts # Vercel cron: check deadlines, fire alerts
  │   ├── weekly-review/route.ts  # Vercel cron: weekly financial summary
  │   └── bank-sync/route.ts     # Vercel cron: Plaid daily sync trigger
  ├── expense/
  │   ├── record/route.ts         # Record expense (text/photo/document)
  │   ├── categorize/route.ts     # Re-categorize expense
  │   └── [...path]/route.ts      # CRUD catch-all
  ├── invoice/
  │   └── [...path]/route.ts
  ├── tax/
  │   └── [...path]/route.ts
  ├── reports/
  │   └── [...path]/route.ts
  └── core/
      └── [...path]/route.ts      # Ledger, chart of accounts
```

**Vercel cron jobs (added to `vercel.json`):**
```json
{
  "crons": [
    { "path": "/api/v1/agentbook/cron/daily-pulse", "schedule": "0 13 * * *" },
    { "path": "/api/v1/agentbook/cron/calendar-check", "schedule": "0 * * * *" },
    { "path": "/api/v1/agentbook/cron/weekly-review", "schedule": "0 14 * * 1" },
    { "path": "/api/v1/agentbook/cron/bank-sync", "schedule": "0 6 * * *" }
  ]
}
```
Note: Vercel cron fires in UTC. The cron handler resolves per-tenant timezone and delivers at the correct local time (e.g., daily pulse at 8am tenant TZ, not 8am UTC).

**Event bus on Vercel (no Kafka):**

Kafka is not available in Vercel serverless. The event bus has a **dual-mode implementation:**
- **Local dev:** Kafka producer/consumer (full event streaming)
- **Vercel:** Database-backed append-only event table + polling
  - Events written to `ab_events` table (same Neon DB, `plugin_agentbook_core` schema)
  - Cron jobs poll for unprocessed events and trigger consumers
  - Pattern memory, audit log, and analytics read from the event table
  - The interface is identical — skills emit events the same way regardless of backend

```typescript
// Event emission — same interface, different backend
import { emitEvent } from '@agentbook/event-bus';

await emitEvent({
  type: 'expense.recorded',
  tenant_id: context.tenant_id,
  payload: { expense_id, amount_cents, category_id },
});
// Local: produces to Kafka topic
// Vercel: inserts into ab_events table
```

**Telegram bot on Vercel:**

The Telegram bot runs as a **webhook**, not polling. This is serverless-compatible:
1. Register webhook URL with Telegram: `https://app.example.com/api/v1/agentbook/telegram/webhook`
2. Telegram sends POST to this URL on every message
3. The API route handler processes the message, calls the agent framework, responds
4. Proactive messages (daily pulse, reminders) are sent via Telegram Bot API from cron handlers

### Build Pipeline (vercel-build.sh integration)

AgentBook plugins are built as part of the existing `vercel-build.sh` pipeline:

1. **Plugin UMD bundles built** (existing step) — includes AgentBook frontend plugins
2. **Bundles copied to `apps/web-next/public/cdn/plugins/`** (existing step)
3. **`prisma db push`** (existing step) — now includes AgentBook schemas
4. **Plugin registry sync** (existing step) — discovers AgentBook plugins from plugin.json
5. **Next.js build** (existing step) — includes AgentBook API routes

No new build steps required. AgentBook integrates into the existing pipeline.

### Environment Variables (added for AgentBook)

```env
# AgentBook — Telegram Bot
TELEGRAM_BOT_TOKEN=<bot token from @BotFather>
TELEGRAM_WEBHOOK_SECRET=<random secret for webhook verification>

# AgentBook — Receipt Storage
# Uses existing BLOB_READ_WRITE_TOKEN (Vercel Blob)

# AgentBook — LLM (via service-gateway, no direct keys needed)
# LLM keys are configured in service-gateway plugin settings

# AgentBook — Cron Authentication
# Uses existing CRON_SECRET for Vercel cron job verification
```

### Deployment Parity Checklist

Every feature must work identically in both environments:

| Feature | Local Dev | Vercel | Parity Strategy |
|---------|-----------|--------|----------------|
| Expense recording | Express route | Next.js API route | Shared handler function, different route wrappers |
| Receipt OCR | LLM via service-gateway | Same | Service-gateway has own Vercel routes |
| Telegram bot | Webhook via ngrok | Webhook via Vercel URL | Same Grammy handler, different webhook URL |
| Daily pulse | Local cron | Vercel cron | Same handler, different trigger mechanism |
| Calendar alerts | Local hourly cron | Vercel hourly cron | Same handler |
| Event bus | Kafka | DB table + polling | Same `emitEvent()` interface, env-switched backend |
| Database | Docker PostgreSQL | Neon PostgreSQL | Same Prisma schema, different connection URL |
| Receipt storage | Local filesystem/MinIO | Vercel Blob | Same storage interface, env-switched backend |
| i18n | JSON files | Bundled at build | Same runtime, files in bundle |

---

## Technical Decisions

### All amounts stored as integer cents
No floating-point in the financial path. `$45.99` -> `4599`. Rounding applied only at display. Per SKILL.md: "all financial calculations use Decimal (not float), rounded to 2 decimal places."

### Constraint engine is code, not prompts
The LLM proposes; the constraint engine validates. Per SKILL.md: "Never put accounting constraints inside LLM prompts as instructions. Constraints are code, not text."

### Verification is a separate pass
Per architecture.md: "The executor and the verifier are separate reasoning passes with separate prompts." The verifier's prompt is adversarial: "Your job is to find errors."

### Plugin-specific Prisma schemas (single DB, multi-schema, serverless-compatible)
Each plugin owns its own PostgreSQL schema (`plugin_agentbook_core`, `plugin_agentbook_expense`, etc.) within the single A3P database. Prisma `multiSchema` preview feature handles schema routing. The same Prisma client works on local Docker PostgreSQL and Vercel Postgres (Neon) with PgBouncer connection pooling. Cross-schema relations (e.g., expense -> `public.User`) work natively since all schemas are in the same database.

### Agent framework / skill decoupling
The agent framework is generic orchestration. All domain knowledge lives in skills. Skills are versioned, hot-reloadable, and independently testable. IRS rate changes = skill update, not framework change.

### LLM via Service Gateway (configurable, not hardcoded)
AgentBook does NOT directly call LLM provider APIs. All LLM calls route through the A3P **service-gateway** plugin, which provides:
- **Configurable LLM backend:** tenant or platform admin can switch between Claude, GPT, open-source models, or self-hosted inference — without changing AgentBook code
- **Model tier routing:** skill manifests declare `modelTier: "haiku" | "sonnet" | "opus"`. The service gateway maps tiers to concrete models based on its connector configuration
- **API key management:** LLM provider keys stored in service-gateway's secret vault, never in AgentBook plugins
- **Cost tracking:** service-gateway meters per-request token usage, enabling per-tenant cost budgets
- **Fallback chain:** if primary provider is down, gateway can failover to secondary (e.g., Claude -> GPT -> local)
- **Rate limiting:** gateway enforces per-tenant LLM call budgets to prevent runaway costs

```typescript
// AgentBook skill calls LLM via service-gateway, never directly
const response = await gateway.llm({
  tier: 'haiku',                    // mapped to concrete model by gateway config
  tenant_id: context.tenant_id,
  prompt: categorization_prompt,
  max_tokens: 200,
});
```

**LLM cost budget target:** < $5/month per active tenant at 100 transactions/month (Haiku for parsing/categorization, Sonnet for planning/verification).

---

## Relationship to Existing A3P Plugins

| Plugin | Role |
|--------|------|
| **marketplace** | Discover and install AgentBook plugins and skills |
| **plugin-publisher** | Publish AgentBook plugin/skill updates |
| **community** | User forum for AgentBook support and discussion |
| **service-gateway** | API gateway for AgentBook API endpoints and third-party integrations |
| **agentbook-core** | NEW — Ledger, chart of accounts, constraints |
| **agentbook-expense** | NEW — Expense tracking, OCR, categorization |
| **agentbook-invoice** | NEW — Invoicing, AR, payments |
| **agentbook-tax** | NEW — Tax planning, reporting, cash flow |

---

## Competitive Scorecard (vs QuickBooks Solopreneur & Wave)

This scorecard is evaluated at each phase gate. Target: exceed 80 by Phase 2, exceed 90 by Phase 4.

| Capability | Wave | QB | AgentBook Target | Phase |
|-----------|------|-----|-----------------|-------|
| Manual expense entry | Yes | Yes | Yes (US + CA) | 0 |
| Multi-jurisdiction support | US only | US + CA | US + CA (extensible to any country) | 0 |
| Receipt OCR (photo/PDF) | No | No | Yes (Telegram + web, agent-powered) | **0** |
| Telegram bot interface | No | No | Yes (text + photo + voice + documents) | **0** |
| Auto-categorization | Rule-based | Rule-based | LLM + pattern memory | 1 |
| Invoice creation | Yes | Yes | Yes (natural language, USD + CAD) | 1 |
| Invoice payment | Yes (Stripe) | Yes | Yes (Stripe, US + CA) | 2 |
| Bank connection | Yes (Plaid) | Yes | Yes (Plaid, US + CA) | 2 |
| Bank reconciliation | Manual | Semi-auto | Agent-powered auto-match | 2 |
| US tax estimation | None | Basic | Full (federal + SE + state) | 2 |
| CA tax estimation | N/A | Basic | Full (federal + provincial + CPP/EI) | 2 |
| Sales tax (US state / CA GST/HST/PST) | US only | US only | US + CA | 2 |
| Proactive deduction hints | None | None | Yes (jurisdiction-aware) | 2 |
| Quarterly installments | None | None | US estimated tax + CA installments | 2 |
| Cash flow projection | None | None | 30/60/90 day forecast | 3 |
| Pattern learning | None | None | Yes (improves over time) | 3 |
| Full dashboard | Yes | Yes | Yes (A3P integrated) | 3 |
| US tax forms (Schedule C/SE) | None | TurboTax | Built-in | 4 |
| CA tax forms (T2125) | N/A | N/A | Built-in | 4 |
| Contractor reporting (1099/T4A) | None | None | Built-in (US + CA) | 4 |
| CPA collaboration | None | Accountant invite | Read-only portal + notes | 4 |
| Multi-user | Unlimited | 1 user | Role-based (owner/bookkeeper/viewer) | 4 |
| Natural language interface | None | None | Primary interface | 0 |
| Human-in-the-loop | None | None | Configurable escalation | 0 |
| **Proactive daily pulse** | **None** | **None** | **Daily financial summary via Telegram** | **0** |
| **Proactive receipt reminders** | **None** | **None** | **Nudges for unmatched transactions** | **0** |
| **Proactive invoice follow-up** | **None** | **None** | **Auto-chase overdue invoices** | **1** |
| **Proactive tax deadline alerts** | **None** | **None** | **7-day and 3-day reminders** | **2** |
| **Proactive deduction hunting** | **None** | **None** | **Agent finds savings you missed** | **2** |
| **Proactive cash flow warnings** | **None** | **None** | **Warns before balance drops** | **3** |
| **Proactive year-end planning** | **None** | **None** | **November optimization report** | **4** |
| **Deadline-aware calendar** | **None** | **None** | **Auto-populated from jurisdiction skills: tax, fiscal, market, seasonal** | **0** |
| **Multi-language UI** | **English only** | **English only** | **i18n from core: en + fr-CA in MVP, add languages without code changes** | **0** |
| Configurable LLM backend | N/A | N/A | Via service-gateway, swap providers without code change | 0 |
| Add new country | N/A | N/A | New jurisdiction pack, zero framework changes | 5+ |
| Add new language | N/A | N/A | New locale files, zero code changes | 5+ |

---

## Risk Register (from phased-plan.md, updated)

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| OCR accuracy too low | Medium | High | Cloud OCR backup (Google Vision); manual entry fallback |
| LLM hallucination on categorization | Medium | Medium | Confidence scoring + user confirmation; learn from corrections |
| Stripe/Plaid API changes | Low | Medium | Abstraction layer; pin API versions |
| Tax calculation errors | Medium | High | Unit tests against published IRS examples; "not a CPA" disclaimer |
| User distrust of autonomous actions | High | High | Default confirmation mode; earn trust gradually |
| LLM API costs at scale | Medium | Medium | Cache classifications; small models for simple tasks |
| Skill hot-reload breaks running sessions | Low | Medium | Version pinning per session; graceful migration |
| Framework/skill interface drift | Medium | Medium | Skill manifest schema validation; integration tests on every skill update |
| CRA/IRS tax rate changes mid-year | Low | Medium | Year-versioned rate tables in jurisdiction packs; annual update process documented |
| Jurisdiction pack interface incomplete for new country | Medium | Medium | `_template/` pack with README; interface compliance test suite runs on all packs |
| GST/HST/PST complexity (13 Canadian provinces) | Medium | Low | Province rate table in CA pack; `SalesTaxEngine` tested for all provinces |
| Exchange rate volatility for cross-border users | Low | Low | MVP stores in tenant base currency; multi-currency enhancements in Phase 5 |
