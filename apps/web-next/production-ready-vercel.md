# NaaP Production Readiness Assessment for Vercel

**Assessment Date:** February 3, 2026
**Version:** 1.0
**Scope:** Core Shell, Plugin SDK, Marketplace, Publisher, Community Hub, Multi-Tenancy, Plugin Lifecycle

---

## Executive Summary

The NaaP (Network-as-a-Platform) codebase demonstrates a **well-architected, feature-rich foundation** for a modern SaaS platform with plugin extensibility. The assessment reveals the platform is approximately **70-75% production-ready** for Vercel deployment, with critical attention needed in authentication patterns, database connection management, and plugin security.

### Overall Readiness Scores

| Component | Score | Status |
|-----------|-------|--------|
| Core Shell App | 75/100 | Ready with caveats |
| Plugin SDK | 85/100 | Production-ready |
| Plugin Marketplace | 75/100 | Ready (needs backend integration) |
| Plugin Publisher | 75/100 | Ready with gaps |
| Community Hub | 75/100 | Production-ready |
| Multi-Tenant Support | 65/100 | Critical fixes needed |
| Plugin Lifecycle | 60/100 | Orchestration incomplete |

---

## Table of Contents

1. [Core Shell App Foundation](#1-core-shell-app-foundation)
2. [Plugin SDK](#2-plugin-sdk)
3. [Plugin Marketplace](#3-plugin-marketplace)
4. [Plugin Publisher](#4-plugin-publisher)
5. [Community Hub](#5-community-hub)
6. [Multi-Tenant Support](#6-multi-tenant-support)
7. [Plugin Lifecycle Management](#7-plugin-lifecycle-management)
8. [Critical Issues Summary](#8-critical-issues-summary)
9. [Deployment Checklist](#9-deployment-checklist)
10. [Recommendations](#10-recommendations)

---

## 1. Core Shell App Foundation

### Architecture Overview

- **Framework:** Next.js 15 App Router with React 19
- **Output:** Standalone (Vercel-compatible)
- **Database:** PostgreSQL with Prisma ORM
- **Authentication:** Multi-method (Email/Password, OAuth, Wallet)

### Strengths

| Feature | Implementation |
|---------|----------------|
| Route Structure | Well-organized with `(auth)` and `(dashboard)` groups |
| Authentication | PBKDF2 hashing (SHA-512, 10K iterations), account lockout protection |
| Context Providers | Clean separation: AuthProvider → ShellProvider → PluginProvider |
| API Design | RESTful with versioning (`/api/v1`), consistent response format |
| Type Safety | Full TypeScript with strict mode |
| Security | CSRF protection, CSP headers, brute-force protection |

### Issues for Vercel Deployment

#### Critical Issues

| Issue | Impact | Recommendation |
|-------|--------|----------------|
| **Database Connection Pooling** | Serverless can exhaust connections | Use Neon with pooling, set explicit `max_client_conn` |
| **Session Management** | 7-day sessions require DB lookup per request | Implement JWT-based sessions with Redis caching |
| **Middleware Token Access** | Dual storage (cookie + localStorage) causes sync issues | Use httpOnly cookies exclusively |

#### High Priority Issues

| Issue | Impact | Recommendation |
|-------|--------|----------------|
| **Cold Start Latency** | Large Prisma schema increases bundle | Use Prisma Client extensions, implement connection warmup |
| **Plugin Bundle Security** | UMD plugins require `unsafe-eval` in CSP | Implement SRI checks, stricter nonce-based CSP |
| **Error Logging** | Console-only logging | Integrate Sentry or similar error tracking |
| **Rate Limiting** | No rate limiting implemented | Add Vercel rate limiting headers, per-user limits |

#### Code Location Reference

```
Authentication: src/lib/api/auth.ts
Middleware: src/middleware.ts
Database: src/lib/db.ts
API Routes: src/app/api/v1/
Contexts: src/contexts/
```

### Database Schema Highlights

The Prisma schema (33KB) includes comprehensive models:
- User, Session, LoginAttempt (auth)
- Team, TeamMember (multi-tenancy)
- PluginPackage, PluginVersion, PluginDeployment (plugin system)
- Proper cascading deletes and unique constraints

---

## 2. Plugin SDK

### Architecture Overview

- **Package:** `@naap/plugin-sdk`
- **Type:** ESM with UMD fallback
- **React Support:** 18.x and 19.x
- **Build Tools:** TypeScript 5.8.2, esbuild/Rollup for UMD

### Strengths

| Feature | Quality |
|---------|---------|
| **Modular Exports** | Subpath exports for tree-shaking (`./hooks`, `./components`, `./types`) |
| **Type Definitions** | Comprehensive interfaces for all 13+ services |
| **Lifecycle Management** | Clear init → mount → unmount flow with cleanup |
| **Multi-Tenancy** | Team context, tenant service, personal vs. shared config |
| **Feature Detection** | Capability checking for graceful degradation |

### Service Interfaces

```typescript
// Core services available to plugins
IAuthService        // User info, roles, permissions
INotificationService // Toast notifications
IStorageService     // File upload/download (Vercel Blob)
IAIService          // AI completions (when enabled)
IEmailService       // Email sending
IEventBus           // Pub/sub communication
ILoggerService      // Structured logging
IThemeService       // Dark/light mode
IPermissionService  // Resource-action permissions
ICapabilityService  // Feature detection
ITenantService      // Multi-tenant installations
ITeamContext        // Team switching
IApiClient          // Authenticated HTTP client
```

### Issues

| Issue | Severity | Fix |
|-------|----------|-----|
| **TypeScript Strictness** | Medium | Enable `noUnusedLocals`, `noImplicitReturns` |
| **Duplicate UMD Configs** | Low | Consolidate Rollup + esbuild to single build |
| **Event Bus Type Safety** | Medium | Add string literal unions for event names |
| **UMD Error Handling** | Medium | Reject mount if init fails (currently continues) |
| **Manual Type Definitions** | Low | Auto-generate UMD types from source |

### Mount Utility

```typescript
// Recommended plugin structure
import { createPluginMount } from '@naap/plugin-sdk';

export const { mount, unmount, getContext } = createPluginMount({
  App: MyPluginApp,
  onInit: async (context) => { /* setup */ },
  onMount: (context) => { /* mounted */ },
  onUnmount: () => { /* cleanup */ },
});
```

---

## 3. Plugin Marketplace

### Architecture Overview

- **Frontend:** React 19, Vite 6, Module Federation + UMD builds
- **Backend:** Express.js stub (actual integration via base-svc)
- **Features:** Search, filtering, sorting, team installation support

### Strengths

| Feature | Implementation |
|---------|----------------|
| **Search & Filter** | Real-time search, 8 categories, 4 sort options |
| **Team Installation** | Full tenant personalization with scope detection |
| **UI/UX** | Professional design with Tailwind, Framer Motion |
| **Build System** | Both Module Federation (dev) and UMD (production) |
| **Fallback Data** | Mock data for API unavailability |

### Production Bundle

```
marketplace.js      65 KB (minified UMD)
marketplace.css     19 KB
manifest.json       Metadata with bundleHash
```

### Issues

| Issue | Severity | Fix |
|-------|----------|-----|
| **Backend Integration** | High | Connects to stub; needs base-svc registry integration |
| **No Pagination** | Medium | All plugins loaded at once; add pagination for scale |
| **No Error Retry** | Low | Add retry logic for transient API failures |
| **Missing Tests** | Medium | No unit or integration tests |
| **Accessibility** | Low | Add ARIA labels, focus management |

### API Endpoints Consumed

```
GET  /api/v1/registry/packages     Plugin catalog
GET  /api/v1/installations         User's installed plugins
POST /api/v1/installations         Install plugin
DELETE /api/v1/installations/{name} Uninstall plugin
```

---

## 4. Plugin Publisher

### Architecture Overview

- **Frontend:** React 18, 5-step publish wizard
- **Backend:** Express.js on port 4010/4110
- **CDN:** Vercel Blob integration for production bundles

### Features

| Feature | Status |
|---------|--------|
| **Manifest Validation** | Comprehensive (name, version, frontend/backend) |
| **Bundle Testing** | Module Federation markers, ./App export check |
| **CDN Deployment** | Vercel Blob with content hashing |
| **API Tokens** | Full CRUD with scopes (read, publish, admin) |
| **Statistics** | 30-day download/install timeline |

### Validation Rules

```typescript
// Manifest Requirements
name: kebab-case format (^[a-z][a-z0-9]*(-[a-z0-9]+)*$)
version: Semantic versioning (MAJOR.MINOR.PATCH)
displayName: Required string
frontend OR backend: At least one required
frontend.routes: Required array of route paths
```

### Security Features

- Helmet.js HTTP headers
- CORS properly configured
- Rate limiting (100 req/min)
- File type validation (zip only)
- Size limits (50MB uploads)

### Issues

| Issue | Severity | Fix |
|-------|----------|-----|
| **GitHub Integration** | High | Webhook handling not implemented |
| **Analytics** | Medium | Stats are mock-generated; need real backend |
| **Settings Page** | Medium | Save endpoints not implemented |
| **Error Recovery** | Low | No retry mechanism for failed uploads |

### CDN Upload Path

```
POST /api/v1/plugin-publisher/publish-cdn
→ https://blob.vercel-storage.com/plugins/{name}/{version}/{filename}
Cache: bundle/styles = 1 year; manifest = 5 min
```

---

## 5. Community Hub

### Architecture Overview

- **Frontend:** React 19, React Router 7, Tailwind CSS
- **Backend:** Express.js 4.21, Prisma 5.20, PostgreSQL
- **Features:** Q&A, Discussions, Voting, Reputation, Badges

### Data Model

```
User → Posts (1:many)
User → Comments (1:many)
User → Votes (1:many)
User → UserBadges (many:many with Badge)
Post → Comments (1:many)
Post → PostTags (many:many with Tag)
```

### Feature Completeness

| Feature | Status |
|---------|--------|
| Post CRUD | Complete |
| Comments/Answers | Complete with acceptance |
| Voting System | Upvote-only, reputation awards |
| Search | Basic (LIKE queries) |
| Tags & Categories | 8 categories, dynamic tags |
| User Profiles | Reputation, levels, badges |
| Leaderboard | Top contributors display |

### Reputation System

```
POST_CREATED             +5 points
POST_UPVOTED            +10 points (voter)
POST_RECEIVED_UPVOTE     +2 points (author)
COMMENT_CREATED          +2 points
ANSWER_ACCEPTED         +15 points (answer author)
QUESTION_SOLVED          +5 points (question author)

Levels: Newcomer(0) → Contributor(50) → Regular(200)
      → Trusted(500) → Expert(1000) → Legend(2500)
```

### Issues

| Issue | Severity | Fix |
|-------|----------|-----|
| **No Real-Time** | Medium | Add WebSocket for live updates |
| **No Caching** | Medium | Add Redis for leaderboard, hot posts |
| **No Rate Limiting** | High | Vulnerable to spam |
| **Basic Search** | Medium | Implement PostgreSQL tsvector indexes |
| **No Moderation** | Medium | Add content moderation tools |

---

## 6. Multi-Tenant Support

### Architecture Overview

```
Team (1) → TeamMember (many) ← User (many)
Team (1) → TeamPluginInstall (many) → PluginDeployment
TeamMember → TeamMemberPluginAccess (per-plugin visibility)
TeamMember → TeamMemberPluginConfig (personal overrides)
```

### Role Hierarchy

| Role | Level | Permissions |
|------|-------|-------------|
| viewer | 1 | View team, plugins, members |
| member | 2 | + Use plugins, personal config |
| admin | 3 | + Invite/remove members, manage plugins |
| owner | 4 | + Delete team, transfer ownership |

### Plugin Access Control Layers

1. **Team Membership** - Must be in TeamMember table
2. **Plugin Installation** - Team must have TeamPluginInstall
3. **Member Access** - TeamMemberPluginAccess flags (visible, canUse, canConfigure)
4. **Personal Config** - TeamMemberPluginConfig for user overrides

### Critical Issues

| Issue | Severity | Location | Fix |
|-------|----------|----------|-----|
| **Missing Auth on Plugin Routes** | CRITICAL | `/teams/[teamId]/plugins/route.ts` | Add `validateSession()` to all handlers |
| **No Team Membership Check** | HIGH | Plugin routes | Add `validateTeamAccess()` before data access |
| **No Admin Role Check** | HIGH | Plugin installation | Require admin role for POST |
| **No Audit Logging** | MEDIUM | All team routes | Log operations to AuditLog model |

### Proper Authorization Pattern

```typescript
// Required in ALL team plugin routes
export async function GET(request: NextRequest, { params }) {
  const token = getAuthToken(request);
  if (!token) return errors.unauthorized();

  const user = await validateSession(token);
  if (!user) return errors.unauthorized();

  const { teamId } = await params;
  const { team, member } = await validateTeamAccess(user.id, teamId, 'viewer');

  // Now safe to query team data
}
```

### Team Context Frontend

```typescript
// shell-context.tsx provides:
const team = {
  currentTeam: Team | null,
  currentMember: TeamMember | null,
  setCurrentTeam: async (teamId) => {},
  isTeamContext: boolean,
  memberRole: string | null,
  hasTeamPermission: (permission) => boolean,
  refreshTeam: async () => {},
};

// Storage: localStorage key 'naap_current_team'
// Events: 'team:change', 'team:created'
```

---

## 7. Plugin Lifecycle Management

### Lifecycle Stages

```
DEVELOPMENT → VALIDATION → TESTING → PUBLISHING → DEPLOYMENT → RUNNING
     ↓            ↓           ↓          ↓            ↓           ↓
  Local dev   Manifest    Frontend   CDN upload   Container   Health
  with SDK    schema      loading    + registry   provision   monitoring
```

### Version Management

```typescript
PluginVersion {
  version: string      // Semantic versioning
  bundleUrl: string    // CDN URL for UMD bundle
  bundleHash: string   // SHA-256 (8 chars) for integrity
  bundleSize: number   // Performance tracking
  deprecated: boolean  // Soft deprecation
  deploymentType: 'cdn' | 'container'
}
```

### Status State Machine

```
PACKAGE:
  draft → published → archived (one-way)

DEPLOYMENT:
  pending → deploying → running
                    ↘ failed → stopped

INSTALLATION:
  active ↔ disabled (toggle)
```

### CDN Deployment

```typescript
// URL Structure
https://cdn.naap.io/plugins/{name}/{version}/{filename}

// Cache Control
Versioned assets: 1 year (immutable)
Manifest files: 5 minutes
```

### Health Monitoring

```typescript
// Backend health check
GET /healthz → { status: 'healthy', plugin: name, version: x.x.x }

// Monitoring
- 5-second timeout per check
- Database connectivity validation
- Response time tracking
- Status: healthy | unhealthy | unknown
```

### Issues

| Issue | Severity | Fix |
|-------|----------|-----|
| **No Container Orchestration** | CRITICAL | Implement Docker/Kubernetes backend |
| **No Database Provisioning** | HIGH | Implement `plugin_{name}` database creation |
| **No Automated Rollback** | HIGH | Add rollback on failed deployment |
| **No Blue-Green Deployment** | MEDIUM | Implement zero-downtime updates |
| **No Security Scanning** | MEDIUM | Scan bundles for vulnerabilities |

---

## 8. Critical Issues Summary

### Must Fix Before Production

| # | Component | Issue | Severity |
|---|-----------|-------|----------|
| 1 | Multi-Tenant | Missing authentication on plugin routes | CRITICAL |
| 2 | Multi-Tenant | No team membership verification | CRITICAL |
| 3 | Lifecycle | No actual container orchestration | CRITICAL |
| 4 | Core Shell | Database connection pooling limits | HIGH |
| 5 | Core Shell | Session management inefficiency | HIGH |
| 6 | Multi-Tenant | No admin role check for plugin install | HIGH |
| 7 | Community | No rate limiting | HIGH |
| 8 | Publisher | GitHub integration incomplete | HIGH |

### Should Fix Soon

| # | Component | Issue | Severity |
|---|-----------|-------|----------|
| 9 | Core Shell | No error tracking service | MEDIUM |
| 10 | Multi-Tenant | No audit logging | MEDIUM |
| 11 | Marketplace | No pagination | MEDIUM |
| 12 | Community | No real-time updates | MEDIUM |
| 13 | Plugin SDK | Event bus type safety | MEDIUM |
| 14 | All | Input validation/sanitization | MEDIUM |

---

## 9. Deployment Checklist

### Pre-Deployment

- [ ] Fix authentication on all team plugin routes
- [ ] Implement database connection pooling with limits
- [ ] Set up error tracking (Sentry or similar)
- [ ] Configure rate limiting
- [ ] Implement audit logging for team operations
- [ ] Add comprehensive input validation

### Environment Variables Required

```bash
# Database
DATABASE_URL=postgresql://...?pgbouncer=true
DATABASE_URL_UNPOOLED=postgresql://...

# Authentication
NEXTAUTH_SECRET=<32+ character secret>
NEXT_PUBLIC_APP_URL=https://your-domain.com

# OAuth (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Storage
BLOB_READ_WRITE_TOKEN=<vercel-blob-token>

# Real-time (optional)
ABLY_API_KEY=

# Plugin CDN
NEXT_PUBLIC_PLUGIN_CDN_URL=https://cdn.naap.io/plugins
```

### Vercel Configuration

```json
// vercel.json
{
  "buildCommand": "prisma generate && next build",
  "outputDirectory": ".next",
  "framework": "nextjs",
  "regions": ["iad1"],
  "functions": {
    "api/**": {
      "maxDuration": 30
    }
  }
}
```

### Database Migration

```bash
# Before first deployment
npx prisma migrate deploy

# After schema changes
npx prisma migrate dev --name <migration-name>
npx prisma generate
```

---

## 10. Recommendations

### Immediate (Before Launch)

1. **Fix Multi-Tenant Security**
   - Add `validateSession()` and `validateTeamAccess()` to all team plugin routes
   - Implement admin role verification for sensitive operations
   - Add audit logging for compliance

2. **Optimize Database for Serverless**
   - Use Neon with connection pooling
   - Set `max_client_conn` appropriately
   - Implement connection warm-up requests

3. **Implement Error Tracking**
   - Integrate Sentry or similar
   - Add request ID tracking
   - Implement structured logging

4. **Add Rate Limiting**
   - Global rate limits via Vercel
   - Per-user limits on sensitive endpoints
   - Brute-force protection on auth endpoints

### Short-Term (First Month)

1. **Implement Real Session Management**
   - JWT-based sessions with Redis caching
   - Reduce database lookups per request
   - Implement session refresh mechanism

2. **Complete Plugin Publisher**
   - GitHub webhook integration
   - Real analytics backend
   - Settings page save endpoints

3. **Enhance Community Hub**
   - WebSocket for real-time updates
   - Redis caching for leaderboard
   - Content moderation tools

4. **Plugin Security**
   - Implement SRI for plugin bundles
   - Add security scanning
   - Stricter CSP with nonces

### Medium-Term (First Quarter)

1. **Container Orchestration**
   - Implement Docker/Kubernetes backend
   - Blue-green deployments
   - Automated rollback on failures

2. **Performance Optimization**
   - Bundle analysis and code splitting
   - Implement pagination everywhere
   - PostgreSQL full-text search indexes

3. **Documentation**
   - OpenAPI/Swagger specs for all APIs
   - Plugin development guide
   - Deployment runbook

### Long-Term (First Year)

1. **Enterprise Features**
   - SSO/SAML integration
   - Advanced RBAC
   - Compliance audit trails

2. **Scale Improvements**
   - Multi-region deployment
   - CDN edge caching
   - Elasticsearch for search

3. **Developer Experience**
   - Plugin development CLI
   - Local development environment
   - Testing framework for plugins

---

## Appendix: File Reference

### Core Shell
```
apps/web-next/src/app/          # Routes and pages
apps/web-next/src/lib/api/      # API utilities
apps/web-next/src/contexts/     # React contexts
apps/web-next/src/middleware.ts # Route middleware
apps/web-next/prisma/           # Database schema
```

### Plugin SDK
```
packages/plugin-sdk/src/        # SDK source
packages/plugin-sdk/src/types/  # Type definitions
packages/plugin-sdk/src/hooks/  # React hooks
packages/plugin-sdk/src/utils/  # Mount utilities
```

### Plugins
```
plugins/marketplace/            # Marketplace plugin
plugins/plugin-publisher/       # Publisher plugin
plugins/community/              # Community hub
```

### Services
```
services/base-svc/              # Core backend service
services/plugin-server/         # Plugin runtime
```

---

**Document Prepared By:** Claude Code Analysis
**Last Updated:** February 3, 2026
**Next Review:** Before production deployment
