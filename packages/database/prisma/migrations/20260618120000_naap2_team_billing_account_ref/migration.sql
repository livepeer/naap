-- NAAP-2: provider-agnostic billing-account binding on Team.
-- Expand-only / additive: both columns are nullable, the index is non-unique,
-- and no existing query reads them. Idempotent (IF NOT EXISTS) so it composes
-- safely with NAAP-1's equivalent migration regardless of apply order.
--
-- A team binds to exactly ONE billing account via {providerSlug, accountId}
-- (the BPP `billingAccountRef`). The usage dashboard scopes a caller's spend to
-- the accounts reachable through their team memberships.

ALTER TABLE "public"."Team" ADD COLUMN IF NOT EXISTS "billingAccountProviderSlug" TEXT;
ALTER TABLE "public"."Team" ADD COLUMN IF NOT EXISTS "billingAccountId" TEXT;

CREATE INDEX IF NOT EXISTS "Team_billingAccountProviderSlug_idx"
    ON "public"."Team"("billingAccountProviderSlug");
