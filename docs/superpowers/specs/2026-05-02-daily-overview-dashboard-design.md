# Daily Overview Dashboard — Design

**Status:** Approved (brainstorm complete, awaiting plan)
**Owner:** AgentBook
**Date:** 2026-05-02
**Audience:** Small-business owners and freelancers (Maya — CA consultant, Alex — US agency, Jordan — side-hustle)

## 1. Goal

Replace the existing AgentBook home dashboard with a **forward-looking daily overview** that answers, in five seconds, "Am I going to be okay this month, and what needs my attention right now?" Lean on AgentBook's unique strengths (cashflow projection, agent judgment, Telegram) instead of cloning the QuickBooks/Wave/FreshBooks "big numbers grid" pattern. Mobile-first; same code path serves desktop.

## 2. Why a new dashboard

The current `Dashboard.tsx` (in `plugins/agentbook-core/frontend/src/pages/`) is a backward-looking metrics grid plus a recent-expense list — visually similar to every competitor and does not differentiate. A daily-coffee user opens it, sees four big numbers they already knew, and bounces. We have unique data (30/60/90 cashflow projection, agent brain, Telegram bot) and we are not using it on the most-visited screen.

## 3. Core mental model

A small-business owner's daily anxiety is not "what did I earn last month" — it is **"will I be okay through the next two weeks."** The new dashboard answers that question first. Three layers, in order of prominence:

1. **Forward view** (hero) — where am I headed and why
2. **Needs your attention** — the 3–5 things that drive the answer
3. **Recent state** (compact) — sanity check on this month + activity pulse

## 4. Layout

### Mobile (≤768px)

```
┌─────────────────────────────────────┐
│ Good morning, Maya          [⋯]     │   header (greeting + kebab)
├─────────────────────────────────────┤
│ FORWARD VIEW                        │
│ $14,200 today → ~$18,400 May 31     │   cash + projection
│ ●━━━━━━━━━━━━━━━━━━━━━━━━━━━●       │   30-day timeline
│ Today                       +30d    │   markers: green↑ inflow, red↓ outflow
│ 💰 Acme   $4,500 in 7d              │
│ 📋 Tax    $3,200 in 14d             │   "next moments" (max 4)
│ 🏠 Rent   $1,800 in 5d              │
├─────────────────────────────────────┤
│ NEEDS YOUR ATTENTION                │
│ <agent summary line, 1–2 sentences> │
│ ⚠ Acme · 32 days overdue            │
│   $4,500           [Send reminder]  │   max 5 ranked items
│ ⚠ Tax payment due May 14            │
│   ~$3,200          [View]           │
├─────────────────────────────────────┤
│ THIS MONTH                          │
│ Rev $12,400 ↑15%  Exp $4,100 ↓3%    │   compact strip vs prior month
│ Net $8,300  ↑22%                    │
├─────────────────────────────────────┤
│ RECENT ACTIVITY                     │
│ ↗ Sent invoice — Acme    +$4,500    │   mixed feed
│ ⬇ Paid by Bob            +$3,200    │
│ 🧾 Uber                  −$28       │
│ … View all                          │
└─────────────────────────────────────┘
[ + New invoice ] [ 📷 Snap ] [ 💬 Ask ]   ← sticky bottom bar
```

### Desktop (≥1024px)

Two-column layout. Forward view occupies 2/3 width; attention panel 1/3 on the right. This-month strip and activity feed span full width below.

```
┌────────────────────────────────────────────────────────────────────┐
│ AgentBook · Good morning, Maya  [+New invoice][📷Snap][💬Ask] [⋯]   │
├──────────────────────────────────────────┬──────────────────────────┤
│ FORWARD VIEW (2/3)                       │ NEEDS YOUR ATTENTION     │
│  $14,200 → ~$18,400   ☀️ Healthy          │ <agent summary>          │
│  ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●      │ ⚠ Acme · 32d  $4,500     │
│  Today                          +30d     │ ⚠ Tax · May 14 ~$3,200   │
│  💰 Acme  $4,500 · 7d                    │ ...                      │
├──────────────────────────────────────────┴──────────────────────────┤
│ This month  Rev $12,400 ↑15%  Exp $4,100 ↓3%  Net $8,300 ↑22%        │
├─────────────────────────────────────────────────────────────────────┤
│ Recent activity                                                     │
│ ↗ Sent invoice — Acme    +$4,500    2h ago                          │
│ ⬇ Got paid — Bob         +$3,200    yesterday                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Tablet (768–1023px)

Single column like mobile, but quick-actions stay in the header (no sticky bottom bar — too small a screen for both header chrome and a fixed bar).

## 5. Components

Replace the body of `plugins/agentbook-core/frontend/src/pages/Dashboard.tsx`. Same file path keeps routing/UMD/manifest unchanged. New subcomponents under `pages/dashboard/`:

```
plugins/agentbook-core/frontend/src/pages/dashboard/
├── Dashboard.tsx              page shell, data fetching, layout
├── ForwardView.tsx            timeline + next-moments
├── CashflowTimeline.tsx       SVG axis with markers
├── NextMomentsList.tsx        bullet list under the timeline
├── AttentionPanel.tsx         agent summary + ranked items
├── AttentionItem.tsx          single row with action button
├── ThisMonthStrip.tsx         compact metrics row
├── ActivityFeed.tsx           mixed invoice/expense/payment list
├── QuickActionsBar.tsx        sticky bottom (mobile) / header row (desktop)
└── hooks/
    ├── useDashboardOverview.ts   fetch + cache aggregator response
    └── useDashboardActivity.ts   fetch + cache activity feed
```

Subcomponents are pure presentation; data fetching is centralized in two hooks. Each subcomponent has a single typed prop interface and is unit-testable in isolation.

## 6. Data model

### Existing endpoints (reused)

| Section | Source(s) |
|---|---|
| Cash today | `GET /api/v1/agentbook-core/trial-balance` (sum of asset accounts) |
| 30-day projected cash | `GET /api/v1/agentbook-tax/cashflow/projection` |
| Upcoming inflows | `GET /api/v1/agentbook-invoice/invoices?status=sent&dueWithinDays=30` |
| Tax deadline | `GET /api/v1/agentbook-tax/tax/quarterly` |
| Overdue invoices | `GET /api/v1/agentbook-invoice/aging-report` |
| Unbilled work | `GET /api/v1/agentbook-invoice/unbilled-summary` |
| Receipts missing | `GET /api/v1/agentbook-expense/expenses?missingReceipt=true&limit=1` |
| MTD + prior-month metrics | `GET /api/v1/agentbook-tax/reports/pnl?period=mtd` and `?period=last-month` |

### New endpoints (added in this spec)

1. **`GET /api/v1/agentbook-core/dashboard/overview`**

Server-side aggregator that fans out the calls above and returns one payload. Avoids 8 cold-start function calls on mobile. Falls back to client-side fan-out if the endpoint is missing or returns 5xx.

Response shape:

```ts
{
  cashToday: number;                     // cents
  projection: {
    days: { date: string; cents: number }[]; // 30 entries
    moodLabel: 'healthy' | 'tight' | 'critical';
    // Baseline thresholds (computed from `days`, tunable later):
    //   critical: any day in window has cents <= 0
    //   tight:    minimum cents in window < 0.5× current monthly expense run-rate
    //   healthy:  otherwise
  };
  nextMoments: Array<{
    kind: 'income' | 'tax' | 'rent' | 'recurring';
    label: string;
    amountCents: number;
    daysOut: number;
    sourceId?: string;
  }>;                                    // ≤4, ordered by daysOut asc; ties broken by absolute amount desc
  attention: Array<{
    id: string;
    severity: 'critical' | 'warn' | 'info';
    title: string;
    subtitle?: string;
    amountCents?: number;
    action?: { label: string; href?: string; postEndpoint?: string };
  }>;                                    // ≤5, server-ranked: overdue invoices → tax within 14d → unbilled work → books out of balance → ≥3 receipts missing
  recurringOutflows: Array<{
    vendor: string;
    amountCents: number;
    nextExpectedDate: string;
  }>;                                    // ≥3 occurrences in last 90d at 25–35d cadence
  monthMtd: { revenueCents: number; expenseCents: number; netCents: number };
  monthPrev: { revenueCents: number; expenseCents: number; netCents: number };
}
```

2. **`GET /api/v1/agentbook-core/dashboard/activity?limit=10`**

Unified recent-activity feed mixing invoice events (sent / paid / voided) + expenses + payments, sorted by timestamp.

```ts
Array<{
  id: string;
  kind: 'invoice_sent' | 'invoice_paid' | 'invoice_voided' | 'expense' | 'payment';
  label: string;
  amountCents: number;                   // sign indicates direction
  date: string;
  href?: string;                         // tap target
}>
```

3. **`GET /api/v1/agentbook-core/dashboard/agent-summary`** *(V1+, see §7)*

LLM-generated 1–2 sentence summary of the attention payload. Cached 15 min per tenant in an **in-memory Map** inside the function process (Fluid Compute reuses instances; a fresh cold start at most produces one LLM call). Returns `{ summary: string, generatedAt: ISO }`. **No new database table.**

## 7. V1+ items (pulled forward from V2)

Three additions raise the dashboard from "another timeline" to "AgentBook's daily voice."

### 7.1 LLM agent summary line

Above the attention list, a 1–2 sentence judgment line: *"Two big invoices land next week, but you're cutting it close on the May 14 tax payment — consider chasing Acme today."* Same data as the bullet list, but with judgment.

- New endpoint `dashboard/agent-summary` (see §6).
- Calls existing agent brain with the attention payload as context.
- Cached 15 min per tenant in an in-memory Map (TTL only; no hash invalidation — slightly stale for ≤15 min is fine).
- **Fallback:** if the LLM call fails or exceeds 3s, return the deterministic counts string (e.g. "3 invoices overdue ($8,400). Tax payment in 12 days."). Never blocks page render.

### 7.2 Auto-detected recurring outflows

Server-side detection of monthly recurring expenses, surfaced as red markers on the timeline and entries in "next moments." Without this, the cashflow timeline misses rent/SaaS/contractors and users distrust the projection.

- **Detection algo:** scan last 90 days of expenses; cluster by `(vendor, amount within ±10%, monthly cadence)`. **Single high-confidence threshold:** require **≥3 occurrences** spaced 25–35 days apart before predicting the next occurrence. Fewer items detected, all trustworthy.
- **Output** appears in `dashboard/overview` as `recurringOutflows`. No new round-trip.
- **No suppression UI in V1** (no `AbDashboardSuppressedBill` table). With a 3-occurrence threshold, false positives are rare. If real-world feedback shows we need an "ignore this" affordance, add it in a later iteration.

### 7.3 Daily Telegram morning digest

A 7–9am-local Telegram message gives users their dashboard before they open the app — turning the page from a destination into a habit.

- New endpoint `POST /api/v1/agentbook-core/dashboard/morning-digest` invoked by Vercel Cron **hourly at minute 0** (`0 * * * *`). A single 7am-UTC schedule cannot cover all timezones; running hourly + filtering inside the handler covers every tenant exactly once per day.
- Handler iterates tenants, computes their local hour from `AbTenantConfig.timezone`, sends only when local hour is **7** (one window per day per tenant). Vercel Cron is at-most-once; we accept rare duplicate digests rather than building idempotency tracking.
- Reuses `dashboard/overview` + `dashboard/agent-summary`. Composes a short Telegram message:
  > ☀️ Good morning, Maya. Cash $14,200 today, projected $18,400 by May 31.
  > **Heads up:** Acme is 32d overdue ($4,500). Tax in 12d.
  > /open to see the full dashboard.
- **Delivery:** Telegram if a chat is linked, else email via existing Resend setup. No-op if neither is configured.
- **Opt-out:** `AbTenantConfig.dailyDigestEnabled` (default `true`) — toggled in existing settings page. No `/quiet` chat command (would require bot-side command parsing).
- **Discoverability:** if `dailyDigestEnabled === true` but no Telegram chat linked, show a one-line dismissible hint in the dashboard kebab menu: "Get this summary at 7am — connect Telegram."

## 8. Persona behavior

No persona-specific templates. **Smart-hide-when-empty** handles all three personas naturally:

- **Maya** (CA consultant): Canadian tax deadlines (T1, GST/HST quarters) appear automatically; agency-only attention items don't show.
- **Alex** (US agency, timer-using): unbilled work surfaces, US quarterly estimated tax appears.
- **Jordan** (side-hustle): no timer → no unbilled work item; no Canadian content; minimal attention list.
- **Empty action queue:** "All clear ☕" panel — calm, not celebratory.
- **No upcoming receivables:** hero shows "No upcoming receivables" subtitle, no green markers.
- **Brand-new tenant** (no expenses, no invoices, no accounts beyond seeded defaults): hero replaced by a 3-step onboarding panel — "① Link bank account · ② Add first invoice · ③ Snap a receipt" — each step a tap target with a tick mark when done. Once at least one expense and one invoice exist, the normal hero takes over. This prevents Jordan from staring at "$0 → $0" on day one.

## 9. Loading & freshness

- One round-trip to the aggregator on mount.
- **Skeleton states** render section shells immediately; the page swaps in the real content when the response lands.
- **Pull-to-refresh** on mobile (inline implementation, no library); refresh button in kebab on desktop.
- No localStorage stale-while-revalidate in V1 — keeps cache invalidation out of the surface area; the dashboard is opened a few times per day, not as a real-time feed.

## 10. Error handling

Pragmatic, not over-engineered:

- Each subcomponent receives `{ data, error }` from its hook. If `error`, the section renders a quiet "—" or short "Couldn't load" line — no React error boundary plumbing.
- **Aggregator returns 500** (whole-page failure) → page shows header + sticky actions + one banner: "Couldn't reach AgentBook. [Retry]"
- **Aggregator returns partial data** (one slice missing) → that section is "—"; the rest renders normally.
- **LLM summary fails or times out (3s)** → deterministic fallback string. User never notices.

Errors are logged via the existing `console.error` path → Vercel function logs / browser logs.

## 11. Mobile interaction

- **Sticky bottom action bar** with `env(safe-area-inset-bottom)` padding for notched phones; 3 actions only (New Invoice, Snap, Ask).
- **Snap opens the camera directly** — `<input type="file" accept="image/*" capture="environment">` so tapping the icon brings up the rear camera in one tap, not a routed upload page. This is the table-stakes mobile receipt flow and the single biggest UX upgrade vs the current dashboard.
- **Pull-to-refresh** on the page container.
- **Tap a "next moment" card** → bottom sheet with detail (no navigation away).
- **Tap an attention item action** → either inline action (`postEndpoint`, fire-and-toast) or route via `href`.
- **Activity feed** paginated by tap-to-load-more (no infinite scroll — keeps scroll position predictable).
- Min tap target 44×44.
- Reduced motion respected.

## 12. Cut list (removed from current Dashboard.tsx)

- ❌ Telegram snapshot button — moved to kebab menu item ("Share to Telegram").
- ❌ Bell icon insight count — replaced by the inline attention panel.
- ❌ 4-card metric grid (Cash / Revenue / Expenses / Net Income) — replaced by hero cash + compact strip.
- ❌ Existing client-side `insights` array — replaced by attention panel + agent summary.
- ❌ Books-balanced status bar — folded into attention panel (only when out of balance).
- ❌ "Recent Expenses" list — replaced by unified activity feed.
- ❌ Quick-action pill row at top — replaced by sticky bottom bar / desktop header buttons (5 → 3 actions).

Untouched: route registration, plugin manifest, `/agentbook` URL, snapshot endpoint (still wired for the kebab menu).

## 13. Testing

### Unit (Vitest, co-located)

- **CashflowTimeline:** marker positions correct; out-of-window markers clipped.
- **NextMomentsList:** sorted ascending by date; capped at 4; correct icon mapping.
- **AttentionPanel:** empty state; ranking order (overdue invoices > tax-within-14d > unbilled > books-out-of-balance > missing-receipts); 5-item cap.
- **ThisMonthStrip:** delta sign and color; "—" when prior month is zero (no `Infinity%`); thousands separator.
- **ActivityFeed:** mixed item types render; empty state.
- **useDashboardOverview:** returns `{ data, error }` shape; sets `error` on non-2xx; resolves cleanly on partial payload.

### V1+ unit tests

- **agent-summary endpoint:** cache hit/miss against in-memory Map; fallback to deterministic when LLM rejects/times out (3s).
- **Recurring detection:** clustering algo with synthetic histories — *positive:* 3 monthly Uber Eats at 30d cadence (detected); *negative:* 3 unrelated single-occurrence expenses (not detected); *edge:* exactly 2 occurrences at 30d cadence (**not** detected — under the ≥3 threshold).
- **Morning digest:** timezone gating (only fires when tenant's local hour equals 7); integration test that one tenant with stub Telegram receives expected payload; tenant without Telegram or email is no-op (no error).

### Integration (Vitest + MSW)

`Dashboard.integration.test.tsx`:
- Happy path with mock aggregator payload.
- Aggregator returns partial payload (e.g. missing `attention`) → that section renders "—"; others render normally.
- Aggregator returns 500 → page renders header + sticky actions + "Couldn't reach AgentBook. [Retry]" banner.
- Empty tenant → 3-step onboarding panel renders in place of hero; no console errors.

### Backend (Vitest)

- `dashboard/overview`: tenant isolation; partial failures return partial payload (don't 500 the whole response).
- `dashboard/activity`: limit honored; sort order; types correctly mapped.

### E2E (Playwright, `tests/e2e/dashboard.spec.ts`)

- **Maya happy path:** login → land on `/agentbook` → assert timeline visible with ≥1 marker, attention panel rendered, this-month strip shows three numbers, activity feed has ≥1 item, sticky action bar visible at 375×812. Click "+ New invoice" → routes to invoice form. Asserts agent summary line is non-empty and is not the deterministic fallback string (proves LLM path live in CI).
- **Empty tenant:** register a fresh user → dashboard renders, no console errors, "All clear ☕" visible.

### Manual QA checklist

- 375×812, 390×844, 768×1024, 1280×800
- Light + dark theme
- iOS Safari pull-to-refresh
- Sticky bar with notch (`safe-area-inset-bottom`)
- Tab navigation reaches every interactive element

## 14. Rollout

Single PR, **no Prisma migration** (zero new tables — see §7 cuts):

1. Backend: aggregator + activity + agent-summary + recurring-outflows in overview + morning-digest endpoint + cron.
2. Frontend: new components, summary line wired to LLM endpoint, timeline shows recurring outflow markers, mobile camera capture wired into Snap action.
3. `vercel.json` cron entry (hourly).
4. Tests + manual QA + Vercel preview → smoke against Maya/Alex/Jordan → merge to main.

No feature flag — single page, single PR, revert if needed.

## 15. Out of scope (V2+)

- User-managed scheduled bills (manual add/edit) — auto-detection covers 80% at 20% cost.
- "Not recurring" suppression UI for auto-detected outflows — high-confidence threshold (≥3 occurrences) makes this rarely needed; revisit if real users complain.
- Persistent agent-summary cache (DB-backed) — in-memory cache is sufficient at current usage; revisit if cost forecasting indicates otherwise.
- Stale-while-revalidate from localStorage — add only if measured first-paint becomes a problem.
- Custom date range on "This month" strip.
- Persona-specific layouts (smart-empty handles it).
- Push notifications beyond Telegram/email digest.
- `/quiet` Telegram command (settings toggle covers the use case).

## 16. Open follow-ups

- **Outflow timeline completeness** — auto-detection covers monthly recurring; weekly/quarterly cadences and one-off bills (e.g. annual insurance) are not detected. Acceptable in V1; revisit when a user-managed scheduled-bills feature lands.
- **Mood label thresholds** ("healthy" / "tight" / "critical") — heuristic to be tuned with real data after V1 ships.
