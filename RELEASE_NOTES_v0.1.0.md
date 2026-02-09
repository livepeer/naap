# NAAP v0.1.0 — Initial MVP Release

**Release Date:** February 9, 2026
**Tag:** `v0.1.0`

---

## What is NAAP?

**NAAP (Node as a Platform)** is an open-source, plugin-based platform for managing and interacting with the **Livepeer AI Compute Network**. It provides a unified shell application where independent teams can build, publish, and run plugins — each with its own frontend, backend, and database schema — all orchestrated by a single CLI.

Think of it as an extensible control plane for the decentralized AI compute economy: operators manage gateways and orchestrators, developers integrate AI models via API keys, community members discuss governance, and everyone benefits from a shared plugin marketplace.

---

## Highlights

- **11 production-ready plugins** covering wallet management, network monitoring, AI video, developer APIs, community forums, and more
- **Full plugin SDK** with React hooks, backend utilities, CLI scaffolding, and UMD build tooling
- **Unified database architecture** — single PostgreSQL instance with schema-level isolation per plugin
- **One-command setup** — `./bin/setup.sh --start` gets you from clone to running platform in under 3 minutes
- **Comprehensive documentation site** with guides, API reference, examples, and AI-assisted development prompts
- **Plugin marketplace** for discovering, installing, and publishing plugins

---

## Core Platform Services

### Shell Application (`apps/web-next`)

The Next.js 15 shell is the entry point for all users. It dynamically loads plugins as UMD bundles at runtime, providing:

- **Authentication** — Email/password, OAuth (Google, GitHub), and Web3 wallet login
- **Role-Based Access Control (RBAC)** — System roles, plugin-scoped roles, and granular permissions
- **Dynamic navigation** — Sidebar auto-populates from registered plugins, ordered by plugin manifest
- **Theme system** — Dark/light mode with shared design tokens (`@naap/theme`)
- **Plugin isolation** — Each plugin runs in its own React context with controlled access to shell services

### Base Service (`services/base-svc`)

The central API gateway providing 10+ route modules:

| Module | Capabilities |
|--------|-------------|
| **Auth** | Email/password + OAuth login, session management, JWT tokens |
| **RBAC** | Role CRUD, permission checks, plugin admin delegation |
| **Registry** | Marketplace browsing, reviews/ratings, publisher management |
| **Lifecycle** | Plugin install/uninstall, integration proxy, audit logs |
| **Metadata** | Plugin config, manifest validation, version management |
| **Secrets** | Secret vault, API key mapping |
| **Tenants** | Multi-tenant installations, preferences, deployment management |
| **Tokens** | API token management, GitHub webhooks |
| **Teams** | Organization management |

Backed by 319+ test cases, CSRF protection, rate limiting, and Redis caching with in-memory fallback.

### Plugin Server (`services/plugin-server`)

Serves built UMD plugin bundles via CDN routes at `/cdn/plugins/<name>/<version>/<name>.js`, enabling same-origin loading for camera/microphone access in plugins like Daydream AI Video.

### Platform Manager (`bin/start.sh`)

A unified CLI for the entire platform:

```bash
./bin/start.sh start --all     # Start everything
./bin/start.sh stop --all      # Graceful shutdown
./bin/start.sh status          # Health dashboard
./bin/start.sh dev <plugin>    # Single-plugin dev mode
./bin/start.sh restart <plugin> # Restart one plugin
./bin/start.sh logs <service>  # Tail service logs
./bin/start.sh validate        # Deep health checks
```

Features parallel backend startup, graceful shutdown with timeout handling, deep health checks (verifies actual API queries, not just `/healthz`), automatic database sync, and lockfile management.

---

## Plugins

### Network Operations

| Plugin | Description |
|--------|-------------|
| **Gateway Manager** | Manage and monitor AI gateway infrastructure with real-time metrics and performance analytics |
| **Orchestrator Manager** | GPU compute orchestrator fleet management with real-time monitoring and performance metrics |
| **Capacity Planner** | Coordinate GPU capacity requests between gateways and orchestrators with soft commits and deadline tracking |
| **Network Analytics** | Real-time network performance metrics, charts, and leaderboards for the AI compute network |

### Developer & Integration

| Plugin | Description |
|--------|-------------|
| **Developer API Manager** | Explore AI models, manage API keys, and track usage for developers integrating with the network |
| **Daydream AI Video** | Real-time AI video transformation using the Daydream.live StreamDiffusion API with camera/mic support |
| **My Dashboard** | Embed Metabase dashboards with interactive analytics |

### Web3 & Community

| Plugin | Description |
|--------|-------------|
| **My Wallet** | MetaMask wallet integration for staking, delegation, and Web3 transactions on the Livepeer network |
| **Community Hub** | Builder community with Q&A, discussions, voting, reputation system, badges, and knowledge sharing |

### Platform

| Plugin | Description |
|--------|-------------|
| **Plugin Marketplace** | Discover, install, and manage plugins to extend NAAP — the built-in app store |
| **Plugin Publisher** | Publish, validate, and manage plugins with upload from local folders or GitHub, and download stats |

---

## For Plugin Developers

### What You Can Build

Any team can build a plugin that plugs into NAAP with its own:

- **Frontend** — React micro-frontend loaded as a UMD bundle, with full access to shell services (auth, theme, notifications, navigation)
- **Backend** — Express server with standardized middleware, auth, and database access
- **Database schema** — Isolated Prisma schema within the unified PostgreSQL instance
- **RBAC roles** — Custom roles and permissions scoped to your plugin

### SDK & Tooling

| Package | What It Provides |
|---------|-----------------|
| `@naap/plugin-sdk` | React hooks (`useShell`, `useUser`, `usePluginApi`, `usePluginConfig`), components, testing utilities, and the `naap-plugin` CLI for scaffolding |
| `@naap/plugin-server-sdk` | `createPluginServer()` factory, auth middleware, request logging, error handling, external API proxy |
| `@naap/plugin-build` | Shared Vite config (`createPluginConfig`) for building UMD bundles |
| `@naap/plugin-utils` | Shared auth and API utilities for plugin frontends |
| `@naap/types` | Canonical TypeScript types for `PluginManifest`, `RuntimePlugin`, `AuthUser`, network entities |
| `@naap/ui` | Shared UI components (Badge, Card, Modal, DataTable, etc.) with consistent theming |
| `@naap/database` | Unified Prisma client for database access |
| `@naap/cache` | Redis caching and rate limiting utilities |

### Getting Started as a Plugin Developer

```bash
# 1. Clone and set up the platform
git clone https://github.com/livepeer/naap.git && cd naap
./bin/setup.sh --start

# 2. Scaffold a new plugin
npx naap-plugin create my-plugin --template full-stack

# 3. Develop with hot-reload
./bin/start.sh dev my-plugin

# 4. Build for production
cd plugins/my-plugin/frontend && npm run build

# 5. Publish to marketplace
cd plugins/my-plugin && npx naap-plugin publish
```

### Plugin Manifest (`plugin.json`)

Every plugin is defined by a single `plugin.json` file — the source of truth for:

- Plugin identity (name, version, display name, description)
- Frontend config (entry point, routes, navigation icon and order)
- Backend config (ports, health check, API prefix, resource limits)
- Database config (schema, migrations, seed)
- RBAC roles and permissions
- Lifecycle hooks (post-install, pre-update, post-update)
- Configuration schema for admin-settable values

---

## Shared Packages

| Package | Purpose |
|---------|---------|
| `@naap/types` | Shared TypeScript types — network entities, plugin types, user types, API responses |
| `@naap/ui` | Design-system components with Tailwind CSS |
| `@naap/theme` | Design tokens, Tailwind config, global CSS |
| `@naap/config` | Configuration management |
| `@naap/utils` | CSRF, error handling, feature flags, metrics, tracing, validation |
| `@naap/web3` | Wallet hooks, provider, transaction monitoring |
| `@naap/livepeer-contracts` | Livepeer smart contract integrations |
| `@naap/livepeer-node-client` | Livepeer node client (AI, Media, CLI) |
| `@naap/livepeer-pipeline` | Livepeer pipeline utilities |
| `@naap/service-registry` | Microservice registry |
| `@naap/api-client` | API client utilities |

---

## Development Process

### Branch Strategy

| Branch | Purpose | Deploys To |
|--------|---------|-----------|
| `develop` | Integration branch — all PRs target here | Staging (auto) |
| `main` | Production — updated weekly via promotion | Production |
| `feat/<team>/<desc>` | Feature branches | — |

### For Plugin Teams

- You own your `plugins/<name>/` directory with full autonomy
- Feature branches: `feat/<team>/<description>`
- PRs target `develop`, auto-assigned via CODEOWNERS
- CI runs path-filtered tests (only your plugin's tests run on your PRs)
- Conventional Commits enforced (`feat:`, `fix:`, `chore:`)

### For Core Contributors

- Core = shell (`apps/web-next`), packages (`packages/*`), services (`services/*`), infrastructure (`bin/*`)
- Changes require review from `@livepeer/naap-core`
- Database schema changes require migration plan
- Shared package changes must pass cross-package TypeScript compilation

### Quick Reference

```bash
./bin/start.sh start --all        # Start everything
./bin/start.sh dev <plugin>       # Dev mode for one plugin
./bin/start.sh status             # Health dashboard
./bin/start.sh validate           # Deep health checks
./bin/start.sh logs <service>     # Tail logs
./bin/start.sh restart <plugin>   # Hot-restart a plugin
```

---

## Documentation

The built-in documentation site at `http://localhost:3000/docs` includes:

- **Getting Started** — Installation, quickstart, project structure, platform operations
- **Concepts** — Architecture, plugin system, database architecture, shell services
- **Guides** — Your first plugin, frontend/backend development, database setup, testing, publishing, troubleshooting
- **API Reference** — CLI, plugin manifest, SDK hooks, shell context, event bus, external proxy, types
- **Examples** — Hello world, API integration, dashboard plugins, database plugins, external proxy
- **AI Prompts** — Pre-built prompts for creating plugins, adding features, debugging, and UI design

---

## Database Architecture

- **Single PostgreSQL instance** with schema-level isolation
- **Public schema** — Core models: User, Role, Permission, WorkflowPlugin, PluginPackage, PluginDeployment, Team, FeatureFlag, Session, etc.
- **Plugin schemas** — Each plugin gets its own schema (e.g., `plugin_community`, `plugin_wallet`, `plugin_daydream`)
- **Prisma ORM** with full-text search support
- **Automatic sync** — `start.sh` ensures schema is pushed and data is seeded on every boot

---

## System Requirements

- Node.js 20+
- Docker (for PostgreSQL)
- npm 9+
- ~4 GB RAM (for all 11 plugins running simultaneously)

---

## What's Next

- Kubernetes deployment manifests
- Plugin sandboxing with iframe isolation for untrusted marketplace plugins
- WebSocket real-time updates via Ably integration
- Automated E2E testing pipeline
- Plugin versioning and rollback
- Multi-tenant SaaS mode

---

## Acknowledgments

Built by the Livepeer community. NAAP is open source under the MIT license.

**Repository:** https://github.com/livepeer/naap
**Documentation:** http://localhost:3000/docs (after setup)
**Quick Start:** `git clone https://github.com/livepeer/naap.git && cd naap && ./bin/setup.sh --start`
