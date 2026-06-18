-- NAAP-2 (M1): make cross-provider usage ingest idempotent.
--
-- A billing provider that retries a BPP ⑥ push must not double-count. The
-- natural key of a usage window is {providerSlug, accountId, appId, windowFrom,
-- windowTo}. We add a UNIQUE index on that tuple and the ingest route upserts
-- on it (INSERT ... ON CONFLICT), so a duplicate window is a no-op update.
--
-- Account-level records (no app) are stored with appId = '' (empty-string
-- sentinel) rather than NULL, so a plain unique index de-duplicates them too
-- (a NULL would be treated as distinct on each retry). This keeps the index
-- portable across PostgreSQL versions and matches `prisma db push`.
--
-- Expand-only: this only adds an index to a table introduced earlier on this
-- same branch (no production data yet; the feature is flag-gated, default OFF).
-- Idempotent (IF NOT EXISTS) so re-applies are safe.

CREATE UNIQUE INDEX IF NOT EXISTS "ProviderUsageRecord_window_key"
    ON "public"."ProviderUsageRecord" ("providerSlug", "accountId", "appId", "windowFrom", "windowTo");
