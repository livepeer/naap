# Team Ownership

## Platform Team (2-3 engineers)

Owns the shell, SDK, shared packages, and infrastructure.

| Area | Path | Description |
|------|------|-------------|
| Shell | `apps/web-next/` | Next.js shell application |
| Base Service | `services/base-svc/` | Auth, teams, plugin registry |
| Plugin Server | `services/plugin-server/` | Plugin asset serving |
| Plugin SDK | `packages/plugin-sdk/` | SDK for plugin developers |
| Plugin Build | `packages/plugin-build/` | Shared Vite build config |
| Plugin Utils | `packages/plugin-utils/` | Shared auth/API utilities |
| Types | `packages/types/` | Shared TypeScript types |
| UI | `packages/ui/` | Shared component library |
| Theme | `packages/theme/` | Design tokens, Tailwind |
| Scripts | `bin/` | Platform management scripts |
| CI/CD | `.github/workflows/` | CI pipelines, deployment |
| Config | `vercel.json`, `docker-compose.yml` | Deployment configs |

## Plugin Team A (3-4 engineers)

Owns infrastructure and network monitoring plugins.

| Plugin | Path | Description |
|--------|------|-------------|
| Gateway Manager | `plugins/gateway-manager/` | Gateway configuration |
| Orchestrator Manager | `plugins/orchestrator-manager/` | Orchestrator management |
| Capacity Planner | `plugins/capacity-planner/` | Capacity planning |
| Network Analytics | `plugins/network-analytics/` | Network monitoring |

## Plugin Team B (3-4 engineers)

Owns user-facing and marketplace plugins.

| Plugin | Path | Description |
|--------|------|-------------|
| Community | `plugins/community/` | Forum and discussions |
| Marketplace | `plugins/marketplace/` | Plugin marketplace |
| My Dashboard | `plugins/my-dashboard/` | User dashboard |
| My Wallet | `plugins/my-wallet/` | Wallet management |
| Daydream Video | `plugins/daydream-video/` | Video plugin |
| Developer API | `plugins/developer-api/` | API management |
| Plugin Publisher | `plugins/plugin-publisher/` | Plugin publishing |

## Cross-Team Responsibilities

| Responsibility | Owner |
|---------------|-------|
| Plugin SDK API changes | Platform Team (requires RFC) |
| Shared UI components | Platform Team |
| Database schema (main) | Platform Team |
| Plugin database schemas | Owning plugin team |
| CI/CD pipeline | Platform Team |
| Documentation | All teams (own their area) |
| Security fixes | Platform Team (urgent), any team (report) |
