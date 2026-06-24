-- NAAP P4: ProviderPlan model (synced plan-spec, EXPAND-ONLY, additive).
--
-- Deliverable 2 (pull direction): the Source-of-Truth for a provider app's
-- published plans, pulled per ProviderInstance and upserted keyed
-- [providerInstanceId, providerPlanId] with a content `revision`. Purely
-- additive — a single new `public.ProviderPlan` table; no existing
-- table/column/constraint is dropped or rewritten and NO data is backfilled.
-- Gated by `plan_spec_sync` (default OFF): nothing reads or writes this table
-- until the flag is ON, so discovery stays exactly today's static behavior
-- (zero regression). Idempotent (IF NOT EXISTS) for safe re-apply.

-- CreateTable: ProviderPlan (public)
CREATE TABLE IF NOT EXISTS "public"."ProviderPlan" (
    "id" TEXT NOT NULL,
    "providerInstanceId" TEXT NOT NULL,
    "providerPlanId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capabilities" TEXT[],
    "sla" JSONB,
    "pricing" JSONB,
    "discoveryPolicy" JSONB,
    "revision" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'pull',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: idempotent upsert key + instance lookup
CREATE UNIQUE INDEX IF NOT EXISTS "ProviderPlan_providerInstanceId_providerPlanId_key" ON "public"."ProviderPlan"("providerInstanceId", "providerPlanId");
CREATE INDEX IF NOT EXISTS "ProviderPlan_providerInstanceId_idx" ON "public"."ProviderPlan"("providerInstanceId");
