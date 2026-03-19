# LPT Financial Command Center — Implementation Plan

## Context

LPT investors lack tooling to manage staking portfolios effectively. The Livepeer Explorer offers basic views but no data export, no multi-wallet management, no yield tracking, no alerts, and no orchestrator comparison. Users (persona: Financial Director) need Bloomberg-terminal-level portfolio management for their LPT staking positions.

This plan enhances the existing `my-wallet` plugin in NaaP to deliver a self-contained "LPT Financial Command Center" across 3 phases.

**Branch**: `feat/mywallet-advanced` (in NaaP repo)

---

## Deployment Architecture: Local + Vercel (No Refactoring)

NaaP uses a **dual-layer API pattern**. Every API endpoint must have BOTH layers to work in both environments:

### Layer 1: Next.js Route Handlers (Vercel-compatible)
- Location: `apps/web-next/src/app/api/v1/wallet/`
- Use `@/lib/db` (Prisma), `@/lib/api/auth`, `@/lib/api/response`, `@/lib/api/csrf`
- Work on **both local dev and Vercel** (serverless functions)
- Existing examples: `wallet/connections/route.ts`, `wallet/transactions/route.ts`, `wallet/staking/state/route.ts`
- Pattern: `validateSession(token)` → Prisma query → `success()` / `errors.xxx()`

### Layer 2: Express Backend (Docker/local dev)
- Location: `examples/my-wallet/backend/src/`
- The catch-all proxy at `apps/web-next/src/app/api/v1/[plugin]/[...path]/route.ts` forwards to Express
- On Vercel, if `WALLET_URL` env is not set, proxy returns **501 NOT_IMPLEMENTED**
- This layer is for: local dev convenience, Docker production, and cron jobs

### Implementation Rule

**For every new API endpoint:**
1. Create the Next.js route handler FIRST in `apps/web-next/src/app/api/v1/wallet/` — this is the **primary, Vercel-compatible** path
2. Create the Express route in `examples/my-wallet/backend/src/routes/` — this is the **secondary, Docker/local** path
3. Both implementations share the same Prisma models and business logic
4. Extract shared business logic into `examples/my-wallet/backend/src/lib/` and import from both layers

### Shared Logic Strategy (DRY — no duplication)

To avoid writing business logic twice:
- **Pure logic** (yield calc, CSV builder, validation) lives in `examples/my-wallet/backend/src/lib/`
- **Next.js routes** import these via a `@wallet/lib` alias or relative path
- **Express routes** import the same files
- Both call into the same Prisma client (unified `@naap/database`)

### Cron Jobs (Phase 2)

Cron jobs (snapshots, price fetching, alert checking) run in the Express backend process. On Vercel:
- **Option A (recommended)**: Vercel Cron (`vercel.json` cron config) calls Next.js API routes that trigger the same job logic
- **Option B**: External scheduler (GitHub Actions, Railway cron) calls the API endpoints
- **Option C**: User triggers "Sync Now" button in the UI which calls the snapshot/price endpoints on-demand

### File Ownership Summary

| Location | Environment | Role |
|----------|-------------|------|
| `apps/web-next/src/app/api/v1/wallet/**` | Local + Vercel | **Primary API** — Next.js route handlers |
| `examples/my-wallet/backend/src/` | Local + Docker | **Secondary API** — Express server + cron jobs |
| `examples/my-wallet/backend/src/lib/` | Both (imported) | **Shared logic** — yield calc, CSV, validation |
| `examples/my-wallet/frontend/src/` | Both | **Frontend** — UMD bundle (dev via Vite, prod via CDN) |
| `packages/database/prisma/schema.prisma` | Both | **Schema** — shared Prisma models |

### New Next.js Route Files Required

**Phase 1:**
```
apps/web-next/src/app/api/v1/wallet/
├── addresses/
│   ├── route.ts              (GET list, POST create)
│   └── [id]/
│       └── route.ts          (PATCH update, DELETE remove)
├── portfolio/
│   ├── route.ts              (GET aggregated portfolio)
│   └── positions/
│       └── route.ts          (GET per-O positions)
├── unbonding-locks/
│   └── route.ts              (GET all locks)
└── protocol/
    └── params/
        └── route.ts          (GET cached protocol params)
```

**Phase 2:**
```
apps/web-next/src/app/api/v1/wallet/
├── yield/
│   └── route.ts              (GET yield calculation)
├── prices/
│   └── route.ts              (GET cached prices)
├── alerts/
│   ├── route.ts              (GET list, POST create)
│   ├── [id]/
│   │   └── route.ts          (PATCH update, DELETE remove)
│   └── history/
│       ├── route.ts          (GET paginated history)
│       └── [id]/
│           └── route.ts      (PATCH mark as read)
├── orchestrators/
│   └── compare/
│       └── route.ts          (GET side-by-side comparison)
├── network/
│   └── benchmarks/
│       └── route.ts          (GET network-level stats)
└── export/
    ├── leaderboard/
    │   └── route.ts          (GET CSV/JSON export)
    └── positions/
        └── route.ts          (GET CSV/JSON export)
```

---

## Phase 1: "Foundation & Portfolio" (~2 weeks)

**Stories**: S1 (multi-wallet), S2 (per-O breakdown), S11 (full staking ops), S12 (unbonding tracker)

### 1.1 Schema Changes

**File**: `packages/database/prisma/schema.prisma` (under `@@schema("plugin_wallet")`)

**Replace** `WalletConnection` (userId @unique → one wallet per user) with:

```prisma
model WalletAddress {
  id            String   @id @default(cuid())
  userId        String                        // no longer @unique — many per user
  address       String
  label         String?                       // e.g. "Hardware Wallet", "Arbitrum Main"
  chainId       Int      @default(42161)
  isPrimary     Boolean  @default(false)
  connectedAt   DateTime @default(now())
  lastSyncedAt  DateTime?

  stakingStates  WalletStakingState[]
  transactions   WalletTransactionLog[]
  unbondingLocks WalletUnbondingLock[]
  snapshots      WalletStakingSnapshot[]

  @@unique([userId, address, chainId])
  @@index([userId])
  @@schema("plugin_wallet")
}

model WalletUnbondingLock {
  id              String    @id @default(cuid())
  walletAddressId String
  lockId          Int
  amount          Decimal   @db.Decimal(78, 0)
  withdrawRound   Int
  status          String    @default("pending")  // pending | withdrawable | withdrawn | rebonded
  createdAt       DateTime  @default(now())
  resolvedAt      DateTime?
  txHash          String?
  walletAddress   WalletAddress @relation(fields: [walletAddressId], references: [id], onDelete: Cascade)

  @@unique([walletAddressId, lockId])
  @@index([status])
  @@schema("plugin_wallet")
}
```

**Data migration**: Migrate existing `WalletConnection` rows into `WalletAddress` with `isPrimary=true`. Update FK references in `WalletStakingState` and `WalletTransactionLog`.

### 1.2 Backend Changes (Dual-Layer: Next.js + Express)

**Shared business logic** (in `examples/my-wallet/backend/src/lib/`):

| File | Purpose |
|------|---------|
| `lib/addressService.ts` | WalletAddress CRUD operations (Prisma queries) |
| `lib/portfolioService.ts` | Aggregate portfolio + per-O position queries |
| `lib/unbondingService.ts` | Unbonding lock queries + status updates |
| `lib/protocolService.ts` | Protocol params fetch + cache |
| `lib/validators.ts` | Shared input validation (address, chainId, etc.) |

**Layer 1: Next.js route handlers** (in `apps/web-next/src/app/api/v1/wallet/`):

| File | Purpose |
|------|---------|
| `addresses/route.ts` | GET list, POST create |
| `addresses/[id]/route.ts` | PATCH update, DELETE remove |
| `portfolio/route.ts` | GET aggregated portfolio |
| `portfolio/positions/route.ts` | GET per-O positions |
| `unbonding-locks/route.ts` | GET all locks |
| `protocol/params/route.ts` | GET cached protocol params |

These import from `examples/my-wallet/backend/src/lib/` and follow existing patterns (see `wallet/connections/route.ts` — `validateSession` → service call → `success()`).

**Layer 2: Express routes** (in `examples/my-wallet/backend/src/routes/`):

| File | Purpose |
|------|---------|
| `routes/walletAddresses.ts` | Same endpoints, Express wrappers |
| `routes/portfolio.ts` | Same, Express wrappers |
| `routes/unbondingLocks.ts` | Same, Express wrappers |
| `routes/protocol.ts` | Same, Express wrappers |
| `middleware/validateOwnership.ts` | Verify user owns requested addressId |

**Modified**: `server.ts` — mount new Express routes.

**Pattern**: Both layers call the SAME service functions in `lib/`. No logic duplication.

### 1.3 Frontend Changes

**New hooks** (in `examples/my-wallet/frontend/src/hooks/`):

| Hook | Returns |
|------|---------|
| `useWalletAddresses.ts` | `{ addresses, addAddress, removeAddress, setPrimary, isLoading }` |
| `usePortfolio.ts` | `{ totalStaked, totalRewards, totalFees, positions[], isLoading }` |
| `useUnbondingLocks.ts` | `{ locks[], isLoading }` — merges on-chain + DB state |
| `useProtocolParams.ts` | `{ currentRound, roundLength, unbondingPeriod }` |
| `useStakingOps.ts` | Enhanced version of `useStaking.ts` — adds `redelegate()`, `rebond()`, `withdrawStake()` |
| `useRoundCountdown.ts` | `{ days, hours, minutes, seconds, percentComplete }` given a target round |

**New components** (in `examples/my-wallet/frontend/src/components/`):

| Component | Description |
|-----------|-------------|
| `WalletSelector.tsx` | Dropdown to select wallet + "Add Wallet" button |
| `PortfolioSummary.tsx` | 4x glass-card Stat tiles (Total Staked, Pending Rewards, Pending Fees, Portfolio Value) |
| `PositionsTable.tsx` | `@naap/ui DataTable` — sortable columns: Orchestrator, Staked, Reward Cut, Fee Share, Pending Rewards, Status |
| `UnbondingPanel.tsx` | Collapsible panel listing unbonding locks with countdown timers |
| `UnbondingCountdown.tsx` | Real-time countdown: `4d 12h 33m` or "READY" with progress bar |
| `AddWalletModal.tsx` | `@naap/ui Modal` — connect MetaMask account + assign label |
| `WalletBadge.tsx` | Truncated address `0x1a2...3f` + label + chain icon |
| `staking/BondForm.tsx` | Amount + orchestrator selector + approve flow |
| `staking/UnbondForm.tsx` | Amount input with max-stake limit |
| `staking/RedelegateForm.tsx` | Current O → New O selector |
| `staking/ClaimForm.tsx` | Claim earnings up to current round |
| `staking/WithdrawForm.tsx` | Withdraw ready locks + withdraw fees |
| `staking/OrchestratorSelect.tsx` | Searchable dropdown with O metrics preview |
| `staking/TxConfirmationDialog.tsx` | Gas estimate, confirm button, MetaMask signing |

**New/modified pages**:

| Page | Action |
|------|--------|
| `Portfolio.tsx` | **New** — replaces Dashboard as main view. Shows WalletSelector → PortfolioSummary → PositionsTable → UnbondingPanel |
| `Staking.tsx` | **Modify** — replace 3-tab form with 5-tab form (Bond/Unbond/Redelegate/Claim/Withdraw), add wallet selector |
| `App.tsx` | **Modify** — add `/portfolio` and `/compare` routes, redirect `/dashboard` → `/portfolio` |

### 1.4 ABI Enhancement

**File**: `examples/my-wallet/frontend/src/lib/contracts.ts`

Add to `BONDING_MANAGER_ABI`:
- `getDelegatorUnbondingLock(address, uint256) view returns (uint256, uint256)` — for unbonding tracker
- `rebond(uint256)`, `rebondFromUnbonded(address, uint256)` — already present but add if missing
- `unbondingPeriod() view returns (uint64)` — for protocol params
- `getTotalBonded() view returns (uint256)` — for benchmarks

### 1.5 UX Design Principles

- **Information hierarchy**: Portfolio summary (glance) → Position table (scan) → Lock details (drill-down)
- **Glass-card pattern**: Consistent with existing `.glass-card p-6` styling
- **Monospace for numbers**: All LPT/ETH amounts, addresses, rounds use `font-mono`
- **Color semantics**: emerald=profit/active, rose=loss/failed, amber=warning/pending, purple=primary/interactive
- **Loading states**: Skeleton components (`@naap/ui Skeleton`) not spinners
- **Backward compat**: Single-wallet users see same UX (selector shows but is non-interactive)

### 1.6 Testing

- **Schema migration**: Jest — roundtrip WalletAddress CRUD, cascade deletes, unique constraint enforcement
- **Backend API**: Supertest — happy paths, auth required, validation errors, ownership checks per endpoint
- **Hooks**: Vitest + RTL — mock ethers.js Contract, verify approve-before-bond flow, countdown math
- **Components**: Vitest snapshot tests — PositionsTable renders/sorts, UnbondingCountdown shows "READY"
- **Integration**: Playwright — connect wallet → add 2nd wallet → see aggregated portfolio → bond/unbond flow
- **Contract ops**: Hardhat fork (Arbitrum) — verify bond/unbond/claim against live state

### 1.7 Quality Gate (100 points, target >= 90)

| Category | Points | Criteria |
|----------|--------|----------|
| **Functionality** | 40 | Multi-wallet CRUD (8), Portfolio aggregation correct (8), Per-O positions match chain (6), All 6 staking ops work (10), Unbonding locks + countdown accurate (8) |
| **UX Quality** | 20 | Glass-card consistent (4), Monospace numbers/truncated addresses (3), Skeleton loading states (3), Error states with retry (3), Responsive at 375px (4), Color coding correct (3) |
| **Code Quality** | 20 | No `any` types in new code (4), Hooks follow loading/error/data pattern (4), Express patterns match existing (3), Public functions have JSDoc (3), DRY (3), Coverage >= 80% (3) |
| **Performance** | 10 | Portfolio loads < 2s (4), No unnecessary re-renders (3), Protocol params cached 5min (3) |
| **Accessibility** | 5 | Keyboard navigable (2), ARIA labels on icon buttons (1), Color + text indicators (2) |
| **Deployment** | 5 | Works in local+Express mode AND Vercel-only mode (2), Migration runs on fresh + existing DB (2), Env vars documented (1) |

---

## Phase 2: "Intelligence & Export" (~2 weeks)

**Stories**: S3 (export), S4 (yield), S5 (alerts), S6 (comparison), S10 (benchmarks), S14 (USD overlay)

### 2.1 Schema Additions

```prisma
model WalletStakingSnapshot {
  id               String   @id @default(cuid())
  walletAddressId  String
  orchestratorAddr String
  bondedAmount     Decimal  @db.Decimal(78, 0)
  pendingStake     Decimal  @db.Decimal(78, 0)
  pendingFees      Decimal  @db.Decimal(78, 0)
  round            Int
  snapshotAt       DateTime @default(now())
  walletAddress    WalletAddress @relation(fields: [walletAddressId], references: [id], onDelete: Cascade)
  @@index([walletAddressId, round])
  @@index([snapshotAt])
  @@schema("plugin_wallet")
}

model WalletAlert {
  id               String    @id @default(cuid())
  userId           String
  type             String    // reward_cut_change | missed_reward | deactivation | unbonding_ready
  orchestratorAddr String?
  threshold        String?   // JSON config
  enabled          Boolean   @default(true)
  createdAt        DateTime  @default(now())
  history          WalletAlertHistory[]
  @@index([userId, type])
  @@schema("plugin_wallet")
}

model WalletAlertHistory {
  id        String    @id @default(cuid())
  alertId   String
  message   String
  data      String?
  readAt    DateTime?
  createdAt DateTime  @default(now())
  alert     WalletAlert @relation(fields: [alertId], references: [id], onDelete: Cascade)
  @@index([alertId, createdAt])
  @@schema("plugin_wallet")
}

model WalletPriceCache {
  id        String   @id @default(cuid())
  symbol    String
  priceUsd  Decimal  @db.Decimal(20, 8)
  source    String   @default("coingecko")
  fetchedAt DateTime @default(now())
  @@unique([symbol, fetchedAt])
  @@index([symbol, fetchedAt])
  @@schema("plugin_wallet")
}
```

### 2.2 Backend: Cron Jobs (Dual-Mode)

**Job logic** (in `examples/my-wallet/backend/src/jobs/`):

| File | Purpose |
|------|---------|
| `snapshotStaking.ts` | Snapshot all user positions to WalletStakingSnapshot |
| `fetchPrices.ts` | LPT/USD + ETH/USD from CoinGecko → WalletPriceCache |
| `checkAlerts.ts` | Evaluate alert rules, create WalletAlertHistory entries |
| `updateUnbonding.ts` | Mark locks "withdrawable" when withdrawRound <= currentRound |

**Trigger Mode 1: Express scheduler** (local dev + Docker)
- `scheduler.ts` uses `node-cron` or `setInterval` to run jobs at configured intervals
- Runs inside the Express backend process

**Trigger Mode 2: Vercel Cron + Next.js API** (Vercel production)
- Add `vercel.json` cron config that calls Next.js API trigger endpoints:
  ```
  apps/web-next/src/app/api/v1/wallet/jobs/snapshot/route.ts
  apps/web-next/src/app/api/v1/wallet/jobs/prices/route.ts
  apps/web-next/src/app/api/v1/wallet/jobs/alerts/route.ts
  apps/web-next/src/app/api/v1/wallet/jobs/unbonding/route.ts
  ```
- These route handlers import the SAME job functions from `backend/src/jobs/` and call them
- Protected by a `CRON_SECRET` env var (Vercel passes this automatically)

**Trigger Mode 3: On-demand** (both environments)
- "Sync Now" button in the UI calls a `/api/v1/wallet/sync` endpoint
- Triggers snapshot + price fetch for the current user only (not all users)

This ensures cron functionality works in ALL deployment scenarios without refactoring.

### 2.3 Backend: New Endpoints (Dual-Layer)

Each endpoint gets BOTH a Next.js route handler AND an Express route, sharing logic from `backend/src/lib/`:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/wallet/yield?period=7d\|30d\|90d\|ytd` | Compute annualized yield from snapshots |
| `GET /api/v1/wallet/prices` | Current LPT/USD, ETH/USD from cache |
| `CRUD /api/v1/wallet/alerts` | Alert config management |
| `GET /api/v1/wallet/alerts/history` | Paginated alert history |
| `GET /api/v1/wallet/orchestrators/compare?addresses=0x1,0x2` | Side-by-side O data (max 4) |
| `GET /api/v1/wallet/network/benchmarks` | Total staked, participation rate, avg reward cut/fee share, inflation |
| `GET /api/v1/wallet/export/leaderboard?format=csv\|json` | Full orchestrator leaderboard export |
| `GET /api/v1/wallet/export/positions?format=csv\|json` | User positions export |

**New shared service files** (in `examples/my-wallet/backend/src/lib/`):
- `yieldCalc.ts` — pure yield computation functions
- `csvBuilder.ts` — generic CSV generation utility
- `alertService.ts` — alert CRUD + evaluation logic
- `priceService.ts` — price fetch + cache logic
- `compareService.ts` — orchestrator comparison queries
- `benchmarkService.ts` — network benchmark aggregation
- `exportService.ts` — export formatting (CSV/JSON)
- `chartTheme.ts` (frontend only) — shared recharts dark theme config

**Yield calculation**: `annualizedYield = ((endPendingStake - startPendingStake) / startBondedAmount) * (365 / periodDays)`

### 2.4 Frontend: New Hooks

| Hook | Returns |
|------|---------|
| `useYield.ts` | `{ rewardYield, feeYield, combinedApy, chart[], period, setPeriod }` |
| `usePrices.ts` | `{ lptUsd, ethUsd, isLoading }` — polls every 5min |
| `useAlerts.ts` | `{ alerts, history, unreadCount, create, update, markRead }` |
| `useCompare.ts` | `{ orchestrators[], addO, removeO }` — for up to 4 Os |
| `useBenchmarks.ts` | `{ participationRate, avgRewardCut, avgFeeShare, inflation }` |
| `useExport.ts` | `{ exportCSV(type), exportJSON(type), isExporting }` — triggers Blob download |

### 2.5 Frontend: New Components

| Component | Description |
|-----------|-------------|
| `YieldCard.tsx` | Period selector (7d/30d/90d/YTD) + 3 stat cards (Reward Yield, Fee Yield, Combined APY) |
| `charts/YieldChart.tsx` | recharts AreaChart — cumulative yield over selected period |
| `ComparisonGrid.tsx` | 1-4 side-by-side O cards with all metrics |
| `charts/ComparisonChart.tsx` | recharts grouped BarChart for cross-O metric comparison |
| `NetworkBenchmarks.tsx` | Collapsible panel: participation rate, inflation, avg cuts — overlaid with user position |
| `charts/BenchmarkDistribution.tsx` | Distribution chart showing where user sits vs network |
| `AlertsPanel.tsx` | Alert history list with bell icon + unread badge |
| `AlertConfigModal.tsx` | Modal to configure alert rules |
| `AlertItem.tsx` | Single alert row with icon, message, time, dismiss |
| `ExportButton.tsx` | Reusable `[Export CSV] [Export JSON]` button pair |
| `PriceDisplay.tsx` | Shows LPT/ETH amount + USD equivalent below; uses `usePrices` |

**New pages**:
- `Compare.tsx` — Orchestrator comparison page (side-by-side cards + charts)

**Modified pages**:
- `Portfolio.tsx` — Add YieldCard, NetworkBenchmarks, AlertsPanel sections
- `Settings.tsx` — Add "Show USD Prices" toggle, alert preferences

### 2.6 UX: Key Design Decisions

- **Export buttons visible in table headers** — not buried in menus (the #1 user complaint)
- **Period selector as pill buttons** — `[7d] [30d] [90d] [YTD]` with active state `bg-accent-purple text-white`
- **Charts**: recharts with dark theme, monospace tick labels, `rgba(255,255,255,0.06)` grid lines
- **Alert bell**: Top-right of Portfolio page header, badge shows unread count in red
- **USD overlay**: Secondary line under LPT/ETH amounts, dimmer text `text-text-muted`, toggleable via Settings
- **Comparison layout**: Flex row, cards stack on mobile `grid-cols-1 md:grid-cols-2 lg:grid-cols-4`

### 2.7 Testing

- **Yield calc**: Unit tests — various snapshot inputs, zero start, missing data, single snapshot
- **Price cron**: Integration — mock CoinGecko response, verify WalletPriceCache upsert
- **Alert evaluation**: Unit tests per type — mock chain state, verify trigger/no-trigger
- **Export**: Supertest — CSV has correct headers/rows, JSON schema validates
- **Charts**: Vitest snapshot tests with mock data
- **E2E**: Playwright — navigate to Compare, add 2 Os, verify cards render, export CSV downloads

### 2.8 Quality Gate (100 points, target >= 90)

| Category | Points | Criteria |
|----------|--------|----------|
| **Functionality** | 40 | Yield correct for all periods (8), Alerts trigger for 4 types (8), Export valid CSV+JSON (6), Comparison for 2-4 Os (6), USD within 1% of CoinGecko (6), Benchmarks correct (6) |
| **UX Quality** | 20 | Charts dark-themed (4), Export buttons visible (3), Alert bell + badge (3), Period selector no-reload (3), Comparison cards align (4), Mobile stacking (3) |
| **Code Quality** | 20 | Crons idempotent (4), Yield calc pure function (4), Charts accept data via props (3), Alert thresholds configurable (3), Export utility reusable (3), Coverage >= 80% (3) |
| **Performance** | 10 | Yield endpoint < 500ms (4), Price from cache < 50ms (3), Chart render < 100ms (3) |
| **Accessibility** | 5 | Charts have aria-label (2), Alert items keyboard-dismissable (1), Color + text indicators (2) |
| **Deployment** | 5 | Works in local+Express AND Vercel-only mode (1), Cron jobs work via both Express scheduler + Vercel Cron (2), Migration no data loss (1), CoinGecko key in .env.example (1) |

---

## Phase 3: "Advanced Analytics" (Remaining 11 Stories)

**Stories**: S7, S8, S9, S13, S15, S16, S17, S18, S19, S20, S21

### 3.1 Sub-Phase Breakdown

**Phase 3a: "History & Analysis"** (~2 weeks) — S7, S9, S13, S15, S20
- S7: Transaction history with gas accounting (running gas cost total, cost-basis tracking)
- S9: Orchestrator reward-call consistency (% of rounds called reward, miss streaks)
- S13: P&L export (combine yield + price history + gas into comprehensive CSV)
- S15: Watchlists (new `WalletWatchlist` model — track Os without delegating)
- S20: Multi-address unified portfolio (cross-address aggregation view)

**Phase 3b: "Simulation & Automation"** (~2 weeks) — S8, S16, S17
- S8: Rebalancing simulator ("what if move X LPT from O-A to O-B?" with projected yield delta)
- S16: Risk score (composite: reward consistency + stake concentration + tenure + fee share stability)
- S17: Auto-claim (notification-based — backend detects threshold, pushes notification, user approves via MetaMask)

**Phase 3c: "Governance & Intelligence"** (~2 weeks) — S18, S19, S21
- S18: Governance tracking (LIPs, how user's Os vote)
- S19: AI recommendations (weighted scoring v1, LLM-powered advice v2)
- S21: Historical network analytics (time-series: total staked, inflation, participation over months)

### 3.2 Schema Additions

```prisma
model WalletWatchlist {
  id               String   @id @default(cuid())
  userId           String
  orchestratorAddr String
  label            String?
  notes            String?
  addedAt          DateTime @default(now())
  @@unique([userId, orchestratorAddr])
  @@schema("plugin_wallet")
}

model WalletGovernanceProposal {
  id           String   @id @default(cuid())
  proposalId   BigInt
  title        String
  description  String?
  status       String
  votesFor     Decimal  @db.Decimal(78, 0)
  votesAgainst Decimal  @db.Decimal(78, 0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@schema("plugin_wallet")
}

model WalletAutoClaimConfig {
  id              String    @id @default(cuid())
  walletAddressId String    @unique
  enabled         Boolean   @default(false)
  minRewardLpt    Decimal   @db.Decimal(78, 0)
  lastClaimedAt   DateTime?
  @@schema("plugin_wallet")
}
```

### 3.3 Dependency Chain

```
Phase 1 (required) → Phase 2 (required) → Phase 3a → Phase 3b → Phase 3c
                                           S7  ─┐
                                           S9  ─┤→ S16 (risk score uses S9 data)
                                           S13 ─┘→ S8  (simulator uses yield + positions)
                                           S15     S17 (auto-claim uses cron infra)
                                           S20
                                                   S18 → S19 (AI uses all data)
                                                         S21
```

### 3.4 Key Technical Decisions

- **S17 Auto-claim**: Use notification-based approach (not key custody). Backend detects threshold → pushes alert → user clicks "Claim Now" in plugin → MetaMask signs.
- **S19 AI**: Expose `/api/v1/wallet/ai/recommend` endpoint. V1 = weighted scoring algorithm. V2 = LLM integration via `@naap/plugin-sdk` AI capabilities.
- **S21 Historical data**: Use Livepeer subgraph (The Graph) for backfill. Pattern already exists in `plugins/dashboard-data-provider/frontend/src/api/subgraph.ts`.

### 3.5 Quality Gate

Same 100-point rubric applied per sub-phase. Each sub-phase must reach 90/100 before proceeding.

---

## Cross-Cutting: Files Summary

### Plugin-internal files (all changes here)

```
examples/my-wallet/
├── frontend/src/
│   ├── App.tsx                          (modify: add routes)
│   ├── hooks/
│   │   ├── useWalletAddresses.ts        (new: Phase 1)
│   │   ├── usePortfolio.ts              (new: Phase 1)
│   │   ├── useUnbondingLocks.ts         (new: Phase 1)
│   │   ├── useProtocolParams.ts         (new: Phase 1)
│   │   ├── useStakingOps.ts             (new: Phase 1 — enhanced useStaking)
│   │   ├── useRoundCountdown.ts         (new: Phase 1)
│   │   ├── useYield.ts                  (new: Phase 2)
│   │   ├── usePrices.ts                 (new: Phase 2)
│   │   ├── useAlerts.ts                 (new: Phase 2)
│   │   ├── useCompare.ts               (new: Phase 2)
│   │   ├── useBenchmarks.ts            (new: Phase 2)
│   │   └── useExport.ts                (new: Phase 2)
│   ├── pages/
│   │   ├── Portfolio.tsx                (new: Phase 1 — replaces Dashboard)
│   │   ├── Staking.tsx                  (modify: Phase 1 — 5-tab form)
│   │   ├── Compare.tsx                  (new: Phase 2)
│   │   └── Settings.tsx                 (modify: Phase 2 — USD toggle, alerts)
│   ├── components/
│   │   ├── WalletSelector.tsx           (new: Phase 1)
│   │   ├── PortfolioSummary.tsx         (new: Phase 1)
│   │   ├── PositionsTable.tsx           (new: Phase 1)
│   │   ├── UnbondingPanel.tsx           (new: Phase 1)
│   │   ├── UnbondingCountdown.tsx       (new: Phase 1)
│   │   ├── AddWalletModal.tsx           (new: Phase 1)
│   │   ├── WalletBadge.tsx              (new: Phase 1)
│   │   ├── staking/BondForm.tsx         (new: Phase 1)
│   │   ├── staking/UnbondForm.tsx       (new: Phase 1)
│   │   ├── staking/RedelegateForm.tsx   (new: Phase 1)
│   │   ├── staking/ClaimForm.tsx        (new: Phase 1)
│   │   ├── staking/WithdrawForm.tsx     (new: Phase 1)
│   │   ├── staking/OrchestratorSelect.tsx (new: Phase 1)
│   │   ├── staking/TxConfirmationDialog.tsx (new: Phase 1)
│   │   ├── YieldCard.tsx                (new: Phase 2)
│   │   ├── charts/YieldChart.tsx        (new: Phase 2)
│   │   ├── ComparisonGrid.tsx           (new: Phase 2)
│   │   ├── charts/ComparisonChart.tsx   (new: Phase 2)
│   │   ├── NetworkBenchmarks.tsx        (new: Phase 2)
│   │   ├── charts/BenchmarkDistribution.tsx (new: Phase 2)
│   │   ├── AlertsPanel.tsx              (new: Phase 2)
│   │   ├── AlertConfigModal.tsx         (new: Phase 2)
│   │   ├── AlertItem.tsx                (new: Phase 2)
│   │   ├── ExportButton.tsx             (new: Phase 2)
│   │   └── PriceDisplay.tsx             (new: Phase 2)
│   └── lib/
│       ├── contracts.ts                 (modify: Phase 1 — add ABI methods)
│       └── chartTheme.ts               (new: Phase 2)
├── backend/src/
│   ├── server.ts                        (modify: mount new routes)
│   ├── routes/
│   │   ├── walletAddresses.ts           (new: Phase 1)
│   │   ├── portfolio.ts                 (new: Phase 1)
│   │   ├── unbondingLocks.ts            (new: Phase 1)
│   │   ├── protocol.ts                  (new: Phase 1)
│   │   ├── yield.ts                     (new: Phase 2)
│   │   ├── prices.ts                    (new: Phase 2)
│   │   ├── alerts.ts                    (new: Phase 2)
│   │   ├── compare.ts                   (new: Phase 2)
│   │   ├── benchmarks.ts               (new: Phase 2)
│   │   └── export.ts                    (new: Phase 2)
│   ├── jobs/
│   │   ├── scheduler.ts                 (new: Phase 2)
│   │   ├── snapshotStaking.ts           (new: Phase 2)
│   │   ├── fetchPrices.ts              (new: Phase 2)
│   │   ├── checkAlerts.ts              (new: Phase 2)
│   │   └── updateUnbonding.ts          (new: Phase 2)
│   ├── lib/
│   │   ├── yieldCalc.ts                 (new: Phase 2)
│   │   └── csvBuilder.ts               (new: Phase 2)
│   └── middleware/
│       └── validateOwnership.ts         (new: Phase 1)
```

### Next.js route handlers (Vercel-compatible API layer)

```
apps/web-next/src/app/api/v1/wallet/
├── addresses/
│   ├── route.ts                           (new: Phase 1)
│   └── [id]/
│       └── route.ts                       (new: Phase 1)
├── portfolio/
│   ├── route.ts                           (new: Phase 1)
│   └── positions/
│       └── route.ts                       (new: Phase 1)
├── unbonding-locks/
│   └── route.ts                           (new: Phase 1)
├── protocol/
│   └── params/
│       └── route.ts                       (new: Phase 1)
├── connections/
│   └── route.ts                           (modify: Phase 1 — update for WalletAddress model)
├── yield/
│   └── route.ts                           (new: Phase 2)
├── prices/
│   └── route.ts                           (new: Phase 2)
├── alerts/
│   ├── route.ts                           (new: Phase 2)
│   ├── [id]/
│   │   └── route.ts                       (new: Phase 2)
│   └── history/
│       ├── route.ts                       (new: Phase 2)
│       └── [id]/
│           └── route.ts                   (new: Phase 2)
├── orchestrators/
│   └── compare/
│       └── route.ts                       (new: Phase 2)
├── network/
│   └── benchmarks/
│       └── route.ts                       (new: Phase 2)
├── export/
│   ├── leaderboard/
│   │   └── route.ts                       (new: Phase 2)
│   └── positions/
│       └── route.ts                       (new: Phase 2)
├── jobs/
│   ├── snapshot/
│   │   └── route.ts                       (new: Phase 2 — Vercel Cron trigger)
│   ├── prices/
│   │   └── route.ts                       (new: Phase 2)
│   ├── alerts/
│   │   └── route.ts                       (new: Phase 2)
│   └── unbonding/
│       └── route.ts                       (new: Phase 2)
└── sync/
    └── route.ts                           (new: Phase 2 — on-demand user sync)
```

### Shared schema (one-time edit)

```
packages/database/prisma/schema.prisma    (modify: add new models under @@schema("plugin_wallet"))
```

### Reference files (read-only, for domain knowledge)

```
go-livepeer/eth/types/contracts.go        — Delegator, Transcoder, UnbondingLock structs
go-livepeer/eth/client.go                 — LivepeerEthClient interface (staking operations)
go-livepeer/eth/contracts/bondingManager.go — Full BondingManager ABI JSON
go-livepeer/eth/watchers/unbondingwatcher.go — Unbonding lock lifecycle events
```

---

## Verification

### Local Dev (Express backend + Next.js shell)
1. `cd ~/Documents/mycodespace/NaaP && docker-compose up` (DB + Redis)
2. `npx prisma migrate dev` in packages/database
3. `cd examples/my-wallet/backend && npm run dev` (port 4008)
4. `cd examples/my-wallet/frontend && npm run dev` (port 3008)
5. `cd apps/web-next && npm run dev` (port 3000)
6. Open http://localhost:3000/wallet → connect MetaMask → verify portfolio loads
7. Verify: requests go through catch-all proxy → Express backend

### Local Dev (Vercel-mode — Next.js routes only, no Express)
1. `docker-compose up` (DB + Redis only)
2. `cd apps/web-next && npm run dev` (port 3000)
3. Do NOT start the Express backend
4. Open http://localhost:3000/wallet → connect MetaMask → verify portfolio loads
5. Verify: requests go through dedicated Next.js route handlers (no 501 errors)
6. This proves the app works on Vercel without the Express backend running

### Production (Vercel)
1. Frontend: UMD bundle deployed via CDN, loaded by shell
2. API: Served by Next.js route handlers in `apps/web-next/src/app/api/v1/wallet/`
3. Database: Managed PostgreSQL with Prisma (DATABASE_URL env var on Vercel)
4. Cron: Vercel Cron triggers Next.js API routes for snapshot/price/alert jobs
5. No `WALLET_URL` env var needed — no proxy dependency

### Production (Docker — alternative)
1. Backend: Docker container on port 4108
2. Set `WALLET_URL=https://wallet-api.your-domain.com` on Vercel
3. Catch-all proxy forwards to Docker backend
4. Cron jobs run inside Docker container via `scheduler.ts`

### Deployment Verification Checklist
- [ ] All API endpoints work with Express backend running (local dev)
- [ ] All API endpoints work WITHOUT Express backend (Vercel mode)
- [ ] Frontend loads and renders in both modes identically
- [ ] Prisma migration runs cleanly on fresh DB
- [ ] No hardcoded localhost URLs in frontend code (all via `getPluginBackendUrl` or relative paths)
- [ ] All env vars documented in `.env.example`

### E2E Test Flow (run in BOTH local and Vercel-mode)
1. Connect wallet → add 2nd wallet → see both in selector
2. Portfolio shows aggregated totals across wallets
3. Per-O positions table renders correct data
4. Bond 1 LPT → verify tx succeeds → portfolio updates
5. Unbond → verify lock appears with countdown
6. Export leaderboard CSV → opens correctly in Excel
7. Compare 2 Os → cards render side-by-side
8. Alert fires when O changes reward cut (simulated)
9. Yield chart shows 30d data after sufficient snapshots
