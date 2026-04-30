# AgentBook — Post Phase 7 Plan

## What's Been Built (Phases 0-7)

| Phase | What | Status | E2E Tests |
|-------|------|--------|-----------|
| **0** | Foundation: 4 plugins, agent framework, Prisma, Telegram, i18n, US+CA packs | Done | 39 |
| **1** | Core bookkeeping: invoice/tax backends, dashboard, proactive handlers | Done | — |
| **2** | Integrations: Stripe, Plaid, reconciliation, anomaly detection, deductions | Done | — |
| **3** | Intelligence: pattern learning, analytics, projections, what-if, engagement tuning | Done | — |
| **4** | Tax filing: tax forms, multi-user, CPA, onboarding, mileage, year-end closing | Done | 21 |
| **5** | Scale: billing, SOC 2, marketplace, multi-currency, UK+AU packs | Done | — |
| **6** | Production: onboarding UI, CPA portal, 10 reports, Plaid/Stripe/OCR endpoints | Done | 34 |
| **7** | Time tracking: timer, projects, profitability, unbilled alerts | Done | 12 |

**Current totals:** ~320 files, ~29,000 lines, 18 skills, 19 handlers, 25 Prisma models, 26 pages, 98 E2E tests.

---

## Remaining Phases Overview

| Phase | Focus | Duration | Key Outcome |
|-------|-------|----------|-------------|
| **8** | Financial Copilot | 4 weeks | Agent becomes a proactive financial advisor |
| **9** | Mobile PWA + Offline | 3 weeks | Full mobile experience beyond Telegram |
| **10** | Multi-Agent System | 6 weeks | Specialized sub-agents for higher quality |
| **11** | Payroll + Inventory | 6 weeks | Close remaining QB feature gaps |
| **12** | AI-Native Moat | 4 weeks | Capabilities no traditional tool can match |

---

## Phase 8: Financial Copilot (4 weeks)

**Goal:** The agent goes from recording transactions to actively advising on financial decisions. This is the moment AgentBook stops being "accounting software" and becomes "your CFO."

### User Stories

**US-8.1: Subscription Audit**
> As a freelancer, I want the agent to identify SaaS subscriptions I'm paying for but not using, so I can cut waste.

- Agent analyzes recurring expenses by vendor
- Cross-references with login frequency data (if available) or amount patterns
- "You're paying $127/month for 3 services you haven't used since January. Cancel to save $1,524/year."
- [Cancel suggestions] [Keep all] [Review each]

**US-8.2: Client Concentration Risk**
> As a consultant, I want the agent to warn me when too much revenue depends on one client, so I can diversify.

- Agent calculates revenue share per client
- Alert when any single client exceeds 40% of revenue
- "73% of your revenue comes from Acme Corp. If they leave, your monthly income drops from $12K to $3.2K."
- Includes diversification suggestions

**US-8.3: Seasonal Pattern Detection**
> As a freelancer, I want the agent to identify seasonal patterns in my income and expenses, so I can plan cash reserves.

- Agent analyzes 12+ months of data for cyclical patterns
- "Your revenue peaks in March and September. Q2 and Q4 are typically 35% lower. Consider setting aside $4,200 from Q1 to cover Q2."
- Cash reserve recommendation based on seasonal low points

**US-8.4: Smart Pricing Suggestions**
> As a consultant, I want the agent to analyze my billing data and suggest rate changes, so I maximize revenue.

- Calculates effective hourly rate per client (including unbilled admin time from time tracking)
- Compares across clients: "Your effective rate for WidgetCo is $85/hr after scope creep. Other clients average $140/hr."
- Suggests: "A 15% rate increase to WidgetCo would add $3,600/year"

**US-8.5: Multi-Year Tax Planning**
> As a self-employed person, I want the agent to model my tax liability across multiple years, so I can make strategic decisions.

- "If you contribute $6,500 to SEP-IRA this year, your 3-year tax savings would be $4,800"
- "Deferring $5,000 of income to January saves $1,100 this year but increases next year's Q1 estimate by $1,500"
- Interactive scenario: user inputs potential decisions, agent shows multi-year impact

### Architecture Decisions

**AD-8.1: Analytics Pipeline (Batch + Real-time)**
- **Current:** Reports computed on-demand per API request
- **Phase 8:** Background analytics pipeline that pre-computes insights daily
  - Nightly cron: runs subscription analysis, concentration check, pattern detection
  - Results stored in `AbInsight` table with expiry and priority
  - Dashboard surfaces top insights; Telegram delivers the highest-priority ones
- **Why:** Complex analytics (seasonal detection, multi-year modeling) are too expensive to compute per-request. Pre-computation enables sub-second dashboard loads.

**AD-8.2: Insight Confidence Scoring**
- Every insight has a `confidence` field (0-1)
- Low-confidence insights (< 0.7) are shown as "possible" with caveats
- High-confidence insights (> 0.9) are stated as recommendations
- Confidence improves as more data accumulates (1 month of data = low, 12 months = high)

### New Components
- Skill: `financial-copilot` (subscription audit, concentration analysis, seasonal detection, pricing suggestions, multi-year tax modeling)
- Prisma: `AbInsight` (tenantId, type, confidence, data, expiresAt, acted_on)
- Proactive handlers: subscription-audit, concentration-warning, seasonal-alert, pricing-suggestion
- Cron: `/api/v1/agentbook/cron/nightly-insights` (runs analytics pipeline)
- Dashboard: Insights feed on main dashboard, dedicated Insights page

---

## Phase 9: Mobile PWA + Offline (3 weeks)

**Goal:** Full mobile experience beyond Telegram. Freelancers need to snap receipts on the go, even without connectivity.

### User Stories

**US-9.1: Offline Receipt Capture**
> As a freelancer at a restaurant with no WiFi, I want to snap a receipt and have it processed when I'm back online.

- PWA with Service Worker queues photos offline
- Syncs automatically when connectivity returns
- Status indicator: "3 receipts pending upload"
- Background sync via Service Worker `sync` event

**US-9.2: GPS Mileage Tracking**
> As a consultant who drives to client sites, I want automatic mileage logging without opening any app.

- Background GPS tracking via Service Worker Geolocation API
- Auto-detect trips (movement start/stop)
- Classify: [Business] [Personal] via swipe gesture
- Calculates deduction at jurisdiction mileage rate (IRS/CRA/HMRC/ATO)

**US-9.3: Push Notifications**
> As a user, I want financial alerts on my phone even when I'm not in Telegram.

- Web Push API alongside Telegram notifications
- User chooses preference: Telegram only, Push only, or both
- Critical alerts (cash flow warning, tax deadline) always push
- Informational (weekly review) respects channel preference

**US-9.4: Offline Dashboard**
> As a freelancer, I want to check my cash position even when offline.

- Dashboard data cached via Service Worker Cache API
- Last-known values shown with "Last updated: 2h ago" indicator
- Expense list, invoice list, trial balance all cached
- Stale data clearly marked

**US-9.5: Biometric Auth**
> As a user, I want to unlock AgentBook with FaceID/fingerprint, not type a password every time.

- Web Authentication API (WebAuthn) for passkey support
- FaceID/TouchID/fingerprint on supported devices
- Falls back to password on unsupported browsers

### Architecture Decisions

**AD-9.1: Service Worker Strategy**
- **Cache-first** for static assets (CSS, JS, images)
- **Network-first with cache fallback** for API data (expenses, invoices, trial balance)
- **Background sync** for queued operations (receipt upload, expense recording)
- Manifest.json for "Add to Home Screen" prompt

**AD-9.2: Offline Queue with Conflict Resolution**
- Offline actions stored in IndexedDB
- On reconnect: replay queue in order
- Conflict: if expense was already created by another device, detect via idempotency key
- Never auto-resolve conflicts for financial data — surface to user

### New Components
- `apps/web-next/public/sw.js` — Service Worker
- `apps/web-next/public/manifest.json` — PWA manifest
- New skill: `gps-mileage` (background tracking, trip detection, rate calculation)
- Offline queue in IndexedDB with sync manager

---

## Phase 10: Multi-Agent System (6 weeks)

**Goal:** Evolve from a single orchestrator to specialized sub-agents that collaborate. Each agent is an expert in its domain.

### User Stories

**US-10.1: Bookkeeper Agent**
> As a user, I want the bookkeeper agent to handle ALL expense recording, categorization, and reconciliation automatically without my involvement after the first month of training.

- Owns: expense recording, categorization, vendor patterns, bank reconciliation
- Goal: > 95% auto-categorization accuracy, < 5% exception rate on reconciliation
- Only escalates truly ambiguous items

**US-10.2: Tax Strategist Agent**
> As a user, I want a dedicated tax agent that continuously monitors my tax position and proactively optimizes it.

- Owns: tax estimation, quarterly payments, deduction hunting, tax form generation
- Monitors: income velocity, bracket proximity, deduction opportunities
- Proactive: "You're $3,000 from the next bracket. Here are 3 things to do before Dec 31."
- Jurisdiction-aware: switches strategies based on US/CA/UK/AU rules

**US-10.3: Collections Agent**
> As a user, I want the collections agent to ensure I get paid on time without me sending awkward reminder emails.

- Owns: invoice follow-up, payment prediction, escalation
- Learns per-client optimal reminder timing
- Adjusts tone: gentle first reminder, firm second, urgent third
- "Acme usually pays 3 days after the second reminder. Sending now."

**US-10.4: Insights Agent**
> As a user, I want the insights agent to discover patterns in my financial data that I can't see.

- Owns: analytics, projections, anomaly detection, business intelligence
- Runs nightly analytics pipeline
- Surfaces top 3 insights per week via Telegram
- "Your effective hourly rate dropped 15% this month because of 20 hours of unbilled admin work for WidgetCo."

**US-10.5: Agent Configuration**
> As a user, I want to configure how aggressive each agent is, so it matches my working style.

- Slider: "Collections aggressiveness" (gentle ↔ firm)
- Toggle: "Auto-send reminders" vs "Ask me first"
- Toggle: "Auto-categorize high-confidence" vs "Always confirm"
- Per-agent engagement preferences

### Architecture Decisions

**AD-10.1: Agent-to-Agent Communication Protocol**
- Sub-agents communicate via the event bus (same `emitEvent()` interface)
- Events: `bookkeeper.expense_recorded` → Tax Strategist recalculates estimate
- Events: `collections.invoice_overdue` → Insights Agent updates cash flow projection
- Orchestrator delegates intents to the correct sub-agent based on intent type
- Sub-agents can request data from each other via typed service interfaces

**AD-10.2: Agent Memory Isolation**
- Each sub-agent has its own memory scope (patterns, preferences, learned behaviors)
- Bookkeeper: vendor patterns, categorization rules
- Tax Strategist: deduction checklist, bracket history
- Collections: per-client reminder timing, response patterns
- Shared: tenant config, chart of accounts, journal entries (read-only for non-bookkeeper agents)

**AD-10.3: Agent Quality Metrics**
- Each agent has measurable performance metrics
- Bookkeeper: categorization accuracy, reconciliation match rate, exception rate
- Tax Strategist: tax savings identified, estimate accuracy (vs actual filing)
- Collections: days sales outstanding (DSO) reduction, payment prediction accuracy
- Insights: user action rate on surfaced insights

### New Components
- `packages/agentbook-framework/src/multi-agent/` — Agent coordinator, sub-agent base class
- `packages/agentbook-framework/src/multi-agent/bookkeeper-agent.ts`
- `packages/agentbook-framework/src/multi-agent/tax-strategist-agent.ts`
- `packages/agentbook-framework/src/multi-agent/collections-agent.ts`
- `packages/agentbook-framework/src/multi-agent/insights-agent.ts`
- Agent configuration UI (per-agent sliders/toggles)
- Agent performance dashboard (accuracy metrics per agent)

---

## Phase 11: Payroll + Inventory (6 weeks)

**Goal:** Close the two biggest remaining feature gaps vs QuickBooks.

### Payroll (3 weeks)
- Employee records, salary/hourly configuration
- Pay run calculation: gross → deductions (tax, benefits) → net
- Direct deposit integration (via Stripe/payment processor)
- Tax withholding: federal + state (US), federal + provincial (CA)
- Payroll tax filings: W-2/T4 year-end
- Proactive: "Payroll for 3 employees is due Friday. Total: $8,400. [Approve] [Review]"

### Inventory (3 weeks)
- SKU management, cost tracking per item
- Quantity on hand, reorder point alerts
- COGS (Cost of Goods Sold) calculation
- Purchase orders: create, receive, track
- Proactive: "Widget stock is down to 12 units (reorder point: 20). Create PO for 50? [Yes] [Skip]"

### Architecture Decision

**AD-11.1: Payroll as Jurisdiction Pack Extension**
- Payroll tax rules vary by country even more than income tax
- Add `PayrollTaxCalculator` interface to jurisdiction packs
- US: federal withholding tables, FICA (SS + Medicare), state withholding
- CA: federal withholding, CPP, EI, provincial withholding
- Same extensible pattern: new country = implement interface, zero framework changes

---

## Phase 12: AI-Native Moat (4 weeks)

**Goal:** Build capabilities that are structurally impossible for QuickBooks/Wave to replicate.

### Conversational Financial Memory
- "What did I spend on travel last quarter?" → semantic search over all transactions
- "Compare my expenses this March vs last March" → temporal reasoning
- "Why was last month's tax estimate so high?" → causal explanation from ledger changes
- Powered by: vector embeddings of transactions + LLM reasoning

### Autonomous Workflow Composition
- User describes a workflow: "Every Friday, if Acme hasn't paid, send a reminder. If it's been 30 days, send a firm letter. If 60 days, flag for my review."
- Agent compiles this into a skill composition (invoice-followup + payment-prediction + escalation)
- Stored as a custom automation, runs autonomously
- "Workflow 'Acme Collections' ran: sent reminder #2 (firm tone). Acme typically pays within 3 days of firm reminder."

### Financial Digital Twin
- Agent maintains a real-time model of the user's complete financial state
- Can simulate any change: "If I hire a contractor at $5K/month, what happens to my cash flow and taxes?"
- Shows: cash projection, tax impact, profitability change, break-even timeline
- Updated continuously as new data arrives

### Architecture Decision

**AD-12.1: Vector Embeddings for Financial Memory**
- Each transaction gets a vector embedding (description + amount + vendor + category + date)
- Stored in pgvector (PostgreSQL extension) or dedicated vector DB
- Enables: semantic search ("travel expenses"), temporal queries, anomaly clustering
- Embedding model: run via service-gateway (same configurable LLM pattern)

**AD-12.2: Workflow DSL (Domain-Specific Language)**
- Custom automations described in a simple YAML/JSON DSL
- Compiled to skill compositions at runtime
- Stored in `AbAutomation` table (tenantId, name, definition, active)
- Framework validates: all referenced skills exist, triggers are valid, actions are authorized
- Human-in-the-loop: all automations have escalation points

---

## Timeline Summary

| Phase | Duration | Cumulative |
|-------|----------|------------|
| 0-7 (done) | 21 weeks | 21 weeks |
| **8: Financial Copilot** | 4 weeks | 25 weeks |
| **9: Mobile PWA** | 3 weeks | 28 weeks |
| **10: Multi-Agent** | 6 weeks | 34 weeks |
| **11: Payroll + Inventory** | 6 weeks | 40 weeks |
| **12: AI-Native Moat** | 4 weeks | 44 weeks |

**Total to full product: ~44 weeks (11 months) from start.**
Phase 0-7 (MVP + production + time tracking) is complete.
Remaining: 23 weeks (6 months) for Phases 8-12.

---

## Key Metrics to Track (from beyond-mvp.md)

| Metric | Target | Phase Achieved |
|--------|--------|----------------|
| Time to first expense | < 5 minutes | Phase 6 (onboarding) |
| Receipt-to-expense time | < 10 seconds | Phase 0 (framework) |
| Auto-categorization accuracy | > 95% at 30 days | Phase 3 (pattern learning) |
| Proactive message action rate | > 40% | Phase 3 (engagement tuning) |
| Monthly active Telegram sessions | > 20/tenant | Phase 0 (Telegram bot) |
| Trial-to-paid conversion | > 15% | Phase 5 (billing plans) |
| CPA satisfaction score | > 4.5/5 | Phase 6 (CPA portal) |
| Tax savings identified per user/year | > $2,000 | Phase 8 (financial copilot) |
| Days Sales Outstanding reduction | > 20% | Phase 10 (collections agent) |
| Workflow automation adoption | > 30% of users | Phase 12 (AI moat) |
