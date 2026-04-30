# AgentBook MVP Development Skill

## Purpose

This skill captures the complete context, architecture decisions, patterns, and implementation details of the AgentBook MVP (Phases 0-5). Use it when continuing AgentBook development, onboarding new contributors, or maintaining consistency with established patterns.

---

## Product Context

**AgentBook** is an agent-based accounting system built as A3P plugins. It targets self-employed individuals and small business owners (freelancers, consultants, micro-agencies) in the US and Canada, with extensible jurisdiction support for UK, EU, and Australia.

**Core differentiator:** AgentBook is not a tool you use — it is a professional that works for you. Unlike QuickBooks (reactive UI) and Wave (reactive UI), AgentBook proactively monitors your finances, hunts for tax savings, chases overdue invoices, and learns from your patterns.

**Primary interfaces:** Telegram bot (primary, natural language), Web dashboard (visual analytics), Vercel cron jobs (proactive engagement).

---

## Architecture Patterns (Always Follow These)

### 1. Agent Proposes, Constraint Engine Disposes
- The LLM generates plans and actions
- The constraint engine validates with deterministic code
- These are NEVER the same component
- Constraints: `balance_invariant` (debits=credits), `period_gate` (no entries to closed periods), `amount_threshold` (escalation above limit), `immutability_invariant` (no mutation of journal entries)
- Constraints are in `packages/agentbook-framework/src/constraint-engine.ts`

### 2. Skills Are Decoupled from Framework
- All domain knowledge lives in `skills/` directories
- Each skill has: `skill.json` manifest + `handler.ts` implementation + `prompts/` directory
- Skills can be hot-reloaded without restarting the framework
- Adding a new capability = adding a new skill, not changing the framework
- Current skills (17): expense-recording, receipt-ocr, invoice-creation, tax-estimation, stripe-payments, bank-sync, anomaly-detection, deduction-hunting, pattern-learning, expense-analytics, earnings-projection, tax-forms, contractor-reporting, mileage-tracking, year-end-closing, data-export, multi-user, onboarding, skill-marketplace

### 3. Proactive, Not Just Reactive
- Every feature has BOTH a reactive path (user asks) and a proactive path (agent initiates)
- Proactive handlers in `packages/agentbook-framework/src/proactive-handlers/`
- Current handlers (18): daily-pulse, weekly-review, invoice-followup, payment-received, recurring-anomaly, receipt-reminder, tax-deadline, deduction-alert, bank-anomaly, reconciliation-nudge, bracket-alert, cash-flow-warning, spending-trend, earnings-milestone, payment-prediction, engagement-tuner, year-end-planning, contractor-threshold, year-end-closing-checklist
- All handlers return `ProactiveMessage` with i18n keys + one-tap action buttons
- Anti-annoyance: quiet hours, priority ranking, engagement-driven frequency tuning, snooze/dismiss

### 4. Jurisdiction Packs (Not Hardcoded Tax Rules)
- Tax rules, chart of accounts, sales tax, deadlines, mileage rates, deductions — all in jurisdiction packs
- Location: `packages/agentbook-jurisdictions/src/{us,ca,uk,au}/`
- Each pack implements 9 interfaces: TaxBracketProvider, SelfEmploymentTaxCalculator, SalesTaxEngine, ChartOfAccountsTemplate, InstallmentSchedule, ContractorReportGenerator, MileageRateProvider, DeductionRuleSet, CalendarDeadlineProvider
- Adding a new country = copy `_template/`, implement interfaces, register in loader. Zero framework changes.

### 5. Verify Then Commit (Never Speculative)
- Journal entries are staged, verified independently, then committed
- Verifier (`packages/agentbook-framework/src/verifier.ts`) uses adversarial prompt + programmatic checks
- Verification failure → rollback BEFORE commit
- This is a separate LLM call from the executor

### 6. i18n From Day One
- Every user-facing string goes through `t()` function
- Locale files in `packages/agentbook-i18n/src/locales/{en,fr}/`
- Formatters: `formatCurrency()`, `formatDate()`, `formatNumber()` — all locale-aware
- Adding a new language = copy `_template/`, translate JSON files, zero code changes

### 7. Dual-Mode Deployment (Local Docker + Vercel Serverless)
- Local: Docker PostgreSQL + Express backends on ports 4050-4053 + Kafka for events
- Production: Vercel Functions + Neon PostgreSQL + DB-backed events (no Kafka)
- Same code, same interfaces, environment-switched backends
- Event bus: `emitEvent()` works identically in both modes

---

## Database Schema Patterns

### Schema Organization
- 4 PostgreSQL schemas: `plugin_agentbook_core`, `plugin_agentbook_expense`, `plugin_agentbook_invoice`, `plugin_agentbook_tax`
- All models use `@@schema("plugin_agentbook_*")` decorators
- 23 Prisma models total
- All amounts stored as integer cents (Int, not Float)
- Every table has `tenantId` for isolation
- Cross-schema relations work via shared database

### Key Models
- **AbTenantConfig**: jurisdiction, region, currency, locale, timezone, auto-approve limit
- **AbJournalEntry + AbJournalLine**: double-entry ledger (immutable once created)
- **AbExpense + AbVendor + AbPattern**: expense tracking with learned categorization
- **AbInvoice + AbClient + AbPayment**: full invoice lifecycle
- **AbTaxEstimate + AbQuarterlyPayment + AbDeductionSuggestion**: tax planning
- **AbBankAccount + AbBankTransaction + AbStripeWebhookEvent**: integrations
- **AbCalendarEvent + AbEngagementLog**: proactive engine state
- **AbTenantAccess + AbCPANote + AbOnboardingProgress**: multi-user + onboarding

---

## Plugin Structure Pattern

Every AgentBook plugin follows this structure:
```
plugins/agentbook-{name}/
  ├── plugin.json                    # Manifest: name, ports, routes, navigation
  ├── backend/
  │   ├── package.json               # Express + Prisma deps
  │   ├── src/server.ts              # createPluginServer + routes
  │   └── src/db/client.ts           # PrismaClient singleton
  └── frontend/
      ├── package.json               # React + Vite deps
      ├── vite.config.ts             # createPluginConfig from @naap/plugin-build
      ├── tailwind.config.js         # extends packages/theme/tailwind-extend.cjs (same as web-next)
      └── src/
          ├── App.tsx                 # createPlugin({ name, version, routes, App })
          ├── mount.tsx              # UMD global registration
          ├── globals.css            # @import @naap/theme/shell-variables.css + @tailwind (no ad-hoc :root)
          └── pages/                 # React page components
```

### Frontend styling (shell alignment)

- **Tailwind:** `theme.extend` must come from [`packages/theme/tailwind-extend.cjs`](../packages/theme/tailwind-extend.cjs) so utilities like `bg-primary`, `text-foreground`, `bg-muted`, `border-border` compile into the UMD CSS bundle (not only when embedded in web-next).
- **CSS variables:** Import [`packages/theme/src/shell-variables.css`](../packages/theme/src/shell-variables.css) at the top of `globals.css` (same definitions as `apps/web-next` via `@import '@naap/theme/shell-variables.css'`). Do not maintain a separate `:root` / `.dark` palette in the plugin.
- **Semantics:** Prefer framework tokens (`bg-card`, `text-muted-foreground`, `border-border`, `bg-primary`, brand `accent-*`) over raw Tailwind palette grays (`gray-*`, `blue-600`) or invented variables (`--border-primary`).
- **Dev deps:** Include `@tailwindcss/typography` and `@tailwindcss/forms` when using the shared preset (matches web-next).

### Backend Pattern
```typescript
const { app, start } = createPluginServer({
  ...pluginConfig,
  requireAuth: process.env.NODE_ENV === 'production',
  publicRoutes: ['/healthz', '/api/v1/agentbook-{name}'],
});

// Tenant isolation middleware
app.use((req, res, next) => {
  (req as any).tenantId = req.headers['x-tenant-id'] as string || 'default';
  next();
});

// Routes use full paths: /api/v1/agentbook-{name}/{resource}
app.get('/api/v1/agentbook-{name}/resource', async (req, res) => { ... });
```

### Frontend Pattern
```typescript
// App.tsx — createPlugin with object syntax (NOT passing component directly)
const plugin = createPlugin({
  name: 'agentbook-{name}',
  version: '1.0.0',
  routes: ['/agentbook/{path}', '/agentbook/{path}/*'],
  App: MyAppComponent,
});
export const mount = plugin.mount;
export default plugin;
```

---

## Proactive Handler Pattern

```typescript
import type { ProactiveMessage } from '../proactive-engine.js';

export interface HandlerData {
  tenantId: string;
  // ... handler-specific fields
}

export function handleSomething(data: HandlerData): ProactiveMessage | null {
  // Return null to skip (nothing to alert about)
  if (!shouldAlert(data)) return null;

  return {
    id: `unique-id-${data.tenantId}-${Date.now()}`,
    tenant_id: data.tenantId,
    category: 'daily_pulse',         // determines grouping + frequency tuning
    urgency: 'important',            // critical | important | informational
    title_key: 'proactive.xxx',      // i18n key
    body_key: 'proactive.xxx',       // i18n key with {param} interpolation
    body_params: { ... },            // values for interpolation
    actions: [                       // one-tap Telegram inline keyboard buttons
      { label_key: 'common.view_details', callback_data: 'view:xxx', style: 'primary' },
      { label_key: 'proactive.remind_later', callback_data: 'snooze_1d:xxx' },
    ],
  };
}
```

---

## Skill Manifest Pattern

```json
{
  "name": "skill-name",
  "version": "1.0.0",
  "description": "What this skill does",
  "intents": ["intent_type_1", "intent_type_2"],
  "tools": [
    {
      "name": "tool_name",
      "description": "What this tool does",
      "input_schema": { ... },
      "output_schema": { ... },
      "constraints": ["balance_invariant"],
      "compensation": "void_tool_name",
      "model_tier": "haiku"
    }
  ],
  "prompts": {
    "prompt_name": { "version": "1.0", "file": "prompts/prompt-name.md" }
  },
  "dependencies": ["agentbook-core"]
}
```

---

## Key Decisions Made (and Why)

| Decision | Rationale |
|----------|-----------|
| Telegram-first, not web-first | Freelancers need frictionless, always-available access. Photo receipts, inline buttons, proactive alerts. |
| Plugin-per-domain, not monolith | Independent deployment, testing, versioning. Invoice plugin updated without touching ledger. |
| Constraints as code, not LLM prompts | LLMs can be convinced to ignore instructions. Programmatic gates cannot be bypassed. |
| Event sourcing for audit trail | Tax compliance requires tamper-proof history. Events enable reconstruction. |
| Integer cents, not floats | Financial precision. $45.99 = 4599 cents. No floating-point rounding errors. |
| Dual-mode event bus | Same code for Kafka (local) and DB (Vercel). Environment-switched, not code-switched. |
| Skills decoupled from framework | IRS rate changes = skill update, not framework change. Hot-reloadable. |
| Jurisdiction packs, not hardcoded rules | Adding a country = implementing interfaces in a new directory. Zero framework changes. |
| i18n from day one | Retrofitting i18n is 10x harder. Every string uses t() from the start. |
| Proactive as core architecture | Not a Phase 3 bolt-on. Proactive handlers are peer-level with reactive handlers. |
| LLM via service-gateway | Configurable backend (Claude/GPT/local). API keys in vault. Cost tracking per tenant. |
| Mobile-first dashboard | 2x2 grid on mobile, horizontal scroll quick actions, touch targets >= 44px. |
| Immutable journal entries | 403 on PUT/PATCH/DELETE. Corrections via reversing entries only. Audit trail integrity. |

---

## Testing Patterns

### E2E Tests (Playwright)
- Location: `tests/e2e/agentbook.spec.ts` + `tests/e2e/phase4.spec.ts`
- 60 tests covering: API endpoints, proxy routes, CDN bundles, browser login, tenant isolation, constraint enforcement
- Run: `cd tests/e2e && npx playwright test --config=playwright.config.ts`

### Unit Tests (Vitest)
- 19 test files across framework, i18n, jurisdictions, backends, telegram
- Pattern: `src/__tests__/module-name.test.ts`
- Run: `npx vitest run` in each package directory

### What to Test for Every New Feature
1. Happy path (feature works correctly)
2. Constraint enforcement (balance check, period gate, amount threshold)
3. Tenant isolation (data from tenant A invisible to tenant B)
4. Immutability (journal entries cannot be modified)
5. Audit trail (AbEvent created for every mutation)
6. i18n (strings use t() keys, not hardcoded English)

---

## Development Workflow

```bash
# Start local dev
docker compose up -d database
cd packages/database && DATABASE_URL="..." npx --no prisma db push --skip-generate
cd ../..

# Start backends
DATABASE_URL="..." PORT=4050 npx tsx plugins/agentbook-core/backend/src/server.ts &
DATABASE_URL="..." PORT=4051 npx tsx plugins/agentbook-expense/backend/src/server.ts &
DATABASE_URL="..." PORT=4052 npx tsx plugins/agentbook-invoice/backend/src/server.ts &
DATABASE_URL="..." PORT=4053 npx tsx plugins/agentbook-tax/backend/src/server.ts &

# Start Next.js
cd apps/web-next && npm run dev &

# Build plugin UMD bundles (for CDN)
for p in agentbook-core agentbook-expense agentbook-invoice agentbook-tax; do
  cd plugins/$p/frontend && npx vite build --mode production && cd ../../..
  cp plugins/$p/frontend/dist/production/* apps/web-next/public/cdn/plugins/$p/1.0.0/
done

# Seed database
DATABASE_URL="..." npx tsx apps/web-next/prisma/seed.ts

# Run tests
cd tests/e2e && npx playwright test --config=playwright.config.ts

# Login: admin@a3p.io / a3p-dev
```

---

## File Counts (Final MVP)

```
Packages:       5 (@agentbook/framework, i18n, jurisdictions, telegram + Prisma models)
Plugins:        4 (core, expense, invoice, tax)
Skills:         17
Proactive:      18 handlers
Prisma models:  23
Dashboard pages: 22
Unit tests:     19 files
E2E tests:      60
Locales:        2 (en, fr-CA)
Jurisdictions:  4 (US, CA, UK, AU)
Total files:    ~290
Total lines:    ~24,000
```
