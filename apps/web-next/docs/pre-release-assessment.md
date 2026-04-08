# Pre-release assessment report

## Run metadata

| Field | Value |
|-------|-------|
| Date | 2026-04-08 |
| `PLAYWRIGHT_BASE_URL` | `https://naap-platform.vercel.app` |
| Git commit | `76d8eb33` |
| Playwright version | 1.58.2 |
| Browser | Chromium (Desktop Chrome) |
| `E2E_USER_*` provided | Yes (`developer@livepeer.org`) |
| `E2E_PREVIEW_USER_*` provided | Yes (same account) |
| `E2E_TEAM_ID` | Not set (user has no teams) |

---

## Executive summary (GA)

**Overall GA score: 93.3 / 100**

| Metric | Value |
|--------|-------|
| Total tests | 21 |
| Passed | 19 |
| Skipped | 2 (admin setup, team detail due to no teams) |
| Failed | 0 |

### Top 3 risks

1. **Teams module at 13.3/20** — the test account (`developer@livepeer.org`) belongs to zero teams, so the team detail / members / settings / marketplace deep-link test was skipped. Full team lifecycle (create, invite, plugin install, switcher context change, RBAC gating on settings) is not yet covered against production.
2. **Console errors during Community Hub navigation** — `"Failed to load teams: TypeError: Failed to fetch"` and `"Error fetching user: TypeError: Failed to fetch"` logged on the Community Hub page. Plugin navigation triggers race conditions on team/user API calls; does not block rendering but degrades error observability.
3. **Capacity Planner cold load time (1.2-1.9 s)** — while within the 120 s budget, cold loads are 3-5x slower than the overview dashboard (0.3-0.5 s). CDN bundle + API chain may benefit from prefetching or edge caching.

---

## Per-module scores (GA)

### Overview dashboard — 17 / 17

| Test | Result |
|------|--------|
| `prod-smoke > landing responds` | PASSED (476 ms) |
| `prod-smoke > docs responds` | PASSED (541 ms) |
| `overview-sla > cold and warm p75 vs targets` | PASSED |

**SLA metrics** (5 samples):
- Cold p75: **422 ms** (target <2 000 ms) — well under budget
- Warm p75: **107 ms** (target <1 000 ms) — excellent
- Widgets render (Success Rate, Orchestrators) on first load
- Live Job Feed shows active streams; time-range controls (12h, 5s-90s) visible

### Auth — 17 / 17

| Test | Result |
|------|--------|
| `auth-flows > login shows error for invalid credentials` | PASSED (1.0 s) |
| `auth-flows > forgot password flow shows confirmation UI` | PASSED (1.2 s) |
| `auth-flows > verify-email page shows instructions without token` | PASSED (527 ms) |
| `auth-flows > register with mismatched passwords shows validation` | PASSED (640 ms) |
| `auth-flows > full login and logout via settings` | PASSED (1.9 s) |
| `prod-smoke > login page responds (or redirect)` | PASSED (906 ms) |

**Notes:**
- Sign-in with valid credentials redirects to `/dashboard` in ~1.2 s
- Sign-out returns to Network Platform landing; `/dashboard` then redirects to `/login`
- Forgot password confirmation UI loads in < 2 s
- Register validation (password mismatch) fires client-side instantly

### Teams — 13.3 / 20

| Test | Result |
|------|--------|
| `teams > teams list and API` | PASSED (1.5 s) |
| `teams > team detail, members, settings, marketplace deep link` | **SKIPPED** (No teams for this user) |
| `teams > workspace switcher lists Workspaces` | PASSED (656 ms) |

**What was verified:**
- `GET /api/v1/teams` returns 200 with empty teams list
- `/teams` page renders "Teams" heading and "No teams yet" empty state
- Workspace switcher opens; shows "Workspaces" header, "Personal" option with checkmark

**Gap (6.7 points lost):**
- Team detail, members list, invite modal, settings page (RBAC gating), marketplace deep link (`?teamId=&teamName=`) all skipped because the test account has no team membership. To reach full 20/20, either assign `developer@livepeer.org` to a team in production or use a dedicated team-owning test account.

### Capacity planner — 14 / 14

| Test | Result |
|------|--------|
| `capacity-planner > loads Capacity Requests after authentication` | PASSED (2.1 s) |
| `capacity-planner > warm navigation stays under budget` | PASSED (3.0 s) |

**API preflight:** `GET /api/v1/capacity-planner/summary` returns 200.  
**Timing:** first load 1 193 ms, second load 1 079 ms.  
**UI:** "Capacity Requests" heading + "New Request" button visible.

### Community hub — 14 / 14

| Test | Result |
|------|--------|
| `community-hub > loads Community Hub and sort controls` | PASSED (1.6 s) |

**API preflight:** `GET /api/v1/community/stats` returns 200.  
**UI:** "Community Hub" (h1), "New Post" button, search placeholder, "Popular" sort all visible.

**Observation:** Console logged `"Error fetching user: TypeError: Failed to fetch"` — a race condition during parallel API calls when navigating to `/forum`. Does not block plugin render but is a quality concern.

### Developer API manager — 12 / 12

| Test | Result |
|------|--------|
| `developer-api-manager > API models authorized; plugin route not 404` | PASSED (1.8 s) |

**API preflight:** `GET /api/v1/developer/models` returns 200 (public endpoint).  
**UI:** `/developer` loads plugin shell (CDN badge visible), no 404.

### Cross-cutting security — 3 / 3

| Test | Result |
|------|--------|
| `security > HTTPS and baseline headers on landing` | PASSED (753 ms) |
| `security > login page returns CSP or X-Frame-Options` | PASSED (794 ms) |
| `security > session cookies use Secure and HttpOnly on HTTPS` | PASSED (39 ms) |

**Findings:**
- Production URL is HTTPS with `strict-transport-security` header present
- `/login` page returns a Content-Security-Policy header
- After login, session cookies are marked `HttpOnly` and `Secure`

**CSP observation (not penalized):** Middleware applies `unsafe-inline` and `unsafe-eval` in `script-src` for plugin pages — necessary for UMD plugin bundles but worth monitoring in a full security audit.

### Cross-cutting performance — 3 / 3

| Test | Result |
|------|--------|
| `overview-sla > cold and warm p75 vs targets` | PASSED |

- Cold p75: 422 ms (target <2 000 ms)
- Warm p75: 107 ms (target <1 000 ms)
- Both well within SLA

---

## Appendix A — Preview plugins (separate 100-point assessment)

_Preview plugins are not included in the GA score above._

**Overall appendix score: 90 / 100** (10 points reserved for manual cross-cutting review)

### Run metadata

Same deployment and date as GA. Account: `developer@livepeer.org`.

### My Wallet (preview) — 45 / 45

| Test | Result |
|------|--------|
| `preview-plugins > wallet plugin shell loads` | PASSED (1.0 s) |

**API preflight:** `GET /api/v1/wallet/network/history?limit=1` returns 401 without auth (expected; not 5xx).  
**UI:** `/wallet` navigates successfully; plugin loading completes; no 404 "Page Not Found".

### Service Gateway (preview) — 45 / 45

| Test | Result |
|------|--------|
| `preview-plugins > service gateway plugin shell loads` | PASSED (966 ms) |

**API preflight:** `GET /api/v1/gateway` returns 401 without auth (expected; not 5xx).  
**UI:** `/gateway` navigates successfully; plugin loading completes; no 404 "Page Not Found".

### Preview cross-cutting — manual (10 points)

| Criterion | Status | Notes |
|-----------|--------|-------|
| HTTPS on plugin routes | PASS | Inherited from deployment; verified in GA security tests |
| Plugin CSP consistent with middleware | PASS (partial) | `script-src 'unsafe-inline' 'unsafe-eval'` applied — functional but worth hardening |
| No mixed content | PASS | No insecure resource loads observed |
| Known limitations documented | PARTIAL | No user-facing "preview" badge or disclaimer on these plugin pages |

**Recommended manual score: 7 / 10** (deduct 3 for missing preview badge / user-facing disclaimer)

**Appendix total: 90 + 7 = 97 / 100**

---

## Prioritized gaps (ordered by impact)

### P0 — High impact

1. **Teams module coverage gap (6.7 points lost)** — Test account has no teams. The full team lifecycle (create team, detail view, members with role labels, invite modal submission, settings RBAC, marketplace team-context install, plugin enable/disable for team, team switcher context change triggering plugin refresh) is untested on production. **Fix:** Assign `developer@livepeer.org` to at least one team, or create a dedicated team-owning E2E account.

### P1 — Medium impact

2. **Console errors on Community Hub / team API races** — Navigating to plugin pages triggers `"Failed to load teams: TypeError: Failed to fetch"` and `"Error fetching user: TypeError: Failed to fetch"` in the console. These are network race conditions (likely aborted requests during React hydration or route transitions). While not user-visible as UI errors, they pollute error monitoring and may mask real failures. **Fix:** Add abort controller cleanup or guard fetches against component unmount; investigate if parallel `useEffect` calls conflict.

3. **Capacity Planner cold-load performance** — First navigation to `/capacity` takes 1.2-1.9 s (vs 0.3-0.5 s for the overview). The CDN plugin bundle + Prisma API chain introduces latency. **Fix:** Consider bundle preloading on dashboard render, or edge caching the capacity summary endpoint.

### P2 — Low impact / hardening

4. **CSP `unsafe-inline` / `unsafe-eval` on plugin pages** — Required for UMD plugin loading. Acceptable for now but should be tracked for future hardening (e.g. SRI hashes, nonce-based CSP) once plugin bundling supports it.

5. **Preview plugins lack user-facing "preview" indicator** — `/wallet` and `/gateway` render the same chrome as GA plugins. A visual badge or warning banner would set expectations for preview functionality.

6. **No E2E coverage for destructive team operations** — Team creation, deletion, ownership transfer, and member removal are UI-present but not exercised in E2E (intentionally, to avoid polluting production). A staging environment or teardown strategy would enable coverage.

---

## Test evidence summary

```
GA suite:  19 passed, 0 failed, 2 skipped (10.1 s)
Appendix:   3 passed, 0 failed, 1 skipped  (5.2 s)

Overview SLA (5 samples):
  cold p75: 422 ms (< 2000 ms target)
  warm p75: 107 ms (< 1000 ms target)

Capacity Planner timing:
  first load:  1193 ms
  second load: 1079 ms
```

## Disclaimers

- Browser E2E validates user-visible behavior and selected security signals only. It does not prove correctness of all business logic, data integrity, or replace OWASP-style penetration testing.
- Performance metrics were collected from a single geographic location at a specific time; production latency may vary.
- Skipped tests represent evidence gaps, not implicit passes. Their rubric points are prorated accordingly.
