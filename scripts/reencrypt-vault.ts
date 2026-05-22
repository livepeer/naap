/**
 * One-shot migration script: re-encrypts all SecretVault rows from legacy
 * encryption formats to the unified v1 envelope format.
 *
 * Legacy formats handled:
 *   1. Gateway format: hex ciphertext + ':' + hex authTag in encryptedValue,
 *      hex IV in iv column, scrypt-derived key from fixed salt "naap-gateway-kdf-v1"
 *   2. Base-svc format: base64(salt + authTag + ciphertext) in encryptedValue,
 *      base64 IV in iv column, PBKDF2-derived key from per-row salt
 *
 * Required env vars:
 *   DATABASE_URL       - Postgres connection string
 *   ENCRYPTION_KEY     - New master key for v1 envelope encryption
 *   LEGACY_ENCRYPTION_KEY - Key used by the gateway encryption (falls back to ENCRYPTION_KEY)
 *   LEGACY_MASTER_KEY  - Key used by base-svc (falls back to ENCRYPTION_MASTER_KEY or SECRET_KEY)
 *
 * Usage:
 *   DATABASE_URL=... ENCRYPTION_KEY=... npx tsx scripts/reencrypt-vault.ts
 */

import * as crypto from 'crypto';
import { PrismaClient } from '../packages/database/src/generated/client';

// --- Config validation ---

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is required.');
  process.exit(1);
}

if (!process.env.ENCRYPTION_KEY) {
  console.error('ERROR: ENCRYPTION_KEY is required (new v1 envelope key).');
  process.exit(1);
}

const NEW_KEY = process.env.ENCRYPTION_KEY;
const LEGACY_GATEWAY_KEY = process.env.LEGACY_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
const LEGACY_BASESVC_KEY =
  process.env.LEGACY_MASTER_KEY ||
  process.env.ENCRYPTION_MASTER_KEY ||
  process.env.SECRET_KEY ||
  '';

const ENVELOPE_PREFIX = 'v1:gcm:scrypt:';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

// --- V1 envelope encrypt (inlined to avoid import issues in script context) ---

function encryptV1(plaintext: string): string {
  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(NEW_KEY, salt, 32, { N: 16384, r: 8, p: 1 });

  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENVELOPE_PREFIX}${salt.toString('hex')}:${iv.toString('hex')}:${ct.toString('hex')}:${tag.toString('hex')}`;
}

// --- Legacy gateway decryption ---

const GATEWAY_KDF_SALT = Buffer.from('naap-gateway-kdf-v1', 'utf8');

function decryptGateway(encryptedValue: string, ivHex: string): string {
  const derivedKey = crypto.scryptSync(LEGACY_GATEWAY_KEY, GATEWAY_KDF_SALT, 32);
  const iv = Buffer.from(ivHex, 'hex');
  const parts = encryptedValue.split(':');
  if (parts.length !== 2) {
    throw new Error('Gateway format expects ciphertext:authTag');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
  decipher.setAuthTag(Buffer.from(parts[1], 'hex'));

  let decrypted = decipher.update(parts[0], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// --- Legacy base-svc decryption ---

const BASESVC_SALT_LENGTH = 32;
const BASESVC_AUTH_TAG_LENGTH = 16;
const BASESVC_ITERATIONS = 100000;
const BASESVC_KEY_LENGTH = 32;

function decryptBaseSvc(encryptedValue: string, ivBase64: string): string {
  if (!LEGACY_BASESVC_KEY) {
    throw new Error('No legacy base-svc key configured');
  }

  const combined = Buffer.from(encryptedValue, 'base64');
  const ivBuffer = Buffer.from(ivBase64, 'base64');

  const salt = combined.subarray(0, BASESVC_SALT_LENGTH);
  const authTag = combined.subarray(BASESVC_SALT_LENGTH, BASESVC_SALT_LENGTH + BASESVC_AUTH_TAG_LENGTH);
  const encryptedData = combined.subarray(BASESVC_SALT_LENGTH + BASESVC_AUTH_TAG_LENGTH);

  const key = crypto.pbkdf2Sync(LEGACY_BASESVC_KEY, salt, BASESVC_ITERATIONS, BASESVC_KEY_LENGTH, 'sha256');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuffer);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedData.toString('hex'), 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// --- Main migration logic ---

interface MigrationResult {
  id: string;
  key: string;
  method: 'gateway' | 'base-svc' | 'already-v1';
  success: boolean;
  error?: string;
}

async function main() {
  console.log('=== SecretVault Re-encryption Migration ===\n');

  const rows = await prisma.secretVault.findMany();
  console.log(`Found ${rows.length} SecretVault row(s) to process.\n`);

  if (rows.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const results: MigrationResult[] = [];

  for (const row of rows) {
    const { id, key, encryptedValue, iv } = row;

    // Already migrated
    if (encryptedValue.startsWith(ENVELOPE_PREFIX)) {
      console.log(`  [SKIP] ${key} (id=${id}) — already v1 envelope`);
      results.push({ id, key, method: 'already-v1', success: true });
      continue;
    }

    let plaintext: string | null = null;
    let method: 'gateway' | 'base-svc' | null = null;

    // Try gateway format first (hex IV, ciphertext:tag format)
    try {
      plaintext = decryptGateway(encryptedValue, iv);
      method = 'gateway';
    } catch {
      // Not gateway format, try base-svc
    }

    // Try base-svc format (base64 combined, base64 IV)
    if (plaintext === null) {
      try {
        plaintext = decryptBaseSvc(encryptedValue, iv);
        method = 'base-svc';
      } catch {
        // Neither format worked
      }
    }

    if (plaintext === null || method === null) {
      const msg = 'Failed to decrypt with both gateway and base-svc methods';
      console.error(`  [FAIL] ${key} (id=${id}) — ${msg}`);
      results.push({ id, key, method: 'gateway', success: false, error: msg });
      continue;
    }

    // Re-encrypt with v1 envelope
    try {
      const newEnvelope = encryptV1(plaintext);

      await prisma.secretVault.update({
        where: { id },
        data: {
          encryptedValue: newEnvelope,
          iv: 'v1-embedded',
          rotatedAt: new Date(),
        },
      });

      console.log(`  [OK]   ${key} (id=${id}) — re-encrypted from ${method}`);
      results.push({ id, key, method, success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [FAIL] ${key} (id=${id}) — write error: ${msg}`);
      results.push({ id, key, method, success: false, error: msg });
    }
  }

  // Summary
  console.log('\n=== Summary ===');
  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const skipped = results.filter((r) => r.method === 'already-v1');

  console.log(`  Total:     ${results.length}`);
  console.log(`  Migrated:  ${succeeded.length - skipped.length}`);
  console.log(`  Skipped:   ${skipped.length} (already v1)`);
  console.log(`  Failed:    ${failed.length}`);

  if (failed.length > 0) {
    console.log('\nFailed rows:');
    for (const f of failed) {
      console.log(`  - ${f.key} (id=${f.id}): ${f.error}`);
    }
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('Unhandled error:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
