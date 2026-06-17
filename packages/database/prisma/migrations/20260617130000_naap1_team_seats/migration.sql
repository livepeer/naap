-- NAAP-1: Team Seats + provider-agnostic billing-account binding.
-- Expand-only / additive: every column added is nullable or has a default, and
-- the new Seat table is unreferenced by existing code paths. With the
-- `team_seats` feature flag OFF this migration is a no-op for runtime behavior
-- (no existing query reads these columns/table). No destructive change.

-- Team: provider-agnostic billingAccountRef = {providerSlug, accountId}.
ALTER TABLE "public"."Team" ADD COLUMN IF NOT EXISTS "billingAccountProviderSlug" TEXT;
ALTER TABLE "public"."Team" ADD COLUMN IF NOT EXISTS "billingAccountId" TEXT;

CREATE INDEX IF NOT EXISTS "Team_billingAccountProviderSlug_idx"
    ON "public"."Team"("billingAccountProviderSlug");

-- Seat: a developer's place in a team. Keys (NAAP-B) are issued to a seat.
CREATE TABLE IF NOT EXISTS "public"."Seat" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'active',
    "keyLimit" INTEGER NOT NULL DEFAULT 5,
    "invitedBy" TEXT,
    "inviteToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Seat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Seat_inviteToken_key" ON "public"."Seat"("inviteToken");
CREATE UNIQUE INDEX IF NOT EXISTS "Seat_teamId_userId_key" ON "public"."Seat"("teamId", "userId");
CREATE INDEX IF NOT EXISTS "Seat_teamId_idx" ON "public"."Seat"("teamId");
CREATE INDEX IF NOT EXISTS "Seat_userId_idx" ON "public"."Seat"("userId");
CREATE INDEX IF NOT EXISTS "Seat_teamId_status_idx" ON "public"."Seat"("teamId", "status");

-- FK to Team (cascade) and User (set null) — both reference existing public tables.
ALTER TABLE "public"."Seat"
    ADD CONSTRAINT "Seat_teamId_fkey" FOREIGN KEY ("teamId")
    REFERENCES "public"."Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."Seat"
    ADD CONSTRAINT "Seat_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DevApiKey: optional seat/team attribution (scalar, no cross-schema FK).
ALTER TABLE "plugin_developer_api"."DevApiKey" ADD COLUMN IF NOT EXISTS "seatId" TEXT;
ALTER TABLE "plugin_developer_api"."DevApiKey" ADD COLUMN IF NOT EXISTS "teamId" TEXT;

CREATE INDEX IF NOT EXISTS "DevApiKey_seatId_idx" ON "plugin_developer_api"."DevApiKey"("seatId");
CREATE INDEX IF NOT EXISTS "DevApiKey_teamId_idx" ON "plugin_developer_api"."DevApiKey"("teamId");
