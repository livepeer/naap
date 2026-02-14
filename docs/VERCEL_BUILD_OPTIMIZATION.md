# Vercel Build Optimization Guide

Current Vercel build time: **~1m 36s** (target). Main builds exceeded 2m after switching to `npm ci` — see "What Went Wrong" below.

## What Went Wrong (Feb 2026)

Switching `installCommand` from `npm install` to `npm ci` **slowed builds**. `npm ci` deletes `node_modules` before installing, which bypasses Vercel's automatic `node_modules` cache. Every build became a full reinstall instead of an incremental update. **Use `npm install`** to restore cache benefits.

## Build Pipeline Breakdown

The `vercel-build.sh` pipeline runs (in order):

1. **plugin-build** (tsc) — ~2–5s
2. **Plugin UMD bundles** (11 plugins, Vite) — **~30–60s** (largest contributor)
3. **Copy bundles** — ~1s
4. **Prisma db push** (network) — ~5–15s
5. **Next.js build** — ~30–50s
6. **sync-plugin-registry** — ~2–5s

---

## High-Impact Improvements

### 1. Enable Nx Cloud or Turborepo Remote Caching (biggest win)

**Impact: Up to 80% reduction on cache hits** (Vercel’s own benchmark).

- **Nx Cloud** (you already use Nx): Add `nx-cloud` and connect to Nx Cloud. Caches plugin builds and Next.js outputs across deploys. Free tier available.
- **Turborepo**: Migrate to Turborepo and use Vercel’s built-in remote cache.

```bash
# Nx Cloud (minimal config)
npx nx connect
```

### 2. Use Vercel’s Build Cache Effectively

- **`ENABLE_ROOT_PATH_BUILD_CACHE=1`** — Vercel enables this for monorepos, which caches `node_modules` recursively.
- **Next.js `.next/cache`** — Ensure `outputFileTracing` and incremental builds are on; avoid clearing `.next` between steps.
- **Verify caching**: In Project Settings → General, ensure “Build Cache” is enabled.

### 3. Reduce Plugin Build Time

- **Parallel builds**: `build-plugins.sh --parallel` is already used.
- **Source-hash cache**: Skips unchanged plugins when the local `.build-hash` matches.
- **Preview vs production**: Previews only build changed plugins; production always builds all.
- **Fewer plugins**: Merge PR 87 (move 6 plugins to examples) to cut builds from 11 → 5 plugins.

### 4. Skip Prisma db push for Unchanged Schema

`vercel-build.sh` already skips `prisma db push` for preview builds when the schema is unchanged. Ensure `VERCEL_GIT_PREVIOUS_SHA` is set for preview deploys so the diff check works.

### 5. `installCommand` — Use `npm install`, not `npm ci`

**npm ci slows Vercel builds.** It removes `node_modules` before installing, bypassing Vercel's automatic cache. Use `npm install --include=dev` so Vercel can cache dependencies between deploys.

### 6. Narrow the Upload Surface

- **`.vercelignore`**: Exclude everything not needed for the build (e.g. `examples/`, `docs/`, test files). Already in place.
- **Root `package.json`**: Avoid pulling in heavy dev tools that aren’t used during the build.

---

## Quick Wins (Low Effort)

| Action | Expected savings | Status |
|--------|------------------|--------|
| Enable Nx Cloud | 30–60s on cache hits | Manual: `npx nx connect` |
| Use `npm install` (not npm ci) | Restore cache | ✓ npm ci breaks Vercel cache |
| Merge PR 87 (fewer plugins) | 20–40s | Pending |
| Ensure Vercel Build Cache is on | 10–30s on cache hits | Check project settings |

---

## Medium-Term (Higher Effort)

1. **Turborepo migration**: Replace the custom `vercel-build.sh` with a `turbo run build` pipeline and use Vercel’s remote cache.
2. **Build plugins in a separate job**: Build plugin bundles in CI, store as artifacts, and consume them in Vercel (more complex setup).
3. **Incremental Next.js**: Ensure `next build` uses `SWC` and `experimental.optimizePackageImports` where applicable.

---

## Monitoring

- Vercel: Deployments → Build logs → timing per step.
- Compare builds with and without cache to quantify improvements.
