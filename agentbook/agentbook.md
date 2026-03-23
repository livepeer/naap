# AgentBook — MVP Implementation Plan for A3P

## Overview

AgentBook is an agent-based accounting system implemented as a set of A3P plugins. Rather than a single monolithic plugin, the MVP is decomposed into **four cooperating plugins** that map to the core accounting domains. Each plugin registers its own tools, constraints, and routes while sharing a common data layer through the A3P plugin framework.

This approach lets each domain evolve independently, enables granular permissions, and follows the A3P plugin-per-domain architecture principle.

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

**Constraints (programmatic, never LLM):**
- Balance invariant: `CHECK (debit_total = credit_total)` at DB level
- Period gate: reject entries to closed periods
- Amount threshold: escalate if amount > tenant auto-approve limit

**Routes:** `/agentbook`, `/agentbook/ledger`, `/agentbook/accounts`

---

### 2. `agentbook-expense` — Expense Tracking & Categorization
**Purpose:** Capture, categorize, and manage expenses. Receipt OCR, auto-categorization with confidence scoring, recurring expense detection, business/personal separation.

**Key tools:**
- `record_expense` — create expense from text, photo, or forwarded receipt
- `categorize_expense` — LLM-based categorization against chart of accounts (from core plugin)
- `detect_recurring` — background pattern detection on expense stream
- `manage_vendors` — vendor memory and per-vendor category rules

**Database schema:** `plugin_agentbook_expense`
- `ab_expenses` (amount, vendor_id, category_id, date, receipt_url, confidence, is_personal)
- `ab_vendors` (name, normalized_name, default_category_id, transaction_count)
- `ab_patterns` (vendor_pattern, category_id, confidence, source, usage_count)
- `ab_recurring_rules` (vendor_id, amount, frequency, next_expected, active)

**Integration with core:** Every recorded expense triggers a journal entry via `agentbook-core.create_journal_entry` (debit: expense account, credit: cash/bank account).

**Routes:** `/agentbook/expenses`, `/agentbook/receipts`, `/agentbook/vendors`

---

### 3. `agentbook-invoice` — Invoicing & Accounts Receivable
**Purpose:** Create, send, and track invoices. Payment collection via Stripe. Client management. Payment follow-up automation.

**Key tools:**
- `create_invoice` — natural language → structured invoice → PDF
- `send_invoice` — email delivery with payment link
- `record_payment` — manual or Stripe webhook payment recording
- `manage_clients` — client records with payment pattern learning
- `get_aging_report` — AR aging (current, 30, 60, 90+ days)

**Database schema:** `plugin_agentbook_invoice`
- `ab_clients` (name, email, address, default_terms, avg_days_to_pay)
- `ab_invoices` (client_id, number, amount, issued_date, due_date, status, pdf_url)
- `ab_invoice_lines` (invoice_id, description, quantity, rate, amount)
- `ab_payments` (invoice_id, amount, method, date, stripe_payment_id, fees)
- `ab_estimates` (client_id, amount, status, validity_period)

**Integration with core:** Invoice creation → journal entry (debit: AR, credit: revenue). Payment → journal entry (debit: cash, credit: AR; debit: fees expense, credit: cash).

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
- `ab_tax_estimates` (period, gross_revenue, expenses, net_income, se_tax, income_tax, total)
- `ab_quarterly_payments` (year, quarter, amount_due, amount_paid, deadline)
- `ab_deduction_suggestions` (category, description, estimated_savings, status)
- `ab_tax_config` (filing_status, state, retirement_type, home_office)

**Integration with core:** Reads ledger data from `agentbook-core` for all calculations. No direct writes to ledger.

**Routes:** `/agentbook/tax`, `/agentbook/reports`, `/agentbook/cashflow`

---

## Cross-Plugin Communication

Plugins communicate through the A3P event bus and direct tool invocation:

```
User Message (Telegram/Web)
    │
    ▼
Agent Orchestrator (intent parsing)
    │
    ├─ "I spent $45 on lunch"
    │   → agentbook-expense.record_expense()
    │   → agentbook-core.create_journal_entry()  (called by expense plugin)
    │
    ├─ "Invoice Acme $5,000"
    │   → agentbook-invoice.create_invoice()
    │   → agentbook-core.create_journal_entry()  (called by invoice plugin)
    │
    ├─ "What's my tax situation?"
    │   → agentbook-tax.estimate_tax()
    │   → reads from agentbook-core ledger
    │
    └─ "Show me my P&L"
        → agentbook-tax.generate_report()
        → reads from agentbook-core ledger
```

**Event flow:**
- `expense.recorded` → tax plugin recalculates estimate
- `invoice.paid` → core plugin records journal entry → tax recalculates
- `period.closed` → expense plugin stops accepting entries for that period

---

## MVP Scope (Phase 0 + Phase 1)

### Phase 0: Foundation (2 weeks)
**Goal:** Plugin scaffolds, ledger database, one working end-to-end flow.

- [ ] Scaffold all 4 plugins using A3P plugin template
- [ ] `agentbook-core`: PostgreSQL schema with balance CHECK constraint
- [ ] `agentbook-core`: Default chart of accounts (Schedule C aligned)
- [ ] `agentbook-core`: `create_journal_entry` tool with constraint engine
- [ ] `agentbook-expense`: `record_expense` tool (text input only)
- [ ] `agentbook-expense`: Basic categorization (manual selection)
- [ ] Web dashboard: Plugin shell pages with navigation
- [ ] Docker Compose: add `plugin_agentbook_*` schemas
- [ ] End-to-end: user types "I spent $20 on coffee" → expense + journal entry created

**Exit criteria:**
- 10 expenses recorded in 5 minutes
- Every expense creates a balanced journal entry
- Second tenant data is completely isolated

### Phase 1: Core Bookkeeping (4 weeks)
**Goal:** Full expense tracking with OCR, invoicing, and basic reporting.

**Week 1-2: Expense system**
- [ ] Receipt OCR (photo → structured data via LLM)
- [ ] Auto-categorization with confidence scoring
- [ ] Category confirmation flow (web UI buttons)
- [ ] Business vs personal expense separation
- [ ] Vendor memory and pattern learning

**Week 3: Invoicing**
- [ ] `agentbook-invoice`: Invoice creation from natural language
- [ ] PDF generation and email sending
- [ ] Manual payment recording
- [ ] AR tracking and aging report
- [ ] Client management

**Week 4: Reporting & Quality**
- [ ] `agentbook-tax`: P&L report generation
- [ ] Cash position calculation
- [ ] Basic tax estimate (federal + SE)
- [ ] Verification pass (independent re-check of journal entries)
- [ ] Saga pattern for multi-step operations

**Exit criteria:**
- Receipt photo → categorized expense in < 10 seconds
- Invoice created and sent in a single action
- P&L report is accurate
- All journal entries balanced (0 exceptions)

---

## Technical Decisions

### All amounts stored as integer cents
No floating-point in the financial path. `$45.99` → `4599`. Rounding applied only at display.

### Constraint engine is code, not prompts
The LLM proposes; the constraint engine validates. Balance checks, period gates, and amount thresholds are deterministic code that cannot be bypassed.

### Verification is a separate pass
After execution, a separate LLM call with an adversarial prompt ("find errors in this entry") validates the result before commit.

### Plugin-specific Prisma schemas
Each plugin owns its own PostgreSQL schema (`plugin_agentbook_core`, `plugin_agentbook_expense`, etc.) for clean isolation while sharing the same database.

### LLM cost budget
- Intent parsing + categorization: Haiku tier (~$0.002/call)
- Planning + verification: Sonnet tier (~$0.01/call)
- Target: < $5/month per active tenant at 100 transactions/month

---

## Relationship to Existing A3P Plugins

AgentBook plugins coexist with the retained platform plugins:

| Plugin | Role |
|--------|------|
| **marketplace** | Discover and install AgentBook plugins |
| **plugin-publisher** | Publish AgentBook plugin updates |
| **community** | User forum for AgentBook support and discussion |
| **service-gateway** | API gateway — future: AgentBook API endpoints for third-party integrations |
| **agentbook-core** | NEW — Ledger, chart of accounts, constraints |
| **agentbook-expense** | NEW — Expense tracking, OCR, categorization |
| **agentbook-invoice** | NEW — Invoicing, AR, payments |
| **agentbook-tax** | NEW — Tax planning, reporting, cash flow |

---

## Next Phases (Post-MVP)

- **Phase 2:** Stripe integration, Plaid bank connection, tax engine enhancements
- **Phase 3:** Pattern learning, cash flow projections, web dashboard with charts
- **Phase 4:** Tax filing prep (Schedule C, 1099), multi-user access, mileage tracking
- **Phase 5:** Production deployment, horizontal scaling, plugin marketplace distribution
