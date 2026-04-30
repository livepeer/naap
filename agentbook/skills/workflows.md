# AgentBook Key Workflows & Implementation Guide

## File Locations Quick Reference

### Backend (Express servers)
| Plugin | Server File | Port |
|--------|------------|------|
| Core | `plugins/agentbook-core/backend/src/server.ts` | 4050 |
| Expense | `plugins/agentbook-expense/backend/src/server.ts` | 4051 |
| Invoice | `plugins/agentbook-invoice/backend/src/server.ts` | 4052 |
| Tax | `plugins/agentbook-tax/backend/src/server.ts` | 4053 |

### Frontend (React UMD plugins)
| Plugin | Pages Directory | Build & Deploy |
|--------|----------------|----------------|
| Core | `plugins/agentbook-core/frontend/src/pages/` | `npm run build` → copy to `apps/web-next/public/cdn/plugins/agentbook-core/` |
| Expense | `plugins/agentbook-expense/frontend/src/pages/` | Same pattern |
| Invoice | `plugins/agentbook-invoice/frontend/src/pages/` | Same pattern |
| Tax | `plugins/agentbook-tax/frontend/src/pages/` | Same pattern |

### Key Infrastructure
| Component | Location |
|-----------|----------|
| Prisma schema | `packages/database/prisma/schema.prisma` |
| Telegram webhook | `apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts` |
| Telegram bot library | `packages/agentbook-telegram/src/bot.ts` |
| Cron jobs | `apps/web-next/src/app/api/v1/agentbook/cron/` |
| API proxy (generic) | `apps/web-next/src/app/api/v1/[plugin]/[...path]/route.ts` |
| API proxy (dedicated) | `apps/web-next/src/app/api/v1/agentbook/{core,expense,invoice,tax}/[...path]/route.ts` |
| Middleware (routing) | `apps/web-next/src/middleware.ts` — PLUGIN_ROUTE_MAP |
| AGI features | `packages/agentbook-framework/src/agi/` |
| Proactive handlers | `packages/agentbook-framework/src/proactive-handlers/` |
| Skills | `packages/agentbook-framework/src/skills/` |
| Jurisdiction packs | `packages/agentbook-jurisdictions/src/` |

## Common Development Patterns

### Adding a new API endpoint
1. Add route in the plugin's `server.ts` (before `start()`)
2. Use `(req as any).tenantId` for tenant isolation
3. Wrap mutations in `db.$transaction()` for atomicity
4. Create `AbEvent` inside the transaction for audit trail
5. Return `{ success: true, data: ... }` or `{ success: false, error: '...' }`

### Adding a new frontend page
1. Create component in `plugins/<name>/frontend/src/pages/NewPage.tsx`
2. Add route in `plugins/<name>/frontend/src/App.tsx` (both `<Route>` and `routes[]`)
3. Add URL mapping in `getInitialRoute()` function
4. Add route to `plugins/<name>/plugin.json` frontend.routes
5. Add path to middleware PLUGIN_ROUTE_MAP in `apps/web-next/src/middleware.ts` (if new prefix)
6. Build: `npm run build` → copy UMD to `apps/web-next/public/cdn/plugins/`

### Adding a new Prisma model
1. Add model to `packages/database/prisma/schema.prisma` with `@@schema("plugin_agentbook_xxx")`
2. Run: `DATABASE_URL=... DATABASE_URL_UNPOOLED=... npx prisma db push --skip-generate`
3. Run: `DATABASE_URL=... DATABASE_URL_UNPOOLED=... npx prisma generate`
4. Restart affected backend(s)

### Using LLM (Gemini)
Each plugin has its own `callGemini(systemPrompt, userMessage, maxTokens)` function.
- Reads `AbLLMProviderConfig` from DB (provider, apiKey, model)
- Returns `string | null` (null = LLM unavailable)
- Always provide a template fallback — never show LLM errors to users
- Gemini API key: stored in DB via admin UI, not in env vars

### Telegram Integration
- Bot token in `apps/web-next/.env.local` as `TELEGRAM_BOT_TOKEN`
- Webhook: `POST /api/v1/agentbook/telegram/webhook`
- Chat ID → tenant mapping in `CHAT_TO_TENANT` object in webhook route
- `bot.init()` required before `handleUpdate()` in serverless
- Tunnel for local dev: `./agentbook/start-telegram.sh`

### Tenant Resolution (how user ID flows)
```
Web: login → cookie naap_auth_token → proxy reads session → sets x-tenant-id header
Telegram: chat.id → CHAT_TO_TENANT lookup → x-tenant-id header
API (direct): x-tenant-id header
Cookie override: ab-tenant cookie (for persona switching in dev)
```

### Expense Creation with Journal Entry
When creating an expense that should hit the books:
1. Find or create vendor (`abVendor.upsert` by normalized name)
2. Look up category from `AbPattern` (vendor pattern learning)
3. If category found + not personal: create `AbJournalEntry` (DR expense account, CR cash 1000)
4. Create `AbExpense` with `journalEntryId`, `categoryId`, `status: 'confirmed'`
5. If low confidence: `status: 'pending_review'`, skip journal entry until confirmed

### Bank Reconciliation
1. Plaid Link → `POST /plaid/create-link-token` → `POST /plaid/exchange-token`
2. `POST /bank-sync` → fetch transactions from Plaid API (last 30 days)
3. Auto-match: each bank txn checked against expenses (amount ±5%, date ±2 days)
4. Matched → `matchStatus: 'matched'`, linked via `matchedExpenseId`
5. Unmatched → `matchStatus: 'pending'` → proactive alert after 7 days

## Testing

### E2E Tests (Playwright)
```bash
cd tests/e2e && npx playwright test --config=playwright.config.ts
```

Key test files:
- `phase11-competitive-gaps.spec.ts` — 33 tests (invoicing, PDF, email, recurring, credit notes)
- `phase12-ai-native-moat.spec.ts` — 33 tests (conversational memory, workflows, digital twin, personality)
- `expense-advisor.spec.ts` — 10 tests (insights, charts, Q&A)
- `expense-gaps.spec.ts` — 14 tests (review queue, blob storage, OCR, CC import, proactive alerts)
- `ca-consultant-tax-2026.spec.ts` — 40 tests (Canadian tax scenario)

### Testing a Specific Feature
```bash
npx playwright test <filename>.spec.ts --config=playwright.config.ts
```

### After Backend Changes
Kill and restart the affected backend, then run tests:
```bash
lsof -i :<port> -t | xargs kill 2>/dev/null
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/naap" DATABASE_URL_UNPOOLED="postgresql://postgres:postgres@localhost:5432/naap" PORT=<port> npx tsx plugins/<name>/backend/src/server.ts &
```
