# NaaP Feature Parity Analysis: Original vs Vercel Migration

**Generated:** 2026-02-03
**Status:** CRITICAL GAPS IDENTIFIED

## Executive Summary

The Vercel migration (web-next) is **approximately 60-65% complete** compared to the original shell-web + plugins architecture. Major feature gaps exist in:

1. **3 plugins completely missing** (Orchestrator Manager, Capacity Planner, Network Analytics)
2. **Admin features incomplete** (Secrets Vault, Integrations)
3. **Team plugin management missing** (team-level installs, per-member access)
4. **Seed data significantly different** (missing roles, test users, marketplace data)

---

## Feature Comparison Matrix

### 1. Plugins Comparison

| Plugin | Original | web-next | Status | Gap Details |
|--------|----------|----------|--------|-------------|
| Gateway Manager | ✅ Full | ✅ API + Schema | 🟡 90% | Frontend routing via remote module |
| Orchestrator Manager | ✅ Full | ❌ Missing | 🔴 0% | No routes or API (Memory-only in Original) |
| Capacity Planner | ✅ Full | ❌ Missing | 🔴 0% | No routes or API (Memory-only in Original) |
| Network Analytics | ✅ Full | ❌ Missing | 🔴 0% | No routes or API (Memory-only in Original) |
| Marketplace | ✅ Full | 🟡 Partial | 🟡 70% | Missing install/uninstall flows |
| Community Hub | ✅ Full | ✅ API + Schema | 🟡 85% | Missing some forum features |
| Developer API | ✅ Full | ✅ API + Schema | 🟡 80% | API routes exist |
| My Wallet | ✅ Full | ✅ API + Schema | 🟡 85% | Missing some staking features |
| My Dashboard | ✅ Full | ✅ API + Schema | 🟡 90% | Metabase embed works |
| Plugin Publisher | ✅ Full | 🟡 Partial | 🟡 60% | Missing GitHub integration |
| Daydream Video | ✅ Full | ✅ API + Schema | 🟡 85% | Session management works |
| Debugger | ✅ Full | 🟡 Partial | 🟡 50% | Missing WebSocket log streaming |

### 2. Authentication Features

| Feature | Original | web-next | Status |
|---------|----------|----------|--------|
| Email/Password Login | ✅ | ✅ | ✅ Complete |
| Email Verification | ✅ | ✅ | ✅ Complete |
| Password Reset | ✅ | ✅ | ✅ Complete |
| Google OAuth | ✅ | ✅ | ✅ Complete |
| GitHub OAuth | ✅ | ✅ | ✅ Complete |
| Session Management | ✅ | ✅ | ✅ Complete |
| Session Refresh | ✅ | ✅ | ✅ Complete |
| Account Lockout | ✅ | ✅ | ✅ Complete |
| CSRF Protection | ✅ | ✅ | ✅ Complete |
| Login Attempt Tracking | ✅ | ✅ | ✅ Complete |

### 3. Authorization (RBAC)

| Feature | Original | web-next | Status | Gap |
|---------|----------|----------|--------|-----|
| Role Model | ✅ | ✅ | ✅ | Schema exists |
| UserRole Model | ✅ | ✅ | ✅ | Schema exists |
| System Roles (root, admin, operator, viewer) | ✅ Seeded | ❌ Not seeded | 🔴 | **Need to seed** |
| Plugin Admin Roles | ✅ Seeded | ❌ Not seeded | 🔴 | **Need to seed** |
| Role Inheritance | ✅ | ✅ | ✅ | Field exists |
| Permission Checking | ✅ | ✅ | ✅ | API exists |
| Role Assignment API | ✅ | ✅ | ✅ | Works |
| Delegation (canAssign) | ✅ | ✅ | ✅ | Field exists |

### 4. Team Management

| Feature | Original | web-next | Status | Gap |
|---------|----------|----------|--------|-----|
| Team CRUD | ✅ | ✅ | ✅ | Complete |
| Team Members | ✅ | ✅ | ✅ | Complete |
| Member Roles (owner, admin, member, viewer) | ✅ | ✅ | ✅ | Complete |
| Team Ownership Transfer | ✅ | ✅ | ✅ | Complete |
| TeamPluginInstall | ✅ | ❌ Missing | 🔴 | **Schema missing** |
| TeamMemberPluginAccess | ✅ | ❌ Missing | 🔴 | **Schema missing** |
| TeamMemberPluginConfig | ✅ | ❌ Missing | 🔴 | **Schema missing** |
| Team Plugin Visibility Control | ✅ | ❌ Missing | 🔴 | Depends on above |
| Team Plugin Role Assignment | ✅ | ❌ Missing | 🔴 | Depends on above |

### 5. Admin Features

| Feature | Original | web-next | Status | Gap |
|---------|----------|----------|--------|-----|
| User Management | ✅ | ❌ Missing | 🔴 | **No admin user list/role API** |
| Role Management | ✅ | ❌ Missing | 🔴 | **No role CRUD API** |
| Audit Log Viewing | ✅ | ❌ Missing | 🔴 | **API route missing** |
| SecretVault CRUD | ✅ | ❌ Missing | 🔴 | **Schema + API missing** |
| IntegrationConfig | ✅ | ❌ Missing | 🔴 | **Schema + API missing** |
| PluginIntegrationPermission | ✅ | ❌ Missing | 🔴 | **Schema missing** |
| Secret Rotation | ✅ | ❌ Missing | 🔴 | Feature missing |

### 6. Plugin System

| Feature | Original | web-next | Status | Gap |
|---------|----------|----------|--------|-----|
| WorkflowPlugin Registry | ✅ | ✅ | ✅ | Schema + API |
| Plugin Loading (Module Federation) | ✅ | ✅ | ✅ | Dynamic imports |
| UserPluginPreference | ✅ | ✅ | ✅ | Works |
| TenantPluginInstall | ✅ | ✅ | ✅ | Schema exists |
| TenantPluginConfig | ✅ | ❌ Missing | 🔴 | **Schema missing** |
| PluginPackage (Marketplace) | ✅ | ✅ | ✅ | Schema exists |
| PluginVersion | ✅ | ✅ | ✅ | Schema exists |
| PluginInstallation | ✅ | ✅ | ✅ | Schema exists |
| PluginDeployment | ✅ | ✅ | ✅ | Schema exists |
| PluginLifecycleEvent | ✅ | ❌ Missing | 🔴 | **Schema missing** |
| PluginMigration | ✅ | ❌ Missing | 🔴 | **Schema missing** |

### 7. Publisher/API Features

| Feature | Original | web-next | Status | Gap |
|---------|----------|----------|--------|-----|
| Publisher Model | ✅ | ✅ | ✅ | Schema exists |
| PluginPackage Publishing | ✅ | 🟡 Partial | 🟡 | Limited API |
| ApiToken (for CI/CD) | ✅ | ❌ Missing | 🔴 | **Schema missing** |
| WebhookSecret | ✅ | ❌ Missing | 🔴 | **Schema missing** |
| GitHub Integration | ✅ | ❌ Missing | 🔴 | Feature missing |

### 8. Observability/Monitoring

| Feature | Original | web-next | Status | Gap |
|---------|----------|----------|--------|-----|
| HistoricalStat | ✅ | ❌ Missing | 🔴 | **Schema missing** |
| JobFeed | ✅ | ❌ Missing | 🔴 | **Schema missing** |
| AuditLog | ✅ | ❌ Missing | 🔴 | **Schema missing** |
| Health Endpoints | ✅ | ✅ | ✅ | Works |

### 9. Real-time Features

| Feature | Original | web-next | Status | Gap |
|---------|----------|----------|--------|-----|
| WebSocket (base-svc) | ✅ | ❌ Replaced | 🟡 | Uses Ably instead |
| Log Streaming (Debugger) | ✅ WebSocket | 🟡 Ably | 🟡 | Different implementation |
| Notifications | ✅ | ✅ Ably | ✅ | Works with Ably |
| Connection Resilience | ✅ | ✅ | ✅ | Ably handles this |

### 10. Database/Seed Data

| Data Type | Original | web-next | Status | Gap |
|-----------|----------|----------|--------|-----|
| Test Users (12 role-based) | ✅ | ❌ Only 2 | 🔴 | **Need 10 more** |
| System Roles (4) | ✅ | ❌ Not seeded | 🔴 | **Need to seed** |
| Plugin Admin Roles (10) | ✅ | ❌ Not seeded | 🔴 | **Need to seed** |
| Feature Flags (4) | ✅ | ❌ Not seeded | 🔴 | **Need to seed** |
| Marketplace Packages (10) | ✅ | ❌ Not seeded | 🔴 | **Need to seed** |
| PluginDeployments | ✅ | ❌ Not seeded | 🔴 | **Need to seed** |
| TenantPluginInstalls | ✅ | ❌ Not seeded | 🔴 | **Need to seed** |
| Historical Stats | ✅ | N/A | 🔴 | Schema missing |
| Job Feeds | ✅ | N/A | 🔴 | Schema missing |

---

## Missing Schema Models (web-next)

The following Prisma models exist in base-svc but are **MISSING** from web-next:

```prisma
// Team Plugin Management (CRITICAL)
TeamPluginInstall
TeamMemberPluginAccess
TeamMemberPluginConfig

// Plugin Configuration
TenantPluginConfig
PluginConfig

// Admin/Secrets
SecretVault
APIKeyMapping
IntegrationConfig
PluginIntegrationPermission

// Observability
HistoricalStat
JobFeed
AuditLog

// Plugin Lifecycle
PluginLifecycleEvent
PluginMigration

// Publisher CI/CD
ApiToken
WebhookSecret
```

---

## Missing API Endpoints (web-next)

### Secrets Management
- `GET /api/v1/secrets` - List secrets
- `POST /api/v1/secrets` - Create secret
- `DELETE /api/v1/secrets/:key` - Delete secret
- `POST /api/v1/secrets/:key/rotate` - Rotate secret

### Integrations
- `GET /api/v1/integrations` - List integrations
- `POST /api/v1/integrations/:type/configure` - Configure integration
- `POST /api/v1/integrations/:type/test` - Test integration

### Team Plugins
- `GET /api/v1/teams/:teamId/plugins` - List team plugins
- `POST /api/v1/teams/:teamId/plugins` - Install plugin for team
- `DELETE /api/v1/teams/:teamId/plugins/:installId` - Uninstall
- `PUT /api/v1/teams/:teamId/plugins/:installId/config` - Update config
- `PATCH /api/v1/teams/:teamId/plugins/:installId/toggle` - Enable/disable
- `GET /api/v1/teams/:teamId/members/:memberId/access` - Get member access
- `PUT /api/v1/teams/:teamId/members/:memberId/access/:pluginInstallId` - Set access

### Missing Plugin APIs
- `/api/v1/orchestrator-manager/*` - All endpoints
- `/api/v1/capacity-planner/*` - All endpoints
- `/api/v1/network-analytics/*` - All endpoints

### Audit
- `GET /api/v1/admin/audit` - View audit logs

---

## Seed Data Gap Analysis

### Original Seed Creates:
1. **13 test users** with specific roles (admin, gateway, orchestrator, capacity, analytics, marketplace, community, developer, wallet, dashboard, publisher, viewer)
2. **4 system roles** (root, admin, operator, viewer)
3. **10 plugin admin roles**
4. **4 feature flags**
5. **10 workflow plugins**
6. **10 marketplace packages** with versions
7. **10 plugin deployments**
8. **Tenant installations** for all users
9. **4 historical stats**
10. **20 job feed entries**

### web-next Seed Creates:
1. **2 test users** (admin@naap.dev, user@naap.dev)
2. **1 test team**
3. **9 workflow plugins** (missing Orchestrator Manager, Capacity Planner, Network Analytics)
4. **No roles seeded**
5. **No marketplace packages**
6. **No plugin deployments**
7. **No tenant installations**

---

## Phased Remediation Plan

### Phase 1: Critical Schema Additions (Priority: CRITICAL)
**Duration:** 1 day
**Effort:** Medium

Add missing Prisma models to web-next:

```
1. TeamPluginInstall
2. TeamMemberPluginAccess
3. TeamMemberPluginConfig
4. TenantPluginConfig
5. SecretVault
6. APIKeyMapping
7. IntegrationConfig
8. PluginIntegrationPermission
9. AuditLog
10. PluginLifecycleEvent
11. PluginMigration
12. HistoricalStat
13. JobFeed
14. ApiToken
15. WebhookSecret
```

### Phase 2: Seed Data Parity (Priority: CRITICAL)
**Duration:** 0.5 day
**Effort:** Low

Migrate seed data from base-svc to web-next:

1. Add all 4 system roles
2. Add all 10 plugin admin roles
3. Add all 12 test users with role assignments
4. Add all 4 feature flags
5. Add all 10 marketplace packages + versions
6. Add plugin deployments
7. Add tenant installations
8. Add 3 missing workflow plugins

### Phase 3: Missing Plugin APIs (Priority: HIGH)
**Duration:** 2 days
**Effort:** High

Create API routes for missing plugins:

1. `/api/v1/orchestrator-manager/*`
2. `/api/v1/capacity-planner/*`
3. `/api/v1/network-analytics/*`

### Phase 4: Admin Features (Priority: HIGH)
**Duration:** 1 day
**Effort:** Medium

Add admin API endpoints:

1. Secrets CRUD + rotation
2. Integration configuration
3. Audit log viewing

### Phase 5: Team Plugin Management (Priority: HIGH)
**Duration:** 1.5 days
**Effort:** High

Add team plugin API endpoints:

1. Team plugin install/uninstall
2. Member access control
3. Personal config overrides
4. Plugin visibility per member

### Phase 6: Publisher/CI Features (Priority: MEDIUM)
**Duration:** 1 day
**Effort:** Medium

Add publisher features:

1. ApiToken CRUD
2. WebhookSecret management
3. GitHub integration

### Phase 7: Observability (Priority: LOW)
**Duration:** 0.5 day
**Effort:** Low

Add observability features:

1. Historical stats collection
2. Job feed tracking
3. Audit log writing

---

## Immediate Actions Required

### Before Testing:
1. ❌ **Stop all applications** - DONE
2. 🔄 **Create unified seed script** - IN PROGRESS
3. ⏳ **Add missing schema models**
4. ⏳ **Migrate seed data**
5. ⏳ **Run migrations**

### Files to Modify:
- `apps/web-next/prisma/schema.prisma` - Add missing models
- `apps/web-next/prisma/seed.ts` - Port full seed from base-svc

---

## Summary Statistics

| Category | Original Features | web-next Features | Parity % |
|----------|------------------|-------------------|----------|
| Plugins | 12 | 9 (full) + 3 (missing) | 75% |
| Auth | 10 | 10 | 100% |
| RBAC | 8 | 5 | 62% |
| Team Management | 10 | 4 | 40% |
| Admin Features | 6 | 2 | 33% |
| Plugin System | 10 | 6 | 60% |
| Observability | 4 | 1 | 25% |
| **Overall** | **60** | **37** | **~62%** |

---

## Conclusion

The web-next migration requires significant work to achieve feature parity. The most critical gaps are:

1. **Missing plugins** (3 of 12 = 25% of plugins)
2. **Team plugin management** (entire subsystem missing)
3. **Admin features** (secrets, integrations)
4. **Seed data** (roles, users, marketplace)

**Recommended approach:** Focus on Phase 1-2 first (schema + seed) to enable testing, then tackle API endpoints in subsequent phases.
