-- Per-team feature-flag override (zero-blast-radius flag scoping). EXPAND-ONLY,
-- additive. Adds the `public.FeatureFlagOverride` table keyed by
-- (teamId, flagKey). When a row exists its `enabled` wins for that team; with NO
-- rows, flag evaluation is byte-identical to today (the global `FeatureFlag`
-- value). No existing table/column/constraint is dropped or rewritten and no
-- data is backfilled. Idempotent (IF NOT EXISTS) for safe re-apply.

-- CreateTable: FeatureFlagOverride (public)
CREATE TABLE IF NOT EXISTS "public"."FeatureFlagOverride" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "flagKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureFlagOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "FeatureFlagOverride_teamId_flagKey_key"
    ON "public"."FeatureFlagOverride"("teamId", "flagKey");
CREATE INDEX IF NOT EXISTS "FeatureFlagOverride_flagKey_enabled_idx"
    ON "public"."FeatureFlagOverride"("flagKey", "enabled");
CREATE INDEX IF NOT EXISTS "FeatureFlagOverride_teamId_idx"
    ON "public"."FeatureFlagOverride"("teamId");

-- FK to Team (cascade) — references an existing public table. A team's overrides
-- are removed with the team.
ALTER TABLE "public"."FeatureFlagOverride"
    ADD CONSTRAINT "FeatureFlagOverride_teamId_fkey" FOREIGN KEY ("teamId")
    REFERENCES "public"."Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
