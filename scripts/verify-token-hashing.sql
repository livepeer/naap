-- Verify token hashing rollout progress.
-- During dual-write phase, both token and tokenHash are populated.
-- The token column remains non-nullable in the schema; it will only
-- become nullable in a future migration once all tokenHash backfills
-- are confirmed and the plaintext column is ready to be dropped.

-- Check for sessions with tokenHash but also a non-null token (pre-cutover, expected)
SELECT 'Sessions with both token and tokenHash (pre-cutover):' AS check,
       COUNT(*) AS count
FROM "Session"
WHERE token IS NOT NULL AND "tokenHash" IS NOT NULL;

-- Check for sessions with ONLY token but no tokenHash (legacy, needs backfill)
SELECT 'Sessions missing tokenHash (needs backfill):' AS check,
       COUNT(*) AS count
FROM "Session"
WHERE token IS NOT NULL AND "tokenHash" IS NULL;

-- Same checks for PasswordResetToken
SELECT 'PasswordResetTokens missing tokenHash:' AS check,
       COUNT(*) AS count
FROM "PasswordResetToken"
WHERE token IS NOT NULL AND "tokenHash" IS NULL;

-- Same for EmailVerificationToken
SELECT 'EmailVerificationTokens missing tokenHash:' AS check,
       COUNT(*) AS count
FROM "EmailVerificationToken"
WHERE token IS NOT NULL AND "tokenHash" IS NULL;

-- Check password hash format distribution
SELECT 'Password hash format distribution:' AS check,
       CASE 
         WHEN "passwordHash" LIKE 'pbkdf2-sha256-600k:%' THEN 'new (pbkdf2-sha256-600k)'
         WHEN "passwordHash" LIKE 'pbkdf2-sha512-10k:%' THEN 'legacy-versioned'
         WHEN "passwordHash" IS NOT NULL THEN 'legacy-unversioned'
         ELSE 'null (needs reset)'
       END AS format,
       COUNT(*) AS count
FROM "User"
GROUP BY format;
