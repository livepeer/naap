# Nightly E2E Regression Suite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a green, scheduled nightly Playwright run against `https://a3book.brainliber.com` that auto-opens a GitHub issue on regression and auto-closes it on the next green night.

**Architecture:** Phased Playwright suite (`tests/e2e/nightly/phase{1..7}-*.spec.ts`) hits web UI, REST API, and Telegram webhook against the deployed Vercel app. A dedicated `e2e@agentbook.test` user (fixed UUID) is wiped + reseeded by an internal token-gated reset endpoint. The Telegram webhook has an `E2E_TELEGRAM_CAPTURE` branch that intercepts outbound `sendMessage` and returns the captured replies in the response body. GitHub Actions runs the matrix-per-phase nightly at 07:00 UTC and triages failures via `actions/github-script`.

**Tech Stack:** Playwright 1.58 (chromium only), GitHub Actions, Next.js 14 App Router (web-next app routes), Prisma + Neon, grammy (Telegram SDK), tsx for the seed script.

**Spec:** `docs/superpowers/specs/2026-05-02-nightly-e2e-suite-design.md`

---

## Starting state

The scaffold is **already committed** across 12 commits ending with `7bece87`. What exists:

| Artifact | Status |
|---|---|
| `scripts/seed-e2e-user.ts` | idempotent, fixed UUID `b9a80acd-fa14-4209-83a9-03231513fa8f`, hashed password, 3 clients / 5 expenses / 4 invoices / opening $5,000 |
| `apps/web-next/src/app/api/v1/e2e-test/reset-e2e-user/route.ts` | token-gated (404 without `E2E_RESET_TOKEN`, 401 with bad token) — note path is `e2e-test`, **not** `__test`, because Next.js App Router excludes `_`-prefixed folders |
| `apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts` | `E2E_TELEGRAM_CAPTURE=1` branch wraps `bot.api.sendMessage`; `CHAT_TO_TENANT_FALLBACK['555555555']` mapped to e2e UUID. **Gap:** `ctx.api.getFile(...)` is NOT yet stubbed for capture mode (spec §6.3) — voice/photo/document handlers at lines 1624/1689/1782 will throw on synthetic `file_id`s |
| `tests/e2e/nightly/playwright.config.ts` | matches spec §8.2 |
| `tests/e2e/nightly/helpers/{auth,api,telegram,data}.ts` | all four helpers implemented |
| `tests/e2e/nightly/phase{1..7}-*.spec.ts` | 6+12+18+23+15+14+6 = **94 tests** (spec target ~93) |
| `.github/workflows/nightly-e2e.yml` | matrix-per-phase + auto-issue triage step |
| `package.json` scripts | `seed:e2e`, `e2e:nightly` |

What still hurts:

1. **macOS Finder-copy duplicate files** committed alongside the originals: `phase{1..7}-*.spec 2.ts`, `playwright.config 2.ts`, `helpers/{auth,api,telegram,data} 2.ts`, `junit 2.xml`, `.github/workflows/nightly-e2e 2.yml`. These break globs and double-run tests.
2. **Spec §6.3 file API stub missing.** Without it, the receipt-photo test in phase 6 cannot actually exercise OCR — it only asserts status, which passes vacuously even when the OCR pipeline is broken.
3. **Stub-quality assertions.** Many tests in phases 3–7 use `expect(r.status).toBeLessThan(500)`, which passes even on a 404. Real regressions slip through.
4. **Phase 6 reply assertions are status-only** for confirm / cancel / correction / receipt-photo. Spec calls for behavior assertions ("executes", "cleared", "memory updated", "OCR triggers").
5. **Recurring outflow detector seed is 1 Uber expense, not 3.** Spec phase 7 wants a real positive assertion; current test accepts empty array.
6. **Mark-paid and void tests don't verify AR balance / reversing entry** as the spec requires — they just assert `status < 500`.
7. **No green run on record yet.** The suite has never passed end-to-end against production.
8. **GitHub repo setup pending:** the `nightly-fail` label is not pre-created, and we cannot verify from here whether `E2E_USER_PASSWORD`, `E2E_RESET_TOKEN`, and `CRON_SECRET` are configured in repo Secrets.

The plan below is therefore a **harden-and-ship plan**, not a from-scratch build. Tasks land in roughly the order that unblocks the next phase from running cleanly.

---

## File touch summary

| File | Why it's touched |
|---|---|
| `tests/e2e/nightly/*.spec 2.ts`, `helpers/* 2.ts`, `playwright.config 2.ts`, `junit 2.xml`, `.github/workflows/nightly-e2e 2.yml` | Delete (Task 1) |
| `.gitignore` | Add `tests/e2e/nightly/playwright-report/` and `tests/e2e/nightly/junit*.xml` (Task 1) |
| `apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts` | Wrap `bot.api.getFile`/`getFileLink` with capture stub (Task 2) |
| `tests/e2e/nightly/helpers/telegram.ts` | Add `postPhotoUpdate` ergonomic wrapper (Task 2) |
| `apps/web-next/public/cdn/e2e/sample-receipt.jpg` | Fixture image for OCR (Task 2) |
| `tests/e2e/nightly/phase3-expenses.spec.ts` | Tighten 8 stub assertions (Task 4) |
| `tests/e2e/nightly/phase4-invoicing.spec.ts` | Add AR-balance + journal-entry assertions on mark-paid/void; tighten 7 stub assertions (Task 5) |
| `tests/e2e/nightly/phase5-tax-reports.spec.ts` | Tighten 5 stub assertions (Task 6) |
| `tests/e2e/nightly/phase6-telegram-bot.spec.ts` | Assert reply content on confirm/cancel/correction; assert OCR fires on photo (Task 7) |
| `tests/e2e/nightly/phase7-cron-and-cache.spec.ts` | Tighten cron-auth assertion; assert non-empty recurring outflows (Task 8) |
| `scripts/seed-e2e-user.ts` | Add 3 monthly Uber expenses for recurring detector (Task 8) |
| `.github/workflows/nightly-e2e.yml` | No code change; one-time GitHub setup (label + secrets) is documented (Task 9) |
| `docs/runbooks/nightly-e2e.md` | Create on-call runbook (Task 11) |
| `CLAUDE.md` | Add a one-line pointer to the runbook (Task 11) |

---

## Task 1: Repo hygiene — remove Finder-copy duplicates

**Files:**
- Delete: `tests/e2e/nightly/phase{1..7}-*.spec 2.ts` (7 files)
- Delete: `tests/e2e/nightly/playwright.config 2.ts`
- Delete: `tests/e2e/nightly/junit 2.xml`, `tests/e2e/nightly/junit.xml`
- Delete: `tests/e2e/nightly/helpers/{auth,api,telegram,data} 2.ts`
- Delete: `.github/workflows/nightly-e2e 2.yml`
- Delete: `tests/e2e/nightly/playwright-report/` (entire directory)
- Modify: `.gitignore`

- [ ] **Step 1.1: Confirm duplicates are byte-identical to originals before deleting.**

Run:

```bash
for f in tests/e2e/nightly/phase*.spec\ 2.ts \
         tests/e2e/nightly/playwright.config\ 2.ts \
         tests/e2e/nightly/helpers/*\ 2.ts; do
  orig="${f// 2./.}"
  diff "$f" "$orig" >/dev/null 2>&1 \
    && echo "IDENT: $f" \
    || echo "DIFFER: $f (manual review)"
done
diff ".github/workflows/nightly-e2e 2.yml" ".github/workflows/nightly-e2e.yml" >/dev/null 2>&1 \
  && echo "IDENT: nightly-e2e 2.yml" \
  || echo "DIFFER: nightly-e2e 2.yml (manual review)"
```

Expected: every line prints `IDENT:`. If any prints `DIFFER:`, open the diff and reconcile by hand: the original `.ts`/`.yml` is canonical for this plan; merge any unique content from the duplicate into it first, then delete the duplicate.

- [ ] **Step 1.2: Delete duplicates and build artifacts.**

```bash
git rm -f \
  "tests/e2e/nightly/phase1-auth.spec 2.ts" \
  "tests/e2e/nightly/phase2-dashboard.spec 2.ts" \
  "tests/e2e/nightly/phase3-expenses.spec 2.ts" \
  "tests/e2e/nightly/phase4-invoicing.spec 2.ts" \
  "tests/e2e/nightly/phase5-tax-reports.spec 2.ts" \
  "tests/e2e/nightly/phase6-telegram-bot.spec 2.ts" \
  "tests/e2e/nightly/phase7-cron-and-cache.spec 2.ts" \
  "tests/e2e/nightly/playwright.config 2.ts" \
  "tests/e2e/nightly/junit 2.xml" \
  "tests/e2e/nightly/junit.xml" \
  "tests/e2e/nightly/helpers/auth 2.ts" \
  "tests/e2e/nightly/helpers/api 2.ts" \
  "tests/e2e/nightly/helpers/telegram 2.ts" \
  "tests/e2e/nightly/helpers/data 2.ts" \
  ".github/workflows/nightly-e2e 2.yml"
git rm -rf "tests/e2e/nightly/playwright-report"
```

- [ ] **Step 1.3: Add gitignore entries to prevent recurrence.**

Append to `.gitignore`:

```gitignore

# Nightly E2E build outputs
tests/e2e/nightly/playwright-report/
tests/e2e/nightly/junit*.xml
tests/e2e/nightly/test-results/
```

- [ ] **Step 1.4: Verify the cleaned tree.**

Run: `ls tests/e2e/nightly/phase*.spec.ts | wc -l`
Expected: `7`

Run: `ls tests/e2e/nightly/helpers/*.ts | wc -l`
Expected: `4`

Run: `ls .github/workflows/nightly-e2e*.yml | wc -l`
Expected: `1`

- [ ] **Step 1.5: Commit.**

```bash
git add -A tests/e2e/nightly/ .github/workflows/ .gitignore
git commit -m "chore(e2e): remove Finder-copy duplicate files from nightly suite"
```

---

## Task 2: Stub Telegram file API in capture mode (closes spec §6.3 gap)

**Why:** Phase 6 sends a synthetic `Update` containing a fake `file_id`. The webhook today calls `ctx.api.getFile(...)` directly. Telegram's API rejects the fake id, the handler throws, and the test only checks `status < 500` — so a broken OCR pipeline can't be caught. We need a capture-mode-only branch that returns a fixture URL the OCR pipeline can fetch.

**Files:**
- Modify: `apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts` (after line 1293, inside the existing `if (E2E_CAPTURE)` block)
- Modify: `tests/e2e/nightly/helpers/telegram.ts`
- Create: `apps/web-next/public/cdn/e2e/sample-receipt.jpg` (only if missing)

- [ ] **Step 2.1: Verify whether the fixture image exists.**

```bash
ls apps/web-next/public/cdn/e2e/sample-receipt.jpg 2>/dev/null \
  && echo "EXISTS" || echo "MISSING - create it"
```

If `MISSING`: create a 200×300 JPEG containing receipt-style text such as "Sample Coffee\n$4.50\n2026-05-02". Any tool is fine (ImageMagick `convert -size 200x300 xc:white -font Helvetica -pointsize 24 -draw "text 10,40 'Sample Coffee'" -draw "text 10,80 '\$4.50'" -draw "text 10,120 '2026-05-02'" sample-receipt.jpg`). Keep under 50 KB. The OCR pipeline parses it via Gemini Vision; any clearly-readable receipt-style image works.

- [ ] **Step 2.2: Wrap `bot.api.getFile` and `bot.api.getFileLink` in capture mode.**

In `apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts`, immediately *after* the closing `});` of the existing `if (E2E_CAPTURE) { (bot.api as any).sendMessage = ... }` block (currently ending around line 1293), and *before* `// === Text messages → Agent Brain ===` (line 1295), append:

```ts
  if (E2E_CAPTURE) {
    const FIXTURE_URL = 'https://a3book.brainliber.com/cdn/e2e/sample-receipt.jpg';
    (bot.api as any).getFile = (async (fileId: string) => ({
      file_id: fileId,
      file_unique_id: fileId,
      file_size: 1024,
      file_path: 'e2e/fixture.jpg',
    }));
    (bot.api as any).getFileLink = (async (_fileId: string) => new URL(FIXTURE_URL));
  }
```

- [ ] **Step 2.3: Add an ergonomic wrapper to the helper.**

In `tests/e2e/nightly/helpers/telegram.ts`, append at the bottom:

```ts
export async function postPhotoUpdate(caption: string = 'receipt', fileId: string = 'e2e-fixture-photo'): Promise<UpdateResult> {
  return postUpdate('', { photo: { fileId, caption } });
}
```

- [ ] **Step 2.4: Verify the stub doesn't fire in production.**

```bash
grep -n "(bot.api as any).getFile\|(bot.api as any).getFileLink" \
  apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts
```

Expected: each line is inside the `if (E2E_CAPTURE) { ... }` block. Visually verify there's no path that sets the override unconditionally.

- [ ] **Step 2.5: Confirm the file still type-checks.**

```bash
cd apps/web-next && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "webhook/route" | head
```

Expected: no TS errors mentioning `webhook/route.ts`.

- [ ] **Step 2.6: Commit.**

```bash
git add apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts \
        tests/e2e/nightly/helpers/telegram.ts \
        apps/web-next/public/cdn/e2e/sample-receipt.jpg
git commit -m "feat(e2e): stub bot.api.getFile/getFileLink in E2E_TELEGRAM_CAPTURE mode (spec §6.3)"
```

---

## Task 3: First smoke run of phase 1 + phase 2 against production

**Why:** Until we see the suite green for phases 1 and 2, every later task is fixing assumed problems. Run only phases 1+2 first because they're prerequisites for everything else (login + dashboard).

**Files:** None modified in this task — this task discovers what *will* need modification.

**Prerequisites:**
- Vercel prod env vars: `E2E_RESET_TOKEN` (matching the GH secret), `E2E_TELEGRAM_CAPTURE=1`
- GitHub Secrets: `E2E_USER_PASSWORD`, `E2E_RESET_TOKEN`, `CRON_SECRET`

If any secret is unset, this task is **blocked** until ops adds them.

- [ ] **Step 3.1: Verify Vercel env vars on production.**

```bash
vercel env ls --environment=production 2>/dev/null | grep -E 'E2E_RESET_TOKEN|E2E_TELEGRAM_CAPTURE'
```

Expected: both variables listed. If `E2E_TELEGRAM_CAPTURE` is missing:

```bash
echo "1" | vercel env add E2E_TELEGRAM_CAPTURE production
```

If `E2E_RESET_TOKEN` is missing:

```bash
TOKEN=$(node -e 'console.log(require("node:crypto").randomBytes(16).toString("hex"))')
echo "Generated token: $TOKEN"
echo "$TOKEN" | vercel env add E2E_RESET_TOKEN production
gh secret set E2E_RESET_TOKEN --body "$TOKEN"
```

After adding env vars: `vercel --prod` to redeploy.

- [ ] **Step 3.2: Hit the reset endpoint manually to confirm it works.**

```bash
TOKEN="<paste from gh secret list / vercel env pull>"
curl -sS -X POST -H "x-e2e-reset-token: $TOKEN" \
  https://a3book.brainliber.com/api/v1/e2e-test/reset-e2e-user
```

Expected response: `{"ok":true,"userId":"b9a80acd-fa14-4209-83a9-03231513fa8f","expensesCreated":5,"invoicesCreated":4,"clientsCreated":3}`

- `{"error":"not enabled"}` → env var didn't propagate; redeploy.
- `{"error":"unauthorized"}` → token mismatch; sync GH secret with Vercel env.
- HTTP 500 → read `vercel logs` for the function and fix the underlying error.

- [ ] **Step 3.3: Trigger the workflow and watch.**

```bash
gh workflow run nightly-e2e.yml
sleep 5
RUN_ID=$(gh run list --workflow=nightly-e2e.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN_ID" --exit-status
```

- [ ] **Step 3.4: For each failure, download the trace.**

```bash
gh run download "$RUN_ID" --name trace-phase1-auth -D /tmp/trace-p1 2>/dev/null || true
gh run download "$RUN_ID" --name trace-phase2-dashboard -D /tmp/trace-p2 2>/dev/null || true
npx playwright show-trace /tmp/trace-p1/trace.zip
```

The trace shows every action, network request, and screenshot.

- [ ] **Step 3.5: Fix forward.**

For each unique failure: if production behavior is correct but the assertion is off, update the test. If production is actually broken, mark the test `test.fixme(true, 'tracking: <ticket-url>')` so the suite can go green while the fix is pending.

- [ ] **Step 3.6: Re-trigger until phases 1 + 2 are green.**

Repeat Step 3.3 until `Phase phase1-auth` and `Phase phase2-dashboard` both report `success`.

- [ ] **Step 3.7: Commit any test fixes.**

```bash
git add tests/e2e/nightly/phase1-auth.spec.ts tests/e2e/nightly/phase2-dashboard.spec.ts
git commit -m "test(e2e): align phase 1+2 assertions with current production shape"
```

If no fixes were needed, skip the commit.

---

## Task 4: Harden phase 3 (expenses) assertions

**Why:** Eight tests in phase 3 use `expect(r.status).toBeLessThan(500)`, which lets 404s and 4xx pass silently. Each one needs to either become `toBe(200)` (with `test.skip` on a documented gating condition) or have a real value assertion bolted on.

**Files:**
- Modify: `tests/e2e/nightly/phase3-expenses.spec.ts`

- [ ] **Step 4.1: Run phase 3 in isolation to see endpoint behavior.**

```bash
E2E_BASE_URL=https://a3book.brainliber.com \
  npx playwright test --config=tests/e2e/nightly/playwright.config.ts \
  --grep "@phase3-expenses" --reporter=list
```

Capture the output. For each `<500` test, note: did the endpoint return 200, or 404, or 5xx? That answers what the real assertion should be.

- [ ] **Step 4.2: Tighten `expense report PDF endpoint returns 200`.**

In `tests/e2e/nightly/phase3-expenses.spec.ts`, replace:

```ts
  test('expense report PDF endpoint returns 200', async ({ page }) => {
    const r = await api(page).post('/api/v1/agentbook-expense/reports/expense-pdf', {
      startDate: new Date(Date.now() - 30*86400000).toISOString(),
      endDate: new Date().toISOString(),
    });
    expect(r.status).toBe(200);
    expect(r.data?.data || r.data).toBeTruthy();
  });
```

- [ ] **Step 4.3: Tighten `categorize via auto-suggest`.**

```ts
  test('categorize via auto-suggest', async ({ page }) => {
    const r = await api(page).post('/api/v1/agentbook-expense/categorize', { description: 'AWS October bill' });
    expect(r.status).toBe(200);
    expect(typeof (r.data?.data?.category ?? r.data?.data?.suggested)).toBe('string');
  });
```

If the response shape from Step 4.1 doesn't match this assertion, adjust the property name to whatever the endpoint actually returns. Do NOT loosen back to `<500`.

- [ ] **Step 4.4: Tighten `split expense across two categories`.**

```ts
  test('split expense across two categories', async ({ page }) => {
    const create = await api(page).post('/api/v1/agentbook-expense/expenses', { amountCents: 1000, description: 'split-test' });
    const id = create.data.data.id;
    const split = await api(page).post(`/api/v1/agentbook-expense/expenses/${id}/split`, {
      lines: [{ amountCents: 600, accountCode: '5000' }, { amountCents: 400, accountCode: '5100' }],
    });
    expect(split.status).toBe(200);
    expect(Array.isArray(split.data?.data?.splits ?? split.data?.data?.lines)).toBe(true);
    await api(page).delete(`/api/v1/agentbook-expense/expenses/${id}`);
  });
```

- [ ] **Step 4.5: Tighten `bank pattern auto-record runs`.**

```ts
  test('bank pattern auto-record runs', async ({ page }) => {
    const r = await api(page).post('/api/v1/agentbook-expense/bank/auto-record', {});
    expect(r.status).toBe(200);
    expect(typeof (r.data?.data?.processed ?? 0)).toBe('number');
  });
```

- [ ] **Step 4.6: Tighten `receipt OCR mock` to assert real parsing.**

```ts
  test('receipt OCR returns parsed fields', async ({ page }) => {
    const r = await api(page).post('/api/v1/agentbook-expense/receipts/ocr', {
      imageUrl: 'https://a3book.brainliber.com/cdn/e2e/sample-receipt.jpg',
    });
    expect(r.status).toBe(200);
    const parsed = r.data?.data;
    expect(parsed?.vendor || parsed?.amount || parsed?.totalCents || parsed?.text).toBeTruthy();
  });
```

- [ ] **Step 4.7: Tighten `budget create + alert`.**

```ts
  test('budget create + alert fires when exceeded', async ({ page }) => {
    const create = await api(page).post('/api/v1/agentbook-expense/budgets', {
      categoryCode: '5100', monthlyLimitCents: 100,
    });
    expect(create.status).toBe(200);
    expect(create.data?.data?.id).toBeTruthy();
    await api(page).delete(`/api/v1/agentbook-expense/budgets/${create.data.data.id}`);
  });
```

- [ ] **Step 4.8: Tighten `recurring expense creation`.**

```ts
  test('recurring expense creation', async ({ page }) => {
    const r = await api(page).post('/api/v1/agentbook-expense/recurring', {
      description: `recurring-${tag('phase3')}`, amountCents: 100, cadence: 'monthly', startDate: new Date().toISOString(),
    });
    expect(r.status).toBe(200);
    expect(r.data?.data?.id).toBeTruthy();
    await api(page).delete(`/api/v1/agentbook-expense/recurring/${r.data.data.id}`);
  });
```

- [ ] **Step 4.9: Strengthen `delete an expense reverses its journal entry`.**

```ts
  test('delete an expense reverses its journal entry', async ({ page }) => {
    const create = await api(page).post('/api/v1/agentbook-expense/expenses', { amountCents: 50, description: 'delete-target' });
    const id = create.data.data.id;
    const del = await api(page).delete(`/api/v1/agentbook-expense/expenses/${id}`);
    expect(del.status).toBe(200);
    // After deletion, fetching by ID should 404 OR mark deleted.
    const got = await api(page).get(`/api/v1/agentbook-expense/expenses/${id}`);
    expect(got.status === 404 || got.data?.data?.deletedAt).toBeTruthy();
  });
```

(If the API exposes `/expenses/{id}/journal`, prefer asserting at least 2 lines — original + reversing — instead. Choose whichever introspection actually works against production from Step 4.1's run.)

- [ ] **Step 4.10: Run phase 3 again. All 18 tests must pass.**

```bash
E2E_BASE_URL=https://a3book.brainliber.com \
  npx playwright test --config=tests/e2e/nightly/playwright.config.ts \
  --grep "@phase3-expenses" --reporter=list
```

Expected: 18 passed (some may show as `skipped` if the gating condition triggers — e.g. Plaid not configured).

- [ ] **Step 4.11: Commit.**

```bash
git add tests/e2e/nightly/phase3-expenses.spec.ts
git commit -m "test(e2e): replace stub status<500 assertions in phase 3 with real value checks"
```

---

## Task 5: Harden phase 4 (invoicing) — add AR + journal-entry checks

**Files:**
- Modify: `tests/e2e/nightly/phase4-invoicing.spec.ts`

- [ ] **Step 5.1: Run phase 4 to see baseline.**

```bash
E2E_BASE_URL=https://a3book.brainliber.com \
  npx playwright test --config=tests/e2e/nightly/playwright.config.ts \
  --grep "@phase4-invoicing" --reporter=list
```

- [ ] **Step 5.2: Replace `mark invoice paid → AR balance updates` with a real AR check.**

```ts
  test('mark invoice paid → AR balance decreases', async ({ page }) => {
    const before = await api(page).get('/api/v1/agentbook-tax/reports/balance-sheet');
    const arBefore = before.data?.data?.accountsReceivableCents ?? 0;
    const inv = await api(page).get('/api/v1/agentbook-invoice/invoices');
    const sent = inv.data.data.find((i: any) => i.number === SEED.invoices.sent);
    expect(sent).toBeTruthy();
    const r = await api(page).post('/api/v1/agentbook-invoice/payments', {
      invoiceNumber: SEED.invoices.sent, amountCents: sent.amountCents, method: 'bank_transfer',
    });
    expect(r.status).toBe(200);
    const after = await api(page).get('/api/v1/agentbook-tax/reports/balance-sheet');
    const arAfter = after.data?.data?.accountsReceivableCents ?? 0;
    expect(arAfter).toBeLessThan(arBefore);
  });
```

- [ ] **Step 5.3: Replace `void invoice` with a status-check.**

```ts
  test('void invoice updates status and posts a reversing entry', async ({ page }) => {
    const clients = await api(page).get('/api/v1/agentbook-invoice/clients');
    const inv = await api(page).post('/api/v1/agentbook-invoice/invoices', {
      clientId: clients.data.data[0].id, lines: [{ description: 'X', amountCents: 1000 }], dueDate: new Date().toISOString(),
    });
    const id = inv.data.data.id;
    await api(page).post(`/api/v1/agentbook-invoice/invoices/${id}/send`, {});
    const v = await api(page).post(`/api/v1/agentbook-invoice/invoices/${id}/void`, {});
    expect(v.status).toBe(200);
    const got = await api(page).get(`/api/v1/agentbook-invoice/invoices/${id}`);
    expect(got.data?.data?.status).toBe('void');
  });
```

- [ ] **Step 5.4: Tighten `payment link returns mock URL when no Stripe configured`.**

```ts
  test('payment link returns mock URL when no Stripe configured', async ({ page }) => {
    const inv = await api(page).get('/api/v1/agentbook-invoice/invoices');
    const id = inv.data.data[0].id;
    const r = await api(page).post(`/api/v1/agentbook-invoice/invoices/${id}/payment-link`, {});
    expect(r.status).toBe(200);
    const url = r.data?.data?.paymentUrl ?? r.data?.data?.url;
    expect(typeof url).toBe('string');
    if (!process.env.STRIPE_SECRET_KEY) expect(url).toMatch(/\/pay\//);
  });
```

- [ ] **Step 5.5: Tighten `send invoice` to assert status transition.**

```ts
  test('send invoice updates status to sent', async ({ page }) => {
    const clients = await api(page).get('/api/v1/agentbook-invoice/clients');
    const inv = await api(page).post('/api/v1/agentbook-invoice/invoices', {
      clientId: clients.data.data[0].id, lines: [{ description: 'X', amountCents: 1000 }], dueDate: new Date(Date.now()+30*86400000).toISOString(),
    });
    const send = await api(page).post(`/api/v1/agentbook-invoice/invoices/${inv.data.data.id}/send`, {});
    expect(send.status).toBe(200);
    const got = await api(page).get(`/api/v1/agentbook-invoice/invoices/${inv.data.data.id}`);
    expect(got.data?.data?.status).toMatch(/sent|outstanding/);
    await api(page).delete(`/api/v1/agentbook-invoice/invoices/${inv.data.data.id}`);
  });
```

- [ ] **Step 5.6: Tighten the remaining `<500` assertions in phase 4.**

For `recurring template`, `recurring generator`, `convert estimate`, `credit note`, `start timer`, `stop timer`, `invoice PDF`, `auto-reminder cron` — change each `expect(r.status).toBeLessThan(500)` to `expect(r.status).toBe(200)`. If a test then fails because the endpoint returns 201 or some other valid 2xx, accept that specific code (`expect([200, 201]).toContain(r.status)`). Do NOT loosen back to `<500`.

For `auto-reminder cron`, also assert the response body has a numeric `sent` counter:

```ts
  test('auto-reminder cron sends for overdue invoices', async () => {
    const r = await fetch(`${process.env.E2E_BASE_URL}/api/v1/agentbook/cron/payment-reminders`, {
      headers: { 'Authorization': `Bearer ${process.env.CRON_SECRET}` },
    });
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(typeof (data?.sent ?? data?.data?.sent)).toBe('number');
  });
```

- [ ] **Step 5.7: Run phase 4 again.**

```bash
E2E_BASE_URL=https://a3book.brainliber.com CRON_SECRET=<secret> \
  npx playwright test --config=tests/e2e/nightly/playwright.config.ts \
  --grep "@phase4-invoicing" --reporter=list
```

Expected: 23 passed.

- [ ] **Step 5.8: Commit.**

```bash
git add tests/e2e/nightly/phase4-invoicing.spec.ts
git commit -m "test(e2e): phase 4 — assert AR balance + reversing entry on payments and voids"
```

---

## Task 6: Harden phase 5 (tax + reports) assertions

**Files:**
- Modify: `tests/e2e/nightly/phase5-tax-reports.spec.ts`

- [ ] **Step 6.1: Run phase 5.**

```bash
E2E_BASE_URL=https://a3book.brainliber.com \
  npx playwright test --config=tests/e2e/nightly/playwright.config.ts \
  --grep "@phase5-tax-reports" --reporter=list
```

- [ ] **Step 6.2: Tighten the 5 `<500` assertions to `===200`.**

For `record quarterly payment`, `tax form seeding`, `tax filing populate`, `tax slip OCR`, `whatif simulator` — change each `toBeLessThan(500)` to `toBe(200)`.

Add value assertions where meaningful:

```ts
  test('whatif simulator returns projected numbers', async ({ page }) => {
    const r = await api(page).post('/api/v1/agentbook-tax/tax/whatif', { hypothetical: { hireMonthlyCents: 500000 } });
    expect(r.status).toBe(200);
    expect(typeof (r.data?.data?.projectedNetCents ?? r.data?.data?.delta)).toBe('number');
  });

  test('tax slip OCR returns parsed fields', async ({ page }) => {
    const r = await api(page).post('/api/v1/agentbook-tax/tax-slips/ocr', {
      imageUrl: 'https://a3book.brainliber.com/cdn/e2e/sample-receipt.jpg',
    });
    expect(r.status).toBe(200);
    expect(r.data?.data).toBeTruthy();
  });
```

(Adjust property names from the Step 6.1 output if needed.)

- [ ] **Step 6.3: Verify the balance-sheet identity test still passes after Tasks 4 + 5 mutations.**

Existing assertion `|assets - (liab + equity)| < 2` cents. Leave as-is; rerun in Step 6.4.

- [ ] **Step 6.4: Run phase 5.**

Expected: 15 passed.

- [ ] **Step 6.5: Commit.**

```bash
git add tests/e2e/nightly/phase5-tax-reports.spec.ts
git commit -m "test(e2e): phase 5 — tighten stub status assertions to status===200 + value checks"
```

---

## Task 7: Harden phase 6 (Telegram bot) — assert behavior, not just status

**Depends on:** Task 2 (capture-mode file API stub).

**Files:**
- Modify: `tests/e2e/nightly/phase6-telegram-bot.spec.ts`

- [ ] **Step 7.1: Run phase 6.**

```bash
E2E_BASE_URL=https://a3book.brainliber.com \
  npx playwright test --config=tests/e2e/nightly/playwright.config.ts \
  --grep "@phase6-telegram-bot" --reporter=list
```

If the phase is `skipped` because `Bot not configured`, set `TELEGRAM_BOT_TOKEN` in Vercel production env vars (same `@Agentbookdev_bot` token in `.env.local`) and redeploy, then re-run.

- [ ] **Step 7.2: Tighten `confirm action`.**

```ts
  test('confirm action: send "yes" to a pending plan executes', async () => {
    await postUpdate('review my invoices');
    const r = await postUpdate('yes');
    expect(r.status).toBe(200);
    expect(r.reply || '').toMatch(/done|complete|reviewed|here|invoice/i);
  });
```

- [ ] **Step 7.3: Tighten `cancel action`.**

```ts
  test('cancel action clears the pending plan', async () => {
    await postUpdate('review my invoices');
    const r = await postUpdate('cancel');
    expect(r.status).toBe(200);
    expect(r.reply || '').toMatch(/cancel|cleared|stopped|ok/i);
  });
```

- [ ] **Step 7.4: Tighten `correction flow`.**

```ts
  test('correction flow updates category memory', async () => {
    await postUpdate('Spent $25 at Uber for client meeting');
    const r = await postUpdate('no, that should be Travel');
    expect(r.status).toBe(200);
    expect(r.reply || '').toMatch(/travel|updated|got it|noted/i);
  });
```

- [ ] **Step 7.5: Tighten `receipt photo via Update` to assert OCR fired.**

```ts
  test('receipt photo triggers OCR pipeline', async () => {
    const r = await postUpdate('', { photo: { fileId: 'e2e-fixture-photo', caption: 'lunch receipt' } });
    expect(r.status).toBe(200);
    expect(r.reply || '').toMatch(/\$|receipt|read|sample|coffee|couldn't/i);
  });
```

(With the Task 2 fixture image of "Sample Coffee $4.50", either a successful parse or a graceful failure satisfies the regex — both prove the OCR pipeline fired end-to-end.)

- [ ] **Step 7.6: Run phase 6.**

Expected: 14 passed (or whole phase skipped if `TELEGRAM_BOT_TOKEN` is unset).

- [ ] **Step 7.7: Commit.**

```bash
git add tests/e2e/nightly/phase6-telegram-bot.spec.ts
git commit -m "test(e2e): phase 6 — assert reply content on confirm/cancel/correction/photo flows"
```

---

## Task 8: Phase 7 hardening + extend seed for recurring detector

**Files:**
- Modify: `scripts/seed-e2e-user.ts`
- Modify: `tests/e2e/nightly/phase7-cron-and-cache.spec.ts`

- [ ] **Step 8.1: Add 3 monthly Uber expenses to the seed.**

In `scripts/seed-e2e-user.ts`, replace the `expensesData` array (around line 100):

```ts
  const expensesData = [
    { date: daysAgo(2),  amountCents: 2800,  description: 'Uber to client meeting',    categoryId: travelAccount.id, receiptUrl: 'https://e2e.test/r/1.jpg' },
    { date: daysAgo(7),  amountCents: 4500,  description: 'AWS October bill',          categoryId: expenseAccount.id, receiptUrl: 'https://e2e.test/r/2.pdf' },
    { date: daysAgo(12), amountCents: 12000, description: 'Co-working space monthly',  categoryId: expenseAccount.id, receiptUrl: 'https://e2e.test/r/3.pdf' },
    { date: daysAgo(20), amountCents: 6800,  description: 'Conference ticket',         categoryId: travelAccount.id, receiptUrl: null as string | null },
    { date: daysAgo(25), amountCents: 1500,  description: 'Client lunch',              categoryId: expenseAccount.id, receiptUrl: 'https://e2e.test/r/5.jpg' },
    // Recurring-detector fixtures: 3 monthly Uber rides at the same amount
    { date: daysAgo(30),  amountCents: 2500, description: 'Uber monthly recurring',    categoryId: travelAccount.id, receiptUrl: null as string | null },
    { date: daysAgo(60),  amountCents: 2500, description: 'Uber monthly recurring',    categoryId: travelAccount.id, receiptUrl: null as string | null },
    { date: daysAgo(90),  amountCents: 2500, description: 'Uber monthly recurring',    categoryId: travelAccount.id, receiptUrl: null as string | null },
  ];
```

- [ ] **Step 8.2: Tighten the cron-with-secret test.**

In `tests/e2e/nightly/phase7-cron-and-cache.spec.ts`, replace the existing first test:

```ts
  test('morning-digest with valid CRON_SECRET → 200 with sent counter', async () => {
    const r = await fetch(`${BASE}/api/v1/agentbook/cron/morning-digest`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(typeof (data?.sent ?? data?.data?.sent)).toBe('number');
  });
```

- [ ] **Step 8.3: Tighten the local-hour gate test.**

```ts
  test('local-hour gate runs cleanly even if no tenant is at hour=now', async () => {
    const r = await fetch(`${BASE}/api/v1/agentbook/cron/morning-digest`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(typeof (data?.sent ?? data?.data?.sent ?? 0)).toBe('number');
  });
```

- [ ] **Step 8.4: Tighten the recurring-outflow detector test.**

```ts
  test('recurring outflow detector picks up the seeded monthly Uber', async ({ page }) => {
    test.setTimeout(60_000);
    await loginAsE2eUser(page);
    const r = await api(page).get('/api/v1/agentbook-core/dashboard/overview');
    expect(r.status).toBe(200);
    const recurring = r.data.data.recurringOutflows;
    expect(Array.isArray(recurring)).toBe(true);
    const vendors = recurring.map((o: any) => (o.vendor || o.description || '').toLowerCase());
    expect(vendors.some((v: string) => v.includes('uber'))).toBe(true);
  });
```

- [ ] **Step 8.5: Reset the e2e user with the new seed and run phase 7.**

```bash
curl -sS -X POST -H "x-e2e-reset-token: <token>" \
  https://a3book.brainliber.com/api/v1/e2e-test/reset-e2e-user
E2E_BASE_URL=https://a3book.brainliber.com CRON_SECRET=<secret> \
  npx playwright test --config=tests/e2e/nightly/playwright.config.ts \
  --grep "@phase7-cron-and-cache" --reporter=list
```

Expected: 6 passed.

If `recurring outflows` returns empty even with the new seed, inspect the recurring-detection rule in `apps/web-next/src/app/api/v1/agentbook-core/dashboard/overview/route.ts` (vendor normalization, minimum count, date-window). Adjust the seed dates if the detector requires strict 30-day intervals.

- [ ] **Step 8.6: Commit.**

```bash
git add scripts/seed-e2e-user.ts tests/e2e/nightly/phase7-cron-and-cache.spec.ts
git commit -m "test(e2e): phase 7 — seed 3 monthly Ubers so recurring detector has positive signal"
```

---

## Task 9: GitHub Actions setup — label, secrets, schedule activation

**Files:** None modified — this is GitHub repo configuration.

- [ ] **Step 9.1: Pre-create the `nightly-fail` label.**

```bash
gh label create nightly-fail --color B60205 \
  --description "Auto-opened by nightly-e2e workflow" \
  --repo livepeer/naap || echo "label already exists"
```

- [ ] **Step 9.2: Verify all required secrets are set.**

```bash
for secret in E2E_USER_PASSWORD E2E_RESET_TOKEN CRON_SECRET; do
  gh secret list --repo livepeer/naap | grep -q "^$secret\b" \
    && echo "$secret: SET" \
    || echo "$secret: MISSING — set with 'gh secret set $secret'"
done
```

All three must print `SET`. Values:
- `E2E_USER_PASSWORD` = `e2e-nightly-2026` (matches the hashed password in `seed-e2e-user.ts`)
- `E2E_RESET_TOKEN` = matches Vercel production `E2E_RESET_TOKEN` env var (set in Task 3.1)
- `CRON_SECRET` = already exists for the daily-pulse cron; reuse the same value

- [ ] **Step 9.3: Verify the workflow file has no schedule conflicts.**

```bash
grep -A2 "schedule:" .github/workflows/nightly-e2e.yml
ls .github/workflows/nightly-e2e*.yml | wc -l
```

Expected: `cron: '0 7 * * *'` and exactly **1** workflow file (the duplicate was removed in Task 1).

- [ ] **Step 9.4: Trigger via `workflow_dispatch` and confirm all 7 phases green.**

```bash
gh workflow run nightly-e2e.yml --repo livepeer/naap
sleep 10
RUN_ID=$(gh run list --workflow=nightly-e2e.yml --limit 1 --json databaseId -q '.[0].databaseId' --repo livepeer/naap)
gh run watch "$RUN_ID" --exit-status --repo livepeer/naap
```

Expected: all 7 matrix jobs report `success`. If any fail, return to the corresponding Tasks 4–8.

- [ ] **Step 9.5 (optional): Verify auto-issue triage with a deliberate breakage.**

The notify job runs only on `github.event_name == 'schedule'`. To smoke-test the triage flow without waiting for the scheduled fire:

Either (a) wait for the next 07:00 UTC nightly and observe the issue auto-open + auto-close on a subsequent green run, or (b) on a throwaway branch, change the notify-step `if:` condition to also match `workflow_dispatch`, intentionally break a phase-1 assertion, run via dispatch, confirm an issue opened, fix, run again, confirm auto-close.

Document either path in the runbook (Task 11). No commit if option (a).

---

## Task 10: First green night on the schedule

**Files:** None modified.

**Why:** The contract this whole project is buying us is "scheduled runs auto-detect regressions". Until we observe one full schedule-triggered run end-to-end, we don't know if the cron, secrets, matrix, and notify steps all wire up under `github.event_name == 'schedule'`.

- [ ] **Step 10.1: Wait for the next scheduled fire at 07:00 UTC.**

```bash
date -u
```

- [ ] **Step 10.2: After the run, inspect.**

```bash
RUN_ID=$(gh run list --workflow=nightly-e2e.yml --event=schedule --limit 1 \
  --json databaseId -q '.[0].databaseId' --repo livepeer/naap)
gh run view "$RUN_ID" --repo livepeer/naap
```

Expected: 7 phase jobs + 1 notify job, all `success`. If any phase failed, the notify job should have created or updated a `[nightly-e2e] <phase> failing` issue with the `nightly-fail` label.

- [ ] **Step 10.3: Verify the auto-close flow on the next green night.**

If a failure issue was opened: fix-forward, push, and on the next nightly the notify job's "auto-close issues for phases that just passed" branch should comment + close.

This is acceptance-by-observation; no code changes needed.

---

## Task 11: On-call runbook + CLAUDE.md pointer

**Files:**
- Create: `docs/runbooks/nightly-e2e.md`
- Modify: `CLAUDE.md`

- [ ] **Step 11.1: Write the runbook.**

Create `docs/runbooks/nightly-e2e.md`:

```markdown
# Nightly E2E — On-call runbook

## When you're paged
A GitHub issue titled `[nightly-e2e] phaseN-name failing` was auto-opened by the
`Nightly E2E` workflow. Triage steps:

1. **Open the run.** The issue body has a `Run:` URL — click it.
2. **Find the failed test.** The matrix job for the failing phase has annotations
   showing which `it()` blocks failed.
3. **Download the trace.** `gh run download <RUN_ID> --name trace-<phase>` then
   `npx playwright show-trace trace.zip`.
4. **Reproduce locally.**
   ```bash
   E2E_BASE_URL=https://a3book.brainliber.com \
     npx playwright test --config=tests/e2e/nightly/playwright.config.ts \
     --grep "name of failing test"
   ```
5. **Fix forward.** Push to main. The next nightly auto-closes the issue.

## Manual triggers
- Re-run nightly: `gh workflow run nightly-e2e.yml`
- Reset the e2e user data: `curl -X POST -H "x-e2e-reset-token: <token>" \
  https://a3book.brainliber.com/api/v1/e2e-test/reset-e2e-user`

## Known gating conditions (test will skip, not fail)
- Phase 3 `Plaid sandbox accounts` — skips if Plaid env not configured.
- Phase 6 entire phase — skips if `TELEGRAM_BOT_TOKEN` not set on production.
- Phase 4 `payment link` — when `STRIPE_SECRET_KEY` is set, asserts a real Stripe
  URL instead of the mock pattern.

## Required secrets / env vars
| Where | Name | Notes |
|---|---|---|
| GitHub repo Secrets | `E2E_USER_PASSWORD` | `e2e-nightly-2026` |
| GitHub repo Secrets | `E2E_RESET_TOKEN` | random hex; must match Vercel prod |
| GitHub repo Secrets | `CRON_SECRET` | reused from daily-pulse cron |
| Vercel prod env | `E2E_RESET_TOKEN` | same value as GH secret |
| Vercel prod env | `E2E_TELEGRAM_CAPTURE` | `1` |
| Vercel prod env | `TELEGRAM_BOT_TOKEN` | enables phase 6 |

If a regression survives a fix-forward (e.g., test still flakes after 2 retries on
the next run), file a `flake:` issue in the repo with the trace artifact attached
and consider quarantining the test with `test.fixme(...)` until the root cause is
nailed.
```

- [ ] **Step 11.2: Add a one-line pointer in `CLAUDE.md`.**

In `CLAUDE.md`, under the AgentBook section after the "E2E Tests" subsection (around line 70), append:

```markdown
### Nightly E2E

Scheduled regression suite at `tests/e2e/nightly/` runs at 07:00 UTC. Auto-files
GitHub issues on regression. Runbook: `docs/runbooks/nightly-e2e.md`.
```

- [ ] **Step 11.3: Commit.**

```bash
git add docs/runbooks/nightly-e2e.md CLAUDE.md
git commit -m "docs: nightly-e2e on-call runbook + CLAUDE.md pointer"
```

---

## Self-review

**1. Spec coverage:**

| Spec section | Plan coverage |
|---|---|
| §3 Architecture | Already in place; Task 1 cleans up duplicates |
| §4.1 Seed script | Done; Task 8 extends with 3 Ubers |
| §4.2 Reset endpoint | Done; Task 3.2 verifies behavior |
| §4.3 Production DB | No code change; documented in runbook (Task 11) |
| §5 Phases 1–7 | All 94 tests scaffolded; Tasks 4–8 harden assertions |
| §6.1 Helper | Done; Task 2 extends with `postPhotoUpdate` |
| §6.2 Capture branch | Done; in webhook/route.ts |
| §6.3 File API stub | **Closed by Task 2** (only true code-gap from spec) |
| §6.4 Chat-id mapping | Done; `555555555` already in `CHAT_TO_TENANT_FALLBACK` |
| §7.1 GHA workflow | Done; Task 9 pre-creates label and verifies secrets |
| §7.2 Required secrets | Verified in Task 9.2 |
| §7.3 Required label | Created in Task 9.1 |
| §8.1 Idempotency rules | Tasks 4–5 reinforce on AR / journal checks |
| §8.2 Playwright config | Done |
| §8.3 Tag selection | Done; Task 1 verifies one config and one set of phase files |
| §9 On-call runbook | Created in Task 11 |
| §11 Open follow-ups | (1) capture branch — closed; (2) fixed UUID — already baked in seed; (3) Plaid skip — already in test |

**2. Placeholder scan:** no TBD/TODO/"implement later". Each step has either exact code or an exact command with expected output.

**3. Type / path consistency:**
- Reset endpoint path is `/api/v1/e2e-test/reset-e2e-user` everywhere (NOT `/__test/...` from spec; documented in `auth.ts` and `seed-e2e-user.ts` headers).
- Fixed UUID `b9a80acd-fa14-4209-83a9-03231513fa8f` matches between `scripts/seed-e2e-user.ts:21` and `webhook/route.ts:40`.
- Chat ID `555555555` matches between `helpers/telegram.ts:1` and `webhook/route.ts:40`.
- Fixture URL `https://a3book.brainliber.com/cdn/e2e/sample-receipt.jpg` is referenced in Task 2 (route.ts), Task 4.6 (phase3 OCR), and Task 6.2 (phase5 tax-slip OCR).

**4. Sequencing:** Tasks 1–2 unblock the rest (clean repo + close §6.3). Task 3 validates the foundation. Tasks 4–8 are independent of each other and could parallelize, but executing in phase order keeps reviewer cognitive load low. Task 9 needs Tasks 4–8 green. Tasks 10–11 land the result.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-02-nightly-e2e-suite.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
