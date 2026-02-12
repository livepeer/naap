# NaaP Platform

A plugin-based platform for the Livepeer AI Compute Network.

[![CI](https://img.shields.io/github/actions/workflow/status/livepeer/NaaP/ci.yml?branch=main&label=CI)](https://github.com/livepeer/NaaP/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

NaaP (Node as a Platform) is an open-source, plugin-based platform for
managing and interacting with the Livepeer AI Compute Network. Built with
Next.js 15, React 19, TypeScript, and a micro-frontend plugin architecture,
it enables independent teams to develop, deploy, and operate plugins without
central coordination. A Next.js shell hosts plugins as UMD bundles loaded at
runtime, backed by per-plugin microservices and a shared PostgreSQL database
with schema-level isolation.

## Quick Start

```bash
# Clone and run (~30s)
git clone https://github.com/livepeer/NaaP.git
cd NaaP
./bin/start.sh
```

This installs dependencies, starts a PostgreSQL database via Docker, runs
migrations, builds all plugin UMD bundles, and starts the platform.

Open **http://localhost:3000** when setup completes.

## Daily Development (after first setup)

```bash
./bin/start.sh                      # Smart start: auto-detects your changed plugins (~6s)
./bin/start.sh community            # Shell + one plugin backend (~6s)
./bin/start.sh gw community         # Shell + specific plugins (~6s)
./bin/start.sh --all                # Everything, all 12 plugins (~10s warm, ~25s cold)
./bin/stop.sh                       # Graceful stop (~2s)
```

Smart start is the default. It skips redundant DB syncs and verification,
and auto-detects which plugins you have changed since the last build --
starting only those plus the marketplace.

## Project Structure

```
NaaP/
├── apps/web-next/            # Next.js shell (auth, layout, plugin host)
├── services/
│   ├── base-svc/             # Core API (auth, teams, plugin registry)
│   └── plugin-server/        # Plugin asset server + CDN proxy
├── packages/
│   ├── database/             # Unified Prisma schema (single DB, multi-schema)
│   ├── plugin-sdk/           # SDK for plugin developers
│   ├── plugin-build/         # Shared Vite build config (createPluginConfig)
│   ├── plugin-utils/         # Shared auth/API utilities
│   ├── types/                # Shared TypeScript types
│   ├── ui/                   # Shared UI components
│   ├── cache/                # Redis caching + rate limiting
│   └── theme/                # Design tokens, Tailwind config
├── plugins/                  # 12 plugins (frontend + optional backend)
├── docker/                   # Docker configs, init-schemas.sql
├── bin/                      # Platform management scripts
└── docs/                     # Documentation
```

## For Plugin Developers

New plugin teams can be fully autonomous within a few minutes. Read the
[Plugin Team Guide](docs/PLUGIN_TEAM_GUIDE.md) for the complete self-service
onboarding process.

```bash
# Scaffold a new plugin
npx naap-plugin create my-plugin

# Start shell + your plugin (~6s)
./bin/start.sh my-plugin

# Or develop with hot reload
./bin/start.sh dev my-plugin
```

## Commands

**Everyday commands:**

| Command | Description | Time |
|---|---|---|
| `./bin/start.sh` | Smart start (auto-detects changed plugins) | ~6s |
| `./bin/start.sh <plugin>` | Shell + one plugin backend | ~6s |
| `./bin/stop.sh` | Graceful parallel stop | ~2s |
| `./bin/start.sh status` | Show status dashboard | instant |

**Full reference:**

| Command | Description |
|---|---|
| `./bin/start.sh` | First-time setup + start (setup is automatic) |
| `./bin/start.sh --all` | Start all services and plugins |
| `./bin/start.sh --no-plugins` | Shell + core only (no backends) |
| `./bin/start.sh --all` | All services, fastest possible |
| `./bin/start.sh dev <plugin>` | Dev mode with HMR for a single plugin |
| `./bin/start.sh validate` | Health-check all services |
| `./bin/start.sh logs <svc>` | Tail logs for a service |
| `./bin/start.sh help` | Show all options |

## Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | React 19, Next.js 15, Vite 6, TypeScript, Tailwind CSS |
| Backend | Node.js 20, Express, Prisma ORM, PostgreSQL |
| Monorepo | Nx workspace + npm workspaces |
| Plugin Loading | UMD bundles served via CDN (`/cdn/plugins/<name>/<version>/<name>.js`) |

## Architecture

The NaaP shell is a Next.js 15 application that dynamically loads plugins as
UMD bundles at runtime. Each plugin is an independent micro-frontend with its
own React component tree, optional Express backend, and isolated database
schema. The shell provides authentication, layout, routing, and a plugin SDK
with React hooks for inter-plugin communication.

Key design decisions:

- **Runtime plugin loading** -- plugins are built independently and served as
  UMD bundles via a CDN, allowing deploy-time composition without rebuilding
  the shell.
- **Multi-tenant RBAC** -- users and teams are scoped with role-based access
  control at the platform level.
- **Hybrid deployment** -- the shell and services run on Vercel + managed
  infrastructure, while plugin backends can run as standalone containers.

See [docs/architecture.md](docs/architecture.md) for the full architecture
reference.

## Contributing

We welcome contributions from everyone. Whether you are fixing a typo,
building a new plugin, or improving core infrastructure, there is a place
for you.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

## Governance

NaaP uses a lightweight governance model built on lazy consensus, plugin team
autonomy, and async-first coordination. Plugin teams have full authority over
their own directories. Core maintainers focus on shared infrastructure and
cross-cutting concerns.

See [GOVERNANCE.md](GOVERNANCE.md) for details.

## License

[MIT](LICENSE)
