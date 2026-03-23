# AgentBooks — Phased implementation plan

## Guiding principles

1. **Vertical slices, not horizontal layers.** Each phase delivers a usable end-to-end flow, not a complete layer.
2. **Telegram first, always.** Every feature works in Telegram before it gets a dashboard component.
3. **Hard constraints before smart features.** The balance invariant and audit trail ship in Phase 1. Pattern learning ships in Phase 3.
4. **Paper trading mindset.** Phase 1 is read-only from the bank and Stripe perspective. Live integrations come in Phase 2 after the guardrails are proven.

---

## Phase 0: Foundation (2 weeks)

**Goal:** NaaP plugin skeleton, ledger database, Telegram bot connected to agent orchestrator, one working tool call end-to-end.

### Deliverables
- NaaP plugin scaffold: manifest format, tool registration, constraint definition
- PostgreSQL schema: accounts, journal_entries, journal_lines, transactions (with balance CHECK constraint)
- Default chart of accounts (Schedule C aligned) seeded per tenant
- Telegram bot (webhook mode) connected to a minimal agent orchestrator
- Single working flow: user types "I spent $20 on coffee" → agent parses → ledger tool posts journal entry → bot confirms
- Kafka topic `agentbooks.events` with first event type: `expense.recorded`
- Docker Compose for local development: PostgreSQL, Redis, Kafka, bot service, orchestrator

### What is NOT in Phase 0
- No OCR, no bank connection, no Stripe, no dashboard, no tax calculations
- The "agent" is a single LLM call with a hardcoded prompt, not a full orchestrator
- Categories are manual — no auto-categorization yet

### Exit criteria
- A user can record 10 expenses via Telegram in 5 minutes
- Every expense creates a balanced journal entry (verified by database constraint)
- Events appear in Kafka topic
- A second tenant can register and their data is completely isolated

---

## Phase 1: Core bookkeeping (4 weeks)

**Goal:** A self-employed person can track all expenses and income through Telegram with auto-categorization and basic reporting.

### Week 1-2: Expense system
- OCR plugin: receipt photo → structured data extraction (Tesseract + LLM interpretation)
- Auto-categorization: LLM-based with confidence scoring against chart of accounts
- Category confirmation flow: inline keyboard [Correct] [Change] [Edit]
- Expense editing and deletion via Telegram
- Recurring expense detection (background consumer on event stream)

### Week 3: Income and invoicing
- Invoice creation tool: natural language → structured invoice → PDF generation
- Invoice sending via email (SendGrid or SES)
- Manual payment recording: "Acme paid invoice #24"
- Accounts receivable tracking: outstanding, overdue, paid
- Aging report (text format via Telegram)

### Week 4: Reporting and quality
- P&L report (text summary via Telegram, PDF export)
- Cash position calculation
- Post-execution verification pass (independent re-check of journal entries)
- Saga pattern implementation for multi-step operations
- Error handling and compensation actions tested

### Exit criteria
- User can photograph a receipt and have it categorized and recorded in < 10 seconds
- User can create and send an invoice in a single Telegram message
- User can request P&L and receive accurate text summary
- All journal entries are balanced (0 exceptions in test suite)
- Failed multi-step operations roll back cleanly

---

## Phase 2: Integrations and tax (4 weeks)

**Goal:** Connect to real financial services. Add tax planning. The system becomes a genuine daily-use bookkeeping tool.

### Week 5: Stripe integration
- OAuth connection flow (web page, link from Telegram)
- Webhook handler: payment.received, refund, dispute
- Automatic payment matching to invoices
- Fee tracking and categorization
- Payout reconciliation

### Week 6: Plaid bank connection
- Plaid Link integration (web page, link from Telegram)
- Daily transaction sync
- Auto-matching engine: bank transactions ↔ recorded expenses
- Unmatched transaction surfacing to user
- Reconciliation status tracking

### Week 7: Tax engine
- Running tax estimate: federal + self-employment + configurable state
- Quarterly estimated tax calculation (annualized income method + safe harbor)
- Quarterly payment reminders (7 days and 3 days before deadline)
- Tax deduction gap analysis: "You haven't logged home office expenses"
- Deduction tracking by Schedule C line

### Week 8: Quality hardening
- Full constraint enforcement across all tool calls
- Anomaly detection on amounts (statistical, per-category)
- Human escalation flow via Telegram inline keyboards
- Escalation timeout and reminder logic
- End-to-end audit trail verification: can reconstruct books from event log

### Exit criteria
- Stripe payments auto-record with correct categorization
- Bank transactions sync daily and 80%+ auto-match on first attempt
- Tax estimate is within 5% of manual calculation for test scenarios
- Escalation flow works: user receives approval request, taps button, agent proceeds
- Audit trail test: restore books from event log matches direct database query

---

## Phase 3: Intelligence and dashboard (4 weeks)

**Goal:** The agent gets smarter over time. Users who want visual analytics get a dashboard.

### Week 9: Pattern learning
- Vendor categorization patterns: auto-confidence increases with repetitions
- Client payment patterns: predict when payment will arrive
- Recurring expense auto-detection and auto-recording
- User preference learning: category overrides update future behavior
- Pattern drift detection: alert if a learned pattern stops matching

### Week 10: Cash flow and projections
- Cash flow projection (30/60/90 days) using: known recurring expenses, expected invoice payments (based on client patterns), estimated tax payments
- Earnings projection: annual revenue estimate with confidence bands
- "What if" scenario support: "What if I land the $30k project?"
- Proactive alerts: "Your cash flow will be tight in March — you have $4,200 in expenses and only $3,100 expected income"

### Week 11-12: Web dashboard
- React SPA with Telegram Login authentication
- Financial overview: revenue vs expense chart, cash position, outstanding invoices
- Transaction list with search, filter, inline edit
- Report viewer: P&L, balance sheet, cash flow statement (interactive)
- Expense analytics: category breakdown, vendor analysis, trend charts
- Tax dashboard: current estimate, quarterly payments, deduction tracking
- Mobile-responsive for tablet use

### Exit criteria
- After 30 days of use, auto-categorization accuracy exceeds 90%
- Cash flow projection is within 15% of actual for test scenarios
- Dashboard loads in < 2 seconds with 1 year of data
- All dashboard data matches Telegram query results exactly

---

## Phase 4: Tax filing and advanced features (4 weeks)

**Goal:** Close the loop on tax season. Add multi-user and advanced bookkeeping features.

### Week 13-14: Tax filing preparation
- Schedule C generation from ledger data
- Schedule SE calculation
- 1099 tracking: expected 1099s from clients, reconciliation
- Tax package export: PDF with all supporting schedules
- TurboTax export format (TXF)
- CPA collaboration: shareable read-only link to books

### Week 15: Mileage and advanced expenses
- Mileage tracking via Telegram
- Standard mileage vs actual expense comparison
- Home office deduction calculation (simplified and regular method)
- Depreciation tracking for equipment purchases
- Contractor payments and 1099-NEC preparation

### Week 16: Multi-user and polish
- Multiple users per business (Raj persona): roles (owner, bookkeeper, read-only)
- Contractor management: track payments, generate 1099s
- Data export: CSV, QBO, API
- Onboarding flow: guided setup via Telegram conversation
- Help system: "How do I categorize this?" with contextual guidance

### Exit criteria
- Generated Schedule C matches hand-prepared Schedule C for 5 test scenarios
- Multi-user access works with proper role isolation
- Full data export round-trips (export → import into fresh instance → identical state)
- New user can complete onboarding in < 10 minutes via Telegram

---

## Phase 5: Scale and marketplace (ongoing)

**Goal:** Multi-tenant production deployment. Plugin marketplace for third-party domain tools.

### Deliverables
- Production deployment on NaaP infrastructure
- Horizontal scaling: multiple agent orchestrator instances behind load balancer
- Plugin marketplace: third-party tools can register (e.g., industry-specific expense categories, Canadian/UK tax engines, multi-currency support)
- Usage-based billing: per-transaction and per-LLM-call metering
- SOC 2 compliance preparation
- Multi-currency support
- Localization: Canadian, UK, EU tax jurisdictions

---

## Resource estimate

| Phase | Duration | Team | Key skills |
|-------|----------|------|------------|
| Phase 0 | 2 weeks | 1 full-stack engineer | NaaP, PostgreSQL, Telegram API, Python |
| Phase 1 | 4 weeks | 1 full-stack + 1 LLM/agent engineer | OCR, LLM prompting, PDF generation |
| Phase 2 | 4 weeks | 2 engineers | Stripe API, Plaid API, tax domain knowledge |
| Phase 3 | 4 weeks | 2 engineers + 1 frontend | React, data visualization, ML patterns |
| Phase 4 | 4 weeks | 2 engineers + tax domain expert | Tax filing formats, regulatory compliance |
| Phase 5 | Ongoing | Full team | DevOps, security, marketplace platform |

**Total to production-ready MVP (Phases 0-2): 10 weeks with 2 engineers.**

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| OCR accuracy too low for receipts | Medium | High | Fallback to manual entry; use cloud OCR (Google Vision) as backup |
| LLM hallucination on categorization | Medium | Medium | Confidence scoring + user confirmation for low-confidence; learn from corrections |
| Stripe/Plaid API changes | Low | Medium | Abstraction layer; pin API versions; monitor changelogs |
| Tax calculation errors | Medium | High | Unit tests against published IRS examples; disclaimer that agent is not a CPA |
| User distrust of autonomous actions | High | High | Default to confirmation mode; earn trust gradually; always show reasoning |
| LLM API costs at scale | Medium | Medium | Cache common classifications; use small models for simple tasks; batch non-urgent operations |
| Regulatory requirements (money transmitter) | Low | High | AgentBooks never moves money directly; Stripe handles payments; Plaid is read-only |
