# NAAP Platform Refactoring Plan

## Executive Summary

This document outlines the incremental refactoring of the Livepeer Network Monitor from a monolithic React SPA to a production-grade micro-frontend architecture with vertical slicing.

## Current State

**Original Stack:**
- Single React application with Vite
- All pages in one codebase
- Mock data in `mockData.ts`
- No backend services

**Identified Workflows:**

| Route | Component | Workflow Domain |
|-------|-----------|-----------------|
| `/` | Overview | base (Shell) |
| `/gateways` | Gateways | gateway-manager |
| `/orchestrators` | Orchestrators | orchestrator-manager |
| `/capacity` | Capacity | capacity-planner |
| `/analytics` | Analytics | network-analytics |
| `/leaderboard` | Leaderboard | network-analytics |
| `/marketplace` | Marketplace | marketplace |
| `/forum` | Forum | community |
| `/settings` | Settings | base (Shell) |

## Migration Phases

### Phase 1: Foundation ✅
- [x] Initialize Nx monorepo
- [x] Extract shared packages (ui, types, theme, utils, config)
- [x] Configure TypeScript path aliases

### Phase 2: Shell Abstraction ✅
- [x] Create shell-web application
- [x] Implement Layout component
- [x] Create ShellContext with auth kernel
- [x] Implement Mitt event bus
- [x] Define WorkflowManifest contract

### Phase 3: First Workflow Extraction ✅
- [x] Create gateway-manager-web MFE
- [x] Expose via WorkflowManifest
- [x] Configure Module Federation

### Phase 4: Module Federation Setup ✅
- [x] Configure Vite Module Federation for shell
- [x] Configure remotes for all workflows
- [x] Set up shared dependencies

### Phase 5: Remaining Workflow Extractions ✅
- [x] orchestrator-manager-web
- [x] capacity-planner-web
- [x] network-analytics-web (includes leaderboard)
- [x] marketplace-web
- [x] community-web

### Phase 6: Backend Services ✅
- [x] base-svc (auth, config)
- [x] gateway-manager-svc
- [x] orchestrator-manager-svc
- [x] capacity-planner-svc
- [x] network-analytics-svc
- [x] marketplace-svc
- [x] community-svc

### Phase 7: Operational Tooling ✅
- [x] start.sh with workflow flags
- [x] stop.sh for cleanup
- [x] smoke.sh for health checks
- [x] Documentation

## File Migration Map

| Original File | Target Location |
|--------------|-----------------|
| `components/UI.tsx` | `packages/ui/src/` |
| `components/Layout.tsx` | `apps/shell-web/src/components/` |
| `types.ts` | `packages/types/src/` |
| `mockData.ts` | Split per workflow service |
| `pages/Gateways.tsx` | `apps/workflows/gateway-manager-web/` |
| `pages/Orchestrators.tsx` | `apps/workflows/orchestrator-manager-web/` |
| `App.tsx` | `apps/shell-web/src/App.tsx` |

## Success Criteria ✅

- [x] System remains runnable after each phase
- [x] All existing routes continue to work
- [x] No direct imports between workflow packages
- [x] Each workflow deployable independently
- [x] `./scripts/start.sh --all` brings up complete system
- [x] `./scripts/smoke.sh` tests all endpoints

## Next Steps (Production Hardening)

1. **Database Integration**: Add SQLite/PostgreSQL per workflow service
2. **Authentication**: Integrate real wallet connection (ethers.js, wagmi)
3. **CI/CD**: Configure GitHub Actions for independent deployment
4. **Monitoring**: Add observability (OpenTelemetry, Prometheus)
5. **Testing**: Add unit tests, integration tests, E2E tests
