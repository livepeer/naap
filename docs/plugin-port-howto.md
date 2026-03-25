# Plugin Port Assignment — How It Works Today

## Ports Are Manually Declared, Not Auto-Assigned

Each plugin declares its own ports in its **`plugin.json`** file with three port fields:

| Field | Purpose | Example Range |
|-------|---------|---------------|
| `frontend.devPort` | Vite dev server | 3001–3117 |
| `backend.devPort` | Backend dev server | 4001–4117 |
| `backend.port` | Production backend | 4101–4217 |

There is **no automatic port allocator** — developers manually pick a unique port number when creating a plugin and must check existing `plugin.json` files to avoid collisions. The file `packages/plugin-sdk/src/config/ports.ts` contains a legacy/partial registry; scan all `plugin.json` files first as the primary source of truth, then optionally check `ports.ts` for legacy entries.

## How `bin/start.sh` Uses Them

The central orchestration script `bin/start.sh` reads ports from each plugin's `plugin.json` at startup using two helper functions:

- `get_plugin_frontend_port()` — parses `frontend.devPort` from `plugin.json`
- `get_plugin_backend_port()` — parses `backend.devPort` from `plugin.json`

When launching a backend, it passes the port via the `PORT` environment variable:

```bash
setsid env DATABASE_URL="$UNIFIED_DB_URL" PORT="$port" npm run dev > "$LOG_DIR/${name}-svc.log" 2>&1 &
```

For frontends, it passes the port to Vite:

```bash
npx vite --port "$fport" --strictPort
```

## Port Resolution Order in Backend Code

Most plugin backends (capacity-planner, community, developer-api, lightning-client, marketplace, plugin-publisher) resolve their port in this priority:

1. **`process.env.PORT`** — set by `bin/start.sh` at launch time
2. **`plugin.json`** — reads `backend.devPort` as fallback
3. **Hardcoded default** — last resort (e.g., `4010`, `4112`)

**Exceptions:** `service-gateway` skips `plugin.json` and resolves directly from `process.env.PORT` to its hardcoded default.

## Override Points

For **core services**, `bin/start.sh` supports env var overrides:

| Env Var | Default | Service |
|---------|---------|---------|
| `SHELL_PORT` | 3000 | Shell (Next.js) |
| `BASE_SVC_PORT` | 4000 | Base service |
| `PLUGIN_SERVER_PORT` | 3100 | Plugin server |

For **plugin backends**, you can override by setting `PORT` before launch, but in practice `bin/start.sh` always reads from `plugin.json`.

## Current Port Matrix (from `plugin.json`)

| Plugin | Frontend devPort | Backend devPort | Backend port (prod) |
|--------|------------------|-----------------|---------------------|
| gateway-manager *(deprecated)* | 3001 | 4001 | 4101 |
| orchestrator-manager *(deprecated)* | 3002 | 4002 | 4102 |
| capacity-planner | 3003 | 4003 | 4103 |
| network-analytics *(deprecated)* | 3004 | 4004 | 4104 |
| marketplace | 3005 | 4005 | 4105 |
| community | 3006 | 4006 | 4106 |
| developer-api | 3007 | 4007 | 4107 |
| my-wallet | 3008 | 4008 | 4108 |
| my-dashboard | 3009 | 4009 | 4109 |
| plugin-publisher | 3010 | 4010 | 4110 |
| daydream-video | 3111 | 4111 | 4211 |
| lightning-client | 3112 | 4112 | 4212 |
| service-gateway | 3116 | 4116 | 4216 |
| dashboard-data-provider | 3020 | — | — |
| hello-world *(deprecated)* | 3020 | — | — |
| todo-list *(deprecated)* | 3021 | 4021 | 4021 |
| intelligent-dashboard | 3025 | — | — |

> **Known conflict:** `dashboard-data-provider` and `hello-world` both declare `devPort: 3020`. This is a legacy collision — `hello-world` is a deprecated example plugin and will be removed. There is no runtime collision detection; if two plugins with the same port run simultaneously, one will fail to bind.

## Vercel Production — Ports Don't Exist

On Vercel, **plugin backends do not run as separate servers**. There are no listening ports. The architecture is fundamentally different from local dev.

### How It Works

NaaP uses a **hybrid deployment model** (defined in `apps/web-next/src/lib/env.ts`):

| Component | Runs on Vercel | Runs off-Vercel |
|-----------|---------------|-----------------|
| Next.js shell + plugin frontends | Yes | — |
| Plugin API routes | Yes (as Serverless Functions) | — |
| base-svc (auth, teams, RBAC) | — | Yes (port 4000) |
| plugin-server (UMD assets) | — | Yes (port 3100) |
| livepeer-svc, pipeline-gateway | — | Yes |

### Plugin API Routing on Vercel

Plugin APIs are implemented as **Next.js API route handlers** under `apps/web-next/src/app/api/v1/`. Each deploys as a Vercel Serverless Function — no ports, no Express servers.

```text
Browser
  → https://your-app.vercel.app/api/v1/wallet/portfolio
  → Next.js route handler (apps/web-next/src/app/api/v1/wallet/portfolio/route.ts)
  → Prisma / DB / business logic
  → Response
```

### The Catch-All Proxy (`/api/v1/[plugin]/[...path]`)

A catch-all route at `apps/web-next/src/app/api/v1/[plugin]/[...path]/route.ts` acts as a fallback proxy. It resolves plugin URLs using this logic:

1. Check for an **env-var override** (e.g., `GATEWAY_MANAGER_URL`, `COMMUNITY_URL`)
2. Fall back to `http://localhost:{devPort}` from the port map

The env-var override map:

| Plugin | Env Var |
|--------|---------|
| gateway-manager *(deprecated)* | `GATEWAY_MANAGER_URL` |
| orchestrator-manager *(deprecated)* | `ORCHESTRATOR_MANAGER_URL` |
| capacity-planner | `CAPACITY_PLANNER_URL` |
| network-analytics *(deprecated)* | `NETWORK_ANALYTICS_URL` |
| marketplace | `MARKETPLACE_URL` |
| community | `COMMUNITY_URL` |
| my-wallet | `WALLET_URL` |
| my-dashboard | `DASHBOARD_URL` |
| daydream-video | `DAYDREAM_VIDEO_URL` |
| developer-api | `DEVELOPER_API_URL` |
| plugin-publisher | `PLUGIN_PUBLISHER_URL` |

Short aliases also work (e.g., `/api/v1/wallet/...` resolves to `my-wallet`).

### The Vercel Guard

When running on Vercel (`VERCEL === '1'`), if a request reaches the catch-all and the resolved URL is still `localhost`, it **returns 501** instead of attempting the proxy:

```text
501 Not Implemented
"Endpoint /api/v1/{plugin}/{path} is not yet available in this environment.
 A dedicated Next.js route handler is needed."
```

This means every plugin endpoint that should work on Vercel **must have a dedicated route handler** under `apps/web-next/src/app/api/v1/`. The catch-all is not a production path — it's a dev convenience and a hybrid-deployment escape hatch.

### base-svc Proxy

The base service (auth, teams, plugin registry) is always off-Vercel. The route `apps/web-next/src/app/api/v1/base/[...path]/route.ts` proxies to it:

```typescript
const BASE_SVC_URL = process.env.BASE_SVC_URL || 'http://localhost:4000';
```

On Vercel, `BASE_SVC_URL` **must** be set to the deployed base-svc host. Without it, all auth/team/registry calls fail.

### Plugin Frontend Assets

Plugin UMD bundles are **not served by plugin-server** on Vercel. Instead:

1. `bin/vercel-build.sh` copies built bundles to `apps/web-next/public/cdn/plugins/`
2. Vercel serves them as static files
3. `vercel.json` rewrites `/plugin-assets/:path*` → `/cdn/plugins/:path*`
4. Plugin discovery uses `cdnBase: '/cdn/plugins'` for bundle URLs

### `vercel.json` — Function Limits

Each API route category has its own Serverless Function config:

| Route Pattern | maxDuration | Memory |
|---------------|-------------|--------|
| `app/api/v1/auth/**` | 30s | default |
| `app/api/v1/base/**` | 60s | default |
| `app/api/v1/livepeer/**` | 60s | default |
| `app/api/v1/pipelines/**` | 120s | default |
| `app/api/v1/storage/**` | 60s | 1024 MB |
| `app/api/v1/gw/**` | 60s | default |
| `app/api/v1/[plugin]/**` | 30s | default |

### Summary: Local Dev vs Vercel Production

| Aspect | Local Dev | Vercel Production |
|--------|-----------|-------------------|
| Plugin backends | Separate Express servers (ports 4001–4117) | Next.js API route handlers (Serverless Functions) |
| Port resolution | `plugin.json` → `devPort` | Not applicable — no ports |
| Plugin frontends | plugin-server (port 3100) | Static files at `/cdn/plugins/` |
| base-svc | `localhost:4000` | Proxied via `/api/v1/base/*` → `BASE_SVC_URL` |
| Catch-all proxy | Proxies to `localhost:{port}` | Returns 501 if route handler is missing |
| URL from frontend JS | `getPluginBackendUrl()` → `http://localhost:{port}` | Same-origin `/api/v1/{plugin}` |

## Notable Gaps

- **`ports.ts` is legacy/optional** — `packages/plugin-sdk/src/config/ports.ts` only covers ~11 plugins and is not the source of truth. Scan all `plugin.json` files for the authoritative port matrix. Newer plugins like `service-gateway` and `lightning-client` are missing from `ports.ts`.
- **No collision detection** — if two plugins declare the same port, you'll get a bind error at runtime.
- **No per-plugin `start.sh`** — individual plugins don't have their own start scripts; everything goes through the central `bin/start.sh`.
