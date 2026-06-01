-- Daydream-only pivot (PR #337): legacy PymtHouse slugs are no longer valid.
-- Coerce all pymthouse plans to daydream; null slugs get daydream as well.
UPDATE "plugin_orchestrator_leaderboard"."DiscoveryPlan"
SET
  "billingProviderSlug" = 'daydream',
  "updatedAt" = NOW()
WHERE "billingProviderSlug" IS NULL
   OR "billingProviderSlug" = 'pymthouse';
