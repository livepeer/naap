# Plugin Port Assignment — How It Works Today

## Ports Are Manually Declared, Not Auto-Assigned

Each plugin declares its own ports in its **`plugin.json`** file with three port fields:

| Field | Purpose | Example Range |
|-------|---------|---------------|
| `frontend.devPort` | Vite dev server | 3001–3117 |
| `backend.devPort` | Backend dev server | 4001–4117 |
| `backend.port` | Production backend | 4101–4217 |

There is **no automatic port allocator** — developers manually pick a unique port number when creating a plugin and must check existing `plugin.json` files and `packages/plugin-sdk/src/config/ports.ts` to avoid collisions.

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

Each plugin's backend server resolves its port in this priority:

1. **`process.env.PORT`** — set by `bin/start.sh` at launch time
2. **`plugin.json`** — reads `backend.devPort` as fallback
3. **Hardcoded default** — last resort (e.g., `4010`, `4112`)

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
| gateway-manager | 3001 | 4001 | 4101 |
| orchestrator-manager | 3002 | 4002 | 4102 |
| capacity-planner | 3003 | 4003 | 4103 |
| network-analytics | 3004 | 4004 | 4104 |
| marketplace | 3005 | 4005 | 4105 |
| community | 3006 | 4006 | 4106 |
| developer-api | 3007 | 4007 | 4107 |
| my-wallet | 3008 | 4008 | 4108 |
| my-dashboard | 3009 | 4009 | 4109 |
| plugin-publisher | 3010 | 4010 | 4110 |
| daydream-video | 3111 | 4111 | 4211 |
| lightning-client | 3112 | 4112 | 4212 |
| service-gateway | 3116 | 4116 | 4216 |
| deployment-manager | 3117 | 4117 | 4217 |
| dashboard-data-provider | 3020 | — | — |
| hello-world | 3020 | — | — |
| todo-list | 3021 | 4021 | 4021 |
| intelligent-dashboard | 3025 | — | — |

## Notable Gaps

- **`ports.ts` is incomplete** — it only covers ~11 plugins; newer ones like `service-gateway`, `lightning-client`, and `deployment-manager` are missing from the SDK's port registry.
- **No collision detection** — if two plugins declare the same port, you'll get a bind error at runtime.
- **No per-plugin `start.sh`** — individual plugins don't have their own start scripts; everything goes through the central `bin/start.sh`.
