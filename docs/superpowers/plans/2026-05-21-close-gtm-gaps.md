# Close GTM Gaps — Phase 3 PR Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 40 gaps from `docs/superpowers/reports/2026-05-21-gap-report.md` via a sequenced PR pipeline. Start from **22/100 (cap 85)**, reach **≥75/100 (safety-to-ship)** in ~6 weeks, and **≥95/100** in ~12 weeks total.

**Architecture:** 6 sequential waves, each ending at a deployable checkpoint. PRs are ordered by `points_reclaimed / effort`; security wave runs first regardless of GTM timeline because findings are exploitable today.

**Tech Stack:** TypeScript, Prisma, Next.js App Router, Express plugins, Gemini, Stripe, Plaid, Playwright.

---

## Sequencing overview

```
[Wave 1 — Security Patch]      week 1     7 PRs   → cap lifted from "exploitable" to "secure baseline"
[Wave 2 — Agent-DNA]           week 2-4   7 PRs   → rubric cap lifts from 85; Tier 1 climbs to ~20/40
[Wave 3 — Data Integrity]      week 4-6   7 PRs   → financial correctness; revenue gates enforced
[Wave 4 — Reliability]         week 6-7   4 PRs   → observability + safety nets
[Wave 5 — Agent-first refactor] week 7-9  3 PRs   → web becomes agent-first (Tier 1 #1 climbs)
[Wave 6 — Domain polish]       week 9-12  7 PRs   → reach 95+
```

**Score trajectory (cumulative):**

| After wave | Score | Rubric state |
|------------|-------|--------------|
| 1 | **30/100** (cap 85) | Security defensible; agent-DNA still failing |
| 2 | **50/100** | Cap lifted; agent-native restored |
| 3 | **62/100** | Financial integrity; revenue enforced |
| 4 | **70/100** | Operationally ready |
| 5 | **80/100** | Web is agent-first |
| 6 | **≥95/100** | Hitting the bar |

---

## Branch + workflow conventions

- All PRs target `main` from feature branches `pr/<short-name>`
- Each PR ≤ 500 LOC diff target (split if exceeds)
- PR description must include:
  - `Closes G-NNN` for each gap closed
  - `Rubric points reclaimed: +N (now X/100)`
  - Test plan with concrete commands
- Reviewer assigns based on touched area (security PRs need 2 reviewers)
- CI must pass; fast suite + lint required green

---

## WAVE 1 — Security Patch (Week 1, P0)

Ship these regardless of GTM timeline. If AgentBook has any external users today, these are critical-incident-grade vulnerabilities.

### PR 1: Centralize tenant resolution to authenticated session

**Closes:** G-001, partial G-007
**Files:**
- Modify: `apps/web-next/src/lib/agentbook-tenant.ts`
- Create: `apps/web-next/src/lib/auth-helpers.ts` (if not exists; tenant-claim verification)
- Modify: every route under `apps/web-next/src/app/api/v1/agentbook*/**` that imports `resolveAgentbookTenant`
- Modify: `plugins/agentbook-core/backend/src/server.ts:38-42` (and same pattern in expense/invoice/tax plugins)
- Create: `apps/web-next/src/lib/__tests__/agentbook-tenant.test.ts`

**Effort:** M (~2 days)

- [ ] **Step 1: Write failing test for tenant resolution**

Create `apps/web-next/src/lib/__tests__/agentbook-tenant.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { resolveAgentbookTenant } from '../agentbook-tenant';

describe('resolveAgentbookTenant', () => {
  it('rejects request with no auth session', async () => {
    const req = new Request('http://localhost/foo', { headers: { 'x-tenant-id': 'attacker-uuid' } });
    await expect(resolveAgentbookTenant(req)).rejects.toThrow(/unauthorized/i);
  });

  it('rejects request with x-tenant-id mismatching session tenant', async () => {
    const req = new Request('http://localhost/foo', { headers: { 'x-tenant-id': 'attacker-uuid', cookie: 'session=valid-user-belonging-to-other-tenant' } });
    await expect(resolveAgentbookTenant(req)).rejects.toThrow(/forbidden|mismatch/i);
  });

  it('returns session-derived tenant when no header provided', async () => {
    const req = mockAuthedRequest('user-A', 'tenant-A');
    const result = await resolveAgentbookTenant(req);
    expect(result).toEqual({ tenantId: 'tenant-A', userId: 'user-A' });
  });

  it('allows server-to-server with HMAC-signed tenant claim', async () => {
    const claim = await signTenantClaim('tenant-A', 'svc:cron');
    const req = new Request('http://localhost/foo', { headers: { 'x-tenant-claim': claim } });
    const result = await resolveAgentbookTenant(req);
    expect(result).toEqual({ tenantId: 'tenant-A', service: 'cron' });
  });

  it('rejects expired or tampered HMAC claim', async () => {
    const req = new Request('http://localhost/foo', { headers: { 'x-tenant-claim': 'tampered.claim.value' } });
    await expect(resolveAgentbookTenant(req)).rejects.toThrow(/invalid|expired/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run apps/web-next/src/lib/__tests__/agentbook-tenant.test.ts
```

Expected: FAIL — current implementation accepts unsigned `x-tenant-id`.

- [ ] **Step 3: Rewrite `resolveAgentbookTenant`**

Replace the existing function. New behavior:
1. Try `x-tenant-claim` header first (HMAC of `tenantId|service|exp` signed with `TENANT_CLAIM_SECRET`). If valid, return `{ tenantId, service }`.
2. Otherwise, require a NextAuth session via `getServerSession(authOptions)`. Lookup user's allowed tenants in `AbTenantMembership` (or equivalent — create if missing).
3. If `x-tenant-id` header present, verify it's in the user's allowed list. Otherwise default to user's primary tenant.
4. Throw 401 if no session, 403 if header tenant not allowed.

Reference implementation:
```typescript
import { getServerSession } from 'next-auth';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { authOptions } from './auth-options';
import { db } from '@/lib/db';

const CLAIM_SECRET = process.env.TENANT_CLAIM_SECRET;
if (!CLAIM_SECRET) throw new Error('TENANT_CLAIM_SECRET not set');

export async function resolveAgentbookTenant(req: Request): Promise<{ tenantId: string; userId?: string; service?: string }> {
  // 1. HMAC-signed claim (for cron / service-to-service)
  const claim = req.headers.get('x-tenant-claim');
  if (claim) {
    const parsed = verifyTenantClaim(claim);
    if (!parsed) throw new Response('invalid tenant claim', { status: 401 });
    return parsed;
  }

  // 2. NextAuth session
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new Response('unauthorized', { status: 401 });

  const memberships = await db.user.findUnique({
    where: { id: session.user.id },
    include: { tenants: { select: { tenantId: true } } },
  });
  const allowed = new Set(memberships?.tenants.map(t => t.tenantId) ?? []);

  const headerTenant = req.headers.get('x-tenant-id');
  const requested = headerTenant ?? session.user.primaryTenantId;
  if (!requested) throw new Response('no tenant', { status: 400 });
  if (!allowed.has(requested)) throw new Response('forbidden', { status: 403 });

  return { tenantId: requested, userId: session.user.id };
}

function verifyTenantClaim(claim: string): { tenantId: string; service: string } | null {
  const [payload, sig] = claim.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', CLAIM_SECRET!).update(payload).digest('hex');
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const { tenantId, service, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (Date.now() > exp) return null;
  return { tenantId, service };
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
npx vitest run apps/web-next/src/lib/__tests__/agentbook-tenant.test.ts
```

- [ ] **Step 5: Update plugin-side tenant middleware**

`plugins/agentbook-{core,expense,invoice,tax}/backend/src/server.ts` lines ~38-42 — replace header-trust with HMAC verification of `x-tenant-claim`. Plugin services receive claim from Next.js proxy.

- [ ] **Step 6: Add Prisma model + migration for AbTenantMembership (if not exists)**

Check first: `grep -n "model AbTenantMembership\|model.*Membership" packages/database/prisma/schema.prisma`. If absent, add:
```prisma
model AbTenantMembership {
  id        String   @id @default(cuid())
  userId    String
  tenantId  String
  role      String   @default("member") // member | admin | owner
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, tenantId])
  @@index([tenantId])
}
```

Migrate and backfill from existing User → tenant link.

- [ ] **Step 7: Update all route handlers**

Run `grep -rln "resolveAgentbookTenant" apps/web-next/src` — every match needs the new error-handling pattern (try/catch returning the Response).

- [ ] **Step 8: Integration smoke test**

```bash
cd apps/web-next && NODE_OPTIONS="--max-old-space-size=4096" npm run dev &
sleep 5

# Should reject (no session)
curl -i -X GET http://localhost:3000/api/v1/agentbook/core/expenses \
  -H "x-tenant-id: attacker-uuid"
# Expect: 401

# With valid session
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"maya@agentbook.test","password":"agentbook123"}' | jq -r .token)
curl -i -X GET http://localhost:3000/api/v1/agentbook/core/expenses \
  -H "Authorization: Bearer $TOKEN" -H "x-tenant-id: attacker-uuid"
# Expect: 403 (Maya not member of attacker tenant)
```

- [ ] **Step 9: Commit + PR**

```bash
git checkout -b pr/centralize-tenant-resolution
# ... commits
git push -u origin pr/centralize-tenant-resolution
gh pr create --title "security: centralize tenant resolution to authenticated session" --body "$(cat <<'EOF'
## Summary
Replaces header-trust tenant resolution with session-derived + HMAC-signed claim for service-to-service. Removes the `'default'` fallback that allowed unauthenticated access to legacy data.

## Closes
- G-001 — Tenant impersonation via x-tenant-id header
- G-007 — Telegram bot-token leak (partial; combined with PR 3)

## Rubric points reclaimed
+5 (Tier 4 #13 from 0/5 → 5/5). Overall: 22 → 27.

## Test plan
- [ ] vitest on agentbook-tenant.test.ts (5 cases)
- [ ] manual curl with no auth → 401
- [ ] manual curl with auth + wrong tenant → 403
- [ ] manual smoke: login as Maya, hit /agentbook/core/expenses → 200

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### PR 2: Lock down `/switch-tenant`

**Closes:** G-002
**Files:**
- Modify: `apps/web-next/src/app/api/v1/agentbook/switch-tenant/route.ts`
- Create: `apps/web-next/src/app/api/v1/agentbook/switch-tenant/__tests__/route.test.ts`

**Effort:** S (~4h). **Depends on:** PR 1 (uses new auth helpers).

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { GET } from '../route';

describe('GET /switch-tenant', () => {
  it('rejects unauthenticated', async () => {
    const req = new Request('http://localhost/?id=tenant-A');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('rejects tenant not in user allowlist', async () => {
    const req = mockAuthedRequest('user-A', 'tenant-A', 'http://localhost/?id=tenant-B');
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('sets ab-tenant cookie when tenant is in allowlist', async () => {
    const req = mockAuthedRequest('user-A', ['tenant-A', 'tenant-B'], 'http://localhost/?id=tenant-B');
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/ab-tenant=tenant-B/);
  });
});
```

- [ ] **Step 2: Implementation**

```typescript
export async function GET(req: Request) {
  const { userId } = await resolveAgentbookTenant(req).catch(() => ({ userId: null }));
  if (!userId) return new Response('unauthorized', { status: 401 });

  const url = new URL(req.url);
  const requestedTenant = url.searchParams.get('id');
  if (!requestedTenant) return new Response('missing id', { status: 400 });

  const memberships = await db.abTenantMembership.findMany({
    where: { userId },
    select: { tenantId: true },
  });
  if (!memberships.some(m => m.tenantId === requestedTenant)) {
    return new Response('forbidden', { status: 403 });
  }

  return new Response(JSON.stringify({ tenantId: requestedTenant }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `ab-tenant=${requestedTenant}; Path=/; HttpOnly; SameSite=Lax; Secure`,
    },
  });
}
```

- [ ] **Step 3: Test pass + PR**

PR title: `security: lock /switch-tenant to authenticated + allowlisted tenants`

### PR 3: Admin auth + apiKey redaction on `/llm-configs`

**Closes:** G-003
**Files:**
- Modify: `apps/web-next/src/app/api/v1/agentbook-core/admin/llm-configs/**/*.ts`
- Modify: `plugins/agentbook-core/backend/src/server.ts:1546-1620` (corresponding plugin routes)
- Create: `apps/web-next/src/lib/admin-guard.ts`

**Effort:** S (~4h). **Depends on:** PR 1.

- [ ] **Step 1: Add admin guard helper**

```typescript
// apps/web-next/src/lib/admin-guard.ts
import { resolveAgentbookTenant } from './agentbook-tenant';
import { db } from '@/lib/db';

export async function requireAdmin(req: Request): Promise<{ userId: string; tenantId: string }> {
  const { userId, tenantId } = await resolveAgentbookTenant(req);
  if (!userId) throw new Response('unauthorized', { status: 401 });
  const membership = await db.abTenantMembership.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
  });
  if (membership?.role !== 'admin' && membership?.role !== 'owner') {
    throw new Response('admin required', { status: 403 });
  }
  return { userId, tenantId };
}
```

- [ ] **Step 2: Apply guard to all 5 llm-configs routes**

```typescript
// apps/web-next/src/app/api/v1/agentbook-core/admin/llm-configs/route.ts
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
  } catch (res) { return res as Response; }
  const configs = await db.abLlmConfig.findMany({ where: { tenantId } });
  return Response.json({
    data: configs.map(c => ({
      ...c,
      apiKey: c.apiKey ? `****${c.apiKey.slice(-4)}` : null,  // redact
    })),
  });
}
```

Same pattern for POST, DELETE, set-default, test.

- [ ] **Step 3: Plugin-side mirror**

`plugins/agentbook-core/backend/src/server.ts:1546-1620` — add admin-role check via tenant claim's `role` field. If service-claim, allow only `service === 'admin'` (which only Next.js layer issues after passing requireAdmin).

- [ ] **Step 4: Tests + PR**

PR title: `security: admin gate + apiKey redaction on /llm-configs`

### PR 4: Delete duplicate unsigned Stripe webhook handlers

**Closes:** G-004, G-005
**Files:**
- Delete: `/stripe/webhook` route in `plugins/agentbook-expense/backend/src/server.ts:915-945`
- Delete: `/stripe/checkout-completed` route in `plugins/agentbook-invoice/backend/src/server.ts:2001-2072`
- Keep: `apps/web-next/src/app/api/v1/agentbook/stripe-webhook/route.ts` (verified correct)

**Effort:** XS (~2h)

- [ ] **Step 1: Verify canonical handler covers events the others were handling**

Read `apps/web-next/src/app/api/v1/agentbook/stripe-webhook/handlers.ts`. Check it handles: `payment_intent.succeeded` (used by expense plugin), `checkout.session.completed` (used by invoice plugin), and any others the plugin handlers were processing.

If canonical handler is missing event types, ADD them there with signature verification BEFORE deleting the unsigned ones.

- [ ] **Step 2: Delete the routes**

Remove the route handlers + any related helper imports.

- [ ] **Step 3: Add regression test**

```typescript
// tests/e2e/security/stripe-webhook-routing.spec.ts
test('plugin-level /stripe/webhook routes no longer exist', async ({ request }) => {
  const r1 = await request.post('/api/v1/agentbook-expense/stripe/webhook', { data: { type: 'fake' } });
  expect(r1.status()).toBe(404);
  const r2 = await request.post('/api/v1/agentbook-invoice/stripe/checkout-completed', { data: { type: 'fake' } });
  expect(r2.status()).toBe(404);
});

test('canonical webhook rejects unsigned events', async ({ request }) => {
  const r = await request.post('/api/v1/agentbook/stripe-webhook', { data: { type: 'payment_intent.succeeded', id: 'evt_fake' } });
  expect(r.status()).toBeGreaterThanOrEqual(400);  // signature missing → rejected
});
```

- [ ] **Step 4: Commit + PR**

PR title: `security: delete duplicate unsigned Stripe webhook handlers`

### PR 5: tenantId filters on cross-tenant `findFirst`/`findMany`

**Closes:** G-008
**Files:** ~10 sites across `plugins/agentbook-{core,expense,invoice}/backend/src/server.ts`

**Effort:** M (~1 day)

- [ ] **Step 1: Enumerate sites**

```bash
grep -rn "findFirst.*where.*id.*}.*[^a-z]tenantId" plugins/*/backend/src/*.ts > /dev/null
# Find the negation:
grep -rn "findFirst.*where.*{[[:space:]]*id" plugins/*/backend/src/*.ts | grep -v tenantId
```

Expected hits from A.1-A.3: `core/server.ts:3324`, `expense/server.ts:286`, `:706`, `:792`, `:1271`, `:1500`, `:1687`, `:1785`, `:1950`; `invoice/server.ts:1293`, `:2014`.

- [ ] **Step 2: Fix each**

For each match, add `tenantId: req.tenantId` to the where clause. Where the lookup is by Plaid-id or external-id, also add tenant filter — never trust external IDs as globally unique.

- [ ] **Step 3: Add lint rule**

Create `.eslintrc.cjs` rule (custom) banning `findFirst({where:{id:...}})` on multi-tenant models. Or use a simpler grep-based pre-commit hook:

```bash
# scripts/check-tenant-lookups.sh
#!/bin/bash
set -e
hits=$(grep -rn "findFirst({.*where.*id" plugins/*/backend/src/*.ts | grep -v tenantId | grep -vE "//[[:space:]]*(safe|sys-wide)" || true)
if [ -n "$hits" ]; then
  echo "ERROR: bare-id lookup on multi-tenant model (add // safe comment if intentional):"
  echo "$hits"
  exit 1
fi
```

Wire into `package.json` `prepush` hook.

- [ ] **Step 4: Tests + PR**

Add an integration test that creates expense in tenant A with a known `categoryId`, then tries to fetch it from tenant B's context. Expect 404 (not the foreign data).

PR title: `security: add tenantId filters to all cross-tenant findFirst sites`

### PR 6: Schema migration — tenantId on line tables

**Closes:** G-009
**Files:**
- Modify: `packages/database/prisma/schema.prisma` (AbJournalLine, AbExpenseSplit, AbInvoiceLine)
- Create: `packages/database/prisma/migrations/YYYYMMDDHHMMSS_add_tenantid_to_lines/migration.sql`
- Modify: any code creating these rows must now pass `tenantId`

**Effort:** M (~1-2 days)

- [ ] **Step 1: Update schema**

```prisma
model AbJournalLine {
  id              String   @id @default(cuid())
  tenantId        String   // NEW
  entryId         String
  accountId       String
  debitCents      Int      @default(0)
  creditCents     Int      @default(0)
  // ... existing fields
  entry           AbJournalEntry @relation(fields: [entryId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@index([entryId])
}
// Same for AbExpenseSplit, AbInvoiceLine
```

- [ ] **Step 2: Backfill migration**

```sql
ALTER TABLE "AbJournalLine" ADD COLUMN "tenantId" TEXT;
UPDATE "AbJournalLine" l
  SET "tenantId" = e."tenantId"
  FROM "AbJournalEntry" e
  WHERE l."entryId" = e."id";
ALTER TABLE "AbJournalLine" ALTER COLUMN "tenantId" SET NOT NULL;
CREATE INDEX "AbJournalLine_tenantId_idx" ON "AbJournalLine"("tenantId");

-- Repeat for AbExpenseSplit, AbInvoiceLine
```

- [ ] **Step 3: Update insertion code**

Every `db.abJournalLine.create` / `createMany` / `db.abExpenseSplit.create` / `db.abInvoiceLine.create` site must pass `tenantId`. Grep:
```bash
grep -rn "abJournalLine\|abExpenseSplit\|abInvoiceLine" plugins/*/backend/src/*.ts apps/web-next/src/**/*.ts
```

- [ ] **Step 4: Add Prisma extension for tenant injection (optional but recommended)**

```typescript
// packages/database/src/extensions/tenant-injection.ts
import { Prisma } from '@prisma/client';
export function tenantInjectionExtension(tenantId: string) {
  return Prisma.defineExtension({
    query: {
      abJournalLine: { create: async ({ args, query }) => query({ ...args, data: { ...args.data, tenantId } }) },
      abExpenseSplit: { create: async ({ args, query }) => query({ ...args, data: { ...args.data, tenantId } }) },
      abInvoiceLine: { create: async ({ args, query }) => query({ ...args, data: { ...args.data, tenantId } }) },
    },
  });
}
```

Use in route handlers: `const tenantDb = db.$extends(tenantInjectionExtension(tenantId));`

- [ ] **Step 5: Test + PR**

Add test that creates a journal entry in tenant A, then verifies `db.abJournalLine.findMany({where:{tenantId:'B'}})` returns empty.

PR title: `security: add tenantId to line tables (AbJournalLine, AbExpenseSplit, AbInvoiceLine)`

### PR 7: Signed-link gate on `/invoices/:id/public`

**Closes:** G-006
**Files:**
- Modify: `plugins/agentbook-invoice/backend/src/server.ts:2078-2114`
- Modify: any frontend code that links to `/invoices/:id/public` — must now use signed URL

**Effort:** S (~4h)

- [ ] **Step 1: Add signed-token verifier**

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';
const SECRET = process.env.INVOICE_PUBLIC_LINK_SECRET!;

function signInvoiceLink(invoiceId: string, tenantId: string, expSeconds = 60 * 60 * 24 * 30): string {
  const exp = Math.floor(Date.now() / 1000) + expSeconds;
  const payload = `${invoiceId}.${tenantId}.${exp}`;
  const sig = createHmac('sha256', SECRET).update(payload).digest('hex');
  return `${exp}.${sig}`;
}

function verifyInvoiceLink(invoiceId: string, tenantId: string, token: string): boolean {
  const [expStr, sig] = token.split('.');
  if (!expStr || !sig) return false;
  const exp = Number(expStr);
  if (!exp || Date.now() / 1000 > exp) return false;
  const expected = createHmac('sha256', SECRET).update(`${invoiceId}.${tenantId}.${exp}`).digest('hex');
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
```

- [ ] **Step 2: Gate the route**

```typescript
app.get('/invoices/:id/public', async (req, res) => {
  const { id } = req.params;
  const token = String(req.query.t ?? '');
  // Look up invoice WITHOUT trusting client's tenant claim
  const invoice = await db.abInvoice.findUnique({ where: { id }, select: { id: true, tenantId: true, /* fields needed for public view */ } });
  if (!invoice) return res.status(404).json({ error: 'not found' });
  if (!verifyInvoiceLink(id, invoice.tenantId, token)) {
    return res.status(403).json({ error: 'invalid or expired link' });
  }
  res.json(invoiceForPublic(invoice));
});
```

- [ ] **Step 3: Update payment-link generation to emit signed URL**

Every send-invoice / payment-link path that generates a public URL must call `signInvoiceLink` and produce `/invoices/{id}/public?t={token}`.

- [ ] **Step 4: Test**

```typescript
test('public invoice rejects unsigned access', async ({ request }) => {
  const inv = await createTestInvoice();
  const r = await request.get(`/api/v1/agentbook-invoice/invoices/${inv.id}/public`);
  expect(r.status()).toBe(403);
});

test('public invoice accepts signed access', async ({ request }) => {
  const inv = await createTestInvoice();
  const token = signInvoiceLink(inv.id, inv.tenantId);
  const r = await request.get(`/api/v1/agentbook-invoice/invoices/${inv.id}/public?t=${token}`);
  expect(r.ok()).toBeTruthy();
});
```

- [ ] **Step 5: Commit + PR**

PR title: `security: signed-link gate on public invoice endpoint`

### Wave 1 checkpoint

After PRs 1–7 merge:

```bash
# Smoke: no exploit paths
curl -i http://prod-host/api/v1/agentbook/switch-tenant?id=any  # 401
curl -i http://prod-host/api/v1/agentbook-core/admin/llm-configs  # 401
curl -i http://prod-host/api/v1/agentbook-expense/stripe/webhook  # 404
curl -i http://prod-host/api/v1/agentbook-invoice/invoices/<random-uuid>/public  # 403
```

Rubric: **27/100 (cap 85)**. Tier 4 #13: 0/5 → 5/5. Tier 4 #15 partial.

---

## WAVE 2 — Agent-DNA (Week 2-4)

Each PR here lifts the rubric closer to 95 by closing auto-fail clauses.

### PR 8: Test scaffolding for agent-brain (TDD foundation)

**Closes:** G-029 (enables safe execution of PRs 9-13)
**Files:**
- Create: `plugins/agentbook-core/backend/src/__tests__/agent-brain.test.ts`
- Create: `plugins/agentbook-core/backend/src/__tests__/test-helpers.ts`
- Create: `tests/e2e/gtm/helpers/mock-llm.ts` (from original plan Task B.1)
- Create: `tests/e2e/gtm/fixtures/llm-responses/`

**Effort:** M (~2-3 days)

Build the mocked-LLM harness and write integration tests for the existing (broken) agent-brain behavior. Tests fail intentionally, documenting the bugs PRs 9-13 will fix.

(See original Task B.1 in `2026-05-21-gtm-assessment-phase1.md` for detailed steps — that work is now reincorporated here.)

PR title: `test(agent-brain): add mocked-LLM harness + failing tests for known bugs`

### PR 9: Split classifyAndExecuteV1; add confirm gate

**Closes:** G-010 (auto-fail clause)
**Files:**
- Modify: `plugins/agentbook-core/backend/src/server.ts` — split `classifyAndExecuteV1` into `classifyOnly` + `executeSkill`
- Modify: `plugins/agentbook-core/backend/src/agent-brain.ts:303` — reorder: classify → assess complexity → if destructive, show plan + require confirm → execute
- Modify: `apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts` — render plan with Proceed/Cancel buttons (already exists, ensure it's gated on `needsConfirm`)

**Effort:** L (~3 days). **Depends on:** PR 8.

Use the failing tests from PR 8 to drive the refactor. Tests for: send-invoice does NOT call Stripe before confirm; void-invoice asks "are you sure?"; record-expense executes immediately (non-destructive, no confirm needed).

PR title: `feat(agent): gate destructive skills on user confirm (fix classify/execute ordering)`

**Rubric points reclaimed:** +6 (auto-fail cap lift to 90 + Tier 1 #3 0/10 → 6/10). Overall: 27 → 33.

### PR 10: Manifest-driven skill routing

**Closes:** G-011 (second auto-fail clause)
**Files:**
- Modify: `plugins/agentbook-core/backend/src/built-in-skills.ts` — add `matchPatterns: string[]` and `excludePatterns: string[]` to each manifest entry
- Modify: `plugins/agentbook-core/backend/src/server.ts:2480-2522` — replace regex chain with `findBestMatchingSkill(text, manifests)` helper
- Move: per-skill exclusions from inline code into manifests

**Effort:** L (~5 days)

PR title: `refactor(agent): replace hardcoded skill-routing regex chain with manifest-driven matcher`

**Rubric points reclaimed:** +4 (Tier 1 #2). Overall: 33 → 37.

### PR 11: Web PlanPreview component

**Closes:** G-012 (third auto-fail clause)
**Files:**
- Create: `apps/web-next/src/components/agent/PlanPreview.tsx`
- Create: `apps/web-next/src/components/agent/AgentMessageThread.tsx` (if no web chat exists yet)
- Modify: dashboard page that hosts the agent chat (likely needs creating if web chat doesn't exist)

**Effort:** M (~3 days)

Match the Telegram pattern: render `plan.steps` as numbered list + Proceed/Cancel buttons. Wire to agent endpoint with session continuity.

PR title: `feat(web): PlanPreview component for multi-step agent actions`

**Rubric points reclaimed:** +4 (Tier 1 #1+#3). Overall: 37 → 41.

### PR 12: Resolve referents in convCtx before classify

**Closes:** G-014
**Files:**
- Modify: `plugins/agentbook-core/backend/src/agent-brain.ts` — add `resolveReferents(text, convCtx)` step before classify
- Modify: `plugins/agentbook-core/backend/src/server.ts` — Stage-1 + Stage-2 paths now consume resolved text

**Effort:** M (~3 days)

`resolveReferents` replaces "fix it", "the last one", "that", "it" with concrete IDs/refs from the last 5 conversation turns. Algorithm:
1. If text has pronoun ("it", "that", "the last", "the X"), look at last 5 turns for matching entity.
2. Score candidates by recency × type match (e.g., "the invoice" → most recent invoice mention).
3. Replace pronoun with concrete ID or short description.

PR title: `feat(agent): resolve conversation referents on all classification paths`

**Rubric points reclaimed:** +1 (Tier 1 #4). Overall: 41 → 42.

### PR 13: Wire proactive handlers to Vercel Cron

**Closes:** G-015
**Files:**
- Modify: `vercel.json` or `vercel.ts` — add cron entries
- Create: `apps/web-next/src/app/api/v1/agentbook/cron/proactive-handlers/route.ts`
- Modify: `plugins/agentbook-core/backend/src/server.ts` — expose proactive handler enumeration + dispatch

**Effort:** M (~2 days)

Route: enumerate active tenants × 22 handlers, invoke each, dispatch `ProactiveMessage` via Telegram adapter (or web notification once that lands).

PR title: `feat(agent): wire 22 proactive handlers to nightly cron`

**Rubric points reclaimed:** +2 (Tier 2 #8). Overall: 42 → 44.

### PR 14: Per-skill metrics

**Closes:** G-016
**Files:**
- Modify: `packages/database/prisma/schema.prisma` — add `AbSkillRun` model
- Modify: `plugins/agentbook-core/backend/src/server.ts` — write AbSkillRun on every execution outcome
- Create: `apps/web-next/src/app/api/v1/agentbook-core/agent/skills/metrics/route.ts`

**Effort:** S (~1 day)

PR title: `feat(agent): per-skill metrics (success rate, latency, token cost)`

**Rubric points reclaimed:** +2 (Tier 1 #2). Overall: 44 → 46.

### Wave 2 checkpoint

After PRs 8–14: **~50/100, cap lifted**. Tier 1 climbs from 0/40 → ~20/40. Agent is now actually agent-first.

---

## WAVE 3 — Data Integrity (Week 4-6)

| PR | Closes | Effort | Pts |
|----|--------|--------|-----|
| 15 — Idempotency middleware + endpoints + journal-entry unique | G-020, G-021 | M (2d) | +2 |
| 16 — Persist Plaid access tokens (delete in-memory Map) | G-019 | S (1d) | +1 |
| 17 — Billing gate enforcement in domain plugins | G-022 | M (2d) | +2 |
| 18 — Fix taxEstimate.effectiveRate (compute on the fly) | G-017 | XS (1h) | +1 |
| 19 — Fix monthlyBurnCents (calendar-based) | G-018 | S (4h) | +1 |
| 20 — Tenant TZ everywhere (date resolution helper) | G-025 | S (1d) | +1 |
| 21 — OCR auto-execute routes through review queue | G-024 | S (1d) | +1 |

**Detail format identical to Wave 1+2 — write per PR when starting. Each follows TDD: failing test → fix → test pass → commit → PR.**

**Wave 3 checkpoint: ~62/100. Financial integrity restored; revenue gates working.**

---

## WAVE 4 — Reliability (Week 6-7)

| PR | Closes | Effort | Pts |
|----|--------|--------|-----|
| 22 — LLM + skill execution timeouts | G-026 | XS (2h) | +1 |
| 23 — Structured logging (Pino) + Sentry SDK | G-027 | M (2d) | +2 |
| 24 — Undo error handling (surface failures, don't pop on 500) | G-028 | XS (2h) | +0.5 |
| 25 — Delete duplicate `.spec 2.ts` files | G-030 | XS (30min) | (test integrity) |

**Wave 4 checkpoint: ~70/100. Operationally ready.**

---

## WAVE 5 — Agent-first refactor (Week 7-9)

| PR | Closes | Effort | Pts |
|----|--------|--------|-----|
| 26 — Wire receipt dropzone (kill theater) | G-031 | S (1d) | +4 |
| 27 — Agent-driven onboarding (replace 7-step wizard) | G-032 | L (5d) | +4 |
| 28 — UI subscribes to agent state (SSE or polling) | G-033 | L (5d) | +3 |

**Wave 5 checkpoint: ~80/100. Web is agent-first.**

---

## WAVE 6 — Domain polish (Week 9-12)

| PR | Closes | Effort | Pts |
|----|--------|--------|-----|
| 29 — Real PDF generation (Puppeteer or React-PDF) | G-034 | S (1d) | +1 |
| 30 — Proper CSV import (papaparse) | G-035 | XS (2h) | +1 |
| 31 — Fix N+1 queries in 5 hot paths | G-036 | M (2d) | +1 |
| 32 — CA tax e2e | G-037 | S (1d) | +1 |
| 33 — Intent-aware LLM context builder | G-038 | S (1d) | +2 |
| 34 — Memory pruning / TTL cron | G-040 | XS (2h) | +0.5 |
| 35 — State-machine enums (AbExpense.status, etc.) | G-023 | L (3d) | +1 |

**Wave 6 checkpoint: ~88-92/100. Add 1 polish week (visual QA, copy review, edge-case bug bash) → ≥95/100.**

---

## Stream B test suite — reintegration

The Stream B test suite (originally Tasks B.1–B.9 in the Phase 1 plan, deferred under option-c) should land **interleaved with Wave 2** as PRs 8a, 8b, 8c, etc. — each agent-DNA refactor needs the test net BEFORE the refactor merges. Specifically:

- PR 8 (test scaffolding) is the first installment — keep this in Wave 2.
- After PR 9 (confirm gate), add PR 9a: `tests/e2e/gtm/01-bookkeeping.spec.ts` + `02-invoicing.spec.ts` exercising the confirm flow.
- After PR 13 (proactive handlers), add PR 13a: integration test that triggers cron and asserts Telegram delivery.
- After PR 28 (UI sync), add PR 28a: `tests/e2e/gtm/06-onboarding.spec.ts` (instrumented first-15-min) + multi-platform adapter abstraction test (was Task B.6 in the Phase 1 plan).

The nightly real-LLM suite (was B.8/B.9) should land as its own PR at the end of Wave 6 — it measures the bar we're trying to clear, so it needs the bar to be clearable first.

---

## Risk register

| Risk | Probability | Mitigation |
|------|-------------|------------|
| Wave 1 security PRs break existing customer integrations | Medium | Roll out behind feature flag; monitor 4xx rate on `/agentbook/**`; have a hotfix branch ready |
| PR 9 (confirm gate) breaks Telegram flows that relied on implicit execute | Medium | Add explicit "auto-execute non-destructive" allow-list; test all 16 built-in skills before merge |
| PR 10 (manifest-driven routing) regresses intent accuracy | High | Add nightly real-LLM suite (B.8) before PR 10 merges; require accuracy stays ≥ baseline |
| PR 27 (onboarding rewrite) increases drop-off rate | Medium | A/B test old wizard vs new agent-driven; ship to 10% first |
| Wave 1 schema migrations (PR 6) take downtime | Low | Migrations are additive (ALTER ADD COLUMN with backfill); use zero-downtime pattern |
| Cumulative refactor introduces regressions outside the gap list | High | Require nightly e2e suite green for 3 consecutive days before each wave checkpoint |

---

## How to execute this plan

**Option 1 (recommended): subagent-driven, one PR at a time.** Use `superpowers:subagent-driven-development`. For each PR:
1. Dispatch implementer with PR's task text + acceptance criteria.
2. Spec-review subagent verifies what was built matches the PR description.
3. Code-quality reviewer subagent checks for cleanliness.
4. Mark PR done, move to next.

**Option 2: human + Claude pair.** Engineer drives each PR with Claude assistance; one PR per ~half-day for small ones, one per day for medium ones. Reviewer assigns based on touched area.

**Option 3: split team.** Wave 1 (security) by one engineer in a worktree branch off `main`. Wave 2 (agent-DNA) by another engineer in parallel from `main`. Re-sync at Wave 3.

**Whatever option:** every PR description must declare rubric points reclaimed and update the running score in this plan's "Score trajectory" table.

---

## Self-Review

| Phase 2 gap | Closing PR | Notes |
|------------|-----------|-------|
| G-001..G-009 (Tier S security) | PRs 1–7 | Order matches gap-report priority |
| G-010..G-016 (Tier A agent-DNA) | PRs 8–14 | PR 8 establishes TDD scaffolding first |
| G-017..G-025 (Tier B data integrity) | PRs 15–21 | Summary tables (detail when starting wave) |
| G-026..G-030 (Tier C reliability) | PRs 22–25 | |
| G-031..G-033 (Tier D agent-first refactor) | PRs 26–28 | |
| G-034..G-040 (Tier E polish) | PRs 29–35 | |

**Placeholder scan:** Wave 3+ uses summary tables instead of full per-step detail. This is intentional — Waves 3-6 should have detailed steps written when starting that wave, not now (the codebase state will have changed). Each summary references the gap-report gap ID so detail can be reconstructed.

**Type consistency:** PR 1's `resolveAgentbookTenant` returns `{ tenantId, userId?, service? }` — used identically in PRs 2, 3, 5, 7. PR 6's `AbTenantMembership` model referenced by PR 1, 2, 3.

**Scope:** This plan covers all 40 gaps from the gap report. Stream B test suite reintegrated as inline PRs (8a, 9a, 13a, 28a, plus a final nightly-suite PR).
