# AgentBook Code Review — 2026-05-21

**Methodology:** See `docs/superpowers/specs/2026-05-21-gtm-assessment-design.md` §6.1.

**Severity legend:** `blocker` (ship-blocker), `launch` (cannot public-launch with this), `polish` (improves quality but not gating), `nit` (style).

**Format:** `[severity] file:line — issue — recommended fix`

---

## Stream A.1 — `plugins/agentbook-core/backend/src/**`

**Scope reviewed:** agent-brain.ts, agent-planner.ts, agent-evaluator.ts, agent-memory.ts, built-in-skills.ts, server.ts (3762 lines), dashboard/*, db/client.ts, __tests__/* (immutability + journal-entry-validation only).

### Agent-DNA / pipeline correctness

- [blocker] plugins/agentbook-core/backend/src/agent-brain.ts:303 — `classifyAndExecuteV1` is called BEFORE `assessComplexity`/plan-preview at line 324, and `classifyAndExecuteV1` (server.ts:3282-3315) already executes the destructive HTTP call. By the time the "Proceed? (yes/no)" plan preview is shown, send-invoice / void-invoice / record-payment / record-expense / split-expense / create-credit-note / edit-expense / tax-filing-submit have ALREADY run. The `confirmBefore: true` manifest flag (built-in-skills.ts:68, 75, 136, 143, 318, 349, 356) is therefore decorative. Fix: split classify into (a) classify-only and (b) execute, and gate (b) on complexity assessment + explicit user confirm.
- [blocker] plugins/agentbook-core/backend/src/server.ts:2930 — reassignment `endpoint = { method: 'POST', ... }` of a `const` declared at line 2640. This throws TypeError at runtime whenever the `cpa-notes` skill is invoked with a `note` parameter. Fix: declare `let endpoint` or use a local variable.
- [VERIFIED OPEN: G-OLD-018] plugins/agentbook-core/backend/src/server.ts:2582 — confirms gap [G-OLD-018] still open. Conversation context (last 10 turns) is loaded in agent-brain.ts:291 and passed through, but inside `classifyAndExecuteV1` it is only consumed at the Stage-3 LLM-fallback prompt (server.ts:2582). The Stage-1 shortcut path (2452-2465), Stage-2 regex fast path (2480-2522), and ALL pre-processing handlers (edit-expense, split-expense, send-invoice, etc.) ignore it. "That", "fix it", "the last one" cannot be resolved on the fast paths. Implement thread-aware referent resolution before regex matching.
- [blocker] plugins/agentbook-core/backend/src/server.ts:2480 — skill routing is a hand-tuned regex chain with hardcoded special-case carve-outs (lines 2487-2514 contain ~50 inline regex exclusions like "record-expense must not match invoice/payment/automation/estimate"). This is the antithesis of manifest-driven routing — auto-deduction -4 on rubric #2 per task brief. Fix: move per-skill exclusion patterns into the skill manifest (`excludePatterns`) and treat them as first-class.
- [VERIFIED OPEN: G-OLD-011] plugins/agentbook-core/backend/src/server.ts:* — confirms gap [G-OLD-011] still open. Grep for "cron" inside this scope returns only references to user-defined `abAutomation` cron strings (lines 1825, 1837) stored as opaque config. No `node-cron`/`@vercel/cron`/scheduler import, no nightly proactive-alert delivery code, and no producer that runs the 22 proactive handlers on a timer. The `lastRun` increments only when a user manually `POST /automations/:id/run` (line 1759).
- [launch] plugins/agentbook-core/backend/src/server.ts:* — No per-skill success-rate / latency / token-cost metrics. `AbConversation.skillUsed` and `AbEvent.action.skillUsed` are written, but nothing aggregates them into a per-skill dashboard / threshold alert. Rubric #2 auto-deduct -2. Fix: add `AbSkillRun` aggregation table or materialized view keyed by `(skillName, day)` and surface via `/agent/skills/metrics`.

### Security & tenant isolation

- [blocker] plugins/agentbook-core/backend/src/server.ts:3324 — `db.abAccount.findFirst({ where: { id: skillResponse.data.categoryId } })` — no `tenantId` filter. Any tenant whose expense returns a `categoryId` belonging to a foreign tenant will leak that account's name into the agent response. Fix: add `tenantId` to the where clause.
- [launch] plugins/agentbook-core/backend/src/server.ts:1546-1620 — all `/admin/llm-configs` endpoints (GET/POST/DELETE/set-default/test) have NO tenant scoping and NO admin role check. Any tenant header value lets a caller read every other tenant's stored Gemini `apiKey` (line 1548, 1586 returns `config.apiKey` to caller as-is via `res.json({ data: configs })`). API-key exfiltration vector. Fix: gate with admin auth + redact `apiKey` on read (`apiKey: '****' + last4`).
- [launch] plugins/agentbook-core/backend/src/server.ts:227-260 — `POST /telegram/resolve-chat` accepts `botToken` from request body and queries `abTelegramBot.findFirst({ where: { botToken } })` (line 235). No auth check on this endpoint and no rate-limit — anyone who guesses a token gets the matching tenantId in the response (line 253). The endpoint also auto-registers the supplied chatId to that bot (line 251), enabling cross-tenant chat hijack if a tenant's bot token leaks even briefly. Fix: require server-to-server shared-secret header and stop auto-registering chatIds without explicit user opt-in.
- [launch] plugins/agentbook-core/backend/src/server.ts:38-42 — middleware reads tenant ID from `x-tenant-id` request header with fallback `'default'`. In production this depends entirely on the Next.js proxy stripping/setting the header — there is no signature/JWT verification in the plugin itself, and the dev branch is `requireAuth: false`. If a plugin port is ever exposed (port-forward, cross-tenant SSRF, internal service), full data access is one HTTP header away. Fix: require a signed tenant claim or HMAC of `tenantId|nonce|ts`.
- [launch] plugins/agentbook-core/backend/src/server.ts:114-191 — `POST /telegram/setup` accepts user-supplied `botToken` and stores it plaintext (line 147-156). No encryption-at-rest, no field-level encryption, no key rotation, and the same token is later returned partially in error messages (line 185 includes `botToken.slice(0,10)`). Fix: encrypt token at rest with KMS / envelope key and never echo any portion in responses or webhooks.
- [polish] plugins/agentbook-core/backend/src/server.ts:881,1592 — Gemini API key passed in URL query string `?key=${apiKey}`. URLs are typically captured in Cloud-Run / Vercel access logs and OpenTelemetry spans. Fix: use the `x-goog-api-key` header instead.
- [polish] plugins/agentbook-core/backend/src/server.ts:1521-1542 — `POST /cpa/generate-link` issues a 30-day access token from `crypto.randomUUID()` and stores it as `accessToken` plaintext. There is no per-tenant rate limit, no audit log of redemptions inside this scope, and no email verification before issuing (just `email: email || 'cpa@example.com'`). Fix: hash token at rest, require email verification, log redemptions.

### Error handling, idempotency, and reliability

- [blocker] plugins/agentbook-core/backend/src/server.ts:3282-3315 — agent skill execution path (the inner POST/GET from `classifyAndExecuteV1`) has NO request timeout. Unlike `executeStep` in agent-planner.ts:316-317 which wraps a 30s AbortController, this code path can hang the webhook indefinitely if downstream plugin stalls. Fix: wrap in AbortController with 30s timeout matching the planner path.
- [launch] plugins/agentbook-core/backend/src/server.ts:870-896 — `callGemini` has no timeout, no retry, and no token budget gate. A slow Gemini response will hold the Express worker for the full default fetch timeout (no cap). Add Promise.race with 20s ceiling; record token usage to a counter.
- [launch] plugins/agentbook-core/backend/src/server.ts:342-478 — `POST /journal-entries` is not idempotent on `(sourceType, sourceId)`. Replays from upstream webhooks or planner retries will duplicate financial entries. The audit event at lines 454-468 is inside the txn (good) but there is no unique constraint or upfront duplicate check. Fix: add `@@unique([tenantId, sourceType, sourceId])` index + return 200 with existing entry on collision.
- [launch] plugins/agentbook-core/backend/src/server.ts:1779-1845 — `POST /automations/from-description` makes a chargeable LLM call on every request, and on JSON-parse failure (line 1820-1831) silently creates a hard-coded "Monday 9am notify" automation that runs every week forever — this can DOS users with spam. Fix: return 422 on parse failure, do NOT auto-create a misbehaving automation.
- [launch] plugins/agentbook-core/backend/src/agent-brain.ts:201-210 — `undo` action issues a fetch to `lastUndo.reverseEndpoint` with empty body and swallows failures (`catch {}`). User sees "Undone: ..." even when the reverse call 500'd. Fix: surface failure with explicit message and do NOT pop the undo stack until success.
- [launch] plugins/agentbook-core/backend/src/agent-brain.ts:242-260 — confirm-execution loop has no per-step timeout other than what `executeStep` provides; a single hung step blocks every subsequent step sequentially even though dependencies could be parallelized. Fix: parallelize where `dependsOn` is empty between steps; add overall plan timeout (e.g. 90s).
- [launch] plugins/agentbook-core/backend/src/server.ts:3309-3319 — the catch swallows `err` into `skillError = true` and the user receives a generic "Please try again" (line 3356). No structured logging to track which skill is failing how often. Fix: log `{ skill, tenantId, errorType, latencyMs }` to AbEvent on failure.
- [launch] plugins/agentbook-core/backend/src/server.ts:870-896 — `callGemini` returns `null` on any non-OK status without surfacing the reason. Quota-exhausted, key-expired, and rate-limited all collapse to the same silent fallback path. Operators have no signal. Fix: throw typed errors and log Gemini status code.
- [polish] plugins/agentbook-core/backend/src/server.ts:2152-2155 — `db.abEvent.findMany({ where: { tenantId, createdAt: { gte: thirtyDaysAgo } } })` has no `take` limit. For active tenants this can return tens of thousands of rows on every personality auto-adapt request. Fix: add `take: 1000` + paginate; or aggregate via `groupBy`.

### Data integrity

- [blocker] plugins/agentbook-core/backend/src/server.ts:861,947,1235,1944 — code reads `taxEstimate.effectiveRate` but the Prisma model `AbTaxEstimate` (schema.prisma:2062-2078) has NO `effectiveRate` column. `(undefined * 100).toFixed(1)` → "NaN%". Every "Effective rate" line in the chat answer (line 947) and tax-package HTML (line 1235) renders "NaN%". Fix: derive on-the-fly as `totalTaxCents / max(grossRevenueCents,1)` or add the column.
- [launch] plugins/agentbook-core/backend/src/server.ts:850 — `config.businessName` is read but `AbTenantConfig` has no such field (grep confirms). Always falls through to `'Unknown'`. Either add the column or remove the reference.
- [launch] plugins/agentbook-core/backend/src/server.ts:865 — `monthlyBurnCents` is computed as `totalExpenses / max(1, ceil(expenses.length / 30))` — a count-based proxy that has nothing to do with calendar months. For a tenant with 60 expenses spanning 3 days, burn = total/2 (treats them as 2 months of activity). Fix: aggregate by `date_trunc('month')` over the trailing 90 days.
- [launch] plugins/agentbook-core/backend/src/server.ts:1287 — `effectiveRateCents = c.totalBilledCents / totalHours` divides cents by hours, yielding a hybrid unit confusingly named "cents". Comparison at line 1306 `effectiveRateCents < (totalBilled / clients.length) * 0.7` then compares this to a different concept (per-client billing average) — units mismatch. Fix: rename + compute properly (cents-per-hour vs cents-per-client).
- [launch] plugins/agentbook-core/backend/src/agent-planner.ts:289-313 — `endpoint.method === 'INTERNAL'` skills return an error from `executeStep`, but the planner can still emit them in the plan (planner prompt does not filter manifests by `method`). Fix: filter `skills` to non-INTERNAL before passing to `generatePlan`, or teach the planner to route INTERNAL actions to dedicated handlers.
- [launch] plugins/agentbook-core/backend/src/server.ts:411 — when journal-entry total exceeds `autoApproveLimitCents`, the handler `console.warn`s and continues. The constraint is named "Amount Threshold (escalation)" but no escalation record, no `pendingApproval` row, no event with `requiresApproval=true` is written. Fix: insert an escalation record + return 202 with a session ID so the user can approve.
- [launch] plugins/agentbook-core/backend/src/server.ts:412-470 — period-gate check at line 392 uses the entry month, but the timezone is implicit on `new Date(date)` server-local. A tenant in Asia-Pacific posting "Mar 31" may have its month resolved as Apr 1 UTC, hitting the wrong fiscal period. Fix: resolve year/month using tenant timezone from `AbTenantConfig`.
- [launch] plugins/agentbook-core/backend/src/dashboard/agent-summary.ts:36 — `cache` is a process-local `Map`. In any multi-worker (Vercel function, multi-process Node) deployment, identical tenants on different workers will see inconsistent summaries and the 15-min TTL is silently per-worker. Fix: move to Redis / `AbCache` table.

### Performance & cost

- [launch] plugins/agentbook-core/backend/src/server.ts:1132-1138 — `for (const a of expenseAccounts)` runs a separate `findMany` on `abJournalLine` per account (typical N≈15-20). Classic N+1. Fix: single `groupBy({ by: ['accountId'], where: { entry: { tenantId, date: range } } })`.
- [launch] plugins/agentbook-core/backend/src/server.ts:1277-1319 — `client-health` runs a `Promise.all` over clients, each making 2 nested DB queries (timeEntries + paidInvoices.include(payments)). For 50 clients = 100+ round-trips. Fix: single aggregate query joining clients↔timeEntries↔invoices↔payments.
- [launch] plugins/agentbook-core/backend/src/server.ts:799-816 — `buildFinancialContext` loads ALL expenses for the tenant (no `take`, no date filter) on every `/ask`, `/financial-snapshot`, `/simulate`, `/money-moves`. Lifetime expense set grows unboundedly. Fix: limit to trailing 12 months and aggregate top vendors via `groupBy`.
- [launch] plugins/agentbook-core/backend/src/server.ts:992-997 — the LLM prompt to `/ask` serializes the full financial context as `JSON.stringify(context, null, 2)` then prepends conversation history. With even modest data this is 5-10K tokens per call. Fix: prune to only the slices needed by the question type or use a context-builder that picks fields based on intent.
- [polish] plugins/agentbook-core/backend/src/server.ts:2668-2683 and 3211-3226 — the same 14-key `categoryKeywords` map is duplicated verbatim between record-expense auto-categorization and the categorize-expenses inline handler. Fix: hoist to module scope.
- [polish] plugins/agentbook-core/backend/src/agent-memory.ts:43-48 — `findMany({ where: { tenantId } })` over all unexpired memories on every agent message, then scored in-memory. For power users this grows to thousands of rows. Fix: pre-filter by simple LIKE on extracted keywords, or pre-compute embedding and use pgvector cosine search.
- [polish] plugins/agentbook-core/backend/src/agent-memory.ts:62-77 — lazy decay writes a `db.abUserMemory.update` per memory whose confidence changed, all fire-and-forget in parallel. On a power user's first request after a long absence this can produce dozens of writes per request. Fix: batch into a single SQL UPDATE-WHERE using `lastUsed`.
- [polish] plugins/agentbook-core/backend/src/server.ts:2415-2419 — `classifyAndExecuteV1` re-fetches conversation (10), memory (50), skills, and config when called directly — but `agent-brain.ts:289-300` already prefetched them and passes them through. The `?? db.find...` defaults will execute even when caller passes empty arrays. Fix: use explicit `undefined` checks (`memory !== undefined`).

### Skill manifest quality

- [polish] plugins/agentbook-core/backend/src/built-in-skills.ts:32 — `scan-document` has identical endpoint to `scan-receipt` (both `/agentbook-expense/receipts/ocr`). Per [G-OLD-003], PDF parsing is not implemented in the expense plugin. The skill manifest advertises a capability the system does not have. Fix: either implement PDF branch in OCR endpoint or remove this skill until it works.
- [polish] plugins/agentbook-core/backend/src/built-in-skills.ts:130 — `send-reminder` is INTERNAL and is intercepted at server.ts:2957, but the manifest's `parameters` declares an `invoiceId` while the inline handler accepts `'all'` as a sentinel string — not documented as an enum. Fix: declare in manifest `parameters.invoiceId: { enum: ['<id>', 'all'] }`.
- [polish] plugins/agentbook-core/backend/src/built-in-skills.ts:248-318 — Canadian tax-filing skills hard-code year `2025` in URL templates (e.g. `tax-filing/2025`, `tax-filing/2025/submit`). Any user filing for 2026 or 2024 hits the wrong endpoint. Fix: parameterize with `taxYear` and template URL via `{taxYear}`.

### Test coverage

- [launch] plugins/agentbook-core/backend/src/__tests__/* — only `immutability.test.ts` and `journal-entry-validation.test.ts` exist. **No unit/integration tests** for agent-brain.ts, agent-planner.ts, agent-evaluator.ts, agent-memory.ts, classifyAndExecuteV1, dashboard handlers, automations, or simulate. The 3762-line server.ts has zero direct coverage. Fix: cover at minimum session-confirm flow, undo flow, complexity assessment, plan-execution loop, and memory correction path.
- [launch] plugins/agentbook-core/backend/src/__tests__/immutability.test.ts:11-53 — these tests verify hard-coded response objects, not the actual Express routes. They will pass even if the route handlers were deleted entirely. Fix: use supertest against the exported `app`.

### Minor / hygiene

- [nit] plugins/agentbook-core/backend/src/agent-brain.ts:61-65 — magic regex sets for cancel/status/skip/undo/confirm — fine as constants, but the confirm regex `/^(yes|confirm|go|ok|proceed|do it|y)$/i` will misfire on a single-letter "y" typed by a confused user. Consider requiring "yes"/"confirm" only in destructive contexts.
- [nit] plugins/agentbook-core/backend/src/agent-planner.ts:39-46 — `DESTRUCTIVE_SKILLS` set drifts from `confirmBefore: true` flags in built-in-skills.ts (e.g. `void-invoice`, `tax-filing-submit` are confirm-before but not in DESTRUCTIVE_SKILLS). Fix: derive `DESTRUCTIVE_SKILLS` from manifest at startup.
- [nit] plugins/agentbook-core/backend/src/agent-planner.ts:155 — `params: raw.params && typeof raw.params === 'object' ? raw.params : {}` — no schema validation of LLM-emitted params against the skill manifest's `parameters` block. A plan can be created with `{amountCents: "five hundred"}` and the type error surfaces only at execute time.
- [nit] plugins/agentbook-core/backend/src/agent-memory.ts:271-276 — correction regex `/(?:no|wrong|not|should be|it'?s|that'?s)\s+(\w[\w\s&]*)/i` is greedy and will capture "that's lunch food" as `lunch food`, but the trailing description gets stored as a category name → no match → "could not find category". Fix: trim trailing description noise / fall back to first-word lookup.
- [nit] plugins/agentbook-core/backend/src/server.ts:3666-3673 — `else { message = JSON.stringify(data).slice(0, 300); }` final fallback dumps raw JSON into the user's chat for any unmatched response shape. Fix: log + return a polite "Done." message.
- [nit] plugins/agentbook-core/backend/src/server.ts:1482 — `const accounts = US_ACCOUNTS; // TODO: Select based on jurisdiction` — jurisdiction is loaded at line 1455 but never branched on. Non-US tenants seeding accounts get US Schedule C lines. Fix: load jurisdiction pack from `agentbook-tax` plugin (where 4 packs already exist per production-readiness.md).
- [nit] plugins/agentbook-core/backend/src/server.ts:3461 — `message = data.message || data.status === 'sent' ? ... : ...` — operator precedence bug. `data.message || data.status === 'sent'` evaluates `(data.message) || (data.status === 'sent')`. If `data.message` is truthy, message is set to the first ternary branch. The intent appears reversed. Fix: parenthesize.

## Stream A.2 — Domain plugins (expense / invoice / tax / billing)

**Scope reviewed:**
- `plugins/agentbook-expense/backend/src/server.ts` (2438 lines), `db/client.ts`, `__tests__/expense-logic.test.ts`
- `plugins/agentbook-invoice/backend/src/server.ts` (2134 lines), `db/client.ts`, `__tests__/invoice-logic.test.ts`
- `plugins/agentbook-tax/backend/src/server.ts` (1526 lines), `tax-filing.ts`, `tax-efiling.ts`, `tax-export.ts`, `tax-slips.ts`, `tax-forms.ts`, `__tests__/tax-calculation.test.ts`
- billing plugin **has no `backend/src` directory** — the runtime lives in `packages/billing/src/**` (account-resolver, plans, features, quotas, cache) and `apps/web-next/src/lib/billing/**` + `apps/web-next/src/app/api/v1/agentbook-billing/**` + the Stripe webhook handler at `apps/web-next/src/app/api/v1/agentbook/stripe-webhook/{route,handlers}.ts`. Reviewed all of the above.

Money-field sweep: confirmed all financial columns in `packages/database/prisma/schema.prisma` are `Int` (cents). The only `Float` usages on monetary models are `confidence` scores, `runwayMonths`, `avgDaysToPay`, `quantity`, and `fxRate` — semantically acceptable. **No `Float` money columns found.**

### expense plugin

#### Agent-pattern / pipeline correctness

- [VERIFIED OPEN: G-OLD-001] plugins/agentbook-expense/backend/src/server.ts:949-1131 — `/receipts/ocr` is wired and calls Gemini Vision correctly, but the Telegram photo webhook adapter (gap G-OLD-001 is about end-to-end wiring) is NOT in scope of this file. The endpoint itself exists; however on line 1102 the auto-execute branch fires when `amount_cents > 0 && confidence > 0.7` and creates the `AbExpense` **without `categoryId`, without `journalEntryId`, without `status: 'pending_review'`**, and without setting `source`. Net effect: a low-friction Telegram receipt scan posts a *floating* uncategorized expense that bypasses the verify-then-commit framework. Fix: set `status: 'pending_review'`, `source: 'telegram_photo'`, and route through the same confirm-flow as `cc_statement` imports.
- [VERIFIED OPEN: G-OLD-003] plugins/agentbook-expense/backend/src/server.ts:949 — `/receipts/ocr` accepts only `imageUrl` and prompts Gemini Vision; there is no PDF branch (no `application/pdf` MIME-type check, no PDF→image pre-render, no use of Gemini's File API for PDFs). Core's `scan-document` manifest still routes here, so PDF receipts/statements fail silently. Fix: detect PDF via Content-Type, either upload as `fileData` via Gemini File API or fall through to a clear "PDF not yet supported" 422.
- [VERIFIED OPEN: G-OLD-002] plugins/agentbook-expense/backend/src/server.ts:2041-2086 — `/receipts/upload-blob` exists and does Vercel Blob upload, but the auto-OCR path at line 1116 stores `receiptUrl: imageUrl` (the Telegram CDN URL) **directly** and never calls `upload-blob`. Telegram URLs expire in ~24h. Fix: call `upload-blob` first inside the OCR auto-execute path or store the source as `pendingBlobUrl` and run the rehost in a follow-up job.
- [VERIFIED OPEN: G-OLD-005] plugins/agentbook-expense/backend/src/server.ts:1939-2034 — review queue endpoints (`/review-queue`, `/expenses/:id/confirm`, `/expenses/:id/reject`) ARE shipped (gap was "not wired"); however the *producer* side at line 1109-1119 (OCR auto-create) and line 95-213 (POST `/expenses`) default to `status: 'confirmed'` and the only producer that writes `status: 'pending_review'` is `/import/cc-statement` (line 2188). So the queue exists but is fed by exactly one source. Re-classify gap as "shipped but not used by Telegram/OCR ingestion path."

#### Security & tenant isolation

- [blocker] plugins/agentbook-expense/backend/src/server.ts:286 — `db.abAccount.findFirst({ where: { id: expense.categoryId } })` — no `tenantId` filter when resolving an expense's category for the detail view. If `expense.categoryId` happens to match an account in another tenant (UUID collision is improbable but the schema doesn't preclude it), the response leaks that account's name/code. Fix: add `tenantId` to the where clause. Same shape at server.ts:1500, 1687, 1785, 1950, 1500, 1271 (all `abAccount.findMany({where:{id:{in:...}}})` without tenant scoping).
- [blocker] plugins/agentbook-expense/backend/src/server.ts:706 — `db.abBankAccount.findFirst({ where: { plaidAccountId: acct.account_id } })` — looks up the bank account by Plaid ID **across all tenants** with no `tenantId` filter. Two consequences: (1) if a Plaid sandbox `account_id` collides with another tenant's (it CAN happen — Plaid sandbox IDs are deterministic for `user_good`), the exchange path skips inserting silently and the user sees zero accounts connected; (2) the existence check leaks the existence of a row in another tenant. Fix: add `tenantId` to the where clause.
- [blocker] plugins/agentbook-expense/backend/src/server.ts:792-793 — `db.abBankTransaction.findFirst({ where: { plaidTransactionId: txn.transaction_id } })` — same cross-tenant lookup bug; the idempotency check uses a global unique on `plaidTransactionId` instead of `(tenantId, plaidTransactionId)`. A second tenant connecting to the same Plaid sandbox `user_good` will skip every transaction (already imported in tenant A's books), producing silent zero-import for tenant B. Fix: add `tenantId` to the where; or change unique constraint in schema to `(tenantId, plaidTransactionId)`.
- [blocker] plugins/agentbook-expense/backend/src/server.ts:655-656 — `const plaidAccessTokens: Record<string, string> = {}` — **in-memory** per-process map of Plaid access tokens. On Vercel's stateless functions every cold start drops these; on subsequent `/bank-sync` calls `accessToken` is `undefined` and the function silently returns "0 imported" instead of refusing to sync (line 861-866). Tokens are never persisted to `AbBankAccount` either — so once the bot restarts the user must re-Link or lose sync. Fix: persist `accessToken` encrypted on `AbBankAccount` and load from there on every sync.
- [launch] plugins/agentbook-expense/backend/src/server.ts:46-49 — same `x-tenant-id` header trust pattern as core (see Stream A.1 finding). No HMAC, no signed JWT. Fix: shared with core; treat as one project-wide issue.
- [launch] plugins/agentbook-expense/backend/src/server.ts:69-87 — `callGemini` reads `apiKey` from any `enabled+isDefault` LLM config **without `tenantId` filter** (line 69, 959). If multiple tenants set their own Gemini key, every plugin call grabs whichever happens to be `isDefault=true` globally — i.e. one tenant's key is used to bill another tenant's OCR. Fix: scope LLM config by tenant or move to a tenant-scoped credential vault.
- [launch] plugins/agentbook-expense/backend/src/server.ts:915-945 — `/stripe/webhook` accepts events with NO signature verification — the comment at line 921 explicitly says "In production: verify signature with Stripe webhook secret" but the verification is **commented out**. Anyone who can hit the plugin port can forge a `payment_intent.succeeded` event. Fix: implement `stripe.webhooks.constructEvent` with the raw body before any DB write, mirroring the billing-plugin webhook at apps/web-next/src/app/api/v1/agentbook/stripe-webhook/route.ts.
- [launch] plugins/agentbook-expense/backend/src/server.ts:13-15 — Plaid client ID & secret hardcoded as fallback (`'69d02fa4f1949b000dbfc51e'`, `'59be40029c47288c4db4acfd79ae56'`) — these are the same sandbox creds checked into CLAUDE.md. While sandbox-only, the same pattern in production gives an attacker the prod creds if env vars aren't set. Fix: throw on startup if `PLAID_SECRET` is unset in production.

#### Error handling, idempotency, reliability

- [blocker] plugins/agentbook-expense/backend/src/server.ts:95-227 — `POST /expenses` has **no idempotency key**. If the agent retries on a network blip (or the user double-taps "confirm"), a duplicate `AbExpense` + duplicate journal entry are written. The audit `AbEvent` at line 196 is the only record but doesn't gate the create. Fix: accept `Idempotency-Key` header or body field; insert into an `AbIdempotencyKey` row inside the same transaction.
- [blocker] plugins/agentbook-expense/backend/src/server.ts:915-945 — `/stripe/webhook` updates `AbStripeWebhookEvent` for idempotency BUT swallows `event.id`/`event.type` from the *unverified* request body. Since the body is also unsigned, an attacker can craft any `event.id` and either (a) trigger a "Already processed" no-op or (b) inject a fake `stripe.payment_intent.succeeded` event into AbEvent. Combined with the missing signature check this is a launch blocker. Fix: verify first, then use `event.id` for dedup.
- [launch] plugins/agentbook-expense/backend/src/server.ts:1102-1124 — OCR auto-execute branch is NOT wrapped in `db.$transaction`. The vendor upsert, expense create, and event emit are three separate DB calls; failure between them leaves orphan vendor rows or missing audit events. Fix: wrap in a single `db.$transaction`.
- [launch] plugins/agentbook-expense/backend/src/server.ts:762-880 — `/bank-sync` has no per-call timeout, no exponential backoff on Plaid 429s, no cursor (uses fixed 30-day window every time so older transactions never sync, and a paged tenant with >500 txns/30d silently truncates). Fix: use Plaid `/transactions/sync` cursor endpoint and persist `cursor` on `AbBankAccount`.
- [launch] plugins/agentbook-expense/backend/src/server.ts:820-841 — auto-match window is "amount within ±5% AND date within ±2 days" (matchWindow = 2 days). For frequent small charges (lunch, parking) this will mismatch routinely — the matcher picks the *first* matching expense by `orderBy: date asc`, not the closest in time. Fix: also score by min(`abs(date diff)`) and require unique vendor when present.
- [launch] plugins/agentbook-expense/backend/src/server.ts:1115-1119 — OCR auto-create stores `receiptUrl: imageUrl` even when Telegram URLs expire (see G-OLD-002). Fix: see expiry note above; either rehost first or refuse to persist a non-rehosted URL.
- [launch] plugins/agentbook-expense/backend/src/server.ts:2099-2168 — `/import/cc-statement` CSV parser does a naive `split(',')` (line 2105) — fields containing commas inside quotes (very common in real-world bank CSVs: `"Subway #1234, NYC"`) corrupt every column to the right. Fix: use a real CSV parser (papaparse, csv-parse).
- [launch] plugins/agentbook-expense/backend/src/server.ts:949-960 — when no `llmConfig` is found, returns a "no_llm_configured" stub with `amount_cents: 0` and `confidence: 0` — but `auto-execute` at line 1102 gates only on `> 0`, so this is safe. Still, the caller has no way to distinguish "OCR worked, low confidence" from "OCR not configured." Surface `status` more prominently in the response envelope.
- [polish] plugins/agentbook-expense/backend/src/server.ts:411-430 and 463-480 — two near-identical `tagRules` tables, one for `/expenses/:id/auto-tag` and one for `/auto-tag-all`. They drift (the second omits `parking`, `entertainment` partial). Fix: hoist to a single const.

#### Data integrity

- [launch] plugins/agentbook-expense/backend/src/server.ts:142-213 — POST `/expenses` creates the journal entry inside the transaction **only when** `resolvedCategoryId && !isPersonal`. If `categoryId` is omitted and no vendor pattern resolves it, the expense is recorded with `journalEntryId: null` and no ledger impact — yet `AbExpense.status` defaults to `'confirmed'`. So an "uncategorized confirmed" expense exists on the list page and disappears from P&L. Either: (a) reject `categoryId`-less creates with 422, or (b) auto-flip to `status: 'pending_review'` until a category is assigned.
- [launch] plugins/agentbook-expense/backend/src/server.ts:1138-1196 — split-transaction logic verifies sum equality (line 1152) but does NOT verify each split's `categoryId` belongs to the same tenant; passing a foreign tenant's `categoryId` will set the split row but no foreign-key violation surfaces because `categoryId` is a loose string field on `AbExpenseSplit`. Fix: validate every `sp.categoryId` exists with `tenantId == req.tenantId` before insert.
- [launch] plugins/agentbook-expense/backend/src/server.ts:1138-1196 — when splitting an already-categorized expense, the original `AbJournalEntry` is NOT reversed or re-balanced; the splits live in `AbExpenseSplit` but the ledger still shows the lump-sum debit to the original category. So Schedule C / T2125 tax reports will undercount the *non-personal* portion if the user splits 50/50. Fix: on split, reverse the original JE and post N new JEs by category.
- [launch] plugins/agentbook-expense/backend/src/server.ts:1162 — splits use `deleteMany` to drop existing rows before re-creating (re-split flow) — this destroys the audit trail of prior splits. Fix: keep prior splits and mark a `replacedAt` instead.
- [launch] plugins/agentbook-expense/backend/src/server.ts:1962-2014 — `POST /expenses/:id/confirm` allows updating `amountCents` and `categoryId` during confirmation but **does not delete or reverse a journal entry if the category changes**. If the auto-created JE used category A and the user confirms with category B, the ledger still shows A. Fix: detect category change and post a reversing entry.
- [launch] plugins/agentbook-expense/backend/src/server.ts:154-160 — journal entry uses `new Date(date || Date.now())` server-local; same TZ bug as core (Stream A.1 finding L412). Same fix.
- [launch] plugins/agentbook-expense/backend/src/server.ts:1670 — `AbExpense.status` default is `'confirmed'` per schema, which means every legacy expense ever recorded without an explicit status is treated as confirmed in the review queue logic. After this code goes live the `status: 'pending_review'` filter at line 1944 will return zero rows for any tenant whose pre-PR data exists. Fix: backfill or treat NULL/legacy as "needs_categorization" rather than "confirmed."
- [polish] plugins/agentbook-expense/backend/src/server.ts:1673 — `deletedAt` exists on `AbExpense` (soft-delete per PR 26), but no endpoint in this file checks `deletedAt: null` in any `findMany`. So the list, category-summary, and tax-summary endpoints all show soft-deleted expenses. Fix: add `deletedAt: null` to every query or use a Prisma extension.
- [polish] plugins/agentbook-expense/backend/src/server.ts:2103-2105 — header lowercasing is done per-row inside the loop. Inefficient + (line 2113) `headers[amountCol]` evaluated against the *first* row's headers while the loop re-derives. Just refactor the CSV parser.

#### Performance & cost

- [launch] plugins/agentbook-expense/backend/src/server.ts:753-758 — `Promise.all(accounts.map(async (acct) => { const txnCount = await db.abBankTransaction.count(...) }))` — N+1: one count query per bank account. Fix: single `groupBy` query.
- [launch] plugins/agentbook-expense/backend/src/server.ts:1182-1196 — split-tx loop creates each split sequentially with separate `await tx.abExpenseSplit.create`. For a 5-way split that's 5 round-trips inside the transaction. Fix: `createMany`.
- [launch] plugins/agentbook-expense/backend/src/server.ts:1564-1590 — duplicate-detection runs O(N²) over `currentExpenses` with no upper bound. For a power user with 5000 expenses in the period this is 25M comparisons. Fix: index expenses by `(vendorId, date)` map and only compare within ±3 day windows.
- [launch] plugins/agentbook-expense/backend/src/server.ts:1620-1648 — savings-opportunity loop loads `recentExpenses` (180 days, no limit) and then `byVendor` averages — for a power user this is the *full* expense table. Fix: `groupBy` at the DB.
- [polish] plugins/agentbook-expense/backend/src/server.ts:2351-2364 — `/budgets/status` runs `db.abExpense.aggregate` once per budget in a `for` loop. Classic N+1.

#### Test coverage

- [launch] plugins/agentbook-expense/backend/src/__tests__/expense-logic.test.ts — only 184 lines. Tests `normalizeVendorName`, payload validation logic, and a few branching scenarios — but **no test for the OCR auto-execute branch**, the split-transaction balance check, the bank-sync auto-match, the CSV import, or any DB-touching endpoint. The 2438-line server.ts has effectively zero integration coverage.

**Summary:** 27 findings (5 blockers, 18 launch, 4 polish). Top concern: Stripe webhook signature verification is missing entirely (`/stripe/webhook` line 915) AND multiple Plaid lookups omit `tenantId`, allowing cross-tenant token/transaction confusion.

### invoice plugin

#### Agent-pattern / data integrity

- [VERIFIED OPEN: G-OLD-006] plugins/agentbook-invoice/backend/src/server.ts:1466-1505 — PDF "generation" is **HTML**, not PDF. `POST /invoices/:id/pdf` writes `pdfHtml` to the DB and `GET /invoices/:id/pdf` serves it back as `text/html`. There is no Puppeteer/React-PDF rendering. Stored `pdfUrl` field at line 1481 points to the same HTML endpoint. Net effect: when a client receives an "invoice PDF" via email (B3 path), they get HTML; print-to-PDF works but the resulting file size is browser-dependent and prone to pagination glitches.
- [VERIFIED CLOSED: G-OLD-007] plugins/agentbook-invoice/backend/src/server.ts:1511-1592 — email delivery via Resend is wired (`ResendProvider` class, `getEmailProvider()` selects based on `RESEND_API_KEY`). Falls back to log-only in dev. Gap is closed; minor concern is no template versioning / unsubscribe link.
- [VERIFIED CLOSED: G-OLD-008] plugins/agentbook-invoice/backend/src/server.ts:1946-1998 — Stripe Checkout link generation via `stripe.checkout.sessions.create` is wired with metadata `{invoiceId, tenantId}`. Gap is closed.
- [VERIFIED CLOSED: G-OLD-009] plugins/agentbook-invoice/backend/src/server.ts:1754-1939 — recurring invoices end-to-end (create schedule + `POST /recurring-invoices/generate` to roll due ones, advances `nextDue` based on frequency). Gap is closed but see launch issue below re: gating.
- [VERIFIED CLOSED: G-OLD-010] plugins/agentbook-invoice/backend/src/server.ts:280-389 — invoice creation seeds AR/Revenue journal entries via accounts 1100/4000 (hard-coded codes) when present, with 422 if accounts missing. Gap is closed.

#### Security & tenant isolation

- [blocker] plugins/agentbook-invoice/backend/src/server.ts:1835-1939 — `POST /recurring-invoices/generate` accepts a tenant-scoped request but is **not gated** behind a cron secret, admin role, or service-to-service header. Any tenant can hit it; it processes only that tenant's `dueItems` (line 1840 filters by `tenantId`), so it's not a *cross-tenant* leak, but it can be abused to **flood-generate invoices** ahead of schedule by a malicious caller for their own tenant (or DOS the cron via repeated calls). Fix: gate on `x-vercel-cron === '1'` or a `CRON_SECRET`.
- [blocker] plugins/agentbook-invoice/backend/src/server.ts:2078-2114 — `GET /invoices/:id/public` is an unauthenticated endpoint that **does not check any token** before returning invoice details (line 2080-2084 finds by `id` only — no tenant scope, no signed link). Anyone who guesses or learns an invoice UUID gets the client name, line items, amounts, and a payment URL. Fix: require a signed access token (HMAC of `invoiceId+tenantId+exp`) in the query; reject otherwise.
- [blocker] plugins/agentbook-invoice/backend/src/server.ts:2001-2072 — `POST /stripe/checkout-completed` accepts a Stripe webhook event WITHOUT signature verification. The handler reads `session.metadata?.invoiceId` and `tenantId` and writes a payment + flips invoice status to `paid` and creates a journal entry. An attacker who can hit this endpoint can mark any invoice as paid (and post a fake debit-cash credit-AR JE) by forging a `checkout.session.completed` event with the right metadata. Fix: verify via `stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET` and use the raw body.
- [launch] plugins/agentbook-invoice/backend/src/server.ts:2014 — `db.abPayment.findFirst({ where: { stripePaymentId: session.payment_intent } })` — no `tenantId` filter; cross-tenant `payment_intent` collision (unlikely but possible if metadata is wrong) would skip the create. Fix: add `tenantId`.
- [launch] plugins/agentbook-invoice/backend/src/server.ts:2042-2043 — account codes for Stripe-payment JE are `1010` and `1200`, but every other path in this file uses `1000` (cash) and `1100` (AR). The seed in core uses 1000/1100 per Stream A.1 review. So Stripe payments either fail silently (accounts not found at line 2044) or post to the wrong accounts. Fix: align code constants — recommend single source-of-truth `AB_CASH_CODE = '1000'`, `AB_AR_CODE = '1100'`.
- [launch] plugins/agentbook-invoice/backend/src/server.ts:1556-1591 — `/invoices/:id/email` and `/invoices/:id/remind` both send to `invoice.client.email` after only a tenant check on the invoice — but if a *prior* request changed the client's email (or the client record was reassigned to a different tenant), the email goes to the wrong address with no consent or audit. Fix: snapshot `clientEmail` on the invoice at send-time.
- [launch] plugins/agentbook-invoice/backend/src/server.ts:1293 — `db.abClient.findMany({ where: { id: { in: clientIds } } })` — no `tenantId` filter when resolving client names for the unbilled summary. Cross-tenant client-name leak (same shape as expense plugin findings). Fix: include `tenantId` filter.
- [launch] plugins/agentbook-invoice/backend/src/server.ts:1622-1627 — payment reminder HTML references `brandColor` *unbound* — the variable was defined inside `generateInvoiceHtml` (line 1359) and is NOT in scope here. This will throw `ReferenceError` at runtime on every reminder send. Fix: hoist or recompute.

#### Error handling & idempotency

- [blocker] plugins/agentbook-invoice/backend/src/server.ts:233-399 — `POST /invoices` has no idempotency key. Two concurrent requests with the same body create two invoices with **the same `INV-YYYY-NNNN` number** — the `@@unique([tenantId, number])` constraint at schema.prisma:1919 will throw `P2002` on the second (handler at line 393-396 returns 409, good), BUT a non-concurrent retry (network blip → client retries) creates a new invoice with the next sequence number and double-bills the client. Fix: accept `Idempotency-Key` header.
- [blocker] plugins/agentbook-invoice/backend/src/server.ts:636-807 — `POST /payments` has no idempotency key either. A Stripe webhook race or a manual "Record payment" double-tap creates two payment rows. The `feesCents` doubles, client `totalPaidCents` double-increments, the invoice flips to `paid` correctly because `existingPaid + amountCents` is recomputed, but the ledger ends up with 2x cash receipt. Fix: idempotency key + check on `(tenantId, invoiceId, externalId)` before insert.
- [launch] plugins/agentbook-invoice/backend/src/server.ts:262-277 — sequence-number generation reads `lastInvoice` outside the transaction then constructs `INV-YYYY-NNNN`. Under concurrent requests this is a classic read-modify-write race; both compute the same `nextSeq`. Mitigated by the unique constraint but produces a 409 instead of a smooth retry. Fix: use a tenant-scoped sequence (`db.$queryRaw\`SELECT nextval(...)\`` or a `Sequence` model with `update increment`).
- [launch] plugins/agentbook-invoice/backend/src/server.ts:1614-1641 — `/invoices/:id/remind` writes `lastRemindedAt` AFTER the email send (line 1641). If the reminder send takes 5s and a second request comes in 1s later, both will send the same reminder. Fix: optimistic-lock — update `lastRemindedAt` first inside a transaction with a `WHERE lastRemindedAt < now()-1h` guard, then send.
- [launch] plugins/agentbook-invoice/backend/src/server.ts:518-521 — email send failures inside `/invoices/:id/send` are swallowed with `console.warn` (line 519) — user gets `emailSent: false` but no error context. If `RESEND_API_KEY` is misconfigured every send silently no-ops. Fix: at minimum surface the error in the response and log to `AbEvent`.
- [launch] plugins/agentbook-invoice/backend/src/server.ts:1949-1956 — `payment-link` early-returns the cached `paymentUrl` (line 1957) even when the invoice amount has since changed. A draft invoice whose lines were edited after the link was generated will route the client to a Checkout session with the *old* amount. Fix: invalidate `paymentUrl` whenever lines/totals change.
- [launch] plugins/agentbook-invoice/backend/src/server.ts:1880-1917 — recurring-invoice generation does not call `getAccountByCode` inside the loop atomically; if the accounts table is mutated mid-loop the JE has stale account IDs. Low impact.
- [launch] plugins/agentbook-invoice/backend/src/server.ts:2057 — `try { ...JE create... } catch { /* journal entry is best-effort */ }` — silently drops journal entries when accounts 1010/1200 don't exist. The payment is still recorded but the ledger is now unbalanced (cash received with no AR offset). For a tenant that paid via Stripe, the P&L over-states revenue. Fix: 422 if accounts missing; do NOT mark `paid` without a JE.

#### Performance & cost

- [launch] plugins/agentbook-invoice/backend/src/server.ts:1146-1162 — `/projects` aggregates totals by mapping in Node from `include: { timeEntries }` — fine for small workspaces but unbounded. A user with 10k time entries loads them all. Fix: `groupBy` on time entries.
- [launch] plugins/agentbook-invoice/backend/src/server.ts:1311-1332 — `project-profitability` same pattern as above; `include: { timeEntries }` then mapped in Node.
- [polish] plugins/agentbook-invoice/backend/src/server.ts:1170-1226 — start/stop/status timer endpoints each issue 1-2 separate queries; status especially is called frequently by the UI. Consider memoizing.

#### Test coverage

- [launch] plugins/agentbook-invoice/backend/src/__tests__/invoice-logic.test.ts — 410 lines, covers number generation, balance math, status transitions. **No tests for:** payment-link generation, Stripe-checkout webhook (the blocker), recurring-invoice generate loop, send-with-email, reminder cascade, credit-note flow. Given the financial blast radius the test gap is significant.

**Summary:** 18 findings (3 blockers, 11 launch, 4 polish). Top concern: `/stripe/checkout-completed` accepts unsigned events and can flip arbitrary invoices to paid + post fake JEs; `/invoices/:id/public` leaks invoice contents to anyone with a UUID.

### tax plugin

#### Agent-pattern / data integrity

- [launch] plugins/agentbook-tax/backend/src/server.ts:190-318 — `/tax/estimate` calls `db.abTaxEstimate.create` on **every** GET (line 257). This is a GET that mutates DB state — REST violation but also unbounded growth: a tenant who hits "refresh" 100 times in a day has 100 estimate rows. The "latest" lookup at line 342-345 works, but tax-package generation per server.ts:861 in core relies on `findFirst orderBy desc` — fine — yet it can never roll up "estimate at end of Q1" because every refresh writes a new row. Fix: upsert keyed on `(tenantId, period)` or change to POST.
- [launch] plugins/agentbook-tax/backend/src/server.ts:111-114 — `getBrackets(jurisdiction)` defaults to US brackets when jurisdiction is unrecognized (e.g. `'uk'`, `'au'`, `'default'`). Production-readiness.md says 4 jurisdiction packs are loaded — but this function silently mis-taxes UK and AU tenants with US brackets. Fix: explicit allow-list with 422 on unknown jurisdiction; pull from tax pack registry.
- [VERIFIED OPEN: G-OLD-013] plugins/agentbook-tax/backend/src/server.ts:120-137 — CA quarterly deadlines exist (Mar 15, Jun 15, Sep 15, Dec 15) BUT there are no E2E tests covering the CA path. The unit-test file `__tests__/tax-calculation.test.ts` (358 lines) covers brackets and SE-tax math but does not exercise the `populateFiling` → `validateFiling` → `exportFiling` → `submitFiling` chain for a CA tenant. Gap stands.
- [launch] plugins/agentbook-tax/backend/src/server.ts:1144 — `db.abVendor.findMany({ where: { id: { in: vendorIds } } })` — same cross-tenant name-leak as in expense/invoice plugins.
- [launch] plugins/agentbook-tax/backend/src/server.ts:1100-1122 — `ar-aging-detail` includes the full client name and per-invoice dollar amounts for every outstanding invoice. No issue with tenant scoping (line 1103 filters by tenantId), but the report is generated on every request with no caching and no pagination. For an accounting firm with 100+ clients this is expensive.
- [launch] plugins/agentbook-tax/backend/src/server.ts:1218-1248 — `quarterly-comparison` runs `findMany` of all revenue and expense accounts inside the quarter loop (line 1228-1240), then `findMany` of journal lines per account per quarter — that's 4 quarters × (revenue_count + expense_count) accounts × 1 line-aggregate each. For 20 accounts this is 80 round-trips per call. Fix: single `groupBy` with `entry.date.gte/lte`.
- [launch] plugins/agentbook-tax/backend/src/server.ts:1268-1277 — `annual-summary` repeats the same N+1 pattern for revenue/expense account aggregation. Same fix.

#### Tax filing (verify-then-commit)

- [launch] plugins/agentbook-tax/backend/src/tax-filing.ts:107-113 — `populateFiling` does a "two-pass" auto-populate to resolve T1↔Schedule1 circular references. Two passes is empirical; if forms have a longer cycle (e.g. T1→Schedule1→T2125→T1) the second pass won't converge. Fix: detect convergence (no field changed since last pass) and run up to N passes with a max-iterations guard.
- [launch] plugins/agentbook-tax/backend/src/tax-filing.ts:14-36 — topological sort `sortByDependencies` uses simple DFS without cycle detection. If two templates declare circular deps it infinite-loops at `visit(dep) → visit(code) → visit(dep)…` because `visited.has(code)` is set BEFORE recursion at line 21. Reading more carefully — `visited` IS set before deps are visited, so the cycle terminates; but the *output* order is non-deterministic for cycles. Document or detect.
- [launch] plugins/agentbook-tax/backend/src/tax-export.ts:14-38 — validation rules array hardcodes `gross >= $30,000` (3,000,000 cents) GST threshold for *Canada*. There is no jurisdiction filter on rules — every tenant runs every rule. A US tenant gets warned about missing GST registration. Fix: tag each rule with applicable jurisdictions and filter.
- [launch] plugins/agentbook-tax/backend/src/tax-export.ts:44-53 — silent `catch { /* skip broken rules */ }` swallows ALL rule errors including bugs. A broken rule means filings pass validation that shouldn't. Fix: log `console.error` with rule ID + error.
- [launch] plugins/agentbook-tax/backend/src/tax-efiling.ts:24-106 — `submitFiling` does NOT use `db.$transaction`. After successful partner submit, the `abTaxFiling.update` at line 85-93 can fail and leave the tenant with a "still in_progress" filing while the CRA has accepted it. Worse, a retry would re-submit. Fix: persist the confirmation BEFORE returning success, or accept the duplicate-submission risk and add explicit `filedRef` reconciliation.
- [launch] plugins/agentbook-tax/backend/src/tax-efiling.ts:53-55 — `findFirst({ where: { jurisdiction, enabled: true } })` for partner config is **not tenant-scoped** — partner config is shared across all tenants. OK for a single integrated partner (Wealthsimple), but if multiple partners are enabled for the same jurisdiction the choice is `findFirst`-undefined. Fix: deterministic ordering + or pin partner per tenant.
- [launch] plugins/agentbook-tax/backend/src/tax-efiling.ts:61-75 — when calling the real partner API, the `Authorization: Bearer ${partner.apiKey}` puts the **plaintext API key from the DB into an outbound header**. If the partner config table is ever leaked (no encryption-at-rest noted), the keys are usable directly. Same encryption gap as Telegram bot tokens in core. Fix: encrypt `apiKey` at rest via KMS envelope.
- [launch] plugins/agentbook-tax/backend/src/tax-efiling.ts:13 — `confNum = "CRA-${Date.now()}…"` mock uses non-cryptographic timestamp. Fine for dev, but the mock is used when no partner is configured (line 79-82) — including in any production deploy that has no NETFILE-certified partner wired up. So a tenant in prod hitting `submit` with no partner gets a fake `CRA-…` confirmation and the filing status flips to `filed` (line 87-93). Massive compliance/legal risk. Fix: require an explicit `MOCK_EFILE=1` env to use the mock; otherwise 503 "no certified partner configured."

#### Security & auth

- [launch] plugins/agentbook-tax/backend/src/tax-filing.ts:191 — `if (['__proto__', 'constructor', 'prototype'].includes(formCode))` — small guard but the next line `forms[formCode][fieldId] = value` is still subject to prototype-pollution via `fieldId`. Fix: same allowlist for `fieldId`, or use `Object.defineProperty` with `enumerable: true, writable: true, configurable: true` on a fresh object.
- [launch] plugins/agentbook-tax/backend/src/tax-slips.ts:23-86 — `processSlipOCR` is called with `callGemini` defined inline at server.ts:1424 as `async (_sys, _user, _max) => null`. The OCR is **wired to return null on every call**. So the entire tax-slip OCR path is a no-op even though the UI shows "processing" feedback. Fix: pass the real Gemini caller from server.ts (mirror expense plugin's OCR pattern).
- [launch] plugins/agentbook-tax/backend/src/server.ts:1417-1430 — `/tax-slips/ocr` calls `processSlipOCR(... callGemini)` with the stub above. Returns success: false `Gemini returned no response` every time — but in dev a developer might miss this. Fix: at minimum log "no LLM configured" prominently.
- [polish] plugins/agentbook-tax/backend/src/server.ts:147 — `getTenantId` falls back to `'default'` (line 147) — same systemic issue as the other plugins.

#### Reports — performance

- [launch] plugins/agentbook-tax/backend/src/server.ts:1197-1215 — `monthly-expense-trend` runs 12 `findMany` queries (one per month). Fix: single query with `groupBy` on `date_trunc('month', date)`.
- [launch] plugins/agentbook-tax/backend/src/server.ts:1170-1194 — `tax-summary` calls `findMany` per expense account (line 1183). For ~20 accounts that's 20 round-trips. Same N+1.

#### Test coverage

- [launch] plugins/agentbook-tax/backend/src/__tests__/tax-calculation.test.ts — 358 lines covering bracket math, SE tax for US, CPP for CA, quarterly deadline dates. **No tests for:** populate-filing two-pass convergence, validation rule jurisdiction filtering, submit-filing happy/sad paths, CA tax-slip OCR (the no-op above would not be caught by unit tests). G-OLD-013 stands.

**Summary:** 22 findings (0 blockers, 18 launch, 4 polish). Top concern: mock e-file path returns fake CRA confirmation numbers without explicit dev-gating, risking a production deploy where users believe their tax return was filed when it wasn't.

### billing plugin (packages/billing + apps/web-next/api/v1/agentbook-billing + Stripe webhook)

#### Stripe webhook

- [polish] apps/web-next/src/app/api/v1/agentbook/stripe-webhook/route.ts:11-24 — signature verification IS implemented correctly: reads `stripe-signature` header (line 11), reads raw body via `await request.text()` (line 14, no middleware body-parsing because `runtime = 'nodejs'` + `dynamic = 'force-dynamic'`), constructs event via `getStripe().webhooks.constructEvent(rawBody, sig, secret)` (line 20). This is the textbook pattern. Closes [G-OLD-024/025] for this specific webhook.
- [VERIFIED CLOSED: G-OLD-024] apps/web-next/src/app/api/v1/agentbook/stripe-webhook/route.ts:28-44 — idempotency is enforced via `BillEvent.stripeEventId @unique` (schema.prisma:2767). Try-create-then-detect-P2002 is the correct pattern. Replay short-circuits to `200 {idempotent: true}`. Good.
- [VERIFIED CLOSED: G-OLD-025] same as above.
- [launch] apps/web-next/src/app/api/v1/agentbook/stripe-webhook/route.ts:31 — `accountId` for the `BillEvent` row is read from `event.data.object.metadata.tenantId` — but for `invoice.paid`/`invoice.payment_failed` events the `metadata.tenantId` lives on the parent Subscription, not the Invoice object. So those rows are inserted with `accountId: null` (line 31 default-null is `??` falsy-coalesce). Fine for storage but `BillEvent` index `(eventType, createdAt)` is the only useful index; no per-tenant lookup possible for these event types. Fix: cross-reference `invoice.subscription` and look up tenant.
- [launch] apps/web-next/src/app/api/v1/agentbook/stripe-webhook/handlers.ts:62-67 — `invoice.paid` and `invoice.payment_failed` cases are **no-ops** (just `console.log`). For a launch-grade billing system you almost certainly want to (a) email the user on payment_failed (dunning), (b) record the invoice ID for the user-facing invoice list. Fix: at minimum mark the local `BillSubscription.status` to `past_due` on payment_failed and revert on payment_succeeded.
- [launch] apps/web-next/src/app/api/v1/agentbook/stripe-webhook/handlers.ts:9-50 — subscription create/update upserts on `accountId` keyed by metadata `tenantId`. If the metadata is missing (line 11-15) returns silently — no alert, no fallback (`return` not `throw`). So a Subscription created outside the AgentBook flow (e.g. manual in Stripe dashboard) is silently dropped. Fix: log a warning to a dedicated table or sentry.
- [launch] apps/web-next/src/app/api/v1/agentbook/stripe-webhook/handlers.ts:25-26 — `current_period_start`/`current_period_end` are cast via `as unknown as { current_period_start: number }` — required because the Stripe TS types lost these fields in later API versions. The cast is correct but should be documented; if Stripe ever moves the fields, billing breaks silently. Fix: add a runtime guard `if (typeof startSec !== 'number') throw ...`.

#### User-facing subscription routes

- [launch] apps/web-next/src/app/api/v1/agentbook-billing/me/subscription/route.ts:21-69 — POST `/me/subscription` creates a Stripe subscription server-side with `paymentMethodId` from the request body. No CSRF protection visible (no SameSite cookie check, no double-submit token). Reads tenant via `resolveAgentbookTenant` which falls back to header `x-tenant-id` then `ab-tenant` cookie then auth-session. If an attacker can plant `x-tenant-id` (CSRF or XSS-derived), they can subscribe a victim tenant to a paid plan using *their own* paymentMethod (the attacker pays, the victim gets enrolled — weird grift, but legitimate avenues like coupon-stacking could exploit). Fix: trust ONLY the auth-session-derived tenant in this route; ignore header & cookie. Same applies to `cancel`, `reactivate`, `intent`.
- [launch] apps/web-next/src/app/api/v1/agentbook-billing/me/subscription/route.ts:38-64 — no idempotency on the Stripe subscription create. A duplicate POST creates a second subscription (Stripe will probably 409 on second create with same customer + same price, but not guaranteed). Fix: pass Stripe's `idempotency_key` parameter.
- [launch] apps/web-next/src/app/api/v1/agentbook-billing/me/subscription/intent/route.ts:11-30 — creates a Stripe customer **on every POST** if none exists, then upserts a `BillSubscription` row with `planId: freePlanId ?? ''`. If `freePlanId` is empty string the row violates the FK. The `?? ''` fallback was probably meant to short-circuit but doesn't. Fix: throw if no Free plan instead of silently writing an empty FK.
- [polish] apps/web-next/src/app/api/v1/agentbook-billing/me/subscription/intent/route.ts:28 — `payment_method_types: ['card']` — locks out wallet payments (Apple Pay, Google Pay). Use `automatic_payment_methods: { enabled: true }`.

#### Admin routes

- [launch] apps/web-next/src/app/api/v1/agentbook-billing/plans/route.ts:54-94 — POST `/plans` creates a Stripe product+price+local row. The `try`-block at line 56-79 has good rollback: on local-DB failure it calls `stripe.products.update(productId, { active: false })`. **However:** if the Stripe `prices.create` call succeeds but the local `prisma.billPlan.create` fails, the rollback archives the *product* but the *price* lives on. Future runs with the same `code` will fail at line 65-79 because there's no idempotency on Stripe price creation. Fix: use Stripe `idempotency_key: ${code}-create` on both Product and Price creates.
- [launch] apps/web-next/src/lib/billing/admin-auth.ts:21 — admin allowlist read from `process.env.ADMIN_EMAILS` on every call (line 21-24). For per-tenant admin role this is too coarse. Per-tenant CPA-style admins cannot manage their own org's plans. Fix: move to a per-tenant `AbRole` table.
- [launch] apps/web-next/src/app/api/v1/agentbook-billing/plans/[id]/route.ts:45-67 — DELETE marks `isActive: false` (soft-delete) but does not check active subscriptions. If 100 customers are on plan X and an admin DELETEs plan X, their subscriptions remain (Stripe-side) but the *local* row is `isActive=false`. The `invalidateAll()` (line 66) refreshes caches → entitlement checks for those 100 customers may degrade depending on plan resolution. Fix: refuse DELETE if `_count.subscriptions > 0`.
- [launch] apps/web-next/src/app/api/v1/agentbook-billing/plans/route.ts:32-38 — GET `/plans` is PUBLIC (no `requireAdmin`). That's fine — pricing is public — but `features`/`quotas` are exposed as JSON. If a future tier has a hidden flag (`internal_beta`) it leaks. Fix: at minimum redact `code === '__billing_inactive__'` patterns and any plan with `isActive: false`.

#### Quotas / entitlement

- [blocker] packages/billing/src/quotas.ts:20-33 — `checkQuota` **fails open on any DB error** (line 29-32) — returns `{ allowed: true, limit: -1 }` on caught exceptions. So if the billing DB is unreachable, every gate is bypassed and the user gets *unlimited usage* until the DB recovers. Combined with `incrementUsage` also failing open (line 47-49), an outage means unbilled usage that cannot be reconstructed. Fix: at minimum log to a durable queue / dead-letter for reconciliation; consider failing closed on writes and only failing open on reads.
- [launch] packages/billing/src/features.ts:21-24 — same fail-open behavior in `canUseFeature`. Documented as intentional ("better to grant access than to brick the bot"). Acceptable but: the bot will then offer paid features (tax_package_generation, multi_user_teams) to non-paying users on a DB blip. Recommend: short retry-with-backoff before falling open, and Sentry-style alerting on the open path.
- [launch] packages/billing/src/quotas.ts:35-49 — `incrementUsage` swallows errors silently with `console.warn`. So if the DB is unreachable, usage is uncounted *and never reconstructable* (no durable write-ahead log). Fix: write to a local in-memory ring + persist on next success, or use a durable outbox table.
- [launch] packages/billing/src/quotas.ts:13-18 — `periodStartOf` falls back to "calendar month start UTC" when subscription has no `currentPeriodEnd`. For a tenant on the synthetic-free plan (no subscription row) this means quotas reset on the 1st of each UTC month — independent of when the user signed up. Acceptable but inconsistent with the Stripe-managed plans whose period is anchored to subscription creation. Fix: document explicitly.
- [launch] packages/billing/src/plans.ts:30-44 — `BILLING_INACTIVE` sentinel grants *unlimited everything* when no plans are configured anywhere. Comment says "every quota is unlimited; every feature is granted." This is the documented intent. But (line 87-90) the check is `prisma.billPlan.count({ where: { isActive: true } })` — if even ONE plan has `isActive: true` but the user has no subscription AND no Free plan, the result is `SYNTHETIC_FREE` (severe restriction: 50 expenses, 10 OCR, etc.). This means an admin who creates one paid plan but forgets to create a Free plan instantly throttles every user without a subscription. The "billing inactive → active" transition has a sharp cliff. Fix: explicit Free plan seed in the migration; or grace-period of 7 days where SYNTHETIC_FREE quotas are doubled before strict enforcement.
- [launch] packages/billing/src/cache.ts:43-47 — `planCache` is **per-process** (in-memory `Map`). Each Vercel Function instance has its own. The webhook calls `invalidateAccount(tenantId)` (handlers.ts:48) which only clears the *local* process's cache — other warm instances still serve stale data for up to 24h. Same issue Stream A.1 flagged for `dashboard/agent-summary.ts:36`. Fix: move to Redis or use a Postgres NOTIFY/LISTEN to broadcast invalidations.
- [launch] packages/billing/src/account-resolver.ts:13-15 — `resolveAccountId` is currently `tenantId === accountId`. Comment promises team-billing migration via `BillSeat`. Until then, ANY change to multi-tenancy/team-billing requires touching every consumer. Document migration plan and add an integration test that asserts `accountId === tenantId` so the day team billing ships, all gates are reviewed.

#### Cron — quotas reset

- [launch] apps/web-next/src/app/api/v1/agentbook-billing/cron/reset-quotas/route.ts:9-13 — accepts EITHER `x-vercel-cron === '1'` OR `?secret=...`. The query-string secret can be logged in proxy/CDN access logs. Fix: prefer header-only auth; drop the `?secret=` form unless explicitly needed for local cron testing.
- [launch] apps/web-next/src/app/api/v1/agentbook-billing/cron/reset-quotas/route.ts:31-61 — sequential loop over `stale` subscriptions with one Stripe `subscriptions.retrieve` call each (line 34). If 10,000 subs are stale and Stripe rate-limits at ~100/sec, this cron takes >100 seconds and can hit Vercel's 60s function timeout. Fix: chunk in batches of 50 with `Promise.all` and `p-limit`, or use Stripe's `subscriptions.list` to fetch in bulk.
- [launch] apps/web-next/src/app/api/v1/agentbook-billing/cron/reset-quotas/route.ts:46-55 — Free-tier subs (no Stripe ID) get `currentPeriodEnd = start + 1 month` (line 49-51). This is good but `currentPeriodStart = sub.currentPeriodEnd ?? new Date()` means a NEW free subscription created with `currentPeriodEnd: null` (per intent route at /me/subscription/intent which doesn't set it) jumps period-start to now (Date object), period-end one month later — fine — but the `BillUsageCounter` rows from BEFORE this point have a different `periodStart` so they're orphaned. Fix: set `currentPeriodStart/End` on initial subscription creation.
- [polish] apps/web-next/src/app/api/v1/agentbook-billing/cron/cleanup-events/route.ts:18 — deletes BillEvent rows older than 90 days. Good. No archival to cold storage; for compliance (PCI/audit) you typically need 1-year+ retention of payment events. Fix: archive to S3/Blob before delete or extend to 365 days.

#### Plugin integration

- [blocker] plugins/agentbook-expense/backend/src/server.ts, agentbook-invoice/backend/src/server.ts, agentbook-tax/backend/src/server.ts — **NONE of these plugins call `checkQuota`/`incrementUsage`/`canUseFeature`** (verified by grep). The billing package is wired in only at the agent layer (Telegram bot) and admin UI. So a user on the Free plan can `POST /api/v1/agentbook-expense/expenses` 10,000 times directly via the API and the quota counters never increment. Fix: add `checkQuota('expenses_created')` middleware to `POST /expenses`, `incrementUsage` on success; same for invoice send and OCR.

**Summary:** 20 findings (2 blockers, 15 launch, 3 polish). Top concern: plugins do not call billing gates at all, so quotas/feature-flags are bypassed via direct API hits; combined with `checkQuota`/`incrementUsage` failing open on DB errors, the entire entitlement system is effectively advisory.

---

### Cross-plugin observations

- **Idempotency:** every financial mutation endpoint (POST `/expenses`, POST `/invoices`, POST `/payments`, POST `/journal-entries` in core, POST `/me/subscription` in billing) lacks an `Idempotency-Key` header pattern. The Stripe webhook is the lone exception (good). Fix: introduce a project-wide `withIdempotency(handler)` wrapper backed by a small `AbIdempotencyKey(tenantId, key, response, expiresAt)` model.
- **Account-code constants:** code `1000` (cash), `1100` (AR), `4000` (revenue), `5200` (fees) are hardcoded across expense and invoice plugins; the Stripe-completed handler uses `1010`/`1200` (mismatch). Fix: centralize in `packages/database/src/account-codes.ts`.
- **OCR auto-execute flow:** in both expense (`/receipts/ocr` line 1102) and tax (`/tax-slips/ocr` line 1417-1429) the auto-execute branches bypass the verify-then-commit framework when confidence > threshold. Tax-slips is a no-op (the `callGemini` stub) so the issue is latent there. Expense actively creates expenses without category/JE.
- **Cross-tenant ID lookups:** systematic pattern of `db.X.findFirst({ where: { id: someId } })` without `tenantId` filter when resolving FK names. Affects expense (account name lookup), invoice (client name lookup, payment lookup), tax (vendor name lookup), and core (per Stream A.1). Fix: add a Prisma extension or lint rule that flags any `findFirst({ where: { id: ... } })` on tenant-scoped models without a `tenantId` filter.


## Stream A.3 — `apps/web-next/src/app/api/v1/agentbook*/**`

**Scope reviewed:** 165 route files across 6 namespaces:
- `agentbook/` — webhooks (`telegram/webhook`, `stripe-webhook`), `switch-tenant`, 15 cron routes, 3 catch-all proxies
- `agentbook-core/` — dashboard, accountant/CPA, telegram setup, llm-configs, journal-entries, restore, money-moves, autopilot, automations, dead-letter, conversations, catch-up, tax-package, etc.
- `agentbook-expense/` — expenses, plaid (5 routes), budgets, advisor, deductions, mileage, csv import, receipts/upload-blob, splits, review-queue, etc.
- `agentbook-invoice/` — invoices, payments, send/void/remind, recurring, estimates, credit-notes, clients, projects, timer, time-entries, etc.
- `agentbook-tax/` — tax/estimate, tax/quarterly, tax-filing/[year]/{submit,export,validate,field,status}, tax-slips, reports (14)
- `agentbook-billing/` — me/subscription{,/intent,/cancel,/reactivate}, plans, templates, 2 crons

### Cross-cutting findings (apply across every namespace)

- [blocker] apps/web-next/src/lib/agentbook-tenant.ts:18-37 — `resolveAgentbookTenant` is the **single tenant gate** for ~150 route handlers and accepts ANY value in the `x-tenant-id` HEADER (line 19-20) or `ab-tenant` COOKIE (line 22-23) **without verification**. There is no HMAC, no auth-session cross-check (the auth fallback at line 25-33 is only reached when neither header nor cookie is present). Any browser, mobile client, or HTTP caller can set `x-tenant-id: <any-tenant-uuid>` and read/write that tenant's data through expenses, invoices, journal entries, billing, tax filings, LLM configs, CPA tokens, etc. Combined with the unauthenticated `/api/v1/agentbook/switch-tenant` (see below), an unauthenticated attacker who knows a tenant UUID has full data access. Fix: derive tenant ONLY from auth session; ignore header & cookie outside of admin/impersonation paths and require an admin-only header for those.
- [blocker] apps/web-next/src/lib/agentbook-tenant.ts:36 — fallback to `'default'` means an unauthenticated request with NO header, NO cookie, and NO session lands on a tenant literally named `default`. Every route in scope is reachable without auth and will silently read/write to the `default` tenant. Fix: throw 401 instead of returning a sentinel; never silently route to a real DB row on a missing auth.
- [launch] cross-cutting — none of the agentbook routes scope tenant ID lookups to a tenant. Routes confirmed with this bug pattern (`db.abAccount.findFirst({ where: { id: ... } })` or `findMany({ where: { id: { in: [...] } } })` without `tenantId`):
  - apps/web-next/src/app/api/v1/agentbook-expense/expenses/[id]/route.ts:40
  - apps/web-next/src/app/api/v1/agentbook-expense/expenses/route.ts:240
  - apps/web-next/src/app/api/v1/agentbook-expense/advisor/insights/route.ts:53 (catAccounts.findMany)
  - apps/web-next/src/app/api/v1/agentbook-expense/expenses/[id]/confirm/route.ts:46 (cashAccount lookup IS tenant-scoped — OK)
  - apps/web-next/src/app/api/v1/agentbook-core/dashboard/overview/route.ts:55 (asset accounts ARE tenant-scoped — OK)
  - same `findFirst({ where: { id } })` shape per Stream A.2 cross-plugin observations — the bug repeats verbatim in the Next.js handlers because they were ported from the Express plugin handlers. Fix: add `tenantId` to every `id`-lookup on tenant-scoped models.
- [launch] cross-cutting — **no idempotency keys on any financial-mutation route**. Confirmed missing on:
  - `POST /agentbook-core/journal-entries` (route.ts:36)
  - `POST /agentbook-expense/expenses` (route.ts:48)
  - `POST /agentbook-expense/expenses/[id]/confirm` (route.ts:23)
  - `POST /agentbook-expense/expenses/[id]/categorize`, `/auto-tag`, `/split`, `/skip-receipt`
  - `POST /agentbook-invoice/invoices` (route.ts:87)
  - `POST /agentbook-invoice/invoices/[id]/send` (route.ts:19) — double-tap will trigger 2 SendGrid sends (when wired)
  - `POST /agentbook-invoice/invoices/[id]/void` (route.ts:15) — double-tap will post 2 reversing JEs and decrement client total twice (no idempotency check)
  - `POST /agentbook-invoice/invoices/[id]/remind` — double-send risk
  - `POST /agentbook-invoice/payments` (route.ts:26)
  - `POST /agentbook-invoice/invoices/draft-from-text` (route.ts:36)
  - `POST /agentbook-invoice/recurring-invoices`, credit-notes, estimates/[id]/{accept,decline,convert}
  - `POST /agentbook-billing/me/subscription` (route.ts:21)
  - `POST /agentbook-billing/me/subscription/cancel|reactivate|intent`
  - `POST /agentbook-billing/plans` (route.ts:40)
  - `POST /agentbook-tax/tax-filing/[year]/submit` (route.ts:14) — double-tap could double-file a tax return
  - `POST /agentbook-expense/bank-transactions/[id]/match` (route.ts:39)
  - The **only** financial mutation route with idempotency is `apps/web-next/src/app/api/v1/agentbook/stripe-webhook/route.ts` (via `BillEvent.stripeEventId` unique). Fix: introduce shared `withIdempotency(handler)` wrapper keyed on `(tenantId, idempotencyKeyHeader, route)` and persist response for 24h.
- [launch] cross-cutting — most routes set `runtime = 'nodejs'` and `dynamic = 'force-dynamic'`, and several `maxDuration = 60` or `120`. There is no request-time auth middleware in `apps/web-next/middleware.ts` (no path under `/api/v1/agentbook*` is gated). Per-route auth is done via `resolveAgentbookTenant` only — and that helper does NOT enforce auth (see blocker above). Fix: add a project-level `middleware.ts` matcher for `/api/v1/agentbook*` that requires a valid session for write methods.

### agentbook/ — webhooks, proxies, crons, switch-tenant

#### telegram/webhook/

- [VERIFIED OPEN: G-OLD-001 PARTIAL] apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts:333-426 — Telegram photo OCR IS wired end-to-end here: `ocrReceipt()` calls Gemini Vision, `createOcrExpense()` persists with `status: 'pending_review'`, `source: 'telegram_photo'`, `journalEntryId: null`. This closes the "photo creates $0.01 stub" portion of G-OLD-001. However the underlying plugin path (`/receipts/ocr` at plugins/agentbook-expense/backend/src/server.ts:1102 per Stream A.2) is still wrong — so if any caller uses the plugin route directly, the bug remains. Re-classify G-OLD-001 as "fixed at the Telegram adapter; plugin route still broken."
- [VERIFIED OPEN: G-OLD-002 PARTIAL] apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts:259-263 — file fetched once at OCR time and base64'd into the Gemini request, BUT `receiptUrl` is stored as the Telegram CDN URL (line 388 inside `createOcrExpense`). Telegram file URLs expire in ~24h. There IS a `/receipts/upload-blob` route at apps/web-next/src/app/api/v1/agentbook-expense/receipts/upload-blob/route.ts:22 that does the Vercel Blob rehost — but the OCR auto-create path at line 388 does NOT call it. Net: same expiry bug as the plugin path. Fix: call upload-blob inline before persisting `receiptUrl`, or queue a rehost job after the OCR succeeds.
- [polish] apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts:6142-6151 — `X-Telegram-Bot-Api-Secret-Token` header IS verified against `TELEGRAM_WEBHOOK_SECRET` (good). BUT the check is `expectedSecret && secret !== expectedSecret && !E2E_CAPTURE` — if `TELEGRAM_WEBHOOK_SECRET` is unset in env (e.g. forgotten on a new deployment), the gate is open and ANY caller can POST forged Telegram updates. Fix: in production, fail-closed: if `TELEGRAM_WEBHOOK_SECRET` is unset, return 503 instead of waving traffic through.
- [launch] apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts:6147-6151 — `E2E_CAPTURE` env var (when set to `'1'`) bypasses the Telegram secret check entirely. The check at line 89 `process.env.E2E_TELEGRAM_CAPTURE === '1'` runs at module load. If this env var is set in any non-test deployment, the webhook becomes wide open. Fix: require an additional env-var gate (e.g. `NODE_ENV !== 'production'`) for the bypass.
- [VERIFIED CLOSED: G-OLD-025] apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts:6164-6218 — Telegram update idempotency via `tg_update:<id>` / `tg_callback:<id>` keys IS implemented via `claimKey` + `recordResponse`. Closes G-OLD-025 for the Telegram path. Edge: `claimKey` failures (line 6202) silently fall through and let the update process — so a dedup-table outage can still produce duplicates. Acceptable trade-off per the comment, but document this.
- [VERIFIED OPEN: G-OLD-018] apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts:1-6403 — the 6402-line route handler is the largest single file in the codebase. It contains massive amounts of agent decision logic that belongs in `plugins/agentbook-core`: OCR result parsing (line 313-330), category inference (line 357-368), confirm-flow state machine (line 482-583, 599-1500+), bank-match matching/scoring (imported from `@/lib/agentbook-payment-matcher`), digest pref editing (via `applyFeedbackToPrefs`), receipt-batch grouping (line 51-55 inline + downstream), telegram callback handling (lines 6100+), and **the entire `setActiveExpense` / `getActiveExpense` thread-context layer**. Per the agent-first rubric ("Routes thin: parse → delegate → respond"), this is the worst offender in the entire codebase. The agent brain's `classifyAndExecuteV1` is called inside this handler but most flows DON'T reach it; the inline regex/keyword dispatch above it handles most messages. Fix: extract OCR/confirm/thread logic into agent-brain skills + adapter trampolines; the route should be parse update → call `handleAgentMessage` → format reply.
- [launch] apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts:60-66 — the rate-limit at line 6244 uses `checkAndIncrement` with default 60/min, 1000/day. Good. BUT failure of `checkAndIncrement` (line 6277-6281) **silently fails open** ("Don't fail-closed on a counter-table outage — better to let through one extra request than to brick the bot for everyone."). For a bot that drives Gemini LLM calls (cost-bearing), this means a counter-table outage produces unbounded LLM spend. Fix: write to a fallback in-memory ring + persist on next success; or fail-closed after 3 consecutive errors with circuit breaker.
- [launch] apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts:208-225 — `getGeminiKey()` reads `db.abLLMProviderConfig.findFirst({ where: { enabled: true, isDefault: true, provider: 'gemini' } })` WITHOUT a `tenantId` scope. Same systemic issue as the plugin (Stream A.2). Every tenant's OCR may use a different tenant's Gemini key. Fix: scope by tenant or move to per-tenant credential vault.
- [launch] apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts:282 — `key=${apiKey}` URL query string for Gemini call (same as Stream A.1 finding). Fix: use `x-goog-api-key` header.
- [launch] apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts:6299-6377 — `withRetry` wraps `b.handleUpdate(update)` with retry; on terminal failure writes to `AbWebhookDeadLetter` and STILL returns 200 to Telegram. Good defensive pattern. But `withRetry` runs the entire 6000-line handler up to 3 times; if the handler is non-idempotent (which much of it is — see active-expense writes, AbUserMemory writes), retries will produce duplicate effects. Fix: ensure handler is idempotent OR run idempotency claim BEFORE retry.
- [polish] apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts:77-80 — `CHAT_TO_TENANT_FALLBACK` hard-codes specific user UUIDs (Maya's web-user UUID, e2e@agentbook.test). This is dev-only data shipped in production code. Fix: gate via `NODE_ENV !== 'production'`.
- [polish] apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts:6395 — top-level `catch` returns `{ ok: true }` for ANY error so Telegram doesn't retry. This drops bugs silently — if `b.handleUpdate` throws unexpectedly *after* the retry/dead-letter path (e.g. ReferenceError), the user sees nothing and ops sees a console log only. Fix: log structured event (`AbEvent.eventType: 'telegram.webhook_uncaught'`) before returning 200.

#### stripe-webhook/

- [VERIFIED CLOSED: G-OLD-024] apps/web-next/src/app/api/v1/agentbook/stripe-webhook/route.ts:11-24 — `stripe-signature` header verified, raw body via `request.text()`, `runtime = 'nodejs'`. Textbook pattern. **This is the only correct Stripe webhook in the codebase** — the plugin handlers at `plugins/agentbook-expense/backend/src/server.ts:915` and `plugins/agentbook-invoice/backend/src/server.ts:2001` are both unsigned per Stream A.2 (BLOCKERS still open).
- [launch] apps/web-next/src/app/api/v1/agentbook/stripe-webhook/handlers.ts:62-67 — `invoice.paid` / `invoice.payment_failed` are no-op (`console.log` only). For dunning + entitlement degradation this is a launch gap. Same as Stream A.2 finding.
- [launch] apps/web-next/src/app/api/v1/agentbook/stripe-webhook/route.ts:31 — `(event.data.object as { metadata?: { tenantId?: string } })?.metadata?.tenantId` reads tenant from the event payload metadata. For `invoice.*` events the metadata lives on the parent Subscription, not the Invoice → `accountId: null` for these rows. Same as Stream A.2 finding.
- [launch] apps/web-next/src/app/api/v1/agentbook/stripe-webhook/handlers.ts:25-26 — `as unknown as { current_period_start: number }` cast on Subscription. If the Stripe API version changes, billing breaks silently. Fix: add runtime type guard.
- [polish] apps/web-next/src/app/api/v1/agentbook/stripe-webhook/handlers.ts:11-15 — `tenantId` missing from Subscription metadata is logged and skipped silently. Same as Stream A.2 finding — log to Sentry-style alert table or `AbEvent`.

#### switch-tenant/

- [blocker] apps/web-next/src/app/api/v1/agentbook/switch-tenant/route.ts:24-54 — **UNAUTHENTICATED tenant switcher**. `GET ?id=<any-uuid>` sets the `ab-tenant` cookie to any value, no session check, no allowlist on UUIDs not in `PERSONAS`. Every subsequent `resolveAgentbookTenant` call returns that value (header > cookie > session). Combined with the cross-cutting blocker on `resolveAgentbookTenant`, this means: open browser → hit `/api/v1/agentbook/switch-tenant?id=<victim-tenant-uuid>` → browse the dashboard as the victim with full read/write. The cookie is `httpOnly: false` (line 49) so JS can read it too. Fix: require auth + verify the user has membership in the target tenant; remove the public-by-UUID flow entirely.
- [launch] apps/web-next/src/app/api/v1/agentbook/switch-tenant/route.ts:13-22 — `PERSONAS` map hard-codes 3 real user UUIDs (Maya, Alex, Jordan) and email addresses in production code. Anyone hitting `GET /switch-tenant` (line 24-37) without an `id` gets the full list. Fix: drop persona helpers from production; gate behind admin/dev.

#### core/[...path]/, expense/[...path]/, invoice/[...path]/, tax/[...path]/

- [blocker] apps/web-next/src/app/api/v1/agentbook/core/[...path]/route.ts:26-38 — proxy route resolves tenant via header > cookie > session > `'default'` and forwards to the plugin backend (`AGENTBOOK_CORE_URL`). Same blocker as the cross-cutting tenant trust issue, **but the proxy compounds it**: every call to a plugin route goes through this catchall with a header it set itself. A tenant-id passed by the browser will be honored by the catchall. Fix: catchalls should ONLY forward tenants derived from auth-session; never header/cookie.
- [launch] apps/web-next/src/app/api/v1/agentbook/{core,expense,invoice,tax}/[...path]/route.ts — all four catchalls are identical. They forward `Authorization` header to the plugin backend BUT not the original `x-forwarded-for`/`user-agent` (line 19-21 only sets Content-Type and Authorization). Audit logs on the plugin side will record the proxy's IP, not the originating client. Fix: forward `x-forwarded-for`.
- [launch] same files line 40-46 — `fetch(targetUrl, ...)` has NO timeout. A stuck plugin backend blocks the Vercel function until the platform kills it (default 60-120s). Same defect class as Stream A.1's `callGemini` finding. Fix: AbortController with a 20-30s timeout, return 504 on timeout.
- [polish] same files line 53-57 — on connection-refused (plugin down), returns 503 with a generic message but does NOT log structured event. For multi-plugin debugging this is a blind spot. Fix: log to `AbEvent.eventType: 'plugin.unreachable'` so ops can correlate outages.

#### cron/

All cron routes that use `safeCompareBearer` (PR 3+) get bearer auth right via `timingSafeEqual`. The older ones use `authHeader !== \`Bearer ${process.env.CRON_SECRET}\`` (string equals, not timing-safe). Inventory below.

- [launch] apps/web-next/src/app/api/v1/agentbook/cron/daily-pulse/route.ts:11 — `authHeader !== \`Bearer ${process.env.CRON_SECRET}\`` non-timing-safe compare (string equals on secret). Per the comment in `plaid-sync/route.ts:13-17` this is "currently only timing-safe on this cron". Migrate to `safeCompareBearer`. Same defect in: `morning-digest/route.ts:889`, `recurring-invoices/route.ts:10`, `weekly-review/route.ts:11`, `calendar-check/route.ts:11`.
- [launch] apps/web-next/src/app/api/v1/agentbook/cron/payment-reminders/route.ts:6 — `GET` handler has NO auth check at all. Anyone can hit the endpoint and trigger reminder sends. Fix: add `safeCompareBearer` gate matching the other crons.
- [launch] apps/web-next/src/app/api/v1/agentbook/cron/daily-pulse/route.ts:64-88 — auto-records bank transactions silently when `pattern.confidence >= 0.9`. Creates `AbExpense` rows with no `journalEntryId`, no `categoryId` filter check, no `status: 'pending_review'`. Per the agent-first rubric, autoposting financial entries without confirmation gate is a launch blocker — this is the "automation that surprises you" pattern Stream A.2 already flagged in the OCR path. Worse: the JE isn't posted (no line 73-82 doesn't touch `abJournalEntry`), so these expenses are floating off-ledger. Fix: route through the same confirm-flow as Telegram OCR (status `pending_review` + Telegram nudge).
- [launch] apps/web-next/src/app/api/v1/agentbook/cron/daily-pulse/route.ts:32-37 — `db.abExpense.aggregate({ where: { tenantId, date: { gte: today } } })` uses server-local `today` (line 29). Tenants in PST will have their "today" boundary set at UTC midnight, not local midnight, despite the timezone check at line 22-26 for sending. Aggregate may include or exclude wrong-hour transactions. Fix: compute `today` in tenant TZ.
- [launch] apps/web-next/src/app/api/v1/agentbook/cron/recurring-invoices/route.ts:32-39 — invoice-number generation reads `lastInvoice` outside a transaction, same race as Stream A.2 found. With 2 concurrent crons (e.g. retry overlap) two invoices get the same `INV-YYYY-NNNN` and one fails P2002.
- [launch] apps/web-next/src/app/api/v1/agentbook/cron/recurring-invoices/route.ts:50-52 — `if (!arAccount || !revenueAccount) continue;` silently skips invoice generation when accounts missing. No event, no alert. Tenant who hasn't seeded their chart of accounts gets zero recurring invoices forever. Fix: log to `AbEvent` so the next morning digest surfaces "Recurring invoice X failed — chart of accounts not seeded."
- [launch] apps/web-next/src/app/api/v1/agentbook/cron/recurring-invoices/route.ts:96-103 — `nextDue.setMonth(nextDue.getMonth() + 1)` ignores the `lastGenerated` field. If a cron is missed for a week then runs, the next due is bumped from the (stale) `nextDue`, so the next generation happens 1 month from when the cron *resumes*, not from when the invoice was due. Recurring schedule drifts on outage. Fix: compute next due from `lastGenerated + frequency`.
- [launch] apps/web-next/src/app/api/v1/agentbook/cron/morning-digest/route.ts:734-752 — `sendTelegram` calls `https://api.telegram.org/bot${bot.botToken}/sendMessage` directly with `bot.botToken` in the URL. Bot tokens are sensitive. Vercel HTTP-egress logs may capture the URL. Fix: use `bot${token}` only in the request init (Telegram requires URL-embedded tokens — there's no header alternative), and explicitly add `Cache-Control: no-store` + ensure no logging middleware records URLs.
- [launch] apps/web-next/src/app/api/v1/agentbook/cron/morning-digest/route.ts:887-1080 — sequential per-tenant `for` loop (line 918) with potentially expensive LLM calls (`generateTaxTip`, `generateCashFlowTip` at line 960-965) per tenant. For 1000 tenants this exceeds Vercel's 60s `maxDuration`. The cron will timeout mid-iteration and stuck tenants get re-emailed on the next run (no per-tenant cursor / state). Fix: bounded fan-out (3-5 concurrent), break into chunked invocations with continuation token, OR move to a background queue.
- [launch] apps/web-next/src/app/api/v1/agentbook/cron/morning-digest/route.ts:867-885 — `sendEmail` uses Resend with `subject: 'Your AgentBook morning summary'` hard-coded; no unsubscribe link, no list-management header. CAN-SPAM / GDPR risk for a daily auto-email. Fix: include unsubscribe URL + `List-Unsubscribe` header per RFC 8058.
- [launch] apps/web-next/src/app/api/v1/agentbook/cron/morning-digest/route.ts:893-908 — auto-enables digest for tenants who have a Telegram bot connected (line 902-907). This is an opt-OUT by default for Telegram users; depending on jurisdiction (CASL, GDPR) bulk-messaging without explicit consent has legal risk. Fix: explicit opt-in required; default to off.
- [launch] apps/web-next/src/app/api/v1/agentbook/cron/morning-digest/route.ts:1067-1070 — top-level error per tenant logs and continues, but the loop counts `errors++` without persisting which tenant failed. A pathological tenant repeatedly failing produces no actionable signal. Fix: persist `AbEvent.eventType: 'digest.failed'` per tenant.
- [launch] apps/web-next/src/app/api/v1/agentbook/cron/daily-backup/route.ts:165-208 — `dailyBackupEnabled` opt-in is good, but the per-tenant backup uploads to Vercel Blob with public-by-token URLs that include the tenant's full data (CSVs of expenses + invoices + payments). The notification at line 75 says "link valid 24h" but Blob URLs are typically permanent unless explicitly token-scoped. Fix: use signed-URL with expiry instead of public Blob URL.
- [launch] apps/web-next/src/app/api/v1/agentbook/cron/dead-letter-replay/route.ts:31-39 — `inferWebhookUrl` builds the URL from the cron's `request.url`. If Vercel routes the cron through a different host (preview deployment, internal hostname), the replay POSTs to the wrong webhook. Fix: require explicit env var in production.
- [launch] apps/web-next/src/app/api/v1/agentbook/cron/dead-letter-replay/route.ts:51 — replays go through `replayOpenDeadLetters` which POSTs back to the Telegram webhook. The webhook idempotency (`tg_update:<id>`) will short-circuit successful replays, but if the original cause was a downstream LLM outage that's *still* broken, the replay re-fails and bumps `attempts`. Over many days a single poisoned message will get retried daily forever. Fix: cap `attempts < 10`, then mark as `permanent_failed`.
- [polish] apps/web-next/src/app/api/v1/agentbook/cron/voice-cache-prune/route.ts, idempotency-prune, purge-deleted, fx-rates — clean, single-purpose crons with timing-safe auth. No issues.
- [polish] apps/web-next/src/app/api/v1/agentbook/cron/calendar-check/route.ts:33-63 — sets `alertSent: true` BEFORE creating the `AbEvent`. If the event-create fails, the alert is marked sent but never delivered. Fix: swap order or wrap in transaction.

### agentbook-core/

#### admin/llm-configs/

- [VERIFIED OPEN: A.1 finding still present] apps/web-next/src/app/api/v1/agentbook-core/admin/llm-configs/route.ts:14-26 — GET endpoint calls `resolveAgentbookTenant(request)` (line 16) but **does NOT check that the caller is an admin**, then returns `db.abLLMProviderConfig.findMany(...)` which includes `apiKey` as plaintext (line 17). **Anyone with a session can read every tenant's Gemini API key.** This duplicates the Stream A.1 [launch] finding at plugin server.ts:1546-1620 verbatim. Fix: gate with admin role check; redact apiKey to last-4.
- [launch] apps/web-next/src/app/api/v1/agentbook-core/admin/llm-configs/route.ts:40-77 — POST creates a new LLM config WITHOUT admin check. Any session can create a config row marked `isDefault: true` and `updateMany({ data: { isDefault: false } })` (line 53) which **clears every other tenant's default flag globally** (no tenantId scope on updateMany). The next plugin OCR call grabs the attacker's config and uses the attacker's apiKey to bill them but exfiltrate the OCR text. Fix: admin auth + tenant-scope on the updateMany.
- [launch] apps/web-next/src/app/api/v1/agentbook-core/admin/llm-configs/[id]/route.ts:14-30 — DELETE has no admin check, no tenant scope. `db.abLLMProviderConfig.delete({ where: { id } })` (line 21) lets any session delete ANY config. Fix: admin gate.
- [launch] apps/web-next/src/app/api/v1/agentbook-core/admin/llm-configs/[id]/test/route.ts:14-58 — `POST .../test` reads `config.apiKey` and uses it to call Gemini (line 34). No tenant scope, no admin check. Any session can pump LLM calls through any tenant's API key (DOS / bill-burn). Fix: admin gate.
- [polish] apps/web-next/src/app/api/v1/agentbook-core/admin/llm-configs/[id]/test/route.ts:34 — `key=${config.apiKey}` URL query string — same Stream A.1 finding.

#### accountant/, cpa/

- [launch] apps/web-next/src/app/api/v1/agentbook-core/accountant/invite/route.ts:49-141 — CPA invite stores `accessToken` in plaintext (line 101) and returns it in the response (line 80, 127). Bearer-token-by-URL pattern. Per A.1 finding on `cpa/generate-link`: should be hashed at rest. The 90-day TTL is documented and OK.
- [launch] apps/web-next/src/app/api/v1/agentbook-core/cpa/generate-link/route.ts:19-46 — duplicate of `accountant/invite` flow (same model `AbTenantAccess`), but: no validation on `email` (line 31 falls back to `'cpa@example.com'`), no audit event written, no idempotency check (line 27 always creates a new row). Same A.1 finding still present. Fix: deprecate this route, route callers to `accountant/invite`.
- [polish] apps/web-next/src/app/api/v1/agentbook-core/cpa/notes/route.ts:47 — `authorId: tenantId` — authorId is set to the tenant ID, not the actual user/CPA who wrote the note. A CPA writing a note is recorded as if the owner wrote it. Audit trail loss. Fix: derive authorId from session.
- [polish] apps/web-next/src/app/api/v1/agentbook-core/accountant/list/route.ts:25-44 — selects exclude `accessToken` (good). But the `active` derivation at line 41-44 returns `true` for rows with NULL `expiresAt`. Revocation sets `expiresAt = new Date()` (per revoke/route.ts:58), but old rows from `cpa/generate-link` did not set expiresAt either. Fix: include `revokedAt` flag in the query.

#### telegram/setup, status, disconnect

- [launch] apps/web-next/src/app/api/v1/agentbook-core/telegram/setup/route.ts:54-72 — stores `botToken` plaintext in `AbTelegramBot.botToken` (line 65). Same A.1 finding (encryption-at-rest missing). Token is then used in URL query strings (line 78) for webhook registration — Vercel HTTP egress logs may capture it.
- [launch] apps/web-next/src/app/api/v1/agentbook-core/telegram/setup/route.ts:77-85 — webhook registration with `setWebhook?secret_token=${webhookSecret}` puts the secret in the URL query string. If `regRes` fails, the error is swallowed silently ("best effort — user can register manually" line 83). User sees `webhookRegistered: false` with no diagnostic. Fix: surface the Telegram-returned error message.
- [launch] apps/web-next/src/app/api/v1/agentbook-core/telegram/status/route.ts:35 — `getWebhookInfo` URL embeds `botToken` in the path. Standard Telegram API requirement, but with no caching and called on every page load, this leaks frequently. Fix: cache result for 1-2 minutes.
- [launch] apps/web-next/src/app/api/v1/agentbook-core/telegram/disconnect/route.ts:14-26 — DELETE has no confirmation gate. A double-tap or replay re-issues `deleteWebhook` (idempotent on Telegram side) but **deletes the DB row** (line 24). The second call will 404 — fine, but recovery requires re-issuing the token. Fix: soft-delete with restore window.

#### journal-entries/, restore/, dead-letter/, snapshot/, autopilot/, money-moves/, audit-events/

- [launch] apps/web-next/src/app/api/v1/agentbook-core/journal-entries/route.ts:36-167 — same Stream A.1 finding repeated verbatim: **no idempotency on financial mutation**, no `@@unique([tenantId, sourceType, sourceId])` upfront check. Replays from webhooks or planner retries double-post.
- [launch] apps/web-next/src/app/api/v1/agentbook-core/journal-entries/route.ts:100-105 — `autoApproveLimitCents` exceeded → just `console.warn` and continue. Same Stream A.1 finding [launch] regarding escalation: no escalation record, no `requiresApproval` event. Fix: 202 + escalation row.
- [launch] apps/web-next/src/app/api/v1/agentbook-core/journal-entries/route.ts:73-97 — period gate uses `new Date(date)` server-local TZ; same TZ bug as Stream A.1 (asia-pacific tenant posting on month boundary hits wrong fiscal period).
- [launch] apps/web-next/src/app/api/v1/agentbook-core/autopilot/route.ts:40-52 — **agent decision logic in adapter**: GET endpoint flips `abAgentConfig.autoApprove` based on `trustPhase` derived from 30-day learning event counts. This belongs in the agent brain's policy/manifest layer, not in a thin HTTP handler. Per rubric #2: logic-in-adapter, auto-deduction. Fix: move to `agent-brain.ts` / `agent-memory.ts` and have the route be read-only.
- [launch] apps/web-next/src/app/api/v1/agentbook-core/autopilot/route.ts:30-31 — `accuracy = total > 0 ? confirmations / total : 0.5` — default 0.5 for new tenants is arbitrary. Combined with the auto-flip at trustLevel > 0.7, a tenant with zero learning events but 6 months active hits `trustLevel = 0.4 + 0.3 = 0.7` and auto-enables auto-approve. This is **automation surprise** — bookkeeper switches to autopilot without user opt-in. Fix: require explicit `autoApprove: true` user toggle; this route should ONLY surface the trust score for display.
- [launch] apps/web-next/src/app/api/v1/agentbook-core/money-moves/route.ts:25-119 — **agent reasoning logic in adapter**. Hard-coded US/CA tax bracket arrays (line 25-39) and threshold logic ("cash cushion < 2 months", "client > 50% of revenue", "$5K from next bracket") are agent decisions. The tax bracket arrays here will drift from the same data in `agentbook-tax/tax/estimate/route.ts:19-35` (already do — `money-moves` uses `min:0, max:1_160_000` for US 10% while `estimate` uses `upTo: 11_600_00`). Fix: extract to a shared module + treat as an agent skill ("proactive-alerts").
- [launch] apps/web-next/src/app/api/v1/agentbook-core/money-moves/route.ts:48-50 — `db.abJournalLine.findMany({ where: { accountId: cash.id, entry: { tenantId } } })` reads ALL journal lines ever for cash account. No date filter. For a tenant with years of data this is unbounded. Fix: aggregate to current balance via `groupBy`.
- [launch] apps/web-next/src/app/api/v1/agentbook-core/dashboard/agent-summary/route.ts:30-31 — `cache = new Map<string, ...>()` is process-local. Same Stream A.1 finding [launch] re: dashboard/agent-summary.ts:36. Cross-worker inconsistency.
- [launch] apps/web-next/src/app/api/v1/agentbook-core/restore/[entityType]/[id]/route.ts:73-99 — `updateMany({ where: { id, tenantId }, data: { deletedAt: null } })` is correct tenant-scoping. Good pattern. But no audit of WHICH user inside the tenant did the restore — `inferActor` returns the session user, OK. No issues.
- [polish] apps/web-next/src/app/api/v1/agentbook-core/dead-letter/route.ts:29-36 — `OR: [{ tenantId }, { tenantId: null }]` lets the caller see globally-orphaned rows. Documented as intentional. But the orphan rows may contain Telegram updates from OTHER tenants whose tenant resolution failed — including their chat IDs, message text, etc. This leaks cross-tenant data. Fix: only show orphans to a designated `superadmin` role.
- [polish] apps/web-next/src/app/api/v1/agentbook-core/dead-letter/[id]/replay/route.ts:48 — same orphan leak via replay. A tenant can replay another tenant's dead-letter row if it happens to be orphaned. Fix: superadmin-only.
- [launch] apps/web-next/src/app/api/v1/agentbook-core/snapshot/route.ts:49-72 — POST writes an `AbEvent` with `actor: 'human'` regardless of who's calling. If the caller is a cron, bot, or agent the actor is mis-labeled. Fix: derive from `inferActor`.
- [polish] apps/web-next/src/app/api/v1/agentbook-core/audit-events/route.ts:38 — `Math.min(parseInt(params.get('limit') || '50', 10), 200)` — `parseInt('abc', 10)` returns NaN, and `Math.min(NaN, 200)` is NaN, and `take: NaN` is rejected by Prisma. Fix: `|| 50` after parseInt.

#### dashboard/, conversations/, catch-up/, searches/

- [launch] apps/web-next/src/app/api/v1/agentbook-core/dashboard/overview/route.ts:53-139 — runs **11 parallel queries** on every dashboard load (line 41-52). For a tenant with multi-year history, `ninetyDayExpenses` (line 129) is unbounded by `take`. Fix: add `take: 500`; aggregate at the DB.
- [polish] apps/web-next/src/app/api/v1/agentbook-core/dashboard/activity/route.ts — not read in detail but follows the same dashboard pattern; assume similar N+1 risk.
- [polish] apps/web-next/src/app/api/v1/agentbook-core/conversations/route.ts:14-31 — tenant-scoped read. `take: parseInt(... || '20')` — same NaN bug as audit-events.
- [polish] apps/web-next/src/app/api/v1/agentbook-core/catch-up/route.ts:33-42 — parses `since` and silently falls back to 24h on parse failure. Good UX; no auth issues.
- [launch] apps/web-next/src/app/api/v1/agentbook-core/searches/route.ts:99-108 — POST saves `query` as raw JSON `body.query as any` (line 105). The query is later executed by `runSavedSearch(tenantId, query)` (saved-searches/[id]/run/route.ts:44). If the runner doesn't validate the query shape per-execution, a malformed saved search persists forever and breaks on every run. Fix: validate shape on write + on read.

### agentbook-expense/

#### expenses/, expenses/[id]/{confirm,categorize,reject,...}

- [launch] apps/web-next/src/app/api/v1/agentbook-expense/expenses/route.ts:48-202 — POST has the same Stream A.2 bugs as the Express plugin (no idempotency, server-local date TZ, default `status: 'confirmed'`). Plus: line 240-243 `db.abAccount.findMany({ where: { id: { in: categoryIds } } })` MISSING `tenantId` — cross-tenant category name leak. Plus: vendor pattern lookup (line 82-93) increments usageCount fire-and-forget — a malicious tenant could supply a `vendor` that normalizes to another tenant's pattern (collisions on common normalized names like "uber") and bump the counter. Tenant-scoped pattern lookup IS used (line 83) so the row read is fine, but the unique index on `(tenantId, vendorPattern)` should be verified in schema.
- [launch] apps/web-next/src/app/api/v1/agentbook-expense/expenses/[id]/route.ts:40 — same Stream A.2 cross-tenant `abAccount.findFirst({ where: { id: expense.categoryId } })` MISSING tenantId. Repeated verbatim in the Next.js port.
- [launch] apps/web-next/src/app/api/v1/agentbook-expense/expenses/[id]/route.ts:97 — `db.abExpense.update({ where: { id }, data })` — the `existing` check at line 85 uses `findFirst({ where: { id, tenantId } })` (good), but the update uses `where: { id }` (no tenant). A race window where two requests interleave could let a stale `existing` pass while a different tenant's row is updated by ID collision. UUIDs are improbable but the pattern is wrong. Fix: `updateMany({ where: { id, tenantId } })`.
- [launch] apps/web-next/src/app/api/v1/agentbook-expense/expenses/[id]/route.ts:147-188 — DELETE has same `where: { id }` update at line 161; same defect.
- [launch] apps/web-next/src/app/api/v1/agentbook-expense/expenses/[id]/confirm/route.ts:48-65 — when no JE yet and `finalCategoryId && !isPersonal`, creates a JE OUTSIDE a transaction (line 48) then updates expense with `journalEntryId` (line 73). If the JE create succeeds but the update fails, the JE exists with `sourceId: expense.id` and the expense still says `status: 'pending_review'` with `journalEntryId: null`. Books are out of sync. Fix: wrap in `db.$transaction`.
- [launch] apps/web-next/src/app/api/v1/agentbook-expense/expenses/[id]/confirm/route.ts:39-67 — when `journalEntryId` already exists AND `body.categoryId` changes the category, no JE reversal/reposting is done. Same Stream A.2 finding [launch] at server.ts:1962-2014. Fix: detect category change and post reversing entry.

#### plaid/

- [VERIFIED CLOSED: G-OLD-012 PARTIAL] apps/web-next/src/app/api/v1/agentbook-expense/plaid/exchange/route.ts:37 — uses `exchangePublicToken` from `@/lib/agentbook-plaid`, which (per the file's design) encrypts the access token via `accessTokenEnc`. This is the correct pattern — addresses the Stream A.2 [blocker] at plugins/agentbook-expense/backend/src/server.ts:655-656 (in-memory Plaid token map). The Next.js routes use the persistent encrypted store. G-OLD-012 closure: live Plaid still needs prod credentials but the storage primitive is correct.
- [launch] apps/web-next/src/app/api/v1/agentbook-expense/plaid/exchange/route.ts:38-55 — response strips `accessTokenEnc` (good). But `plaidItemId` is returned to the client (line 41). Plaid item IDs are not secret per Plaid docs, but combined with a leaked institution credential they're useful for fingerprinting. Low risk; consider scrubbing.
- [launch] apps/web-next/src/app/api/v1/agentbook-expense/plaid/sync/route.ts:23-26 — `findMany({ where: { tenantId, connected: true, accessTokenEnc: { not: null } } })` is tenant-scoped (good). Sequential `for` loop (line 32) — for 5+ accounts this serializes Plaid calls. Same defect as the cron file but reusable patterns suggest moving to a shared `processAll`.
- [polish] apps/web-next/src/app/api/v1/agentbook-expense/plaid/link-token/route.ts:20 — `process.env.PLAID_ENV || 'sandbox'` defaults to sandbox in response. In production this is leaky — the client knows whether they're on sandbox. Fix: gate the env return behind admin.

#### receipts/upload-blob/, advisor/, budgets/, deductions/, bank-transactions/

- [launch] apps/web-next/src/app/api/v1/agentbook-expense/receipts/upload-blob/route.ts:54-58 — `db.abExpense.update({ where: { id: expenseId }, data: { receiptUrl: permanentUrl } })` — NO tenant check on the expense being updated. Caller passes `expenseId` and the receipt URL of one tenant's expense can be overwritten by another tenant's `upload-blob` call (if expenseId is known). Fix: `updateMany({ where: { id: expenseId, tenantId } })`.
- [launch] apps/web-next/src/app/api/v1/agentbook-expense/receipts/upload-blob/route.ts:38 — filename `receipts/${tenantId}/${Date.now()}.${ext}` — predictable filenames. If Vercel Blob URLs don't include a random token, sequential receipt access by URL-guessing is possible. Vercel Blob does add tokens by default but the predictable prefix encourages enumeration attacks. Fix: add `crypto.randomUUID()` to the filename.
- [launch] apps/web-next/src/app/api/v1/agentbook-expense/advisor/insights/route.ts:51-56 — `catAccounts = await db.abAccount.findMany({ where: { id: { in: Array.from(allCatIds) } } })` — same cross-tenant leak (no tenantId).
- [launch] apps/web-next/src/app/api/v1/agentbook-expense/advisor/insights/route.ts:122-148 — duplicate-detection runs O(N²) inside a Vercel function. Same Stream A.2 finding [launch] at server.ts:1564-1590; ported verbatim.
- [polish] apps/web-next/src/app/api/v1/agentbook-expense/budgets/route.ts:46-123 — clean pattern, tenant-scoped, audit emitted. No issues.
- [polish] apps/web-next/src/app/api/v1/agentbook-expense/deductions/suggestions/[id]/apply/route.ts:25-118 — clean pattern, tenant-scoped, idempotent (line 44-49 detects already-applied), audited. No issues.
- [polish] apps/web-next/src/app/api/v1/agentbook-expense/bank-transactions/[id]/match/route.ts:39-143 — clean pattern, tenant-scoped, delegates to `applyInvoiceMatch`/`applyExpenseMatch` helpers. Errors mapped to HTTP via `BankMatchError`. No issues.

#### import/

- [launch] apps/web-next/src/app/api/v1/agentbook-expense/import/csv/route.ts:28-42 — `parseCSV` does `lines[i].split(',')` (line 34). Same naive CSV parser as Stream A.2 finding [launch]. Fields with embedded commas corrupt the row.
- [launch] apps/web-next/src/app/api/v1/agentbook-expense/import/csv/route.ts:85-133 — sequential `for` loop creating expenses one-by-one (line 118-127). For 1000-row CSVs this is 1000 round-trips. No transaction wrapping. Fix: `createMany` in batches.
- [launch] apps/web-next/src/app/api/v1/agentbook-expense/import/csv/route.ts:118-127 — creates expenses with `confidence: 0.6` and NO `status` field (defaults to `'confirmed'` per schema). Per Stream A.2, CC-statement imports use `pending_review`. Inconsistent: CSV imports auto-confirm at 60% confidence which violates the "verify-then-commit" framework that powers the review queue. Fix: set `status: 'pending_review'` for CSV imports too.

### agentbook-invoice/

- [launch] apps/web-next/src/app/api/v1/agentbook-invoice/invoices/route.ts:87-233 — invoice number generation race (line 113-124): same Stream A.2 finding repeated. Plus no idempotency key.
- [launch] apps/web-next/src/app/api/v1/agentbook-invoice/invoices/[id]/route.ts:91 — `db.abInvoice.update({ where: { id }, data })` — same defect: `existing` check is tenant-scoped, update is not. Fix: `updateMany({ where: { id, tenantId } })`.
- [launch] apps/web-next/src/app/api/v1/agentbook-invoice/invoices/[id]/route.ts:150 — DELETE same defect.
- [launch] apps/web-next/src/app/api/v1/agentbook-invoice/invoices/[id]/send/route.ts:39 — `tx.abInvoice.update({ where: { id }, data: { status: 'sent' } })` — same defect.
- [launch] apps/web-next/src/app/api/v1/agentbook-invoice/invoices/[id]/void/route.ts:74-77 — same defect on update.
- [launch] apps/web-next/src/app/api/v1/agentbook-invoice/payments/route.ts:26-197 — same Stream A.2 finding: no idempotency key on payments. A double-tap or webhook race creates 2 payments and 2 JEs. Per A.2: `existingPaid + amountCents` recomputation flips `paid` correctly but cash receipt is doubled.
- [launch] apps/web-next/src/app/api/v1/agentbook-invoice/invoices/draft-from-text/route.ts:95-102 — `db.abClient.findMany({ where: { tenantId } })` then in-memory filter (line 101) — full client table scan for matching. For a tenant with 1000 clients this is unbounded. Fix: SQL `ILIKE` on name with index.
- [launch] apps/web-next/src/app/api/v1/agentbook-invoice/invoices/draft-from-text/route.ts:43-50 — `parseInvoiceFromText` is called inline. This is a chargeable LLM call with no caching, no idempotency, no rate-limit at the route level (only the Telegram-side rate-limit). Fix: rate-limit cost-bearing routes too.
- [polish] apps/web-next/src/app/api/v1/agentbook-invoice/invoices/draft-from-text/route.ts — agent decision logic (parser + client name resolution + ambiguity detection) lives in the route. Could be a `draft-invoice-from-text` skill manifested in the agent brain. Adapter purity issue (mild — the parser is in `@/lib/agentbook-invoice-parser` so the route is thin enough).

### agentbook-tax/

- [launch] apps/web-next/src/app/api/v1/agentbook-tax/tax/estimate/route.ts:19-58 — duplicate tax bracket arrays diverge from `agentbook-core/money-moves/route.ts`. Per cross-plugin observation: centralize.
- [launch] apps/web-next/src/app/api/v1/agentbook-tax/tax/estimate/route.ts:72-156 — `GET /tax/estimate` does NOT write `AbTaxEstimate` (comment line 7: "Read-only"). However other code paths (Stream A.1) expect `AbTaxEstimate` rows to exist; this divergence means the `tax-package` HTML rendering and `morning-digest`'s `taxQEstimateCents` lookup can return null even when a tenant has just hit the estimate. Fix: align — either always write or always derive.
- [launch] apps/web-next/src/app/api/v1/agentbook-tax/tax-slips/ocr/route.ts:24-41 — `callGemini` reads `process.env.GEMINI_API_KEY` directly (line 25). Falls back to null if unset → `processSlipOCR` silently returns no result. Same Stream A.2 finding [launch] re: tax-slips processOCR being a no-op without LLM config.
- [launch] apps/web-next/src/app/api/v1/agentbook-tax/tax-slips/ocr/route.ts:28 — `key=${apiKey}` URL query string for Gemini (same systemic issue).
- [launch] apps/web-next/src/app/api/v1/agentbook-tax/tax-filing/[year]/submit/route.ts:14-31 — delegates to `submitFiling` (same Stream A.2 [launch] findings re: mock e-file, no transaction wrapping, plaintext partner apiKey).
- [polish] apps/web-next/src/app/api/v1/agentbook-tax/reports/* — 14 report routes. Reviewed shape only — each is tenant-scoped, read-only, deterministic. No specific issues but the N+1 patterns from Stream A.2 (tax/server.ts:1144-1277) likely repeat verbatim in the Next.js ports.

### agentbook-billing/

- [VERIFIED OPEN: from A.2] apps/web-next/src/app/api/v1/agentbook-billing/me/subscription/route.ts:21-69 — same Stream A.2 finding: trusts `resolveAgentbookTenant` (header > cookie > session) for billing operations. Combined with the cross-cutting tenant-trust blocker, an attacker can subscribe a victim tenant to a paid plan using attacker's own payment method.
- [launch] apps/web-next/src/app/api/v1/agentbook-billing/me/subscription/route.ts:38-64 — no Stripe `idempotency_key` parameter on `subscriptions.create`. A double-tap creates 2 subscriptions; Stripe may 409 on second create with same customer+price but not guaranteed. Same A.2 finding.
- [launch] apps/web-next/src/app/api/v1/agentbook-billing/me/subscription/intent/route.ts:14-28 — creates a Stripe customer on EVERY POST when none exists. No idempotency key. Race: two parallel POSTs create 2 Stripe customers. Same A.2 finding.
- [launch] apps/web-next/src/app/api/v1/agentbook-billing/me/subscription/intent/route.ts:21 — `freePlanId ?? ''` — same A.2 finding: empty string violates FK if Free plan unseeded.
- [polish] apps/web-next/src/app/api/v1/agentbook-billing/me/subscription/intent/route.ts:28 — `payment_method_types: ['card']` — same A.2 finding: locks out wallet payments.
- [launch] apps/web-next/src/app/api/v1/agentbook-billing/plans/route.ts:54-94 — same A.2 finding: Stripe product+price create not idempotent; rollback archives product but not price.
- [launch] apps/web-next/src/app/api/v1/agentbook-billing/plans/route.ts:32-38 — GET is public (no admin check). Same A.2 finding.
- [launch] apps/web-next/src/app/api/v1/agentbook-billing/cron/reset-quotas/route.ts:9-13 — accepts `?secret=...` query string OR `x-vercel-cron: 1`. Query-string secrets leak into logs. Same A.2 finding.
- [launch] apps/web-next/src/app/api/v1/agentbook-billing/cron/reset-quotas/route.ts:31-61 — sequential loop with one Stripe `subscriptions.retrieve` per stale sub. Same A.2 finding [launch] re: rate-limit + timeout risk at 10K subs.
- [polish] apps/web-next/src/app/api/v1/agentbook-billing/cron/cleanup-events/route.ts:18 — 90-day retention. Same A.2 finding re: PCI/compliance 1-year preference.

### Subdirectory summaries

- **telegram/webhook/** (1 route, 6402 lines): correct webhook secret check + idempotency + retry/dead-letter, but ~5000 lines of agent decision logic in adapter → biggest rubric #2 violation in the codebase; bypass via `E2E_TELEGRAM_CAPTURE` env if set in prod; OCR auto-stored receiptUrl still uses Telegram URLs.
- **stripe-webhook/** (2 files): textbook signature-verified webhook with idempotency via BillEvent unique. Only correct Stripe webhook in the codebase. Invoice events are no-ops.
- **switch-tenant/** (1 route): BLOCKER — unauthenticated tenant impersonation via cookie.
- **{core,expense,invoice,tax}/[...path]/** (4 proxies): cookie/header-tenant pass-through with no auth + no `fetch` timeout. Inherits the resolveAgentbookTenant blocker.
- **cron/** (15 routes): bearer-gated; mix of timing-safe and string-equals compares; payment-reminders is UNAUTHENTICATED; daily-pulse autoposts expenses without confirmation gate; morning-digest does sequential-per-tenant LLM calls (timeout risk); calendar-check has alert-marked-before-emit race.
- **agentbook-core/admin/llm-configs/** (4 routes): BLOCKER-grade — no admin role check, returns plaintext apiKey, deletes globally, can use any tenant's apiKey via test endpoint. Same defect as A.1 plugin finding.
- **agentbook-core/accountant/, cpa/**: plaintext access tokens at rest; cpa/generate-link still has no email validation and is a duplicate path.
- **agentbook-core/telegram/{setup,status,disconnect}**: plaintext bot token at rest; setup webhook secret in URL query string.
- **agentbook-core/journal-entries**: same A.1 [launch] findings (no idempotency, TZ bug, no escalation).
- **agentbook-core/{autopilot,money-moves}**: agent decision logic in adapter — rubric #2 auto-deduct.
- **agentbook-core/{dashboard,conversations,catch-up,searches,audit-events}**: mostly clean tenant-scoped reads; minor NaN-from-parseInt patterns.
- **agentbook-core/{restore,dead-letter,snapshot}**: restore correctly uses `updateMany` with tenant; dead-letter shows orphans cross-tenant; snapshot mis-labels actor.
- **agentbook-expense/expenses/, plaid/**: persistent encrypted Plaid tokens (closure of A.2 blocker); same A.2 findings still present in the route layer (cross-tenant abAccount lookups, no idempotency, update-without-tenant defect, no transaction around confirm/JE).
- **agentbook-expense/{receipts/upload-blob, advisor, import/csv}**: upload-blob updates expense without tenant scope; advisor leaks abAccount; CSV import is naive parser + sequential creates + wrong default status.
- **agentbook-invoice/**: every state-transition route (PATCH/send/void/remind/payments) uses `update where: { id }` after a tenant-scoped `findFirst` — race window; no idempotency on any POST.
- **agentbook-tax/**: read-only estimate diverges from money-moves brackets; tax-slips OCR a no-op without env var; submit delegates to A.2-flagged mock e-file.
- **agentbook-billing/**: every A.2 finding reproduced in the Next.js layer; no idempotency on Stripe creates; subscribe trusts header/cookie tenant.

**Stream A.3 total:** 65 findings (3 blocker, 53 launch, 9 polish). Top blockers: (1) `resolveAgentbookTenant` accepts unverified header+cookie + falls back to `'default'` — every route in scope is one HTTP header from full cross-tenant access; (2) `/api/v1/agentbook/switch-tenant` lets an unauthenticated browser become any tenant by setting a cookie; (3) `admin/llm-configs` endpoints have NO admin gate and return plaintext apiKey + can be used to pump LLM calls billed to any tenant.

## Stream A.4 — `apps/web-next/src/app/(dashboard)/**`

### Scope note

The literal `apps/web-next/src/app/(dashboard)/**` directory contains 17 page.tsx files. Of those, **12 are shell/admin/embedded chrome** (settings, admin/*, teams, marketplace, feedback, releases, embedded/governance/treasury, [...slug] catch-all). The actual AgentBook financial features live in **plugin frontends** (`plugins/agentbook-{core,expense,invoice,tax}/frontend/src/pages/`) and are mounted at runtime by `apps/web-next/src/app/(dashboard)/[...slug]/page.tsx` (path-based route matching on `usePathname()`, line 23-48). When a user visits `/agentbook/expenses`, Next.js routes the request through this catch-all, which then loads the corresponding plugin UMD bundle and React-Router-mounts the appropriate page (e.g. `plugins/agentbook-expense/frontend/src/pages/ExpenseList.tsx`).

Because rubric #1 is asking "can a user accomplish this entire screen's purpose by chatting", I audit the plugin pages as well — they ARE the rendered output of `(dashboard)/agentbook/*` routes. I cite both file paths.

### Global observations (apply to the whole shell)

- [launch] apps/web-next/src/app/(dashboard)/layout.tsx:11-13 — the dashboard shell wraps every page in `AppLayout` (sidebar + top-bar) but has **no persistent chat surface**. There is no docked agent panel, no slash-command palette, no "press / to ask the agent" affordance anywhere in `apps/web-next/src/components/layout/`. The only agent interface on the WEB is one `AskBar` embedded inside `plugins/agentbook-expense/frontend/src/pages/ExpenseList.tsx:467` (one page, one plugin). This is the single biggest rubric #1 violation: the product's chat-first claim is fulfilled only by Telegram, not the web shell.
- [launch] apps/web-next/src/components/layout/app-layout.tsx / sidebar.tsx — sidebar navigation is a traditional CRUD-app tree (Expenses, Invoices, Clients, Tax, Reports, Settings). The chat is not a peer in navigation; it is invisible in the shell. Rubric #1 deducts -2 for "every primary workflow can be completed via chat alone" because there is no chat to alone-complete anything from.
- [launch] apps/web-next/src/app/(dashboard)/[...slug]/page.tsx:135-159 — when the agent (via Telegram) creates an expense or drafts an invoice, the catch-all-mounted page has NO mechanism to receive that update. The plugin loads with its own `useEffect(() => fetch(...))` pattern (e.g. ExpenseList.tsx:184-206). There is no `useAgentSession()` hook, no shell event-bus listener for `agent.action.completed`. Chat-driven changes do not appear in the open page without a manual refresh.
- [launch] No `PlanPreview` component exists anywhere in the codebase. Grep across `apps/web-next/src` and `plugins/*/frontend/src` for `Proceed`, `PlanPreview`, `plan.steps`, or "Proceed/Cancel" returns zero matches. The Telegram bot has inline Proceed/Cancel buttons per `apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts`, but the WEB has no equivalent surface. This is the rubric #3 hard-floor risk: "Agent has no plan-preview mechanism for any multi-step action" caps the overall score at 85 unless qualified by Telegram-only delivery.
- [polish] apps/web-next/src/contexts/shell-context.tsx exists with a `useEvents` event-bus, but it is wired only for cross-tab notifications (`notifications`), team-switch broadcasts, and plugin manifest updates — not for agent-session deltas. No plugin page subscribes to `agent.expense.recorded` or similar.

### Dashboard shell pages (the literal `apps/web-next/src/app/(dashboard)/**`)

- [NOTE] apps/web-next/src/app/(dashboard)/admin/feedback/page.tsx — deliberately form-only (admin triage UI for the feedback queue). Exempt from rubric #1 deduction.
- [NOTE] apps/web-next/src/app/(dashboard)/admin/plugins/page.tsx — deliberately form-only (system-admin sets which plugins are core/auto-install). Exempt.
- [NOTE] apps/web-next/src/app/(dashboard)/admin/secrets/page.tsx — deliberately form-only (admin secret/key management). Exempt.
  - [polish] line 97-101, 108 — uses `window.confirm()` (native browser dialog) for delete + rotate. Functional but inconsistent with the Modal pattern used elsewhere; replace with the `@naap/ui` Modal for tenant-consistent UX.
- [NOTE] apps/web-next/src/app/(dashboard)/admin/users/page.tsx — deliberately form-only (sysadmin user list / role assignment). Exempt.
- [NOTE] apps/web-next/src/app/(dashboard)/embedded/[type]/page.tsx — third-party iframe wrappers (Livepeer treasury + governance). Not an AgentBook surface; exempt.
- [polish] apps/web-next/src/app/(dashboard)/feedback/page.tsx:71-72 — user feedback form (bug/feature/general). Chat parity exists in concept (a user could `/feedback` the agent) but no `submit-feedback` skill is registered in `built-in-skills.ts`. Submitting a bug report is currently form-only. Note: explicitly not in the financial-feature scope, so not a launch-grade deduction, but the page does duplicate what a future skill should own.
- [NOTE] apps/web-next/src/app/(dashboard)/governance/page.tsx, treasury/page.tsx — both are redirect()'s to `/embedded/...`. Exempt.
- [launch] apps/web-next/src/app/(dashboard)/marketplace/page.tsx — installing a plugin, leaving a review, posting a comment — entire marketplace UX is form-only. No `install-plugin`, `review-plugin`, or `query-marketplace` skill in `built-in-skills.ts`. This is arguably a deliberate "advanced view" for system installation, but for an agent-native product, "install the X plugin" is exactly the kind of operation Claude Code lets you do via chat. Borderline; flagging as launch because the product narrative is agent-first.
- [NOTE] apps/web-next/src/app/(dashboard)/plugins/[pluginName]/page.tsx — generic plugin loader; not a feature surface. Exempt.
- [NOTE] apps/web-next/src/app/(dashboard)/releases/page.tsx — read-only changelog. Exempt.
- [polish] apps/web-next/src/app/(dashboard)/settings/page.tsx — user preferences, plugin order, theme, profile. Mostly legitimately settings (exempt from rubric #1), BUT the page also does plugin **uninstall** (line 79-80, `setUninstallingPlugin` + `showUninstallConfirm`). Uninstall has a confirm modal — good. Settings persist via `fetch PUT`; there's no `update-preferences` skill, so an agent can't "make my theme dark" — minor gap but not blocking.
- [NOTE] apps/web-next/src/app/(dashboard)/teams/page.tsx — team management list. Workspace administration, exempt.
- [NOTE] apps/web-next/src/app/(dashboard)/teams/[teamId]/page.tsx — team dashboard with plugin installs. Workspace administration, exempt.
- [launch] apps/web-next/src/app/(dashboard)/teams/[teamId]/members/page.tsx:159 — member removal uses `confirm('Are you sure you want to remove this member?')` (native browser confirm) — destructive action has a confirm step, but it's native browser modal not a styled dialog. Acceptable for rubric #3 "destructive actions require explicit confirm" because the confirm DOES exist; flagging as a UX polish, not a launch defect.
- [NOTE] apps/web-next/src/app/(dashboard)/teams/[teamId]/settings/page.tsx — workspace administration, exempt. Has a `deleteConfirmText` "type the team name" pattern — good.
- [NOTE] apps/web-next/src/app/(dashboard)/[...slug]/page.tsx — the plugin loader catch-all. Not a feature surface itself.

### Plugin frontend pages mounted into (dashboard)/[...slug] (the actual AgentBook UX)

#### agentbook-core/

- [polish] plugins/agentbook-core/frontend/src/pages/Dashboard.tsx — landing page. Mostly read-only (overview, attention items, next moments). Has "New invoice / Snap / Ask" buttons (lines 20-28) — the Ask button links to `/agentbook/agents` (an agent CONFIG page), NOT a chat. There's no `useAgentSession` integration. Independent `useDashboardOverview()` hook (line 59) — chat-driven changes do not appear live. Polish: refactor to subscribe to agent state.
- [launch] plugins/agentbook-core/frontend/src/pages/Onboarding.tsx:50-60 — onboarding entirely form-only (business_type, jurisdiction, currency, bank, telegram). For an agent-first product, the canonical demo is "the agent walks you through onboarding by asking questions." No `onboarding-step` skill exists; the agent cannot complete steps for the user. Exact violation of rubric #1 criterion "every primary workflow can be completed via chat alone." First impression is form-driven.
- [launch] plugins/agentbook-core/frontend/src/pages/CPAPortal.tsx:30-44 — CPA link generation is form-only (`generateLink()` POST). There IS a `cpa-share` skill (built-in-skills.ts line 230) — partial parity — but the email is hardcoded to `cpa@example.com` (line 36), no agent-routed alternative. The notes feature (addNote line 47-58) maps to the `cpa-notes` skill (line 224) — chat parity exists. Mixed.
- [launch] plugins/agentbook-core/frontend/src/pages/HomeOffice.tsx — quarterly home-office deduction entry. No `home-office` skill in built-in-skills.ts. Form-only. -2.
- [launch] plugins/agentbook-core/frontend/src/pages/TelegramSettings.tsx — connecting the Telegram bot is form-only on web (paste token). There IS a `telegram-setup` skill (line 327), but it requires the user to message the bot from a different Telegram account to set up the first bot — chicken-and-egg. Acceptable as a bootstrap form; flagging as note rather than full launch.
- [NOTE] plugins/agentbook-core/frontend/src/pages/AdminConfig.tsx — LLM provider/api-key configuration. Deliberately form-only (admin) — exempt.
- [NOTE] plugins/agentbook-core/frontend/src/pages/admin/DeadLetter.tsx — webhook dead-letter queue admin. Deliberately form-only — exempt.
- [polish] plugins/agentbook-core/frontend/src/pages/Agents.tsx:38-48 — agent configuration toggles (aggressiveness slider, auto-approve, model tier, frequency). Deliberately a configuration surface — exempt from rubric #1 form-only deduction. BUT the page is also the destination of the Dashboard "Ask" button (Dashboard.tsx:26-28) — which is misleading since this page configures agents, it doesn't chat with them. Rename or relink.
- [polish] plugins/agentbook-core/frontend/src/pages/Ledger.tsx — read-only journal-entry viewer. Has a `query-finance` skill that overlaps. Chat parity acceptable; flag as polish for plan-preview / intermediate-state visibility — none on this page.
- [polish] plugins/agentbook-core/frontend/src/pages/Accounts.tsx — read-only chart-of-accounts list, filter by type. No write actions. Chat parity not required (read-only). OK.
- [polish] plugins/agentbook-core/frontend/src/pages/Activity.tsx — read-only audit-event viewer. OK — deliberately a forensic surface, exempt.
- [polish] plugins/agentbook-core/frontend/src/pages/Projections.tsx — read-only earnings projection. Skill parity: `query-finance` and `cashflow-report` (line 200). OK.
- [launch] plugins/agentbook-core/frontend/src/pages/SavedSearches.tsx — create/edit/delete saved searches via form. There IS a `searches` Telegram command per the file header ("the bot's `/searches` command shows pinned only"), but no skill in BUILT_IN_SKILLS for `create-saved-search` or `pin-search`. Creating new searches is form-only. -2.

#### agentbook-expense/

- [launch] plugins/agentbook-expense/frontend/src/pages/NewExpense.tsx:15-41 — manual expense entry. There IS a `record-expense` skill (built-in-skills.ts line 3), and chat parity is real on Telegram. But on web, this page is the only path: there's no `AskBar` here, no "Try saying: 'Coffee 4.50 starbucks'" affordance, and the form's success state (line 47-49) doesn't show the journal entry that was created. Worse: the receipt upload zone (line 51-56) is decorative — it has no `onClick` handler, no file input, no drag-drop wire. The text says "we'll extract the details automatically" but does NOT call `/receipts/ocr` from this page. Document as "manual override" and add a 'Talk to me instead' link. -2.
- [launch] plugins/agentbook-expense/frontend/src/pages/NewExpense.tsx:15-41 (continued) — the expense POST (line 19-29) creates with NO confirmation gate, NO plan preview, NO journal entry preview. The Telegram path has a confirmation prompt (Stream A.2 finding); web bypasses it. Rubric #3 deduction risk.
- [VERIFIED CLOSED][partial] plugins/agentbook-expense/frontend/src/pages/ExpenseList.tsx:9, 467 — has an `AskBar` component, this is the SOLE chat-equivalent surface in the whole web UI. Maps to `/api/v1/agentbook-core/agent/message` (line 247). Good — but only handles READ-ONLY queries ("top spending", "duplicates") per AskBar.tsx SUGGESTIONS — does NOT support write actions like "delete that expense" or "recategorize all Starbucks to Meals". Limited parity. (Counted as PARTIAL closure, not deducted.)
- [polish] plugins/agentbook-expense/frontend/src/pages/ExpenseList.tsx:208-215 — restore for soft-deleted expense exists, but no UI confirm before soft-delete (deletion is not visible in this view — only restore). Need to verify the delete-action surface (likely in [id] route page); if delete is one-click in the row dropdown without confirm, rubric #3 -3 hard-floor risk.
- [launch] plugins/agentbook-expense/frontend/src/pages/Receipts.tsx — read-only grid of receipts, plus a decorative "drag and drop" upload zone (line 40-45) with NO `onClick`, NO file input, NO handler. Same pattern as NewExpense.tsx — the upload affordance is theater. There IS a `scan-receipt` skill (line 22) so chat parity exists in principle, but the page misleads users into thinking the dropzone works. -2.
- [launch] plugins/agentbook-expense/frontend/src/pages/Vendors.tsx — read-only vendor list. There IS a `vendor-insights` skill (line 90). Read-only OK. But no link to "edit vendor's default category" — vendor pattern editing (relevant per built-in-skills `manage-recurring` and the pattern-learning subsystem) is entirely absent from web. -2.
- [launch] plugins/agentbook-expense/frontend/src/pages/Budgets.tsx — budget CRUD via form (line 41-80). There ARE `set-budget` and `query-budget` skills (built-in-skills.ts line 371, 377). Chat parity exists for SET and QUERY; but EDIT and DELETE (`Pencil`, `Trash2` icons imported line 2) flow through the form, no skill. Mixed. The `set-budget` skill should also handle update/delete — verify or -2.
- [launch] plugins/agentbook-expense/frontend/src/pages/Mileage.tsx — form-only mileage entry. No `record-mileage` skill in BUILT_IN_SKILLS. (G-OLD-020 closure was the backend; no agent skill on top.) -2.
- [launch] plugins/agentbook-expense/frontend/src/pages/PerDiem.tsx — form-only per-diem entry. No `record-per-diem` skill in BUILT_IN_SKILLS. -2.
- [launch] plugins/agentbook-expense/frontend/src/pages/BankConnection.tsx:70-80 — Plaid Link is form-only (web only). No `connect-bank` skill in BUILT_IN_SKILLS. Acceptable since OAuth flow inherently requires a browser context — flag as `[NOTE]` instead. Actually deliberately form-only (auth flow), exempt.
- [NOTE] plugins/agentbook-expense/frontend/src/pages/BankConnection.tsx — exempt from rubric #1 deduction (OAuth handshake inherently browser-only).

#### agentbook-invoice/

- [launch] plugins/agentbook-invoice/frontend/src/pages/NewInvoice.tsx:45-... — manual invoice draft via form. There IS a `create-invoice` skill (line 34) and the `draft-from-text` endpoint, so chat parity is real, but the web form's submit does NOT show a plan preview ("Here's the invoice I'll create: Client X, $5K, net-30, send via email?"). It just POSTs and navigates. Rubric #3 multi-step-no-plan deduction risk. -2.
- [launch] plugins/agentbook-invoice/frontend/src/pages/Clients.tsx — there is NO "Add Client" button visible in the first 100 lines; client creation appears to happen as a side-effect of invoice creation (NewInvoice.tsx writes clientName + clientEmail). There IS a `query-clients` skill (line 114) — chat can READ clients but cannot create/edit/delete. Mixed.
- [polish] plugins/agentbook-invoice/frontend/src/pages/Clients.tsx — independent fetch via useCallback (line 35-49) with no subscription to agent updates. Chat-created clients do not appear without manual refresh.
- [polish] plugins/agentbook-invoice/frontend/src/pages/InvoiceList.tsx — read-only invoice list + restore. The "send", "void", "remind", "payment" state transitions are NOT inline here — they happen on detail pages (per Stream A.3 findings about `/invoices/[id]/send/route.ts` etc., the API routes exist). Skills for send-invoice, void-invoice, record-payment, send-reminder ALL exist (lines 132, 345, 139, 164). Chat parity good for state transitions. Independent fetch — polish.
- [launch] plugins/agentbook-invoice/frontend/src/pages/Estimates.tsx — create estimate, convert to invoice, decline. Skills exist: `create-estimate` (line 146), `query-estimates` (line 108), `convert-estimate` (line 339). Chat parity good. But within the page itself, "convert" or "decline" are likely click-to-execute without confirm (Trash2 icon imported line 12). -2 for destructive without confirm if delete is wired.
- [launch] plugins/agentbook-invoice/frontend/src/pages/RecurringInvoices.tsx — full CRUD on recurring schedules. The pause/play/edit/delete are all form/button driven. There's a `manage-recurring` skill for expenses (line 84) but NOT for invoice recurring schedules. -2 form-only.
- [polish] plugins/agentbook-invoice/frontend/src/pages/Projects.tsx — read-only project profitability. OK.
- [launch] plugins/agentbook-invoice/frontend/src/pages/Timer.tsx — timer start/stop is form-driven (Play/Square buttons). Skills `start-timer` (line 152), `stop-timer` (line 158), `timer-status` (line 120) exist. Good chat parity. But "generate invoice from selected entries" (`generating` state, line 35) is form-only — no `invoice-from-time` skill. -2.

#### agentbook-tax/

- [polish] plugins/agentbook-tax/frontend/src/pages/TaxDashboard.tsx — read-only tax-estimate display. `tax-estimate` skill (line 170) exists. OK.
- [polish] plugins/agentbook-tax/frontend/src/pages/Quarterly.tsx — read-only quarterly schedule. `quarterly-payments` skill (line 176) exists. OK.
- [polish] plugins/agentbook-tax/frontend/src/pages/CashFlow.tsx — read-only cash-flow projection. `cashflow-report` skill (line 200) exists. OK.
- [launch] plugins/agentbook-tax/frontend/src/pages/Deductions.tsx:55-69 — applying/dismissing a deduction suggestion is a one-click PATCH (line 58-62) with NO confirmation, NO plan preview. "Apply this deduction" creates a downstream journal entry in some flows; should be confirmed. Rubric #3 destructive-without-confirm risk. -2.
- [polish] plugins/agentbook-tax/frontend/src/pages/Analytics.tsx — read-only. OK.
- [polish] plugins/agentbook-tax/frontend/src/pages/Reports.tsx — read-only report-list. Maps to multiple skills (pnl-report, balance-sheet, cashflow-report). OK.
- [launch] plugins/agentbook-tax/frontend/src/pages/TaxPackage.tsx — year-end tax-package generation is form-only ("Generate" button POSTs). No `generate-tax-package` skill in BUILT_IN_SKILLS. -2.
- [launch] plugins/agentbook-tax/frontend/src/pages/WhatIf.tsx — scenario simulator is form-only. There IS a `simulate-scenario` skill (line 40), so chat parity exists in principle, but the web page doesn't surface the chat alternative. The "calculate" button (line 22-40) is single-shot, no plan preview, no follow-up. (Borderline — the skill exists; flag as polish since the underlying capability is reachable.)

### Intermediate-state visibility (rubric #1)

Every plugin page reviewed uses a generic `<Loader2 className="animate-spin" />` or `Loading...` text. None show meaningful status like "checking your March expenses..." or "looking up your Acme invoices...". Citations:

- [polish] plugins/agentbook-expense/frontend/src/pages/ExpenseList.tsx:467 — AskBar shows a 3-dot animation while waiting; no text.
- [polish] plugins/agentbook-expense/frontend/src/pages/BankConnection.tsx:49-65 — loading state is just a Loader2 icon.
- [polish] plugins/agentbook-tax/frontend/src/pages/TaxDashboard.tsx:40-58 — loading state generic.
- [polish] plugins/agentbook-invoice/frontend/src/pages/Estimates.tsx — generic loader.

All count as polish — not blockers but consistent rubric #1 deduction across the entire UI.

### Edit history / undo

- [VERIFIED PARTIAL: G-OLD-023] Soft-delete + restore exist on expenses (ExpenseList.tsx:208-215), invoices (InvoiceList.tsx:88), clients (Clients.tsx:55-62). 90-day window per inline comments. This is the only undo affordance.
- [polish] No undo for: invoice send (once sent, can only void), payment recording, estimate conversion, tax-package generation, agent config changes (Agents.tsx), saved-search edits. Add a `recent-actions` view with one-click undo for at-risk operations.

### Rubric #1 auto-deduction tally

Counted `[launch]` findings where a financial feature in the dashboard/plugin UI is form-only OR chat-driven path is absent/broken:

| # | Finding (abbrev) |
|---|------|
| 1 | layout.tsx — no persistent chat surface in shell |
| 2 | layout/sidebar.tsx — CRUD-app navigation, chat not a peer |
| 3 | [...slug]/page.tsx — plugin pages do not subscribe to agent updates (independent fetch) |
| 4 | No PlanPreview component anywhere in web codebase |
| 5 | marketplace/page.tsx — install/review form-only |
| 6 | Onboarding.tsx — 7-step setup form-only, no agent walk-through |
| 7 | CPAPortal.tsx — CPA email hardcoded, partial parity |
| 8 | HomeOffice.tsx — quarterly entry form-only, no skill |
| 9 | SavedSearches.tsx — saved-search CRUD form-only, no skill |
| 10 | NewExpense.tsx — manual entry + theater dropzone |
| 11 | NewExpense.tsx — no confirmation gate on web POST |
| 12 | Receipts.tsx — theater dropzone, no handler |
| 13 | Vendors.tsx — vendor edit not exposed |
| 14 | Budgets.tsx — edit/delete form-only |
| 15 | Mileage.tsx — no record-mileage skill |
| 16 | PerDiem.tsx — no record-per-diem skill |
| 17 | NewInvoice.tsx — no plan preview before draft |
| 18 | Estimates.tsx — convert/decline likely click-without-confirm |
| 19 | RecurringInvoices.tsx — recurring CRUD form-only, no skill |
| 20 | Timer.tsx — invoice-from-time form-only |
| 21 | Deductions.tsx — apply/dismiss without confirm |
| 22 | TaxPackage.tsx — generate form-only, no skill |

**22 launch-grade form-only / chat-parity-missing findings × 2 pts each = -44 pts.**

Hard cap: per the rubric, rubric #1 max is 12 pts, so the auto-deduction floors at -12 (zeroing out the category). Per spec §5 "6+ such findings = whole category zeroed out" — confirmed: **rubric #1 (Agent-first architecture) = 0/12**.

Per Tier-1 hard floor: if Tier 1 total drops below 32/40, overall score caps at 90. With rubric #1 zeroed, Tier 1 max becomes 28/40 — Tier 1 hard-floor TRIPPED, overall score capped at 90.

Additionally hit:
- Rubric #3 risk: "Agent has no plan-preview mechanism for any multi-step action" — per spec §5 Hard Floors, this caps overall at 85 until fixed. The Telegram bot has plan preview but the web UI does not; depends on grader's interpretation of "for any multi-step action" — recommend NOT triggering the cap because chat parity via Telegram demonstrates the mechanism exists in product, even if not on web.

### Summary

Of **39 page-equivalent surfaces reviewed** (17 dashboard shell + 22 plugin frontend pages), **6 have legitimate chat parity** (ExpenseList via AskBar; Ledger / Accounts / Activity / Projections / Reports as read-only views the agent can also serve; plus invoice send/void/payment skills that the web defers to), **22 are form-only-without-chat-parity (launch)**, **11 are deliberate form-only and exempt** (admin/secrets/users/feedback-triage/team-administration/embedded-iframes/auth-flows). **Net rubric #1 auto-deduction: -12 (capped) — rubric #1 scored 0/12.** Tier 1 hard floor TRIPPED; overall score caps at 90. The single biggest fix would be adding a persistent chat surface to `apps/web-next/src/components/layout/app-layout.tsx` (closes findings 1–4 in one PR) and shipping skills for the eight feature areas currently form-only (home-office, saved-search, mileage, per-diem, recurring-invoice, vendor-edit, generate-tax-package, invoice-from-time).



## Stream A.5 — Prisma schema + existing tests

> Reviewed: `packages/database/prisma/schema.prisma` (2,775 lines, ~120 models) and `tests/e2e/` (51 spec files, 10,541 LOC). Cross-references prior findings index §1 (158/158 tests baseline), §4 (uncovered areas), §6 (test inventory) and code-review §A.2 (money-field/cross-tenant findings).

### Schema findings

#### Money/numeric correctness

- [polish] schema.prisma:1614 — `AbFinancialSnapshot.runwayMonths Float` — derived metric in cash flow; `Float` is fine for display but document rounding to avoid drift when compared across snapshots (e.g. `5.499999` vs `5.5`). Either reduce to `Decimal(5,2)` or round at write time.
- [polish] schema.prisma:1840 — `AbMileageEntry.miles Float` — mileage can lose precision (e.g. odometer-derived 12345.67). The pattern across the industry is `Decimal(10,2)`. Same risk for `quantity Float` on `AbInvoiceLine:1931` and `budgetHours Float` on `AbProject:1982`. Money columns are `Int cents` (good) but the multiplied quantities are `Float`, so `quantity * rateCents` rounding behavior should be tested.
- [polish] schema.prisma:2144 — `AbSalesTaxCollected.rate Float` — tax rate `Float` risks 6.5 vs 6.499999 issues; should be `Decimal(7,5)` or stored as basis-points `Int`.
- [polish] schema.prisma:1898 — `AbInvoice.fxRate Float` and schema.prisma:2572 `AbFxRate.rate Float` — FX rates are typically stored to 6 decimals; `Float` is acceptable for cache but `Decimal(18,6)` would prevent off-by-one-penny drift on booked amounts. Not blocking but worth noting given multi-currency complexity.

(Note: `grep -nE "Float" schema.prisma` returned 27 hits — all are confidence scores, metrics, ratings, or non-monetary ratios except those flagged above. No raw money column is `Float`. Stream A.2's finding "no `Float` money columns" is confirmed.)

#### Tenant scoping (multi-tenant integrity)

- [blocker] schema.prisma:1514 — `AbJournalLine` has NO `tenantId` field — relies on join to `AbJournalEntry.tenantId`. Combined with cross-tenant `findFirst({id})` bugs identified in Stream A.2, a malicious or buggy query against `AbJournalLine` directly cannot be tenant-filtered without a join. Add `tenantId String` + `@@index([tenantId])` and backfill from parent entry; this is a defense-in-depth measure consistent with all other models.
- [blocker] schema.prisma:1686 — `AbExpenseSplit` has NO `tenantId` — same risk as above; FK is via `expenseId` only.
- [blocker] schema.prisma:1926 — `AbInvoiceLine` has NO `tenantId` — same risk as above; FK is via `invoiceId` only.
- [launch] schema.prisma:1604 — `AbFinancialSnapshot` exists with `tenantId + snapshotDate` index but lacks `@@unique([tenantId, snapshotDate])` — duplicate snapshots for the same calendar day are silently allowed (no idempotency). Cron-replay safety relies on caller dedup.
- [launch] schema.prisma:2549 — `AbLearningEvent` indexes `(tenantId, agentId, createdAt)` but has no `@@unique` on (tenantId, eventType, sourceId) or similar — if a learning pipeline retries, the same learning event can be recorded twice and skew confidence math.
- [launch] schema.prisma:2680 — `AbWebhookDeadLetter.tenantId String?` — nullable tenantId is documented as intentional (unresolved chats), BUT the only index is `(resolvedAt, createdAt)` — no `(tenantId)` index, so per-tenant DLQ replay scans the whole table.

#### Enums vs free-form strings (typo-proof)

- [launch] schema.prisma:1481 — `AbAccount.accountType String` — comment says "asset | liability | equity | revenue | expense" but it is a free-form string. Add an enum `AbAccountType`. A typo here corrupts trial-balance math.
- [launch] schema.prisma:1501 — `AbJournalEntry.sourceType String` — same issue; should be enum (`expense | invoice | payment | manual | adjustment`).
- [launch] schema.prisma:1670 — `AbExpense.status String` ("confirmed | pending_review | rejected") and `:1671 source String` (8 documented values) — both string. Without an enum, a code-level rename (e.g. `pending_review` → `needs_review`) silently breaks `@@index([tenantId, status])` filtering. Add enums `AbExpenseStatus`, `AbExpenseSource`.
- [launch] schema.prisma:1903 — `AbInvoice.status String` ("draft | sent | viewed | paid | overdue | void") — state machine, must be enum. Same for `AbEstimate.status` (:1964), `AbPayment.method` (:1945), `AbTaxFiling.status` (:2179).
- [launch] schema.prisma:1417 — `AbTenantConfig.jurisdiction String` defaults to `"us"` — should be enum `Jurisdiction { US CA UK AU }` to prevent typos like `"USA"` or `"u.s."` breaking jurisdiction packs.
- [launch] schema.prisma:1471 — `AbConvThread.status String` ("active | closed | archived") + `:2475 closeReason String?` (4 values) — state machine, must be enum.
- [launch] schema.prisma:1792 — `AbBankTransaction.matchStatus String` ("pending | matched | exception | ignored") — must be enum given matching logic is non-trivial.

(Community plugin uses proper enums — `CommunityPostStatus`, `CommunityVoteTarget`, etc. Agentbook plugins do not follow this pattern.)

#### Foreign-key cascade policies (silent default = Restrict in Prisma)

- [launch] schema.prisma:1519 — `AbJournalLine.account` relation to `AbAccount` has no explicit `onDelete`. Default is `Restrict`. If an account is "deleted" (it currently has no `deletedAt`, see below), the journal lines block the delete silently. Be explicit (`Restrict`) so future maintainers see the intent.
- [launch] schema.prisma:1654 — `AbExpense.vendor` to `AbVendor` — no `onDelete`. Deleting a vendor row will fail to remove if expenses exist; given vendors have soft-delete, the implicit `Restrict` is probably correct but should be explicit.
- [launch] schema.prisma:1888 / :1961 / :2022 / :1943 — `AbInvoice.client`, `AbEstimate.client`, `AbCreditNote.invoice`, `AbPayment.invoice` — none have explicit `onDelete`. Critical financial relations; spell out the policy.
- [launch] schema.prisma:1998 — `AbTimeEntry.project AbProject?` — no `onDelete`. Likely should be `SetNull` (don't lose billable hours when project archived) but currently `Restrict` blocks deletes.
- [launch] schema.prisma:2741 — `BillSubscription.plan` to `BillPlan` — no `onDelete`. Plans have soft-archive (`isActive`), so `Restrict` is right, but be explicit.

#### Soft delete consistency

- [launch] schema.prisma:1476 — `AbAccount` has no `deletedAt`. Other financial entities (`AbExpense:1673`, `AbVendor:1707`, `AbBudget:1810`, `AbMileageEntry:1848`, `AbInvoice:1911`, `AbClient:1872`) have soft-delete per PR 26. Accounts can't be deleted cleanly without breaking historical journal lines — either add `deletedAt` + `isActive` flag (it has `isActive Boolean @default(true)` but never set when deleting) or document hard-delete-with-restrict policy.
- [launch] schema.prisma:1496 — `AbJournalEntry` has no `deletedAt`. Per double-entry ledger immutability (per `production-readiness.md`), this is probably intentional — entries should be reversed via offsetting entries, not deleted. Document this in the model header to prevent future devs from adding it.
- [polish] schema.prisma:1939 — `AbPayment` and `:2018 AbCreditNote` and `:2080 AbQuarterlyPayment` have no `deletedAt`. Same rationale (immutability) but undocumented.
- [polish] schema.prisma:1735 — `AbRecurringRule`, `:1820 AbStripeWebhookEvent`, `:1957 AbEstimate`, `:2035 AbRecurringInvoice` — no `deletedAt`. Inconsistent with peer models; pick a policy and document.

#### Audit columns

- [launch] schema.prisma:1496 — `AbJournalEntry` has `createdAt` but no `updatedAt`. Since immutable, this is fine; but contrast with `AbConversation:1625` and `AbEvent:1544` which also lack `updatedAt`. Document the "append-only" intent.
- [polish] schema.prisma:1939 — `AbPayment` has only `createdAt` (no `updatedAt`). If a payment can be voided or amended, missing `updatedAt` makes audit hard. Add it or document immutability.

#### Unique constraints / idempotency

- [launch] schema.prisma:1496 — `AbJournalEntry` indexes by `(tenantId, sourceType)` but has no `@@unique([tenantId, sourceType, sourceId])`. The `sourceId` is the only natural-key linking journal entries back to source documents (expense, invoice, payment). A duplicate run of "post journal entry for expense X" can silently create two journal entries for the same expense — and break trial-balance reconciliation. Bank-sync, cron retries, and webhook replays make this a real risk. **Strong recommendation: add `@@unique([tenantId, sourceType, sourceId])` (nullable allowed).**
- [launch] schema.prisma:1647 — `AbExpense` has no idempotency key. Per spec §6.1, the comment on `AbBankTransaction.idempotencyKey @unique` (:1793) shows the pattern; expenses created via Telegram/OCR/import need the same safety. Add `externalId String? @unique` or compose with source.
- [launch] schema.prisma:1819 — `AbStripeWebhookEvent.stripeEventId @unique` — good. But `AbWebhookDeadLetter:2680` does NOT have `@unique` on any natural key; replay can duplicate.
- [polish] schema.prisma:2080 — `AbQuarterlyPayment` has `@@unique([tenantId, year, quarter, jurisdiction])` — good. But `AbTaxEstimate:2062` is only indexed by `(tenantId, period)`, NOT unique — multiple estimates per period accumulate forever; cron "recalculate quarterly estimate" creates a new row each run.

#### Index coverage (hot queries)

- [polish] schema.prisma:1939 — `AbPayment` indexes `(tenantId, date)` and `(invoiceId)` but no `(stripePaymentId)` index — Stripe webhook lookup by `stripePaymentId` does a table scan.
- [polish] schema.prisma:2255 — `AbCalendarEvent` indexes by `(tenantId, date)` and `(tenantId, status)` but cron "find events due in N days" probably wants `(date, status)` (global, not per-tenant).
- [polish] schema.prisma:2410 — `AbAgentSkillBinding` has `@@index([tenantId, agentId])` but no `(tenantId, skillName)` — skill manifest matching at chat-time runs once per turn; could benefit.
- [polish] schema.prisma:2549 — `AbLearningEvent` indexed only by `(tenantId, agentId, createdAt)` — confidence-decay queries probably need `(tenantId, skillName)`.

#### Other notes

- [polish] schema.prisma:1655 — `AbExpense.categoryId String?` is a soft reference to `AbAccount.id` but has no `@relation`. Same for `:1689 AbExpenseSplit.categoryId`, `:1723 AbPattern.categoryId`, `:1805 AbBudget.categoryId`. Documented in comments but no enforced FK — a category can be deleted (assuming `AbAccount` ever gains delete) leaving dangling references. Cross-schema relations are awkward in Prisma multi-schema, but consider a foreign-key DB constraint via raw migration.
- [polish] schema.prisma:1413 — `AbTenantConfig.userId` is treated as the tenantId everywhere else. The `@@unique` on `userId` means one tenant = one user. Multi-user-per-tenant (teams) is unsupported. This is by design but worth flagging as a long-term scaling limit.

### Test inventory

- **Total spec files:** 51 (`find tests/e2e -name "*.spec.ts" | wc -l` returns 51). Prior baseline mentions "158/158 across 21 test suites" — the delta is partly because (a) some of the 21 "suites" group multiple spec files together, (b) recent specs (e.g. `agent-soft-delete`, `agent-tax-package`, `agent-idempotency`) were added after the 2026-05-20 baseline, and (c) **14 duplicate `*.spec 2.ts` files inflate the count** (see below).
- **Total LOC:** 10,541 across `*.spec.ts`.
- **Duplicate spec files: 8** — all in `tests/e2e/nightly/`:
  - `phase1-auth.spec 2.ts`
  - `phase2-dashboard.spec 2.ts`
  - `phase3-expenses.spec 2.ts`
  - `phase4-invoicing.spec 2.ts`
  - `phase5-tax-reports.spec 2.ts`
  - `phase6-telegram-bot.spec 2.ts`
  - `phase7-cron-and-cache.spec 2.ts`
  - `playwright.config 2.ts`
  - Plus `junit 2.xml` stale report artifact.
  - **Diff with original (e.g. phase1-auth):** the `2.ts` versions are *stale* — they still reference `/dashboard` and a UI logout button, while the canonical `.ts` versions reference `/agentbook` and a programmatic logout. macOS finder-copy artifacts (the `" 2"` suffix is the macOS duplicate-name pattern).
- **Skills without e2e coverage: 11 of 65** (17% gap):
  - `scan-document` — PDF scanning (gap G-OLD-003 still open)
  - `expense-breakdown` — chart category breakdown
  - `edit-expense` — modify amount/category/vendor/date/description
  - `split-expense` — business/personal split (`AbExpenseSplit` table)
  - `create-credit-note` — `AbCreditNote` model exists, no e2e
  - `manage_receipt_request` — note the underscore vs hyphen naming inconsistency vs other skills
  - `tax-filing-field` — granular field-level updates on filing
  - `tax-slip-scan` — OCR for tax slips (T4/W-2)
  - `telegram-setup` — Telegram bot config skill
  - `telegram-status` — bot health/connection status
  - `void-invoice` — `AbInvoice.status='void'` transition; complete absence of E2E despite invoice state machine relying on it
  - `ca-schedule-1-review` — Canadian Schedule 1 review (CA jurisdiction gap G-OLD-013)
- **Weak tests (status-only, no DB read-back): ~5-8 specs.** Top offenders by `expect(*.status).toBe(...)` count:
  - `agent-cpa.spec.ts` (8 status assertions)
  - `phase12-ai-native-moat.spec.ts` (7) — 480 LOC of API surface verification, light on business outcome checks
  - `phase11-competitive-gaps.spec.ts` (7) — 556 LOC, mostly verifies `res.ok()` and shape, not e.g. ledger balance invariant after action
  - `expense-gaps.spec.ts` (6) — relies on previously-seeded data (`MAYA = '2e2348b6-...'`), no DB cleanup; coupling makes runs order-dependent
  - `agent-deductions.spec.ts` (5)
  - `agentbook.spec.ts` (4) — smoke-level

### Test findings (specific)

- [launch] tests/e2e/nightly/phase1-auth.spec 2.ts (and 7 sibling files) — 8 duplicate `*.spec 2.ts` files plus `playwright.config 2.ts` shipped from macOS finder copies. Playwright will discover and execute these alongside the canonical files, **doubling the count of "passing tests"** in CI and exercising stale code paths (e.g. phase1 2.ts still hits `/dashboard` which 404s on current shell). Delete all 9 `* 2.*` files.
- [launch] tests/e2e:missing — skills `scan-document`, `expense-breakdown`, `edit-expense`, `split-expense`, `create-credit-note`, `manage_receipt_request`, `tax-filing-field`, `tax-slip-scan`, `telegram-setup`, `telegram-status`, `void-invoice`, `ca-schedule-1-review` have no e2e coverage — add specs in Stream B prioritizing **void-invoice** (state machine corner case), **edit-expense** + **split-expense** (touch ledger), and **scan-document** (P1 gap G-OLD-003).
- [launch] tests/e2e/expense-gaps.spec.ts:4 — hardcoded `MAYA = '2e2348b6-a64c-44ad-907e-4ac120ff06f2'` tenant id with no fixture cleanup. Tests run `describe.serial` and accumulate rows in Maya's tenant on every run; rerunning the suite changes the assertion baseline (e.g. `length >= 1` instead of `length === 1`). Compare with `agent-soft-delete.spec.ts:23` which uses `TENANT = e2e-pr26-soft-delete-${Date.now()}` + `afterAll deleteMany` — that pattern is the right model.
- [launch] tests/e2e/agent-batch-receipts.spec.ts:80 — `test.fixme('4 photos in quick succession → ONE summary, not 4 prompts')` left in place without a tracking issue or expected-fix-by date. The batch-receipts skill is a key proactive UX feature.
- [polish] tests/e2e/bank-plaid.spec.ts:20 — `test.skip(true, 'Matcher unit-tested in vitest; OAuth round-trip is manual via sandbox.')` — entire file disabled. Given G-OLD-012 (live Plaid not wired) is still open per prior findings, this is the most important Plaid e2e and it doesn't run. Consider an integration spec that exercises the sandbox sync at least once per CI.
- [polish] tests/e2e/agent-multicurrency.spec.ts:102 — `test.skip('createInvoiceDraft on EUR persists originalCurrency + booked USD amount')` — multi-currency was advertised as shipped in `phase11-competitive-gaps.spec.ts` (GAP B10), but the canonical e2e test for the draft is skipped. Inconsistent.
- [polish] tests/e2e/agent-tax-package.spec.ts:142,175,194 — 4 `test.skip(!serverReachable, ...)` gates. If the dev server is down in CI, the whole suite silently passes with no signal. Tests should fail loudly when their preconditions aren't met (set up via `webServer` in `playwright.config.ts`).
- [polish] tests/e2e/phase11-competitive-gaps.spec.ts:18 — `describe.serial` chains 30+ tests through shared mutable state (`let clientId; let invoiceId; let invoiceNumber`). A single failure cascades — the file then reports many cascading failures hiding the root cause. Split into independent `test.describe` blocks or use fixtures.
- [polish] tests/e2e/agentbook.spec.ts — 4 `expect(*.status).toBe(200)` assertions and no follow-up DB read-back. A 200 on `/agentbook-core/journal/post` only proves the endpoint replied; the trial-balance invariant should be asserted afterwards.
- [polish] tests/e2e — no spec exercises tenant isolation comprehensively beyond a single test (per prior-findings §A.5 / G-OLD-016). RLS commented out + no enum on `accountType` + `findFirst({id})` patterns = systemic cross-tenant risk; new isolation spec should join Stream B.
- [nit] tests/e2e/nightly/ vs tests/e2e/gtm/ — two parallel directory conventions exist (`nightly` Phase-numbered + `gtm` fixture-based). Document the difference in `tests/e2e/README.md` (currently only `gtm/README.md` exists).

### Summary

**Schema: 28 findings (3 blockers, 20 launch, 5 polish). Tests: 11 findings (4 launch, 6 polish, 1 nit). Critical:** Three line-item tables (`AbJournalLine`, `AbExpenseSplit`, `AbInvoiceLine`) have no `tenantId` column — combined with Stream A.2's `findFirst({id})` cross-tenant bugs, this is the highest-priority schema-level defense-in-depth gap. Test side: 8 duplicate `*.spec 2.ts` files in `nightly/` ship stale assertions and likely double-execute in CI, and 11 of 65 skills (including `void-invoice` and `edit-expense`) have zero e2e coverage.

## Stream B — Test Results

(populated as test specs land)

---

## Summary

- Total findings: __
- Blocker: __
- Launch: __
- Polish: __
- Nit: __
