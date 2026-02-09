# NaaP Vercel Migration Plan

## Executive Summary

This document outlines a comprehensive, risk-managed migration plan to transform NaaP from a multi-service Docker-based architecture to a Vercel-compatible serverless architecture. The migration is designed to be incremental, with each phase being independently deployable and fully tested before proceeding.

**Migration Duration**: 12-16 weeks (estimated)
**Risk Level**: Medium (mitigated through phased approach)
**Rollback Capability**: Full rollback possible at any phase

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Target Architecture](#2-target-architecture)
3. [Migration Phases Overview](#3-migration-phases-overview)
4. [Phase 0: Foundation & Preparation](#phase-0-foundation--preparation)
5. [Phase 1: Database Consolidation](#phase-1-database-consolidation)
6. [Phase 2: Frontend Migration](#phase-2-frontend-migration)
7. [Phase 3: API Layer Migration](#phase-3-api-layer-migration)
8. [Phase 4: Real-time Services Migration](#phase-4-real-time-services-migration)
9. [Phase 5: Storage & Infrastructure](#phase-5-storage--infrastructure)
10. [Phase 6: Plugin System Modernization](#phase-6-plugin-system-modernization)
11. [Phase 7: Final Cutover & Optimization](#phase-7-final-cutover--optimization)
12. [Risk Management Matrix](#risk-management-matrix)
13. [Rollback Procedures](#rollback-procedures)
14. [Success Metrics](#success-metrics)

---

## 1. Current State Analysis

### 1.1 Architecture Overview

```
Current Architecture (Docker-based)
═══════════════════════════════════

┌─────────────────────────────────────────────────────────────────┐
│                         NGINX (Port 80)                          │
└─────────────────────────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌───────────────┐      ┌───────────────┐      ┌───────────────┐
│  Shell Web    │      │ Plugin Server │      │   Base SVC    │
│  (Port 3000)  │      │  (Port 3100)  │      │  (Port 4000)  │
└───────────────┘      └───────────────┘      └───────────────┘
                                                      │
                                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    12 Plugin Backends                            │
│  (Ports 4001-4011, 4111)                                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    8 PostgreSQL Databases                        │
│  (Ports 5432-5440)                                              │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Component Inventory

| Category | Count | Technology | Migration Complexity |
|----------|-------|------------|---------------------|
| Frontend Apps | 13 | React + Vite + Module Federation | Low |
| Backend Services | 15 | Express.js | Medium |
| Databases | 8 | PostgreSQL + Prisma | High |
| WebSocket Services | 2 | ws library | High |
| File Storage | 1 | Local/S3 | Low |
| Message Queue | 1 | Kafka (disabled) | N/A |
| Cache | 1 | Redis | Low |

### 1.3 Critical Dependencies

```
Dependency Graph
════════════════

Shell Web ──────┬──► Plugin Server ──► Plugin Frontends (12)
                │
                └──► Base SVC ──────┬──► Auth/Sessions
                                    ├──► WebSocket (Real-time)
                                    └──► Plugin Backends (12)
                                              │
                                              ▼
                                    PostgreSQL Databases (8)
```

### 1.4 Data Flow Patterns

1. **Synchronous**: HTTP REST (majority of traffic)
2. **Asynchronous**: WebSocket (debugger, real-time updates)
3. **Media**: WebRTC/WHIP (Daydream video only)
4. **File**: Multipart upload → Storage service → S3/Local

---

## 2. Target Architecture

### 2.1 Vercel-Native Architecture

```
Target Architecture (Vercel + External Services)
════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────┐
│                         VERCEL EDGE                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Edge Middleware                       │   │
│  │  (Auth, Rate Limiting, Routing, Security Headers)       │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌───────────────┐      ┌───────────────┐      ┌───────────────┐
│  Shell App    │      │ Plugin Assets │      │  API Routes   │
│  (Next.js)    │      │    (CDN)      │      │ (Serverless)  │
└───────────────┘      └───────────────┘      └───────────────┘
                                                      │
                                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                      EXTERNAL SERVICES                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │   Neon   │  │  Upstash │  │   Ably   │  │  Vercel  │       │
│  │PostgreSQL│  │  Redis   │  │ Realtime │  │   Blob   │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DEDICATED SERVICES (Railway)                  │
│  ┌──────────────────────┐  ┌──────────────────────┐            │
│  │   Daydream Video     │  │   Debugger Service   │            │
│  │   (WebRTC/WHIP)      │  │   (WebSocket)        │            │
│  └──────────────────────┘  └──────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Technology Stack Mapping

| Current | Target | Rationale |
|---------|--------|-----------|
| Vite + React | Next.js 14 (App Router) | Native Vercel support, SSR, API routes |
| Express.js | Vercel API Routes | Serverless, auto-scaling |
| 8× PostgreSQL | 1× Neon (multi-schema) | Cost, simplicity, branching |
| Redis (self-hosted) | Upstash Redis | Serverless-native |
| WebSocket (ws) | Ably/Pusher | Managed real-time |
| Local/S3 Storage | Vercel Blob | Native integration |
| Module Federation | Dynamic imports + CDN | Simpler, faster |
| PM2 | Vercel (managed) | No process management needed |
| Nginx | Vercel Edge | Built-in routing, caching |

### 2.3 Database Schema Consolidation

```
Current: 8 Separate Databases
═════════════════════════════
naap_base (users, sessions, auth)
naap_gateway (gateway configs)
naap_orchestrator (orchestration)
naap_capacity (capacity planning)
naap_analytics (network metrics)
naap_marketplace (plugins, listings)
naap_community (posts, comments)
naap_dashboard (dashboards, widgets)
+ naap_daydream_video (sessions)
+ naap_wallet (transactions)

Target: 1 Database, Multiple Schemas
════════════════════════════════════
naap_production
├── core (users, sessions, auth, teams)
├── plugins (marketplace, registry)
├── gateway (gateway configs)
├── orchestrator (orchestration)
├── capacity (capacity planning)
├── analytics (network metrics)
├── community (posts, comments)
├── dashboard (dashboards, widgets)
├── wallet (transactions)
└── daydream (video sessions)
```

---

## 3. Migration Phases Overview

```
Phase Timeline (12-16 weeks)
════════════════════════════

Week:  1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16
       │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │
P0 ════╪═══╪═══╝   │   │   │   │   │   │   │   │   │   │   │   │   │
       │   │       │   │   │   │   │   │   │   │   │   │   │   │   │
P1 ════╪═══╪═══════╪═══╪═══╝   │   │   │   │   │   │   │   │   │   │
       │   │       │   │       │   │   │   │   │   │   │   │   │   │
P2 ════╪═══╪═══════╪═══╪═══════╪═══╪═══╝   │   │   │   │   │   │   │
       │   │       │   │       │   │       │   │   │   │   │   │   │
P3 ════╪═══╪═══════╪═══╪═══════╪═══╪═══════╪═══╪═══╝   │   │   │   │
       │   │       │   │       │   │       │   │       │   │   │   │
P4 ════╪═══╪═══════╪═══╪═══════╪═══╪═══════╪═══╪═══════╪═══╝   │   │
       │   │       │   │       │   │       │   │       │   │   │   │
P5 ════╪═══╪═══════╪═══╪═══════╪═══╪═══════╪═══╪═══════╪═══╪═══╝   │
       │   │       │   │       │   │       │   │       │   │   │   │
P6 ════╪═══╪═══════╪═══╪═══════╪═══╪═══════╪═══╪═══════╪═══╪═══════╪═══╝
       │   │       │   │       │   │       │   │       │   │   │   │
P7 ════╪═══╪═══════╪═══╪═══════╪═══╪═══════╪═══╪═══════╪═══╪═══════╪═══╝

Legend:
═══ Active development
╝   Phase gate (review, test, sign-off)
```

### Phase Summary

| Phase | Name | Duration | Risk | Rollback |
|-------|------|----------|------|----------|
| 0 | Foundation & Preparation | 2 weeks | Low | N/A |
| 1 | Database Consolidation | 3 weeks | High | Full |
| 2 | Frontend Migration | 2 weeks | Low | Full |
| 3 | API Layer Migration | 2 weeks | Medium | Full |
| 4 | Real-time Services | 2 weeks | Medium | Partial |
| 5 | Storage & Infrastructure | 1 week | Low | Full |
| 6 | Plugin System | 2 weeks | Medium | Full |
| 7 | Final Cutover | 2 weeks | Medium | Full |

---

## Phase 0: Foundation & Preparation

**Duration**: 2 weeks
**Risk Level**: Low
**Objective**: Establish infrastructure, tooling, and safety nets before any migration work.

### 0.1 Tasks

#### 0.1.1 Environment Setup

```bash
# Create Vercel project structure
naap-vercel/
├── apps/
│   └── web/                 # Next.js app (shell + plugins)
├── packages/
│   ├── database/            # Prisma schemas (consolidated)
│   ├── api/                 # Shared API utilities
│   └── ui/                  # Shared UI components
├── vercel.json
└── turbo.json
```

**Deliverables**:
- [ ] Vercel organization created
- [ ] Neon database provisioned (development)
- [ ] Upstash Redis provisioned (development)
- [ ] Ably account created (development)
- [ ] Vercel Blob storage configured
- [ ] Environment variables documented

#### 0.1.2 CI/CD Pipeline

```yaml
# .github/workflows/migration-checks.yml
name: Migration Validation

on:
  pull_request:
    branches: [main, migration/*]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Lint
        run: npm run lint

  type-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Type Check
        run: npm run type-check

  test-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Unit Tests
        run: npm run test:unit

  test-integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: test
    steps:
      - uses: actions/checkout@v4
      - name: Integration Tests
        run: npm run test:integration

  test-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: E2E Tests (Playwright)
        run: npm run test:e2e
```

**Deliverables**:
- [ ] GitHub Actions workflows configured
- [ ] Vercel preview deployments enabled
- [ ] Branch protection rules set
- [ ] Required reviewers configured (2+ experts)

#### 0.1.3 Testing Infrastructure

```typescript
// tests/e2e/critical-paths.spec.ts
import { test, expect } from '@playwright/test';

// Critical user journeys that MUST pass before any phase completion
export const criticalPaths = [
  'user-registration',
  'user-login',
  'user-logout',
  'plugin-load',
  'plugin-navigate',
  'dashboard-view',
  'wallet-connect',
  'community-post',
  'marketplace-browse',
  'settings-update',
];

test.describe('Critical Path Tests', () => {
  for (const path of criticalPaths) {
    test(`Critical: ${path}`, async ({ page }) => {
      // Test implementation
    });
  }
});
```

**Deliverables**:
- [ ] Playwright E2E test suite (critical paths)
- [ ] Jest unit test suite (existing + new)
- [ ] API integration test suite
- [ ] Performance baseline captured
- [ ] Test coverage report (target: 80%+)

#### 0.1.4 Monitoring & Observability

```typescript
// lib/monitoring.ts
import { Vercel } from '@vercel/analytics';
import { SpeedInsights } from '@vercel/speed-insights';

// Error tracking
import * as Sentry from '@sentry/nextjs';

// Logging
import { log } from '@logtail/next';

export const monitoring = {
  init() {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.VERCEL_ENV,
      tracesSampleRate: 0.1,
    });
  },

  trackMigrationMetric(phase: string, metric: string, value: number) {
    log.info('migration_metric', { phase, metric, value });
  },
};
```

**Deliverables**:
- [ ] Sentry error tracking configured
- [ ] Vercel Analytics enabled
- [ ] Custom migration metrics dashboard
- [ ] Alerting rules defined

#### 0.1.5 Documentation

**Deliverables**:
- [ ] Architecture Decision Records (ADRs) for key decisions
- [ ] Runbook for each migration phase
- [ ] Rollback procedures documented
- [ ] Team training completed

### 0.2 Phase Gate Checklist

```markdown
## Phase 0 Completion Checklist

### Infrastructure
- [ ] All external services provisioned and accessible
- [ ] CI/CD pipeline running successfully
- [ ] Preview deployments working

### Testing
- [ ] E2E test suite covers all critical paths
- [ ] Unit test coverage ≥ 80%
- [ ] Performance baseline documented

### Documentation
- [ ] Migration runbook complete
- [ ] Rollback procedures tested
- [ ] Team sign-off obtained

### Review
- [ ] Security review completed
- [ ] Architecture review completed
- [ ] Cost analysis completed

### Sign-off
- [ ] Engineering Lead: _________________ Date: _______
- [ ] Security Lead: ___________________ Date: _______
- [ ] Product Owner: __________________ Date: _______
```

---

## Phase 1: Database Consolidation

**Duration**: 3 weeks
**Risk Level**: HIGH
**Objective**: Consolidate 8 PostgreSQL databases into 1 Neon database with schema separation.

### 1.1 Pre-Migration Analysis

#### 1.1.1 Data Inventory

```sql
-- Run on each existing database to capture metrics
SELECT
  schemaname,
  tablename,
  n_tup_ins as inserts,
  n_tup_upd as updates,
  n_tup_del as deletes,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

**Deliverables**:
- [ ] Complete data inventory for all 8 databases
- [ ] Table relationship mapping
- [ ] Data volume analysis
- [ ] Query pattern analysis (slow query log)

#### 1.1.2 Schema Design

```sql
-- Target schema structure
-- File: prisma/schema/core.prisma

generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["multiSchema"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["core", "plugins", "gateway", "orchestrator",
              "capacity", "analytics", "community", "dashboard",
              "wallet", "daydream"]
}

// Core schema - shared across all plugins
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  passwordHash  String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  // Relations to plugin schemas
  walletAccounts  WalletAccount[]  // wallet schema
  dashboards      Dashboard[]       // dashboard schema
  posts           Post[]            // community schema

  @@schema("core")
}

model Session {
  id        String   @id @default(cuid())
  userId    String
  token     String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id])

  @@schema("core")
}

// Plugin schema - marketplace & registry
model Plugin {
  id          String   @id @default(cuid())
  name        String   @unique
  version     String
  description String?
  author      String
  status      PluginStatus @default(PENDING)

  @@schema("plugins")
}

// Continue for each plugin's tables...
```

**Deliverables**:
- [ ] Consolidated Prisma schema file
- [ ] Foreign key relationships mapped across schemas
- [ ] Index strategy documented
- [ ] Migration scripts prepared

### 1.2 Migration Execution

#### 1.2.1 Week 1: Non-critical Databases

**Order**: analytics → capacity → orchestrator → gateway

```bash
# Migration script for each database
#!/bin/bash
set -e

DB_NAME=$1
SCHEMA_NAME=$2

echo "Migrating $DB_NAME to schema $SCHEMA_NAME..."

# 1. Create schema in Neon
psql $NEON_URL -c "CREATE SCHEMA IF NOT EXISTS $SCHEMA_NAME;"

# 2. Export from source
pg_dump -h localhost -p 5436 -U naap_analytics -d naap_analytics \
  --schema-only --no-owner > /tmp/${DB_NAME}_schema.sql

# 3. Transform schema references
sed -i "s/public\./${SCHEMA_NAME}\./g" /tmp/${DB_NAME}_schema.sql

# 4. Import to Neon
psql $NEON_URL -f /tmp/${DB_NAME}_schema.sql

# 5. Export data
pg_dump -h localhost -p 5436 -U naap_analytics -d naap_analytics \
  --data-only --no-owner > /tmp/${DB_NAME}_data.sql

# 6. Transform and import data
sed -i "s/public\./${SCHEMA_NAME}\./g" /tmp/${DB_NAME}_data.sql
psql $NEON_URL -f /tmp/${DB_NAME}_data.sql

# 7. Verify row counts
echo "Verifying migration..."
./verify_migration.sh $DB_NAME $SCHEMA_NAME
```

**Verification Script**:
```bash
#!/bin/bash
# verify_migration.sh

SOURCE_DB=$1
TARGET_SCHEMA=$2

echo "Comparing row counts..."

# Get source counts
SOURCE_COUNTS=$(psql -h localhost -p 5436 -U naap_$SOURCE_DB -d naap_$SOURCE_DB \
  -t -c "SELECT tablename, n_live_tup FROM pg_stat_user_tables ORDER BY tablename;")

# Get target counts
TARGET_COUNTS=$(psql $NEON_URL \
  -t -c "SELECT tablename, n_live_tup FROM pg_stat_user_tables WHERE schemaname='$TARGET_SCHEMA' ORDER BY tablename;")

# Compare
diff <(echo "$SOURCE_COUNTS") <(echo "$TARGET_COUNTS")

if [ $? -eq 0 ]; then
  echo "✅ Migration verified successfully"
else
  echo "❌ Row count mismatch detected!"
  exit 1
fi
```

**Deliverables**:
- [ ] analytics schema migrated and verified
- [ ] capacity schema migrated and verified
- [ ] orchestrator schema migrated and verified
- [ ] gateway schema migrated and verified

#### 1.2.2 Week 2: Critical Databases

**Order**: community → marketplace → dashboard → wallet

```typescript
// Database adapter for dual-write during migration
// lib/db/migration-adapter.ts

import { PrismaClient as LegacyClient } from '@prisma/legacy-client';
import { PrismaClient as NeonClient } from '@prisma/neon-client';

export class MigrationAdapter {
  private legacy: LegacyClient;
  private neon: NeonClient;
  private mode: 'legacy' | 'dual-write' | 'neon';

  constructor() {
    this.legacy = new LegacyClient();
    this.neon = new NeonClient();
    this.mode = process.env.DB_MODE as any || 'legacy';
  }

  async create<T>(model: string, data: any): Promise<T> {
    if (this.mode === 'legacy') {
      return this.legacy[model].create({ data });
    }

    if (this.mode === 'dual-write') {
      // Write to both, read from legacy
      const [legacyResult] = await Promise.all([
        this.legacy[model].create({ data }),
        this.neon[model].create({ data }).catch(err => {
          console.error('Neon write failed (non-blocking):', err);
        }),
      ]);
      return legacyResult;
    }

    return this.neon[model].create({ data });
  }

  async findMany<T>(model: string, args: any): Promise<T[]> {
    if (this.mode === 'neon') {
      return this.neon[model].findMany(args);
    }
    return this.legacy[model].findMany(args);
  }

  // ... other methods
}
```

**Deliverables**:
- [ ] Dual-write adapter implemented
- [ ] community schema migrated (dual-write mode)
- [ ] marketplace schema migrated (dual-write mode)
- [ ] dashboard schema migrated (dual-write mode)
- [ ] wallet schema migrated (dual-write mode)

#### 1.2.3 Week 3: Core Database & Cutover

**Core database migration (users, sessions, auth)**:

```typescript
// Migration with zero-downtime strategy
// scripts/migrate-core.ts

import { PrismaClient } from '@prisma/client';

async function migrateCore() {
  const legacy = new PrismaClient({ datasources: { db: { url: LEGACY_URL } } });
  const neon = new PrismaClient({ datasources: { db: { url: NEON_URL } } });

  console.log('Starting core migration...');

  // 1. Migrate users in batches
  let cursor: string | undefined;
  let batch = 0;

  while (true) {
    const users = await legacy.user.findMany({
      take: 1000,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { id: 'asc' },
    });

    if (users.length === 0) break;

    await neon.user.createMany({
      data: users,
      skipDuplicates: true,
    });

    cursor = users[users.length - 1].id;
    batch++;
    console.log(`Migrated batch ${batch} (${users.length} users)`);
  }

  // 2. Migrate sessions (active only)
  const activeSessions = await legacy.session.findMany({
    where: { expiresAt: { gt: new Date() } },
  });

  await neon.session.createMany({
    data: activeSessions,
    skipDuplicates: true,
  });

  console.log(`Migrated ${activeSessions.length} active sessions`);

  // 3. Verify integrity
  const legacyUserCount = await legacy.user.count();
  const neonUserCount = await neon.user.count();

  if (legacyUserCount !== neonUserCount) {
    throw new Error(`User count mismatch: ${legacyUserCount} vs ${neonUserCount}`);
  }

  console.log('✅ Core migration complete');
}
```

**Cutover procedure**:

```markdown
## Core Database Cutover Checklist

### Pre-cutover (T-1 hour)
- [ ] Announce maintenance window
- [ ] Disable new user registrations
- [ ] Complete final data sync
- [ ] Verify data integrity

### Cutover (T-0)
- [ ] Set DB_MODE=neon in environment
- [ ] Deploy updated configuration
- [ ] Verify application health
- [ ] Run smoke tests

### Post-cutover (T+1 hour)
- [ ] Monitor error rates
- [ ] Verify user logins working
- [ ] Check session persistence
- [ ] Enable registrations

### Rollback trigger conditions
- Error rate > 5%
- Login success rate < 95%
- P99 latency > 2s
```

**Deliverables**:
- [ ] Core schema migrated
- [ ] Dual-write verified for 24 hours
- [ ] Cutover completed
- [ ] Legacy databases kept as backup (7 days)

### 1.3 Phase Gate Checklist

```markdown
## Phase 1 Completion Checklist

### Data Integrity
- [ ] All tables migrated with matching row counts
- [ ] Foreign key relationships verified
- [ ] No orphaned records
- [ ] Indexes recreated and optimized

### Performance
- [ ] Query performance within 10% of baseline
- [ ] Connection pooling configured (Prisma Accelerate)
- [ ] No N+1 queries introduced

### Testing
- [ ] All E2E tests passing
- [ ] Data integrity tests passing
- [ ] Load test completed (same performance)

### Documentation
- [ ] Schema documentation updated
- [ ] Runbook for database operations
- [ ] Backup/restore procedures tested

### Review
- [ ] Database expert review completed
- [ ] Security review (access controls)
- [ ] Performance review

### Sign-off
- [ ] Database Lead: _________________ Date: _______
- [ ] Engineering Lead: ______________ Date: _______
- [ ] Security Lead: _________________ Date: _______
```

---

## Phase 2: Frontend Migration

**Duration**: 2 weeks
**Risk Level**: Low
**Objective**: Migrate shell and plugin frontends from Vite to Next.js with preserved Module Federation.

### 2.1 Shell Application Migration

#### 2.1.1 Next.js Setup

```typescript
// apps/web/next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: true,
  },

  // Preserve existing routing structure
  async rewrites() {
    return [
      // Plugin routes
      {
        source: '/plugins/:plugin/:path*',
        destination: '/plugins/:plugin/:path*',
      },
    ];
  },

  // Security headers (from Nginx)
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },

  // Webpack config for Module Federation compatibility
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
```

#### 2.1.2 Layout Migration

```typescript
// apps/web/app/layout.tsx
import { Inter } from 'next/font/google';
import { Providers } from '@/components/providers';
import { Shell } from '@/components/shell';
import '@/styles/globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'NaaP - Neutral AI and Application Platform',
  description: 'Plugin-based platform for AI and applications',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
```

#### 2.1.3 Plugin Loading System

```typescript
// apps/web/lib/plugin-loader.ts
import dynamic from 'next/dynamic';
import { type ComponentType } from 'react';

interface PluginManifest {
  name: string;
  version: string;
  entry: string;
  scope: string;
}

const pluginCache = new Map<string, ComponentType>();

export async function loadPlugin(pluginName: string): Promise<ComponentType> {
  // Check cache first
  if (pluginCache.has(pluginName)) {
    return pluginCache.get(pluginName)!;
  }

  // Fetch manifest from registry
  const manifest = await fetchPluginManifest(pluginName);

  // Dynamic import from CDN
  const PluginComponent = dynamic(
    () => import(/* webpackIgnore: true */ manifest.entry)
      .then(mod => mod.default || mod.App),
    {
      loading: () => <PluginSkeleton />,
      ssr: false,
    }
  );

  pluginCache.set(pluginName, PluginComponent);
  return PluginComponent;
}

async function fetchPluginManifest(name: string): Promise<PluginManifest> {
  const res = await fetch(`/api/plugins/${name}/manifest`);
  if (!res.ok) throw new Error(`Plugin not found: ${name}`);
  return res.json();
}
```

**Deliverables**:
- [ ] Next.js project structure created
- [ ] Shell layout migrated
- [ ] Navigation components migrated
- [ ] Theme system migrated
- [ ] Plugin loader implemented

### 2.2 Plugin Frontend Migration

#### 2.2.1 Plugin Build Configuration

```typescript
// plugins/[name]/frontend/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  build: {
    // Output as ESM module for dynamic import
    lib: {
      entry: 'src/App.tsx',
      formats: ['es'],
      fileName: 'index',
    },

    rollupOptions: {
      external: ['react', 'react-dom', 'react-router-dom'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react-router-dom': 'ReactRouterDOM',
        },
      },
    },

    // Content-hash for cache busting
    cssCodeSplit: false,
    minify: 'terser',
  },
});
```

#### 2.2.2 Plugin Deployment Pipeline

```yaml
# .github/workflows/plugin-deploy.yml
name: Deploy Plugin

on:
  push:
    paths:
      - 'plugins/*/frontend/**'

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Detect changed plugins
        id: changes
        run: |
          PLUGINS=$(git diff --name-only HEAD~1 | grep 'plugins/.*/frontend' | cut -d'/' -f2 | uniq)
          echo "plugins=$PLUGINS" >> $GITHUB_OUTPUT

      - name: Build plugins
        run: |
          for plugin in ${{ steps.changes.outputs.plugins }}; do
            cd plugins/$plugin/frontend
            npm ci
            npm run build
            cd -
          done

      - name: Deploy to Vercel Blob
        run: |
          for plugin in ${{ steps.changes.outputs.plugins }}; do
            vercel blob put "plugins/$plugin/" plugins/$plugin/frontend/dist/* \
              --token=${{ secrets.VERCEL_TOKEN }}
          done

      - name: Update plugin registry
        run: |
          for plugin in ${{ steps.changes.outputs.plugins }}; do
            curl -X POST "${{ secrets.API_URL }}/api/plugins/$plugin/deploy" \
              -H "Authorization: Bearer ${{ secrets.API_TOKEN }}" \
              -d '{"version": "${{ github.sha }}"}'
          done
```

**Deliverables**:
- [ ] All 12 plugin frontends migrated to ESM build
- [ ] Plugin deployment pipeline working
- [ ] Plugin registry API implemented
- [ ] CDN caching configured

### 2.3 Phase Gate Checklist

```markdown
## Phase 2 Completion Checklist

### Functionality
- [ ] Shell renders correctly
- [ ] All plugins load successfully
- [ ] Navigation works between plugins
- [ ] Deep links work
- [ ] Authentication flow works

### Performance
- [ ] LCP < 2.5s
- [ ] FID < 100ms
- [ ] CLS < 0.1
- [ ] Bundle size within 10% of baseline

### Testing
- [ ] E2E tests passing
- [ ] Visual regression tests passing
- [ ] Accessibility audit passed (WCAG 2.1 AA)

### Documentation
- [ ] Component documentation updated
- [ ] Plugin development guide updated

### Review
- [ ] Frontend expert review completed
- [ ] UX review completed
- [ ] Performance review completed

### Sign-off
- [ ] Frontend Lead: _________________ Date: _______
- [ ] UX Lead: ______________________ Date: _______
- [ ] Engineering Lead: ______________ Date: _______
```

---

## Phase 3: API Layer Migration

**Duration**: 2 weeks
**Risk Level**: Medium
**Objective**: Migrate Express.js backends to Vercel API Routes with serverless compatibility.

### 3.1 API Route Structure

```
apps/web/app/api/
├── auth/
│   ├── login/route.ts
│   ├── logout/route.ts
│   ├── register/route.ts
│   ├── session/route.ts
│   └── oauth/
│       ├── github/route.ts
│       └── google/route.ts
├── users/
│   ├── route.ts
│   ├── [id]/route.ts
│   └── me/route.ts
├── plugins/
│   ├── route.ts
│   ├── [name]/
│   │   ├── route.ts
│   │   └── manifest/route.ts
├── wallet/
│   └── [...path]/route.ts
├── dashboard/
│   └── [...path]/route.ts
├── community/
│   └── [...path]/route.ts
├── marketplace/
│   └── [...path]/route.ts
├── gateway/
│   └── [...path]/route.ts
├── orchestrator/
│   └── [...path]/route.ts
├── capacity/
│   └── [...path]/route.ts
├── analytics/
│   └── [...path]/route.ts
└── daydream/
    └── [...path]/route.ts
```

### 3.2 Express to API Route Adapter

```typescript
// lib/api/express-adapter.ts
import { NextRequest, NextResponse } from 'next/server';
import { type RequestHandler } from 'express';

type ApiHandler = (req: NextRequest) => Promise<NextResponse>;

export function adaptExpressHandler(
  handler: RequestHandler
): ApiHandler {
  return async (req: NextRequest) => {
    // Create Express-compatible request/response objects
    const expressReq = await createExpressRequest(req);
    const expressRes = createExpressResponse();

    return new Promise((resolve) => {
      expressRes.on('finish', () => {
        resolve(new NextResponse(expressRes.body, {
          status: expressRes.statusCode,
          headers: expressRes.headers,
        }));
      });

      handler(expressReq, expressRes, (err) => {
        if (err) {
          resolve(NextResponse.json(
            { error: err.message },
            { status: 500 }
          ));
        }
      });
    });
  };
}

// Alternative: Full rewrite (recommended for new code)
export function createApiHandler<T>(
  schema: z.ZodSchema<T>,
  handler: (data: T, req: NextRequest) => Promise<NextResponse>
): ApiHandler {
  return async (req: NextRequest) => {
    try {
      // Parse and validate input
      const body = await req.json().catch(() => ({}));
      const query = Object.fromEntries(req.nextUrl.searchParams);
      const data = schema.parse({ ...body, ...query });

      // Execute handler
      return await handler(data, req);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation failed', details: error.errors },
          { status: 400 }
        );
      }

      console.error('API Error:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  };
}
```

### 3.3 Example Migration: Auth API

```typescript
// Before: plugins/base-svc/src/routes/auth.ts (Express)
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !await bcrypt.compare(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      token: crypto.randomUUID(),
      expiresAt: addDays(new Date(), 7),
    },
  });

  res.cookie('session', session.token, { httpOnly: true, secure: true });
  res.json({ user: { id: user.id, email: user.email, name: user.name } });
});

// After: apps/web/app/api/auth/login/route.ts (Next.js)
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { compare } from 'bcryptjs';
import { addDays } from 'date-fns';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = loginSchema.parse(body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !await compare(password, user.passwordHash!)) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        token: crypto.randomUUID(),
        expiresAt: addDays(new Date(), 7),
      },
    });

    cookies().set('session', session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }

    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

### 3.4 Plugin API Catch-All Route

```typescript
// apps/web/app/api/[plugin]/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getPluginHandler } from '@/lib/api/plugin-registry';
import { validateAuth } from '@/lib/auth';

export async function GET(
  req: NextRequest,
  { params }: { params: { plugin: string; path: string[] } }
) {
  return handlePluginRequest(req, params, 'GET');
}

export async function POST(
  req: NextRequest,
  { params }: { params: { plugin: string; path: string[] } }
) {
  return handlePluginRequest(req, params, 'POST');
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { plugin: string; path: string[] } }
) {
  return handlePluginRequest(req, params, 'PATCH');
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { plugin: string; path: string[] } }
) {
  return handlePluginRequest(req, params, 'DELETE');
}

async function handlePluginRequest(
  req: NextRequest,
  params: { plugin: string; path: string[] },
  method: string
) {
  const { plugin, path } = params;

  // Validate authentication
  const auth = await validateAuth(req);
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get plugin handler
  const handler = await getPluginHandler(plugin, path.join('/'), method);
  if (!handler) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Execute handler with context
  return handler(req, { user: auth.user, plugin });
}
```

### 3.5 Serverless Considerations

```typescript
// lib/db/index.ts
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { Pool } from '@neondatabase/serverless';

// Serverless-optimized Prisma client
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

function createPrismaClient() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaNeon(pool);

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : ['error'],
  });
}
```

### 3.6 Phase Gate Checklist

```markdown
## Phase 3 Completion Checklist

### Functionality
- [ ] All API endpoints migrated
- [ ] Authentication working
- [ ] Authorization (RBAC) working
- [ ] Rate limiting configured
- [ ] CORS configured

### Performance
- [ ] Cold start < 500ms
- [ ] P50 latency < 100ms
- [ ] P99 latency < 500ms
- [ ] No connection pool exhaustion

### Testing
- [ ] API integration tests passing
- [ ] Load tests passing (1000 req/s)
- [ ] Security tests passing

### Documentation
- [ ] API documentation (OpenAPI)
- [ ] Error codes documented
- [ ] Rate limits documented

### Review
- [ ] API design review completed
- [ ] Security review completed
- [ ] Performance review completed

### Sign-off
- [ ] Backend Lead: _________________ Date: _______
- [ ] Security Lead: ________________ Date: _______
- [ ] Engineering Lead: _____________ Date: _______
```

---

## Phase 4: Real-time Services Migration

**Duration**: 2 weeks
**Risk Level**: Medium
**Objective**: Migrate WebSocket services to Ably/Pusher for serverless compatibility.

### 4.1 Real-time Architecture

```
Current WebSocket Architecture
══════════════════════════════

┌─────────────┐     WebSocket      ┌─────────────┐
│   Browser   │◄──────────────────►│  base-svc   │
└─────────────┘                    └─────────────┘
       │                                  │
       │                                  ▼
       │                           ┌─────────────┐
       └───────WebSocket──────────►│  debugger   │
                                   └─────────────┘


Target Architecture (Ably)
══════════════════════════

┌─────────────┐     Ably SDK      ┌─────────────┐
│   Browser   │◄─────────────────►│    Ably     │
└─────────────┘                   │   Cloud     │
                                  └─────────────┘
                                        ▲
                                        │ Ably REST API
                                        │
┌─────────────────────────────────────────────────────┐
│                   Vercel Functions                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │  Auth Hook  │  │ Event Pub   │  │ Presence    │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 4.2 Ably Integration

```typescript
// lib/realtime/ably-client.ts (Browser)
import Ably from 'ably';

let ablyClient: Ably.Realtime | null = null;

export function getAblyClient(): Ably.Realtime {
  if (!ablyClient) {
    ablyClient = new Ably.Realtime({
      authUrl: '/api/realtime/token',
      authMethod: 'POST',
    });
  }
  return ablyClient;
}

export function subscribeToChannel(
  channelName: string,
  eventName: string,
  callback: (message: Ably.Message) => void
) {
  const channel = getAblyClient().channels.get(channelName);
  channel.subscribe(eventName, callback);

  return () => {
    channel.unsubscribe(eventName, callback);
  };
}

// lib/realtime/ably-server.ts (Server)
import Ably from 'ably';

const ablyRest = new Ably.Rest(process.env.ABLY_API_KEY!);

export async function publishEvent(
  channelName: string,
  eventName: string,
  data: unknown
) {
  const channel = ablyRest.channels.get(channelName);
  await channel.publish(eventName, data);
}

export async function createTokenRequest(
  userId: string,
  capabilities: Record<string, string[]>
) {
  return ablyRest.auth.createTokenRequest({
    clientId: userId,
    capability: capabilities,
  });
}
```

### 4.3 Token Authentication Endpoint

```typescript
// apps/web/app/api/realtime/token/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/lib/auth';
import { createTokenRequest } from '@/lib/realtime/ably-server';

export async function POST(req: NextRequest) {
  const auth = await validateAuth(req);
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Define capabilities based on user role
  const capabilities: Record<string, string[]> = {
    [`user:${auth.user.id}`]: ['subscribe', 'publish'],
    'notifications': ['subscribe'],
  };

  // Add plugin channels if user has access
  for (const plugin of auth.user.plugins) {
    capabilities[`plugin:${plugin}`] = ['subscribe'];
  }

  // Admin gets debug channel access
  if (auth.user.role === 'admin') {
    capabilities['debug:*'] = ['subscribe'];
  }

  const tokenRequest = await createTokenRequest(auth.user.id, capabilities);
  return NextResponse.json(tokenRequest);
}
```

### 4.4 Migrate Debugger to Ably

```typescript
// Before: WebSocket in debugger service
wss.on('connection', (ws, req) => {
  ws.on('message', (data) => {
    const { action, plugin } = JSON.parse(data);
    if (action === 'subscribe') {
      subscriptions.set(ws, plugin);
    }
  });
});

// Broadcast logs
function broadcastLog(plugin: string, log: LogEntry) {
  for (const [ws, subscribedPlugin] of subscriptions) {
    if (subscribedPlugin === plugin || subscribedPlugin === '*') {
      ws.send(JSON.stringify(log));
    }
  }
}

// After: Ably-based debugger
// apps/web/app/api/debug/log/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { publishEvent } from '@/lib/realtime/ably-server';
import { validateAuth } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const auth = await validateAuth(req);
  if (!auth.valid || auth.user.role !== 'service') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { plugin, level, message, timestamp, meta } = await req.json();

  // Publish to plugin-specific channel
  await publishEvent(`debug:${plugin}`, 'log', {
    plugin,
    level,
    message,
    timestamp,
    meta,
  });

  // Also publish to global debug channel for admins
  await publishEvent('debug:all', 'log', {
    plugin,
    level,
    message,
    timestamp,
    meta,
  });

  return NextResponse.json({ success: true });
}

// hooks/useDebugLogs.ts (Client)
import { useEffect, useState } from 'react';
import { subscribeToChannel } from '@/lib/realtime/ably-client';

export function useDebugLogs(plugin: string | '*') {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    const channel = plugin === '*' ? 'debug:all' : `debug:${plugin}`;

    const unsubscribe = subscribeToChannel(channel, 'log', (message) => {
      setLogs(prev => [...prev, message.data].slice(-1000));
    });

    return unsubscribe;
  }, [plugin]);

  return logs;
}
```

### 4.5 Migrate Notification System

```typescript
// lib/notifications.ts
import { publishEvent } from '@/lib/realtime/ably-server';

export async function sendNotification(
  userId: string,
  notification: {
    type: 'info' | 'success' | 'warning' | 'error';
    title: string;
    message: string;
    action?: { label: string; url: string };
  }
) {
  // Store in database for persistence
  await prisma.notification.create({
    data: {
      userId,
      ...notification,
      read: false,
    },
  });

  // Publish for real-time delivery
  await publishEvent(`user:${userId}`, 'notification', notification);
}

// hooks/useNotifications.ts (Client)
import { useEffect } from 'react';
import { subscribeToChannel } from '@/lib/realtime/ably-client';
import { useToast } from '@/components/ui/toast';

export function useNotifications(userId: string) {
  const { toast } = useToast();

  useEffect(() => {
    const unsubscribe = subscribeToChannel(
      `user:${userId}`,
      'notification',
      (message) => {
        const notification = message.data;
        toast({
          title: notification.title,
          description: notification.message,
          variant: notification.type,
        });
      }
    );

    return unsubscribe;
  }, [userId, toast]);
}
```

### 4.6 Daydream Video Service (Keep Dedicated)

```typescript
// Daydream stays on Railway/Render due to WebRTC requirements
// Update frontend to point to dedicated service

// lib/daydream/config.ts
export const DAYDREAM_CONFIG = {
  // API endpoint (Vercel function for metadata)
  apiUrl: process.env.NEXT_PUBLIC_DAYDREAM_API_URL,

  // WebRTC endpoint (dedicated server)
  whipUrl: process.env.NEXT_PUBLIC_DAYDREAM_WHIP_URL,

  // Playback (Livepeer)
  playbackUrl: 'https://lvpr.tv',
};

// apps/web/app/api/daydream/streams/route.ts
// Proxy to dedicated Daydream service
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const auth = await validateAuth(req);
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();

  // Forward to dedicated Daydream service
  const response = await fetch(`${DAYDREAM_CONFIG.apiUrl}/streams`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': auth.user.id,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
```

### 4.7 Phase Gate Checklist

```markdown
## Phase 4 Completion Checklist

### Functionality
- [ ] Real-time notifications working
- [ ] Debug log streaming working
- [ ] Presence indicators working
- [ ] Reconnection handling working

### Performance
- [ ] Message latency < 100ms
- [ ] Connection establishment < 500ms
- [ ] No message loss under load

### Testing
- [ ] Real-time integration tests passing
- [ ] Chaos testing (disconnect/reconnect)
- [ ] Load testing (10,000 concurrent connections)

### Documentation
- [ ] Real-time API documentation
- [ ] Channel naming conventions
- [ ] Capability matrix documented

### Review
- [ ] Real-time architecture review
- [ ] Security review (channel access)
- [ ] Cost analysis review

### Sign-off
- [ ] Backend Lead: _________________ Date: _______
- [ ] Security Lead: ________________ Date: _______
- [ ] Engineering Lead: _____________ Date: _______
```

---

## Phase 5: Storage & Infrastructure

**Duration**: 1 week
**Risk Level**: Low
**Objective**: Migrate file storage to Vercel Blob and finalize infrastructure.

### 5.1 Vercel Blob Integration

```typescript
// lib/storage/blob.ts
import { put, del, list } from '@vercel/blob';

export async function uploadFile(
  file: File | Buffer,
  path: string,
  options?: { contentType?: string; access?: 'public' | 'private' }
): Promise<{ url: string; pathname: string }> {
  const blob = await put(path, file, {
    access: options?.access || 'public',
    contentType: options?.contentType,
  });

  return {
    url: blob.url,
    pathname: blob.pathname,
  };
}

export async function deleteFile(url: string): Promise<void> {
  await del(url);
}

export async function listFiles(prefix: string): Promise<string[]> {
  const { blobs } = await list({ prefix });
  return blobs.map(blob => blob.url);
}
```

### 5.2 Plugin Artifact Storage

```typescript
// apps/web/app/api/plugins/[name]/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { uploadFile } from '@/lib/storage/blob';
import { validateAuth } from '@/lib/auth';

export async function POST(
  req: NextRequest,
  { params }: { params: { name: string } }
) {
  const auth = await validateAuth(req);
  if (!auth.valid || !auth.user.canPublishPlugins) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get('file') as File;

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  // Validate file
  if (!file.name.endsWith('.zip')) {
    return NextResponse.json({ error: 'Must be a ZIP file' }, { status: 400 });
  }

  if (file.size > 50 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large (max 50MB)' }, { status: 400 });
  }

  // Upload to Vercel Blob
  const { url, pathname } = await uploadFile(
    file,
    `plugins/${params.name}/${Date.now()}.zip`,
    { contentType: 'application/zip' }
  );

  // Update plugin registry
  await prisma.pluginVersion.create({
    data: {
      pluginName: params.name,
      version: formData.get('version') as string,
      artifactUrl: url,
      uploadedBy: auth.user.id,
    },
  });

  return NextResponse.json({ url, pathname });
}
```

### 5.3 Edge Middleware

```typescript
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Security headers
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // CSP header
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn.vercel-insights.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.ably.io wss://*.ably.io https://*.vercel-insights.com",
      "frame-src 'self' https://lvpr.tv",
    ].join('; ')
  );

  // Rate limiting (via Vercel Edge Config or Upstash)
  // Implemented in specific API routes

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
```

### 5.4 Environment Configuration

```typescript
// vercel.json
{
  "buildCommand": "turbo run build",
  "outputDirectory": "apps/web/.next",
  "framework": "nextjs",
  "regions": ["iad1"],
  "env": {
    "DATABASE_URL": "@database-url",
    "ABLY_API_KEY": "@ably-api-key",
    "UPSTASH_REDIS_REST_URL": "@upstash-redis-url",
    "UPSTASH_REDIS_REST_TOKEN": "@upstash-redis-token"
  },
  "crons": [
    {
      "path": "/api/cron/cleanup-sessions",
      "schedule": "0 * * * *"
    },
    {
      "path": "/api/cron/cleanup-stale-uploads",
      "schedule": "0 0 * * *"
    }
  ]
}
```

### 5.5 Phase Gate Checklist

```markdown
## Phase 5 Completion Checklist

### Functionality
- [ ] File uploads working
- [ ] File downloads working
- [ ] Plugin artifacts stored correctly
- [ ] CDN caching working

### Security
- [ ] CSP headers configured
- [ ] CORS configured
- [ ] Rate limiting working
- [ ] File type validation working

### Testing
- [ ] Upload/download tests passing
- [ ] Security headers verified
- [ ] Rate limiting tested

### Documentation
- [ ] Storage API documented
- [ ] Environment variables documented
- [ ] Security configuration documented

### Sign-off
- [ ] Infrastructure Lead: ____________ Date: _______
- [ ] Security Lead: _________________ Date: _______
```

---

## Phase 6: Plugin System Modernization

**Duration**: 2 weeks
**Risk Level**: Medium
**Objective**: Modernize plugin system for contributor-friendly deployment.

### 6.1 Plugin Registry

```typescript
// lib/plugins/registry.ts
import { prisma } from '@/lib/db';
import { redis } from '@/lib/cache';

export interface PluginManifest {
  name: string;
  version: string;
  displayName: string;
  description: string;
  author: string;
  entryPoint: string;
  permissions: string[];
  dependencies: Record<string, string>;
}

export async function getPluginManifest(name: string): Promise<PluginManifest | null> {
  // Check cache first
  const cached = await redis.get(`plugin:${name}:manifest`);
  if (cached) {
    return JSON.parse(cached);
  }

  // Fetch from database
  const plugin = await prisma.plugin.findUnique({
    where: { name },
    include: { latestVersion: true },
  });

  if (!plugin) return null;

  const manifest: PluginManifest = {
    name: plugin.name,
    version: plugin.latestVersion.version,
    displayName: plugin.displayName,
    description: plugin.description,
    author: plugin.author,
    entryPoint: plugin.latestVersion.artifactUrl,
    permissions: plugin.permissions,
    dependencies: plugin.latestVersion.dependencies,
  };

  // Cache for 5 minutes
  await redis.setex(`plugin:${name}:manifest`, 300, JSON.stringify(manifest));

  return manifest;
}

export async function registerPlugin(
  manifest: PluginManifest,
  userId: string
): Promise<void> {
  await prisma.plugin.upsert({
    where: { name: manifest.name },
    create: {
      name: manifest.name,
      displayName: manifest.displayName,
      description: manifest.description,
      author: manifest.author,
      permissions: manifest.permissions,
      ownerId: userId,
      versions: {
        create: {
          version: manifest.version,
          artifactUrl: manifest.entryPoint,
          dependencies: manifest.dependencies,
        },
      },
    },
    update: {
      displayName: manifest.displayName,
      description: manifest.description,
      versions: {
        create: {
          version: manifest.version,
          artifactUrl: manifest.entryPoint,
          dependencies: manifest.dependencies,
        },
      },
    },
  });

  // Invalidate cache
  await redis.del(`plugin:${manifest.name}:manifest`);
}
```

### 6.2 Plugin CLI for Contributors

```typescript
// packages/plugin-cli/src/commands/deploy.ts
import { Command } from 'commander';
import { build } from 'vite';
import { upload } from './upload';
import { register } from './register';

export const deployCommand = new Command('deploy')
  .description('Build and deploy plugin to NaaP')
  .option('-e, --env <env>', 'Target environment', 'preview')
  .action(async (options) => {
    console.log('Building plugin...');

    // 1. Build frontend
    await build({
      configFile: 'vite.config.ts',
      mode: 'production',
    });

    // 2. Package backend (if exists)
    if (fs.existsSync('backend')) {
      await packageBackend();
    }

    // 3. Upload artifacts
    console.log('Uploading artifacts...');
    const artifactUrl = await upload('./dist', options.env);

    // 4. Register with platform
    console.log('Registering plugin...');
    const manifest = JSON.parse(fs.readFileSync('plugin.json', 'utf-8'));
    await register({ ...manifest, entryPoint: artifactUrl }, options.env);

    console.log('✅ Plugin deployed successfully!');
    console.log(`Preview: https://preview.naap.dev/plugins/${manifest.name}`);
  });
```

### 6.3 Plugin Sandbox

```typescript
// lib/plugins/sandbox.ts
import { createContext, Script } from 'vm';

export function createPluginSandbox(pluginName: string) {
  // Restricted global context for server-side plugin execution
  const sandbox = {
    console: createScopedConsole(pluginName),
    fetch: createScopedFetch(pluginName),
    setTimeout: (fn: Function, ms: number) => setTimeout(fn, Math.min(ms, 30000)),
    setInterval: undefined, // Disabled in serverless
    process: { env: getPluginEnv(pluginName) },

    // NaaP SDK
    naap: {
      db: createPluginDbClient(pluginName),
      cache: createPluginCacheClient(pluginName),
      storage: createPluginStorageClient(pluginName),
    },
  };

  return createContext(sandbox);
}

function createScopedFetch(pluginName: string) {
  return async (url: string, options?: RequestInit) => {
    // Log external requests
    console.log(`[${pluginName}] fetch: ${url}`);

    // Block internal URLs
    if (url.startsWith('http://localhost') || url.includes('127.0.0.1')) {
      throw new Error('Internal URLs not allowed');
    }

    return fetch(url, {
      ...options,
      headers: {
        ...options?.headers,
        'X-Plugin-Name': pluginName,
      },
    });
  };
}
```

### 6.4 Plugin Review Workflow

```typescript
// apps/web/app/api/plugins/[name]/submit/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/lib/auth';
import { sendNotification } from '@/lib/notifications';

export async function POST(
  req: NextRequest,
  { params }: { params: { name: string } }
) {
  const auth = await validateAuth(req);
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const plugin = await prisma.plugin.findUnique({
    where: { name: params.name },
    include: { latestVersion: true },
  });

  if (!plugin) {
    return NextResponse.json({ error: 'Plugin not found' }, { status: 404 });
  }

  if (plugin.ownerId !== auth.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Create review request
  const review = await prisma.pluginReview.create({
    data: {
      pluginId: plugin.id,
      versionId: plugin.latestVersion.id,
      status: 'PENDING',
      submittedBy: auth.user.id,
    },
  });

  // Notify reviewers
  const reviewers = await prisma.user.findMany({
    where: { role: 'PLUGIN_REVIEWER' },
  });

  for (const reviewer of reviewers) {
    await sendNotification(reviewer.id, {
      type: 'info',
      title: 'New Plugin Review',
      message: `${plugin.displayName} v${plugin.latestVersion.version} submitted for review`,
      action: { label: 'Review', url: `/admin/plugins/${plugin.name}/review` },
    });
  }

  return NextResponse.json({ reviewId: review.id, status: 'PENDING' });
}
```

### 6.5 Phase Gate Checklist

```markdown
## Phase 6 Completion Checklist

### Functionality
- [ ] Plugin registry working
- [ ] Plugin deployment working
- [ ] Plugin loading working
- [ ] Plugin review workflow working

### Developer Experience
- [ ] CLI documented and tested
- [ ] Plugin template created
- [ ] Documentation site updated
- [ ] Example plugins created

### Security
- [ ] Plugin sandboxing working
- [ ] Permission system working
- [ ] Review workflow enforced

### Testing
- [ ] Plugin deployment tests passing
- [ ] Plugin loading tests passing
- [ ] Sandbox security tests passing

### Sign-off
- [ ] Platform Lead: _________________ Date: _______
- [ ] Security Lead: _________________ Date: _______
- [ ] Developer Relations: ___________ Date: _______
```

---

## Phase 7: Final Cutover & Optimization

**Duration**: 2 weeks
**Risk Level**: Medium
**Objective**: Complete migration, optimize performance, and decommission legacy infrastructure.

### 7.1 Production Cutover Checklist

```markdown
## Production Cutover Plan

### T-7 Days: Preparation
- [ ] Final security audit completed
- [ ] Load testing completed (2x expected traffic)
- [ ] Runbook reviewed by on-call team
- [ ] Rollback procedure tested
- [ ] Communication plan prepared

### T-1 Day: Final Checks
- [ ] All E2E tests passing on staging
- [ ] Performance metrics within targets
- [ ] Monitoring dashboards ready
- [ ] On-call rotation confirmed
- [ ] Customer communication sent

### T-0: Cutover
- [ ] Enable maintenance mode on legacy
- [ ] Final data sync (if applicable)
- [ ] DNS cutover to Vercel
- [ ] Verify all endpoints responding
- [ ] Run smoke tests
- [ ] Disable maintenance mode

### T+1 Hour: Validation
- [ ] Error rate < 0.1%
- [ ] P99 latency < 500ms
- [ ] All critical paths working
- [ ] Real-time features working
- [ ] File uploads working

### T+24 Hours: Stabilization
- [ ] No critical issues reported
- [ ] Performance stable
- [ ] Scale testing (if needed)
- [ ] Legacy infrastructure standby

### T+7 Days: Decommission
- [ ] Legacy traffic confirmed zero
- [ ] Database backups verified
- [ ] Legacy infrastructure shutdown
- [ ] Cost savings confirmed
```

### 7.2 Performance Optimization

```typescript
// next.config.js optimizations
const nextConfig = {
  // Enable React Server Components
  experimental: {
    serverActions: true,
    ppr: true, // Partial Pre-Rendering
  },

  // Image optimization
  images: {
    remotePatterns: [
      { hostname: '*.vercel-storage.com' },
      { hostname: '*.blob.vercel-storage.com' },
    ],
  },

  // Bundle analysis
  webpack: (config, { isServer }) => {
    if (process.env.ANALYZE === 'true') {
      const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
      config.plugins.push(
        new BundleAnalyzerPlugin({
          analyzerMode: 'static',
          reportFilename: isServer ? 'server.html' : 'client.html',
        })
      );
    }
    return config;
  },
};
```

### 7.3 Cost Optimization

```markdown
## Vercel Cost Optimization

### Compute
- Use Edge Functions for simple operations (auth checks, redirects)
- Use Serverless Functions for complex operations (database, external APIs)
- Implement aggressive caching (ISR, SWR)

### Database (Neon)
- Use connection pooling (Prisma Accelerate)
- Implement query caching (Upstash Redis)
- Archive old data to cold storage

### Storage (Vercel Blob)
- Set appropriate cache headers
- Implement lifecycle policies for temp files
- Use presigned URLs for large uploads

### Real-time (Ably)
- Use channel multiplexing
- Implement presence efficiently
- Archive logs instead of real-time streaming

### Estimated Monthly Costs
| Service | Tier | Est. Cost |
|---------|------|-----------|
| Vercel | Pro | $20/seat |
| Neon | Launch | $19/mo |
| Upstash Redis | Pay-as-you-go | ~$10/mo |
| Ably | Free/Pro | $0-99/mo |
| Vercel Blob | Pay-as-you-go | ~$5/mo |
| **Total** | | **~$50-150/mo** |
```

### 7.4 Final Phase Gate Checklist

```markdown
## Phase 7 Completion Checklist

### Functionality
- [ ] All features working in production
- [ ] All plugins migrated
- [ ] All users migrated
- [ ] All data migrated

### Performance
- [ ] LCP < 2.5s (all pages)
- [ ] API P99 < 500ms
- [ ] Real-time latency < 100ms
- [ ] Uptime > 99.9%

### Security
- [ ] Penetration test completed
- [ ] Security audit completed
- [ ] Compliance verified (if applicable)

### Operations
- [ ] Monitoring complete
- [ ] Alerting configured
- [ ] Runbooks finalized
- [ ] On-call trained

### Documentation
- [ ] Architecture documentation updated
- [ ] API documentation updated
- [ ] Contributor guide updated
- [ ] Deployment guide updated

### Business
- [ ] Cost analysis completed
- [ ] SLA defined
- [ ] Support process defined

### Final Sign-off
- [ ] CTO: __________________________ Date: _______
- [ ] Engineering Lead: ______________ Date: _______
- [ ] Security Lead: _________________ Date: _______
- [ ] Product Owner: _________________ Date: _______
- [ ] Operations Lead: _______________ Date: _______
```

---

## Risk Management Matrix

| Risk | Probability | Impact | Mitigation | Contingency |
|------|-------------|--------|------------|-------------|
| Data loss during DB migration | Low | Critical | Dual-write, backups, verification | Restore from backup |
| Performance degradation | Medium | High | Load testing, gradual rollout | Scale up, rollback |
| WebSocket feature regression | Medium | Medium | Thorough testing, Ably fallback | Keep legacy WS service |
| Plugin compatibility issues | Medium | Medium | Testing matrix, contributor outreach | Compatibility shim |
| Cost overrun | Low | Medium | Monitoring, alerts, budgets | Optimize or scale down |
| Security vulnerability | Low | Critical | Security audit, pen testing | Immediate patch, rollback |
| Vendor lock-in | Low | Medium | Abstract service interfaces | Migration path documented |

---

## Rollback Procedures

### Database Rollback (Phase 1)

```bash
#!/bin/bash
# rollback-database.sh

echo "Starting database rollback..."

# 1. Stop new writes to Neon
vercel env rm DATABASE_URL --yes
vercel env add DATABASE_URL "$LEGACY_DATABASE_URL"

# 2. Redeploy with legacy database
vercel --prod

# 3. Verify legacy database is being used
curl -X POST https://naap.dev/api/health/db

echo "Database rollback complete"
```

### Frontend Rollback (Phase 2)

```bash
#!/bin/bash
# rollback-frontend.sh

echo "Starting frontend rollback..."

# 1. Redeploy previous version
vercel rollback

# 2. Verify deployment
curl -I https://naap.dev

echo "Frontend rollback complete"
```

### Full Rollback

```bash
#!/bin/bash
# rollback-full.sh

echo "Starting full rollback to legacy infrastructure..."

# 1. Update DNS to point to legacy Nginx
# (Manual step - requires DNS provider access)

# 2. Start legacy services
ssh legacy-server "cd /opt/naap && docker-compose up -d"

# 3. Verify legacy is running
curl -I https://legacy.naap.dev/healthz

# 4. Update DNS TTL and switch
echo "Manual DNS switch required"

echo "Full rollback initiated - complete DNS switch manually"
```

---

## Success Metrics

### Technical Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Page Load (LCP) | 3.2s | < 2.5s | Vercel Analytics |
| API Latency (P99) | 450ms | < 500ms | Vercel Analytics |
| Error Rate | 0.5% | < 0.1% | Sentry |
| Uptime | 99.5% | > 99.9% | Vercel Status |
| Cold Start | N/A | < 500ms | Custom logging |

### Business Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Infrastructure Cost | $500/mo | < $200/mo | Cloud billing |
| Deployment Time | 15 min | < 2 min | CI/CD metrics |
| Developer Onboarding | 2 days | < 2 hours | Survey |
| Plugin Deployment | Manual | < 5 min | CLI metrics |

### Quality Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Test Coverage | > 80% | Jest/Playwright |
| Security Score | A+ | Mozilla Observatory |
| Accessibility | WCAG 2.1 AA | axe-core |
| Documentation | Complete | Manual review |

---

## Appendix

### A. Environment Variables Reference

```bash
# Database
DATABASE_URL=postgresql://...@neon.tech/naap

# Authentication
NEXTAUTH_SECRET=...
NEXTAUTH_URL=https://naap.dev

# External Services
ABLY_API_KEY=...
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...

# Storage
BLOB_READ_WRITE_TOKEN=...

# Monitoring
SENTRY_DSN=...
SENTRY_AUTH_TOKEN=...

# Feature Flags
ENABLE_REALTIME=true
ENABLE_PLUGINS=true
```

### B. Team Responsibilities

| Phase | Lead | Reviewers | On-call |
|-------|------|-----------|---------|
| 0 | Platform Lead | All Leads | N/A |
| 1 | Database Lead | Platform, Security | Database |
| 2 | Frontend Lead | Platform, UX | Frontend |
| 3 | Backend Lead | Platform, Security | Backend |
| 4 | Backend Lead | Platform, Security | Backend |
| 5 | Platform Lead | Security | Platform |
| 6 | Platform Lead | Security, DevRel | Platform |
| 7 | CTO | All Leads | All |

### C. Communication Plan

| Event | Audience | Channel | Timing |
|-------|----------|---------|--------|
| Phase Start | Team | Slack #migration | Day 1 |
| Phase Complete | Team | Slack #migration | Completion |
| Blocker | Leads | Slack #migration-leads | Immediate |
| Cutover | All stakeholders | Email, Slack | T-7, T-1, T-0 |
| Incident | On-call, Leads | PagerDuty | Immediate |

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-02 | Claude | Initial version |

**Next Review Date**: Before Phase 0 kickoff

**Approval Required From**:
- [ ] CTO
- [ ] Engineering Lead
- [ ] Security Lead
- [ ] Product Owner
