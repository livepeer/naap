-- NAAP-A-db: DB-driven billing-provider adapter registry (EXPAND-ONLY).
--
-- Adds nullable `adapterType` + `config` columns to BillingProvider so the
-- adapter registry can resolve a provider's adapter implementation from the DB
-- instead of a static slug→adapter map. Purely additive: existing rows keep
-- adapterType = NULL and continue to resolve by `slug`, so flag-OFF behavior is
-- unchanged (zero regression). No backfill here (expand → migrate → contract).
ALTER TABLE "public"."BillingProvider" ADD COLUMN IF NOT EXISTS "adapterType" TEXT;
ALTER TABLE "public"."BillingProvider" ADD COLUMN IF NOT EXISTS "config" JSONB;
