# Pre-release E2E assessment (Playwright)

## What runs

| Suite | Command | Tags |
|--------|---------|------|
| GA (main 100-point rubric) | `npm run test:e2e:pre-release` | `@pre-release` (excludes `@appendix-preview`) |
| Appendix — preview plugins | `npm run test:e2e:appendix-preview` | `@appendix-preview` |

Run from `apps/web-next` with `PLAYWRIGHT_BASE_URL` pointing at the deployment under test (for example `https://naap-platform.vercel.app`).

```bash
cd apps/web-next
export PLAYWRIGHT_BASE_URL=https://naap-platform.vercel.app
export E2E_USER_EMAIL='you@example.com'
export E2E_USER_PASSWORD='***'

npm run test:e2e:pre-release
npm run pre-release:score
```

## Environment variables

| Variable | Purpose |
|----------|---------|
| `PLAYWRIGHT_BASE_URL` | Target origin; when not `localhost`, Playwright does not start `npm run dev`. |
| `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` | **Required** for authenticated flows (teams, plugins, developer API UI, cookie security check). Also used by `tests/auth.setup.ts` to populate `playwright/.auth/user.json` for the `chromium` / `mobile-chrome` projects. **Never commit values.** |
| `E2E_TEAM_ID` | Optional stable team UUID for team deep-link tests. |
| `E2E_PREVIEW_USER_EMAIL` / `E2E_PREVIEW_USER_PASSWORD` | **Appendix only** — account that can load `/wallet` and `/gateway` (plugins enabled in Marketplace or via preferences). |
| `E2E_ENFORCE_OVERVIEW_SLA` | Set to `1` to hard-fail overview cold/warm p75 thresholds (default is log-only). |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Optional; used by `authenticate as admin` setup (not part of the default pre-release grep). |

## Scoring helper

After a run, Playwright writes `test-results/results.json`. Summarize mapped rubric rows:

```bash
npm run pre-release:score
npm run pre-release:score:appendix   # after appendix suite only
```

Copy the CLI output into [docs/pre-release-assessment.md](pre-release-assessment.md) for the dated run section. The script is heuristic: adjust points in the doc when a test spans multiple rubric areas.

## Skips vs failures

- **Skipped** usually means missing env (for example no `E2E_USER_*`) or no team for the signed-in user. Treat as **evidence gap**, not a pass.
- **Failed** is a release blocker for that area until triaged.

## Security note

Automated checks cover headers, HTTPS, and cookie flags only. They do not replace a full security review or penetration test.
