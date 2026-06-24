-- NAAP P0: ProviderInstance — per-app provider instance (EXPAND-ONLY, additive).
--
-- Multi-app foundation. `BillingProvider` stays the adapter-TYPE catalog
-- (slug @unique, unchanged); `ProviderInstance` is the per-APP row so MANY
-- instances may share one `adapterType` (e.g. multiple pymthouse apps). Per-app
-- creds move OUT of global env: `config` holds NON-SECRET connection params,
-- `secretRef` points at a SecretVault.key holding the M2M secret (never the
-- value). Purely additive — no existing table/column/constraint is touched, so
-- with the `provider_instances` flag OFF nothing reads this table and behavior
-- is unchanged (zero regression). Idempotent (IF NOT EXISTS) for safe re-apply.
CREATE TABLE IF NOT EXISTS "public"."ProviderInstance" (
    "id" TEXT NOT NULL,
    "adapterType" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "config" JSONB,
    "secretRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderInstance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ProviderInstance_slug_key" ON "public"."ProviderInstance"("slug");
CREATE INDEX IF NOT EXISTS "ProviderInstance_adapterType_idx" ON "public"."ProviderInstance"("adapterType");
CREATE INDEX IF NOT EXISTS "ProviderInstance_enabled_idx" ON "public"."ProviderInstance"("enabled");
