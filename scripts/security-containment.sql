-- ============================================================================
-- SECURITY CONTAINMENT RUNBOOK — Phase 0
-- ============================================================================
-- Run these statements against the PRODUCTION Neon database AFTER rotating
-- the neondb_owner password in the Neon console and updating Vercel env vars.
--
-- Prerequisites (manual, before running this file):
--   1. Neon Console → Roles → neondb_owner → Reset Password
--   2. Vercel Dashboard → Project Settings → Environment Variables:
--      - Update DATABASE_URL, DATABASE_URL_UNPOOLED, POSTGRES_* for Production & Preview
--   3. Redeploy production so the app reconnects with the new password
--
-- After running this file:
--   - All password-reset and email-verification tokens are invalidated
--   - Admin accounts (@livepeer.org + anyone with an :admin role) must use
--     the forgot-password flow to set a new password
--   - Sessions are left intact (deferred to Phase 2 code cutover, option B)
-- ============================================================================

BEGIN;

-- Step 1: Wipe all password-reset tokens (prevents stolen-token account takeover)
DELETE FROM "PasswordResetToken";

-- Step 2: Wipe all email-verification tokens
DELETE FROM "EmailVerificationToken";

-- Step 3: Null the password hash for every admin-role user
-- This forces them through the forgot-password email flow on next login.
UPDATE "User"
SET "passwordHash" = NULL
WHERE email LIKE '%@livepeer.org'
   OR id IN (
       SELECT ur."userId"
       FROM "UserRole" ur
       JOIN "Role" r ON ur."roleId" = r.id
       WHERE r.name LIKE '%:admin'
   );

COMMIT;

-- Verification queries (run after COMMIT to confirm):
SELECT 'PasswordResetToken count:', COUNT(*) FROM "PasswordResetToken";
SELECT 'EmailVerificationToken count:', COUNT(*) FROM "EmailVerificationToken";
SELECT 'Admins with null passwordHash:', COUNT(*)
FROM "User" u
WHERE u."passwordHash" IS NULL
  AND (u.email LIKE '%@livepeer.org'
       OR u.id IN (
           SELECT ur."userId"
           FROM "UserRole" ur
           JOIN "Role" r ON ur."roleId" = r.id
           WHERE r.name LIKE '%:admin'
       ));
