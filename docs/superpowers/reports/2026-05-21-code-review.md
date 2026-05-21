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

(populated in Task A.2)

## Stream A.3 — `apps/web-next/src/app/api/v1/agentbook*/**`

(populated in Task A.3)

## Stream A.4 — `apps/web-next/src/app/(dashboard)/**`

(populated in Task A.4)

## Stream A.5 — Prisma schema + existing tests

(populated in Task A.5)

## Stream B — Test Results

(populated as test specs land)

---

## Summary

- Total findings: __
- Blocker: __
- Launch: __
- Polish: __
- Nit: __
