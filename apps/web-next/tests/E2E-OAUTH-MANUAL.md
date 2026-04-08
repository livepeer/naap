# Manual OAuth and email verification sign-off (production)

Automated Playwright OAuth specs (`tests/oauth.spec.ts`, tag `@oauth`) are **skipped by default** and **excluded in CI** (`grepInvert: /@oauth/`). Google and GitHub often block scripted browsers; email verification requires a real inbox.

**Regression guard (Google/GitHub session shape):** `tests/oauth-session-dashboard.spec.ts` runs when `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` are set (same as `auth.setup.ts`). It checks that `/dashboard` renders **Network Platform** when the session exists only as **cookies** (API login) and after **localStorage `naap_auth_token` is cleared** (same client behavior as right after OAuth callback). It does not complete Google/GitHub in the browser; use `oauth.spec.ts` with `RUN_OAUTH_E2E=1` for provider redirects.

```bash
cd apps/web-next
E2E_USER_EMAIL=... E2E_USER_PASSWORD=... npx playwright test oauth-session-dashboard.spec.ts
# Against production:
PLAYWRIGHT_BASE_URL=https://naap-platform.vercel.app E2E_USER_EMAIL=... E2E_USER_PASSWORD=... npx playwright test oauth-session-dashboard.spec.ts
```

Use this matrix for **manual** pre-release checks against `https://naap-platform.vercel.app` (or staging).

## Environment

- Browser: Chrome (desktop) and one mobile Safari or Chrome.
- Test account for inbox verification: **qiang@livepeer.org** (or dedicated disposable for repeated runs).

## Sign-up and verification (email)

| Step | Action | Pass criteria |
|------|--------|----------------|
| 1 | Open `/register`, register with **qiang@livepeer.org** + strong password | Redirect to `/verify-email`, copy shows “Verify your email” |
| 2 | Check inbox (and spam) for verification mail | Message received from your configured provider (e.g. Resend) |
| 3 | Click verification link | Lands on `/verify-email?token=…`, then success → redirect to login |
| 4 | Log in with same password | Session works; `/dashboard` loads |

## Sign-up / sign-in (Google)

| Step | Action | Pass criteria |
|------|--------|----------------|
| 1 | `/register` → **Google** | Redirect to Google consent; after consent, session created |
| 2 | Sign out, `/login` → **Google** | Same account can sign in again |

## Sign-up / sign-in (GitHub)

| Step | Action | Pass criteria |
|------|--------|----------------|
| 1 | `/register` → **GitHub** | Redirect to GitHub; authorize; session created |
| 2 | Sign out, `/login` → **GitHub** | Repeat sign-in works |

## Optional automated smoke (local / staging only)

```bash
cd apps/web-next
RUN_OAUTH_E2E=1 npx playwright test oauth.spec.ts
```

Do **not** rely on this for production sign-off unless the run consistently reaches the provider without interstitials.

## CI note

To include `@oauth` in a dedicated job, set `CI=` empty or override `grepInvert`, and provide `RUN_OAUTH_E2E=1` plus stable test users (often requires Google “test users” and a dedicated GitHub OAuth app).
