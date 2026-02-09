/**
 * Encryption Service
 * 
 * Provides AES-256-GCM encryption for secret storage.
 * Uses a master key from environment for key derivation.
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

/**
 * Get the master key from environment
 */
function getMasterKey(): string {
  const masterKey = process.env.ENCRYPTION_MASTER_KEY || process.env.SECRET_KEY;
  if (!masterKey) {
    console.warn('WARNING: No encryption master key set. Using default for development.');
    return 'naap-dev-master-key-change-in-production';
  }
  return masterKey;
}

/**
 * Derive a key from the master key using PBKDF2
 */
function deriveKey(masterKey: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(masterKey, salt, ITERATIONS, KEY_LENGTH, 'sha256');
}

export interface EncryptionResult {
  encryptedValue: string;
  iv: string;
}

export interface DecryptionInput {
  encryptedValue: string;
  iv: string;
}

/**
 * Create an encryption service instance
 */
export function createEncryptionService() {
  const masterKey = getMasterKey();

  return {
    /**
     * Encrypt a value
     */
    encrypt(value: string): EncryptionResult {
      // Generate random salt and IV
      const salt = crypto.randomBytes(SALT_LENGTH);
      const iv = crypto.randomBytes(IV_LENGTH);
      
      // Derive key from master key
      const key = deriveKey(masterKey, salt);
      
      // Create cipher
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
      
      // Encrypt
      let encrypted = cipher.update(value, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Get auth tag
      const authTag = cipher.getAuthTag();
      
      // Combine salt + authTag + encrypted data
      const combined = Buffer.concat([
        salt,
        authTag,
        Buffer.from(encrypted, 'hex'),
      ]);

      return {
        encryptedValue: combined.toString('base64'),
        iv: iv.toString('base64'),
      };
    },

    /**
     * Decrypt a value
     */
    decrypt(input: DecryptionInput): string {
      const { encryptedValue, iv } = input;
      
      // Decode from base64
      const combined = Buffer.from(encryptedValue, 'base64');
      const ivBuffer = Buffer.from(iv, 'base64');
      
      // Extract salt, auth tag, and encrypted data
      const salt = combined.subarray(0, SALT_LENGTH);
      const authTag = combined.subarray(SALT_LENGTH, SALT_LENGTH + AUTH_TAG_LENGTH);
      const encryptedData = combined.subarray(SALT_LENGTH + AUTH_TAG_LENGTH);
      
      // Derive key
      const key = deriveKey(masterKey, salt);
      
      // Create decipher
      const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuffer);
      decipher.setAuthTag(authTag);
      
      // Decrypt
      let decrypted = decipher.update(encryptedData.toString('hex'), 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    },

    /**
     * Hash a value (one-way, for comparison)
     */
    hash(value: string): string {
      const salt = crypto.randomBytes(SALT_LENGTH);
      const hash = crypto.pbkdf2Sync(value, salt, ITERATIONS, KEY_LENGTH, 'sha256');
      return salt.toString('hex') + ':' + hash.toString('hex');
    },

    /**
     * Verify a hashed value
     */
    verifyHash(value: string, hashedValue: string): boolean {
      const [saltHex, hashHex] = hashedValue.split(':');
      const salt = Buffer.from(saltHex, 'hex');
      const expectedHash = crypto.pbkdf2Sync(value, salt, ITERATIONS, KEY_LENGTH, 'sha256');
      return expectedHash.toString('hex') === hashHex;
    },

    /**
     * Generate a random API key
     */
    generateApiKey(): string {
      return 'naap_' + crypto.randomBytes(32).toString('hex');
    },
  };
}

// Singleton instance
let encryptionService: ReturnType<typeof createEncryptionService> | null = null;

export function getEncryptionService() {
  if (!encryptionService) {
    encryptionService = createEncryptionService();
  }
  return encryptionService;
}
