/**
 * One-shot migration script: encrypts sensitive plaintext columns at rest
 * using the v1 envelope format (AES-256-GCM with scrypt key derivation).
 *
 * Tables & fields processed:
 *   1. OAuthAccount: accessToken, refreshToken
 *   2. DaydreamSettings (daydream_settings): apiKey
 *   3. BillingProviderOAuthSession: accessToken
 *
 * Idempotent — already-encrypted values (prefixed with "v1:gcm:scrypt:") are
 * skipped. Safe to run multiple times.
 *
 * Required env vars:
 *   DATABASE_URL     - Postgres connection string
 *   ENCRYPTION_KEY   - Master key for v1 envelope encryption
 *
 * Usage:
 *   DATABASE_URL=... ENCRYPTION_KEY=... npx tsx scripts/encrypt-sensitive-columns.ts
 */

import * as crypto from 'crypto';
import { PrismaClient } from '../packages/database/src/generated/client';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is required.');
  process.exit(1);
}

if (!process.env.ENCRYPTION_KEY) {
  console.error('ERROR: ENCRYPTION_KEY is required.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// v1 envelope encryption (inlined to avoid package resolution issues in scripts)
// ---------------------------------------------------------------------------

const ENVELOPE_PREFIX = 'v1:gcm:scrypt:';

function isEncrypted(value: string): boolean {
  return value.startsWith(ENVELOPE_PREFIX);
}

function encryptValue(plaintext: string, aad?: string): string {
  const key = process.env.ENCRYPTION_KEY!;
  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(key, salt, 32, { N: 16384, r: 8, p: 1 });
  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENVELOPE_PREFIX}${salt.toString('hex')}:${iv.toString('hex')}:${ct.toString('hex')}:${tag.toString('hex')}`;
}

// ---------------------------------------------------------------------------
// Migration logic
// ---------------------------------------------------------------------------

const prisma = new PrismaClient();

interface Summary {
  oauthAccountsProcessed: number;
  oauthAccountsSkipped: number;
  daydreamSettingsProcessed: number;
  daydreamSettingsSkipped: number;
  billingSessionsProcessed: number;
  billingSessionsSkipped: number;
  errors: string[];
}

const summary: Summary = {
  oauthAccountsProcessed: 0,
  oauthAccountsSkipped: 0,
  daydreamSettingsProcessed: 0,
  daydreamSettingsSkipped: 0,
  billingSessionsProcessed: 0,
  billingSessionsSkipped: 0,
  errors: [],
};

async function encryptOAuthAccounts(): Promise<void> {
  console.log('\n── OAuthAccount ──');

  const accounts = await prisma.oAuthAccount.findMany({
    where: {
      OR: [
        { accessToken: { not: null } },
        { refreshToken: { not: null } },
      ],
    },
  });

  console.log(`  Found ${accounts.length} rows with token fields populated.`);

  for (const acct of accounts) {
    try {
      const updates: Record<string, string> = {};
      const ctx = `OAuthAccount:${acct.id}`;

      if (acct.accessToken && !isEncrypted(acct.accessToken)) {
        updates.accessToken = encryptValue(acct.accessToken, `${ctx}:accessToken`);
      }
      if (acct.refreshToken && !isEncrypted(acct.refreshToken)) {
        updates.refreshToken = encryptValue(acct.refreshToken, `${ctx}:refreshToken`);
      }

      if (Object.keys(updates).length > 0) {
        await prisma.oAuthAccount.update({
          where: { id: acct.id },
          data: updates,
        });
        summary.oauthAccountsProcessed++;
        console.log(`  ✓ Encrypted OAuthAccount ${acct.id}`);
      } else {
        summary.oauthAccountsSkipped++;
      }
    } catch (err) {
      const msg = `OAuthAccount ${acct.id}: ${(err as Error).message}`;
      summary.errors.push(msg);
      console.error(`  ✗ ${msg}`);
    }
  }
}

async function encryptDaydreamSettings(): Promise<void> {
  console.log('\n── DaydreamSettings ──');

  const rows = await prisma.daydreamSettings.findMany({
    where: { apiKey: { not: null } },
  });

  console.log(`  Found ${rows.length} rows with apiKey populated.`);

  for (const row of rows) {
    try {
      if (!row.apiKey) {
        summary.daydreamSettingsSkipped++;
        continue;
      }

      if (isEncrypted(row.apiKey)) {
        summary.daydreamSettingsSkipped++;
        continue;
      }

      const ctx = `DaydreamSettings:${row.userId}:apiKey`;
      const encrypted = encryptValue(row.apiKey, ctx);

      await prisma.daydreamSettings.update({
        where: { id: row.id },
        data: { apiKey: encrypted },
      });

      summary.daydreamSettingsProcessed++;
      console.log(`  ✓ Encrypted DaydreamSettings ${row.id} (user ${row.userId})`);
    } catch (err) {
      const msg = `DaydreamSettings ${row.id}: ${(err as Error).message}`;
      summary.errors.push(msg);
      console.error(`  ✗ ${msg}`);
    }
  }
}

async function encryptBillingProviderOAuthSessions(): Promise<void> {
  console.log('\n── BillingProviderOAuthSession ──');

  const sessions = await prisma.billingProviderOAuthSession.findMany({
    where: { accessToken: { not: null } },
  });

  console.log(`  Found ${sessions.length} rows with accessToken populated.`);

  for (const session of sessions) {
    try {
      if (!session.accessToken) {
        summary.billingSessionsSkipped++;
        continue;
      }

      if (isEncrypted(session.accessToken)) {
        summary.billingSessionsSkipped++;
        continue;
      }

      const ctx = `BillingProviderOAuthSession:${session.loginSessionId}:accessToken`;
      const encrypted = encryptValue(session.accessToken, ctx);

      await prisma.billingProviderOAuthSession.update({
        where: { loginSessionId: session.loginSessionId },
        data: { accessToken: encrypted },
      });

      summary.billingSessionsProcessed++;
      console.log(`  ✓ Encrypted BillingProviderOAuthSession ${session.loginSessionId}`);
    } catch (err) {
      const msg = `BillingProviderOAuthSession ${session.loginSessionId}: ${(err as Error).message}`;
      summary.errors.push(msg);
      console.error(`  ✗ ${msg}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  Encrypt Sensitive Columns – One-Shot Migration  ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`Timestamp: ${new Date().toISOString()}`);

  await encryptOAuthAccounts();
  await encryptDaydreamSettings();
  await encryptBillingProviderOAuthSessions();

  // Summary
  console.log('\n══════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('══════════════════════════════════════════');
  console.log(`  OAuthAccount:                  ${summary.oauthAccountsProcessed} encrypted, ${summary.oauthAccountsSkipped} skipped`);
  console.log(`  DaydreamSettings:              ${summary.daydreamSettingsProcessed} encrypted, ${summary.daydreamSettingsSkipped} skipped`);
  console.log(`  BillingProviderOAuthSession:   ${summary.billingSessionsProcessed} encrypted, ${summary.billingSessionsSkipped} skipped`);

  if (summary.errors.length > 0) {
    console.log(`\n  ERRORS (${summary.errors.length}):`);
    for (const e of summary.errors) {
      console.log(`    - ${e}`);
    }
  } else {
    console.log('\n  No errors.');
  }

  const total =
    summary.oauthAccountsProcessed +
    summary.daydreamSettingsProcessed +
    summary.billingSessionsProcessed;
  console.log(`\n  Total fields encrypted: ${total}`);
  console.log('══════════════════════════════════════════\n');
}

main()
  .catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
