# NAAP Platform CLI

All platform management goes through a single script: **`./bin/start.sh`**.

## TL;DR

```bash
# First time (after git clone)
./bin/setup.sh --start          # installs deps, starts DB, builds plugins, starts platform

# Daily development (6 seconds)
./bin/start.sh --fast           # smart: auto-detects your changed plugins
./bin/start.sh community        # shell + one plugin
./bin/start.sh stop             # parallel stop (~2s)
```

---

## Setup (first time only)

```bash
./bin/setup.sh           # install deps, start DB, build plugins
./bin/setup.sh --start   # same, then start the platform immediately
```

You only run this once after cloning. After that, use `start.sh` for everything.

---

## Starting the Platform

### Recommended: `--fast` (daily driver)

```bash
./bin/start.sh --fast
```

This is the command you will use 90% of the time. It:
- Skips redundant DB sync and plugin verification
- Auto-detects which plugins you changed since last build
- Rebuilds only the changed plugin(s)
- Starts shell + marketplace + your changed plugin backends
- If nothing changed, starts shell only

**Typical time: 6-8 seconds.**

### Start specific plugins by name

```bash
./bin/start.sh community                  # shell + community backend
./bin/start.sh gateway-manager community  # shell + 2 backends
./bin/start.sh community --fast           # same, skip DB sync + verify
```

Just type the plugin name(s) as arguments. No flags needed.

**Typical time: 6-8 seconds.**

### Start everything

```bash
./bin/start.sh start --all           # all 12 plugins + shell + core
./bin/start.sh start --all --fast    # same, skip checks (fastest)
```

**Typical time: ~10s warm, ~25s cold (first build).**

### Shell only (no plugin backends)

```bash
./bin/start.sh                    # shell + core services
./bin/start.sh start --no-plugins # explicit form
```

All plugin UIs still load (via CDN bundles), but no backend APIs are running.

**Typical time: 5-6 seconds.**

### Dev mode (HMR for a single plugin)

```bash
./bin/start.sh dev daydream-video
```

Starts the plugin with Vite HMR (hot module replacement) for instant feedback during frontend development.

---

## Stopping

```bash
./bin/start.sh stop                     # stop everything (~2s)
./bin/start.sh stop community           # stop one plugin backend
./bin/start.sh stop --plugins           # stop all plugin backends
./bin/start.sh stop --shell             # stop shell only
./bin/start.sh stop --infra             # also stop Docker containers
```

All stops are parallel -- 15 services stop in ~2 seconds.

---

## Before Pushing

Pre-push validation runs automatically (installed by `./bin/setup.sh`):

- Builds `@naap/plugin-build` (required for plugin vite configs)
- Runs plugin-sdk tests

```bash
npm run ci-check          # Run manually (~15-30s)
npm run ci-check:full     # Full vercel-build (~2 min)
git push --no-verify      # Skip hook when needed
```

---

## Other Commands

| Command | Description |
|---------|-------------|
| `./bin/start.sh status` | Show what is running (ports, PIDs, uptime) |
| `./bin/start.sh watch` | Live dashboard (auto-refreshes every 5s) |
| `./bin/start.sh validate` | Full health check of all services + DB + CDN |
| `./bin/start.sh restart community` | Restart a specific plugin |
| `./bin/start.sh restart --services` | Restart core services |
| `./bin/start.sh logs base-svc` | Tail logs for a service |
| `./bin/start.sh list` | List all available plugins |
| `./bin/start.sh help` | Show all options |

---

## Flags Reference

| Flag | Effect |
|------|--------|
| `--fast` | Skip DB sync + verification, auto-detect changed plugins |
| `--timing` | Show per-phase timing breakdown after startup |
| `--all` | Start all plugin backends |
| `--no-plugins` | Start shell + core only, no backends |
| `--only=p1,p2` | Start only named plugin backends |
| `--clean` | Delete `.next` cache before starting shell |
| `--skip-verify` | Skip plugin CDN accessibility checks |
| `--skip-db-sync` | Skip `prisma generate` / `prisma db push` |
| `--deep-check` | Run deep API health checks on backends |
| `--sequential` | Force sequential backend startup (debug) |

Flags can be combined: `./bin/start.sh start --all --fast --timing`

---

## Performance Benchmarks

Measured on a typical dev machine (Apple Silicon, plugins already built):

| Scenario | Start | Stop |
|----------|-------|------|
| `--fast` (no changes) | **6s** | **2s** |
| `--fast` (1 plugin changed) | **8s** | **2s** |
| Single plugin (`community`) | **6s** | **2s** |
| Two plugins (`gw na`) | **8s** | **2s** |
| Shell only (`--no-plugins`) | **5s** | **2s** |
| All plugins (`--all`, warm) | **10s** | **2.5s** |
| All plugins (`--all`, cold build) | **25-27s** | **2.5s** |

Cold build = first time after clone (all 12 plugin UMD bundles must be compiled).

---

## Typical Developer Workflows

### Plugin developer (most common)

```bash
# Morning: pull latest, start working on your plugin
git pull
./bin/start.sh --fast           # detects your changes, starts what you need

# Make code changes... plugin rebuilds automatically on next start

# End of day
./bin/start.sh stop
```

### Working on a specific plugin

```bash
./bin/start.sh community        # shell + community backend
# or with HMR:
./bin/start.sh dev community    # shell + community with hot reload
```

### Testing everything together

```bash
./bin/start.sh start --all --timing   # start all, see timing breakdown
./bin/start.sh validate               # run full health checks
```

### Quick iteration cycle

```bash
./bin/start.sh stop && ./bin/start.sh --fast   # full restart in ~8s
```

---

## Port Assignments

**Core Services:**

| Service | Port |
|---------|------|
| Shell (Next.js) | 3000 |
| Plugin Server | 3100 |
| Base Service | 4000 |

**Plugin Backends (from plugin.json):**

| Plugin | Port |
|--------|------|
| Gateway Manager | 4001 |
| Orchestrator Manager | 4002 |
| Capacity Planner | 4003 |
| Network Analytics | 4004 |
| Marketplace | 4005 |
| Community Hub | 4006 |
| Developer API | 4007 |
| My Wallet | 4008 |
| My Dashboard | 4009 |
| Plugin Publisher | 4010 |
| Daydream AI Video | 4111 |

---

## Troubleshooting

### Port already in use

```bash
./bin/start.sh stop             # cleans up all platform processes
# or manually:
lsof -ti:3000 | xargs kill
```

### Plugin not loading in the shell

```bash
# Check if the CDN bundle exists
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/cdn/plugins/community/1.0.0/community.js
# Should return 200

# If 404, rebuild:
./bin/start.sh start --all      # rebuilds any missing plugins
```

### Services not starting

```bash
./bin/start.sh status           # see what is running
./bin/start.sh logs base-svc    # check logs
./bin/start.sh validate         # full diagnostics
```

### Database issues

```bash
cd packages/database
npx prisma db push              # push schema to DB
npx prisma studio               # open GUI
```

---

## Other Scripts

| Script | Purpose |
|--------|---------|
| `setup.sh` | First-time setup (deps, DB, build) |
| `build-plugins.sh` | Build all plugin UMD bundles |
| `health-monitor.sh` | Background service health daemon (started automatically) |
| `smoke.sh` | Run smoke tests against running services |

---

## Requirements

- **Node.js** 20+
- **npm** 10+
- **Docker** (for PostgreSQL)
- **Bash** 3.2+ (macOS default)
