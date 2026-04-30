# AgentBook Architecture Reference

## System Overview

AgentBook is an AI-powered accounting system built as 4 plugins within the A3P (Agent as a Product) platform. It targets freelancers and small businesses with agent-based bookkeeping, invoicing, tax management, and financial intelligence.

## Plugin Architecture

```
apps/web-next/          → Next.js 15 frontend (port 3000)
  └── public/cdn/plugins/  → UMD plugin bundles served as static files

plugins/
  agentbook-core/       → Ledger, accounts, agents, AI features (port 4050)
  agentbook-expense/    → Expenses, receipts, OCR, bank/Plaid, AI advisor (port 4051)
  agentbook-invoice/    → Invoices, clients, payments, time tracking (port 4052)
  agentbook-tax/        → Tax estimation, reports, deductions (port 4053)

packages/
  database/             → Prisma schema (41 models, 7 schemas, PostgreSQL)
  agentbook-framework/  → Core framework: orchestrator, skills, proactive engine, AGI
  agentbook-i18n/       → i18n (en + fr-CA)
  agentbook-jurisdictions/ → US, CA, UK, AU tax/compliance packs
  agentbook-telegram/   → Grammy bot (webhook mode, serverless)
```

## Database Schema (41 Models, 7 Schemas)

| Schema | Models | Purpose |
|--------|--------|---------|
| `public` | User, Session, Role, Team, etc. | Platform auth & teams |
| `plugin_agentbook_core` | TenantConfig, Account, JournalEntry, JournalLine, FiscalPeriod, Event, Automation, FinancialSnapshot, Conversation, AgentConfig, AgentPersonality, LearningEvent, etc. | Ledger, agents, AI |
| `plugin_agentbook_expense` | Expense, ExpenseSplit, Vendor, Pattern, RecurringRule, BankAccount, BankTransaction | Expense tracking, bank |
| `plugin_agentbook_invoice` | Client, Invoice, InvoiceLine, Payment, Estimate, Project, TimeEntry, CreditNote, RecurringInvoice | Invoicing, time |
| `plugin_agentbook_tax` | TaxEstimate, QuarterlyPayment, DeductionSuggestion, TaxConfig, SalesTaxCollected | Tax & compliance |

### Key Patterns
- All amounts in **integer cents** (no floats)
- Tenant isolation via `tenantId` on every model
- Double-entry ledger: every financial transaction creates `AbJournalEntry` + `AbJournalLine`s
- Event sourcing: `AbEvent` logs every mutation for audit trail
- `@@unique` constraints prevent duplicates (e.g., `[tenantId, number]` on invoices)

## API Endpoints (140 total)

| Plugin | Port | Endpoints | Key Routes |
|--------|------|-----------|------------|
| Core | 4050 | 49 | `/ask`, `/simulate`, `/money-moves`, `/autopilot`, `/automations`, `/personality`, `/financial-snapshot` |
| Expense | 4051 | 37 | `/expenses`, `/receipts/ocr`, `/receipts/upload-blob`, `/advisor/insights`, `/advisor/chart`, `/advisor/ask`, `/advisor/proactive-alerts`, `/plaid/*`, `/bank-sync`, `/import/cc-statement`, `/review-queue` |
| Invoice | 4052 | 34 | `/invoices`, `/clients`, `/payments`, `/credit-notes`, `/recurring-invoices`, `/timer/*`, `/time-entries`, `/project-profitability` |
| Tax | 4053 | 20 | `/tax/estimate`, `/tax/quarterly`, `/tax/deductions`, `/reports/pnl`, `/reports/balance-sheet`, `/reports/cashflow`, `/cashflow/projection` |

## Frontend (26 Pages)

Each plugin has a React UMD bundle loaded by the web-next shell via `PluginLoader`. Uses `MemoryRouter` with `getInitialRoute()` to map URL paths to internal routes.

Build: `cd plugins/<name>/frontend && npm run build` → copies to `apps/web-next/public/cdn/plugins/`

## LLM Integration (Gemini)

- Provider config stored in `AbLLMProviderConfig` (DB, not env)
- Each plugin has its own `callGemini()` helper (no cross-plugin dependency)
- Used for: conversational Q&A, chart annotations, receipt OCR, workflow generation, what-if narratives
- Template fallback when LLM is unavailable — never errors to users

## Multi-Agent System

4 agents: Bookkeeper, Tax Strategist, Collections, Insights
- Per-tenant personality (communication style, proactive level, risk tolerance)
- Self-adapting based on user engagement patterns
- 22 skills loaded dynamically per agent
- Trust curve: agents earn autonomy over time

## Proactive Engine

23 handlers generate alerts (spending spikes, tax deadlines, missing receipts, etc.)
4 cron jobs: daily-pulse, weekly-review, calendar-check, recurring-invoices

## External Integrations

| Integration | Status | Details |
|------------|--------|---------|
| Plaid (bank) | Live (sandbox) | Link token, account sync, transaction import, auto-matching |
| Gemini LLM | Live | Vision OCR, Q&A, annotations, workflow generation |
| Telegram | Live (dev) | Photo/PDF OCR, expense recording, proactive alerts, inline keyboards |
| Stripe | Stub | Webhook endpoint exists, Connect OAuth not live |
| Vercel Blob | Configured | Receipt storage (falls back to local in dev) |

## Auth & Tenant Flow

```
Browser login → naap_auth_token cookie → Next.js proxy extracts user ID → sets x-tenant-id header → backend uses for all queries
Telegram → chat ID → CHAT_TO_TENANT mapping → same x-tenant-id flow
```
