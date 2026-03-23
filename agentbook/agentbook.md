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

## Agent Architecture: Framework + Skills (Decoupled)

### Design Principle
The agent framework is a **generic orchestration engine**. All domain knowledge lives in **loadable, updatable skills**. The system can be iterated/upgraded by improving agent skills without changing the agent framework.

### Agent Framework (stable, rarely changes)
```
AgentFramework/
  ├── orchestrator.ts        # Intent routing, DAG planning, execution loop
  ├── constraint-engine.ts   # Hard gates, escalation gates, soft checks
  ├── verifier.ts            # Independent verification pass
  ├── context-assembler.ts   # Typed context loading per intent
  ├── escalation-router.ts   # Human-in-the-loop routing
  ├── skill-registry.ts      # Discovers, loads, validates, hot-reloads skills
  └── event-emitter.ts       # Kafka event emission
```

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
User Message (Telegram/Web)
    |
    v
Agent Framework (skill-based intent routing)
    |
    +-- "I spent $45 on lunch"
    |   -> skill:expense-recording.record_expense()
    |   -> agentbook-core.create_journal_entry()
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
- `invoice.paid` -> core plugin records journal entry -> tax recalculates
- `period.closed` -> expense plugin stops accepting entries for that period

---

## Phase 0: Foundation (2 weeks)

**Goal:** Plugin scaffolds, agent framework with skill system, ledger database, one working end-to-end flow.

### Implementation Tasks
- [ ] **P0-T01** Scaffold all 4 plugins using A3P plugin template
- [ ] **P0-T02** Implement agent framework: orchestrator, constraint engine, skill registry
- [ ] **P0-T03** Implement first skill: `expense-recording` with skill manifest
- [ ] **P0-T04** `agentbook-core`: PostgreSQL schema with balance CHECK constraint
- [ ] **P0-T05** `agentbook-core`: Tenant config with `jurisdiction`, `region`, `currency`, `locale` fields
- [ ] **P0-T06** Implement jurisdiction pack interfaces (`TaxBracketProvider`, `ChartOfAccountsTemplate`, `SalesTaxEngine`, etc.)
- [ ] **P0-T07** Implement US jurisdiction pack: chart of accounts (Schedule C aligned), federal + state tax brackets (2025)
- [ ] **P0-T08** Implement CA jurisdiction pack: chart of accounts (T2125 aligned), federal + provincial tax brackets (2025)
- [ ] **P0-T09** Jurisdiction pack loader: resolve correct pack from tenant config, validate interfaces
- [ ] **P0-T10** `agentbook-core`: `create_journal_entry` tool with constraint engine
- [ ] **P0-T11** `agentbook-expense`: `record_expense` tool (text input only, currency from tenant config)
- [ ] **P0-T12** `agentbook-expense`: Basic categorization (manual selection from jurisdiction-specific CoA)
- [ ] **P0-T13** Web dashboard: Plugin shell pages with navigation (use `frontend-design` skill for A3P UI compliance)
- [ ] **P0-T14** Docker Compose: add `plugin_agentbook_*` schemas
- [ ] **P0-T15** End-to-end US: user types "I spent $20 on coffee" -> expense + journal entry in USD
- [ ] **P0-T16** End-to-end CA: user types "I spent $20 on coffee" -> expense + journal entry in CAD
- [ ] **P0-T17** Jurisdiction pack template (`_template/`) with README for adding new countries

### Testing Tasks
- [ ] **P0-TEST-01** Unit tests: constraint engine (balance invariant pass/fail/edge), tool schema validation
- [ ] **P0-TEST-02** Unit tests: skill registry (load, validate, register, reject malformed)
- [ ] **P0-TEST-03** Unit tests: jurisdiction pack loader (US pack loads, CA pack loads, unknown jurisdiction rejected)
- [ ] **P0-TEST-04** Unit tests: US ChartOfAccountsTemplate produces Schedule C-aligned accounts
- [ ] **P0-TEST-05** Unit tests: CA ChartOfAccountsTemplate produces T2125-aligned accounts
- [ ] **P0-TEST-06** Integration test: US tenant expense -> journal entry in USD -> event emitted
- [ ] **P0-TEST-07** Integration test: CA tenant expense -> journal entry in CAD -> event emitted
- [ ] **P0-TEST-08** Accounting test: trial balance sums to zero after 100 random transactions (both US and CA tenants)
- [ ] **P0-TEST-09** Tenant isolation test: US tenant and CA tenant data completely isolated
- [ ] **P0-TEST-10** Debit/credit rules verified for every account type (per SKILL.md)
- [ ] **P0-TEST-11** Jurisdiction pack interface compliance: all 9 interfaces implemented for US and CA packs

### Quality Gates
- [ ] **P0-QG-01** Code review using `/code-review` plugin on all PRs
- [ ] **P0-QG-02** No TODOs, dead code, or placeholder implementations in merged code
- [ ] **P0-QG-03** All UI components designed with `frontend-design` skill, compliant with A3P UI guidelines
- [ ] **P0-QG-04** Architecture compliance check: verify against architecture.md checklist (Section 7)
- [ ] **P0-QG-05** SKILL.md compliance: all tools follow Tool pattern, all constraints are declarative

### Verification Checklist
- [ ] 10 expenses recorded in 5 minutes (test with both US and CA tenant)
- [ ] Every expense creates a balanced journal entry (verified by DB constraint)
- [ ] US tenant gets Schedule C-aligned chart of accounts in USD
- [ ] CA tenant gets T2125-aligned chart of accounts in CAD
- [ ] Events appear in Kafka topic
- [ ] Skill hot-reload: update expense-recording skill -> changes take effect without restart
- [ ] Adding a mock "test-country" jurisdiction pack works without any framework/plugin changes
- [ ] Second tenant data is completely isolated
- [ ] Test coverage >= 85% for all new code
- [ ] Zero lint errors, zero type errors

### Phase 0 Assessment (100 points)

| Category | Max Points | Criteria |
|----------|-----------|----------|
| **Feature Completeness vs QB/Wave** | 15 | Expense entry works end-to-end; matches basic manual entry of QB/Wave |
| **Architecture Compliance** | 20 | Agent-guardrail separation, verify-then-commit, event sourcing, plugin-per-domain, skill decoupling |
| **Multi-Jurisdiction** | 15 | US + CA packs load correctly, interfaces validated, adding new country requires zero framework changes |
| **Code Quality** | 20 | No dead code/TODOs, code review passed, test coverage >= 85%, SKILL.md patterns followed |
| **Agent Design** | 15 | Framework/skill decoupled, skill manifest validated, constraint engine is code not prompts |
| **UI/UX Quality** | 15 | A3P UI guideline compliant, frontend-design skill used, responsive, accessible |

**Pass threshold: 80/100. If below 80, identify gaps and create remediation tasks before proceeding.**

---

## Phase 1: Core Bookkeeping (4 weeks)

**Goal:** Full expense tracking with OCR, invoicing, and basic reporting. Feature parity with Wave free tier for expense and invoice basics.

### Week 1-2: Expense System
- [ ] **P1-T01** Skill: `receipt-ocr` — photo -> structured data via LLM
- [ ] **P1-T02** Skill: `expense-categorization` — auto-categorization with confidence scoring
- [ ] **P1-T03** Category confirmation flow (web UI inline buttons) — use `frontend-design` skill
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

### Week 4: Reporting & Quality
- [ ] **P1-T15** Skill: `report-generation` — P&L, trial balance
- [ ] **P1-T16** Cash position calculation
- [ ] **P1-T17** Basic tax estimate skill — delegates to jurisdiction pack (US: federal + SE + state; CA: federal + provincial + CPP/EI)
- [ ] **P1-T18** Verification pass (independent re-check per architecture.md Section 3.2)
- [ ] **P1-T19** Saga pattern for multi-step operations (per architecture.md Executor)
- [ ] **P1-T20** Web dashboard: expense list, invoice list, P&L view — use `frontend-design` skill

### Testing Tasks
- [ ] **P1-TEST-01** OCR accuracy: benchmark against 50+ receipt images (target: 90% field extraction)
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
| **Feature Completeness vs QB/Wave** | 25 | Expense tracking with OCR matches Wave; invoicing matches QB Solopreneur basics; P&L available |
| **Architecture Compliance** | 20 | Verify-then-commit on all writes, constraint engine active, event sourcing, audit trail |
| **Code Quality** | 20 | Code review passed, >= 85% coverage, no dead code, SKILL.md patterns, production-ready error handling |
| **Agent Design** | 20 | Skills decoupled, prompt versions tracked, confidence scoring calibrated, pattern learning works |
| **UI/UX Quality** | 15 | Dashboard matches A3P guidelines, responsive, professional invoice PDFs, intuitive confirmation flows |

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
| **Feature Completeness vs QB/Wave** | 25 | Bank connection matches both; tax estimation exceeds Wave (none) and matches QB; payment collection works |
| **Architecture Compliance** | 20 | Event sourcing complete, audit trail reconstructible, security architecture implemented |
| **Code Quality** | 20 | Idempotent webhooks, no secrets in code, graceful degradation, >= 85% coverage |
| **Agent Design** | 20 | Tax/bank skills independently deployable, anomaly detection statistical not LLM, escalation deterministic |
| **UI/UX Quality** | 15 | Bank connection flow polished, tax dashboard clear, reconciliation UI intuitive |

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
- [ ] **P3-T11** Proactive alerts skill: cash flow warnings, tax bracket alerts

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
| **Feature Completeness vs QB/Wave** | 25 | Pattern learning exceeds both; cash flow projection exceeds both; full dashboard matches QB |
| **Architecture Compliance** | 20 | Pattern memory per architecture.md, event-driven learning pipeline, cache warming |
| **Code Quality** | 20 | Performance budgets met, responsive dashboard, >= 85% coverage |
| **Agent Design** | 20 | Learning skills improve autonomously, proactive alerts work, scenario modeling correct |
| **UI/UX Quality** | 15 | Dashboard is production-grade, charts interactive, drill-down works, A3P compliant |

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
| **Feature Completeness vs QB/Wave** | 25 | Tax filing exceeds both (Wave has none, QB requires TurboTax); multi-user matches QB; CPA portal unique |
| **Architecture Compliance** | 20 | RBAC per architecture, data export/import clean, year-end closing uses period gate |
| **Code Quality** | 20 | Tax math tested against IRS, role isolation tested, >= 85% coverage |
| **Agent Design** | 20 | Tax skills independently updatable (IRS rate changes), onboarding is a skill |
| **UI/UX Quality** | 15 | CPA portal polished, onboarding flow intuitive, tax package PDF professional |

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

## Technical Decisions

### All amounts stored as integer cents
No floating-point in the financial path. `$45.99` -> `4599`. Rounding applied only at display. Per SKILL.md: "all financial calculations use Decimal (not float), rounded to 2 decimal places."

### Constraint engine is code, not prompts
The LLM proposes; the constraint engine validates. Per SKILL.md: "Never put accounting constraints inside LLM prompts as instructions. Constraints are code, not text."

### Verification is a separate pass
Per architecture.md: "The executor and the verifier are separate reasoning passes with separate prompts." The verifier's prompt is adversarial: "Your job is to find errors."

### Plugin-specific Prisma schemas
Each plugin owns its own PostgreSQL schema for clean isolation while sharing the same database.

### Agent framework / skill decoupling
The agent framework is generic orchestration. All domain knowledge lives in skills. Skills are versioned, hot-reloadable, and independently testable. IRS rate changes = skill update, not framework change.

### LLM cost budget
Per architecture.md AD-6: Haiku tier for parsing/categorization, Sonnet tier for planning/verification. Target: < $5/month per active tenant at 100 transactions/month.

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
| Receipt OCR | No | No | Yes (agent-powered) | 1 |
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
| Add new country | N/A | N/A | New jurisdiction pack, zero framework changes | 5+ |

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
