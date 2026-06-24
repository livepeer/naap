-- NAAP P1: Subscription model + DevApiKey.subscriptionId (EXPAND-ONLY, additive).
--
-- Multi-subscription foundation. A team may hold MANY concurrent subscriptions;
-- a DevApiKey MAY link to one. Purely additive:
--   - new `public.Subscription` table,
--   - new NULLABLE `plugin_developer_api.DevApiKey.subscriptionId` column.
-- No existing table/column/constraint is dropped or rewritten and NO data is
-- backfilled here (expand → migrate → contract). Existing keys keep
-- subscriptionId = NULL and resolve via today's key → team → single
-- billingAccountRef path (zero regression). Idempotent (IF NOT EXISTS) for safe
-- re-apply.

-- CreateTable: Subscription (public)
CREATE TABLE IF NOT EXISTS "public"."Subscription" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "providerInstanceId" TEXT NOT NULL,
    "providerPlanId" TEXT,
    "accountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "appId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Subscription_teamId_status_idx" ON "public"."Subscription"("teamId", "status");
CREATE INDEX IF NOT EXISTS "Subscription_providerInstanceId_idx" ON "public"."Subscription"("providerInstanceId");

-- AlterTable: add nullable link from DevApiKey → Subscription (scalar, no FK)
ALTER TABLE "plugin_developer_api"."DevApiKey" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DevApiKey_subscriptionId_idx" ON "plugin_developer_api"."DevApiKey"("subscriptionId");
