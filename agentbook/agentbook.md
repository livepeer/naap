# AgentBook — MVP Implementation Plan for A3P

> **Governing documents:** This plan MUST be implemented in compliance with:
> - `architecture.md` — Component design, quality system, data architecture
> - `SKILL.md` — Code patterns, constraints, testing standards, LLM prompt standards
> - `requirements-v2.md` — Feature requirements, competitive positioning, acceptance criteria
> - `phased-plan.md` — Phase sequencing, exit criteria, risk register

---

## Overview

AgentBook is an agent-based accounting system implemented as a set of A3P plugins. Rather than a single monolithic plugin, the MVP is decomposed into **four cooperating plugins** that map to the core accounting domains, plus an **agent framework** with a decoupled **skill system** that allows the agent to be upgraded by improving skills without changing the framework.

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

## Plugin Decomposition

### 1. `agentbook-core` — Ledger & Chart of Accounts
**Purpose:** The financial backbone. Double-entry ledger, chart of accounts, journal entries, tenant configuration, and the constraint engine that enforces accounting invariants.

**Key tools:**
- `create_journal_entry` — balanced debit/credit entry (hard-gated: sum(debits) == sum(credits))
- `get_trial_balance` — real-time trial balance
- `manage_chart_of_accounts` — CRUD for accounts (Schedule C aligned defaults)
- `close_period` / `open_period` — fiscal period management

**Database schema:** `plugin_agentbook_core`
- `ab_accounts` (chart of accounts)
- `ab_journal_entries` (header: date, memo, source, verified)
- `ab_journal_lines` (entry_id, account_id, debit, credit)
- `ab_fiscal_periods` (year, month, status: open/closed)
- `ab_tenant_config` (business type, tax jurisdiction, currency, auto-approve limit)

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
**Purpose:** Real-time tax estimation, quarterly payment management, deduction optimization, Schedule C generation, and financial reporting (P&L, balance sheet, cash flow).

**Key tools:**
- `estimate_tax` — running federal + SE + state tax estimate
- `suggest_deductions` — gap analysis against Schedule C categories
- `calculate_quarterly` — quarterly estimated tax with safe harbor comparison
- `generate_report` — P&L, balance sheet, cash flow, tax package
- `project_cash_flow` — 30/60/90 day forecast

**Database schema:** `plugin_agentbook_tax`
- `ab_tax_estimates` (period, gross_revenue_cents, expenses_cents, net_income_cents, se_tax_cents, income_tax_cents, total_cents)
- `ab_quarterly_payments` (year, quarter, amount_due_cents, amount_paid_cents, deadline)
- `ab_deduction_suggestions` (category, description, estimated_savings_cents, status)
- `ab_tax_config` (filing_status, state, retirement_type, home_office)

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
- [ ] **P0-T05** `agentbook-core`: Default chart of accounts (Schedule C aligned)
- [ ] **P0-T06** `agentbook-core`: `create_journal_entry` tool with constraint engine
- [ ] **P0-T07** `agentbook-expense`: `record_expense` tool (text input only)
- [ ] **P0-T08** `agentbook-expense`: Basic categorization (manual selection)
- [ ] **P0-T09** Web dashboard: Plugin shell pages with navigation (use `frontend-design` skill for A3P UI compliance)
- [ ] **P0-T10** Docker Compose: add `plugin_agentbook_*` schemas
- [ ] **P0-T11** End-to-end: user types "I spent $20 on coffee" -> expense + journal entry created

### Testing Tasks
- [ ] **P0-TEST-01** Unit tests: constraint engine (balance invariant pass/fail/edge), tool schema validation
- [ ] **P0-TEST-02** Unit tests: skill registry (load, validate, register, reject malformed)
- [ ] **P0-TEST-03** Integration test: text expense -> intent parse -> categorize -> journal entry -> event emitted
- [ ] **P0-TEST-04** Accounting test: trial balance sums to zero after 100 random transactions
- [ ] **P0-TEST-05** Tenant isolation test: second tenant data completely isolated
- [ ] **P0-TEST-06** Debit/credit rules verified for every account type (per SKILL.md)

### Quality Gates
- [ ] **P0-QG-01** Code review using `/code-review` plugin on all PRs
- [ ] **P0-QG-02** No TODOs, dead code, or placeholder implementations in merged code
- [ ] **P0-QG-03** All UI components designed with `frontend-design` skill, compliant with A3P UI guidelines
- [ ] **P0-QG-04** Architecture compliance check: verify against architecture.md checklist (Section 7)
- [ ] **P0-QG-05** SKILL.md compliance: all tools follow Tool pattern, all constraints are declarative

### Verification Checklist
- [ ] 10 expenses recorded in 5 minutes
- [ ] Every expense creates a balanced journal entry (verified by DB constraint)
- [ ] Events appear in Kafka topic
- [ ] Skill hot-reload: update expense-recording skill -> changes take effect without restart
- [ ] Second tenant data is completely isolated
- [ ] Test coverage >= 85% for all new code
- [ ] Zero lint errors, zero type errors

### Phase 0 Assessment (100 points)

| Category | Max Points | Criteria |
|----------|-----------|----------|
| **Feature Completeness vs QB/Wave** | 20 | Expense entry works end-to-end; matches basic manual entry of QB/Wave |
| **Architecture Compliance** | 25 | Agent-guardrail separation, verify-then-commit, event sourcing, plugin-per-domain, skill decoupling |
| **Code Quality** | 20 | No dead code/TODOs, code review passed, test coverage >= 85%, SKILL.md patterns followed |
| **Agent Design** | 20 | Framework/skill decoupled, skill manifest validated, constraint engine is code not prompts |
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
- [ ] **P1-T07** Custom expense categories (per requirements-v2 US-1.4, Schedule C aligned)

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
- [ ] **P1-T17** Basic tax estimate skill (federal + SE)
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
- [ ] **P2-T04** Tax estimation skill: federal + SE + state (per requirements-v2 US-5.1)
- [ ] **P2-T05** Quarterly estimated tax skill (per requirements-v2 US-5.3)
- [ ] **P2-T06** Tax deduction gap analysis skill (per requirements-v2 US-5.2)
- [ ] **P2-T07** Full constraint enforcement across all tool calls
- [ ] **P2-T08** Anomaly detection (statistical, per-category, per architecture.md)
- [ ] **P2-T09** Human escalation flow with timeout/reminder logic
- [ ] **P2-T10** Web dashboard: bank connection, tax dashboard — use `frontend-design` skill
- [ ] **P2-T11** Payment follow-up automation skill (per requirements-v2 US-2.5)

### Testing Tasks
- [ ] **P2-TEST-01** Stripe webhook handling: payment, refund, dispute, payout — all generate correct journal entries
- [ ] **P2-TEST-02** Plaid sync: daily transactions match, 80%+ auto-match on first attempt
- [ ] **P2-TEST-03** Tax estimate within 5% of manual calculation for 10 test scenarios (per phased-plan.md)
- [ ] **P2-TEST-04** Quarterly estimate: annualized income method vs safe harbor comparison correct
- [ ] **P2-TEST-05** Deduction gap analysis: correctly identifies 5 common missed deductions
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
- [ ] **P4-T01** Schedule C generation skill from ledger data (per requirements-v2 US-5.4)
- [ ] **P4-T02** Schedule SE calculation skill
- [ ] **P4-T03** 1099 tracking and generation skill (per requirements-v2 US-3.2)
- [ ] **P4-T04** Tax package export: PDF, TXF, CSV (per requirements-v2 US-5.4)
- [ ] **P4-T05** CPA collaboration: read-only link, notes (per requirements-v2 US-8.1)
- [ ] **P4-T06** Mileage tracking skill (per requirements-v2 US-1.5)
- [ ] **P4-T07** Home office deduction calculation skill
- [ ] **P4-T08** Depreciation tracking skill (Section 179 per requirements-v2 US-5.2)
- [ ] **P4-T09** Multi-user access with roles (per requirements-v2 US-8.2)
- [ ] **P4-T10** Guided onboarding flow (per requirements-v2 US-10.1)
- [ ] **P4-T11** Data export/import: CSV, QBO, migration tools (per requirements-v2 US-9.4)
- [ ] **P4-T12** Year-end closing skill (per requirements-v2 US-5.5)

### Testing Tasks
- [ ] **P4-TEST-01** Schedule C matches hand-prepared for 5 test scenarios (per phased-plan.md)
- [ ] **P4-TEST-02** 1099 threshold alert fires correctly at $550/$600
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
- [ ] **P5-T03** Skill marketplace: third-party skills can be published via plugin-publisher
- [ ] **P5-T04** Usage-based billing: per-transaction and per-LLM-call metering
- [ ] **P5-T05** SOC 2 compliance preparation (per requirements-v2 NFR-1)
- [ ] **P5-T06** Multi-currency support skill
- [ ] **P5-T07** Localization skills: Canadian, UK, EU tax jurisdictions

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

| Capability | Wave | QB | AgentBook Target | Phase Available |
|-----------|------|-----|-----------------|----------------|
| Manual expense entry | Yes | Yes | Yes | 0 |
| Receipt OCR | No | No | Yes (agent-powered) | 1 |
| Auto-categorization | Rule-based | Rule-based | LLM + pattern memory | 1 |
| Invoice creation | Yes | Yes | Yes (natural language) | 1 |
| Invoice payment | Yes (Stripe) | Yes | Yes (Stripe) | 2 |
| Bank connection | Yes (Plaid) | Yes | Yes (Plaid) | 2 |
| Bank reconciliation | Manual | Semi-auto | Agent-powered auto-match | 2 |
| Tax estimation | None | Basic | Full (federal + SE + state) | 2 |
| Proactive deduction hints | None | None | Yes (agent-initiated) | 2 |
| Quarterly tax management | None | None | Yes (calculate + remind + track) | 2 |
| Cash flow projection | None | None | 30/60/90 day forecast | 3 |
| Pattern learning | None | None | Yes (improves over time) | 3 |
| Full dashboard | Yes | Yes | Yes (A3P integrated) | 3 |
| Schedule C generation | None | TurboTax | Built-in | 4 |
| CPA collaboration | None | Accountant invite | Read-only portal + notes | 4 |
| Multi-user | Unlimited | 1 user | Role-based (owner/bookkeeper/viewer) | 4 |
| Natural language interface | None | None | Primary interface | 0 |
| Human-in-the-loop | None | None | Configurable escalation | 0 |

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
