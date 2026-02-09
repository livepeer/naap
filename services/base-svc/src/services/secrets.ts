/**
 * Secret Vault Service
 * 
 * Manages encrypted secrets and API key mappings.
 * Provides centralized credential management for integrations.
 */

import { PrismaClient } from '@naap/database';
import { createEncryptionService } from './encryption';

export interface SecretInput {
  key: string;
  value: string;
  description?: string;
  scope?: string;
  createdBy?: string;
}

export interface SecretMetadata {
  key: string;
  description?: string;
  scope: string;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
  rotatedAt?: Date;
}

export interface KeyMappingInput {
  pluginName: string;
  integrationType: string;
  secretKey: string;
}

export function createSecretVaultService(prisma: PrismaClient) {
  const encryption = createEncryptionService();

  return {
    /**
     * Store a secret
     */
    async storeSecret(input: SecretInput): Promise<SecretMetadata> {
      const { encryptedValue, iv } = encryption.encrypt(input.value);

      const secret = await prisma.secretVault.upsert({
        where: { key: input.key },
        create: {
          key: input.key,
          encryptedValue,
          iv,
          description: input.description,
          scope: input.scope || 'global',
          createdBy: input.createdBy,
        },
        update: {
          encryptedValue,
          iv,
          description: input.description,
          scope: input.scope || 'global',
          rotatedAt: new Date(),
        },
      });

      return {
        key: secret.key,
        description: secret.description || undefined,
        scope: secret.scope,
        createdBy: secret.createdBy || undefined,
        createdAt: secret.createdAt,
        updatedAt: secret.updatedAt,
        rotatedAt: secret.rotatedAt || undefined,
      };
    },

    /**
     * Get a secret value (decrypted)
     */
    async getSecret(key: string, scope?: string): Promise<string | null> {
      const secret = await prisma.secretVault.findFirst({
        where: {
          key,
          ...(scope && { scope }),
        },
      });

      if (!secret) return null;

      return encryption.decrypt({
        encryptedValue: secret.encryptedValue,
        iv: secret.iv,
      });
    },

    /**
     * List all secrets (metadata only, no values)
     */
    async listSecrets(scope?: string): Promise<SecretMetadata[]> {
      const secrets = await prisma.secretVault.findMany({
        where: scope ? { scope } : undefined,
        select: {
          key: true,
          description: true,
          scope: true,
          createdBy: true,
          createdAt: true,
          updatedAt: true,
          rotatedAt: true,
        },
        orderBy: { key: 'asc' },
      });

      return secrets.map(s => ({
        key: s.key,
        description: s.description || undefined,
        scope: s.scope,
        createdBy: s.createdBy || undefined,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        rotatedAt: s.rotatedAt || undefined,
      }));
    },

    /**
     * Delete a secret
     */
    async deleteSecret(key: string): Promise<boolean> {
      try {
        await prisma.secretVault.delete({
          where: { key },
        });
        return true;
      } catch {
        return false;
      }
    },

    /**
     * Rotate a secret (update with new value)
     */
    async rotateSecret(key: string, newValue: string, rotatedBy?: string): Promise<SecretMetadata | null> {
      const existing = await prisma.secretVault.findUnique({
        where: { key },
      });

      if (!existing) return null;

      const { encryptedValue, iv } = encryption.encrypt(newValue);

      const secret = await prisma.secretVault.update({
        where: { key },
        data: {
          encryptedValue,
          iv,
          rotatedAt: new Date(),
        },
      });

      return {
        key: secret.key,
        description: secret.description || undefined,
        scope: secret.scope,
        createdBy: secret.createdBy || undefined,
        createdAt: secret.createdAt,
        updatedAt: secret.updatedAt,
        rotatedAt: secret.rotatedAt || undefined,
      };
    },

    /**
     * Create a key mapping for a plugin
     */
    async createKeyMapping(input: KeyMappingInput): Promise<void> {
      await prisma.aPIKeyMapping.upsert({
        where: {
          pluginName_integrationType: {
            pluginName: input.pluginName,
            integrationType: input.integrationType,
          },
        },
        create: {
          pluginName: input.pluginName,
          integrationType: input.integrationType,
          secretKey: input.secretKey,
        },
        update: {
          secretKey: input.secretKey,
        },
      });
    },

    /**
     * Get key mappings for a plugin
     */
    async getPluginKeyMappings(pluginName: string) {
      return prisma.aPIKeyMapping.findMany({
        where: { pluginName },
      });
    },

    /**
     * Get all key mappings
     */
    async getAllKeyMappings() {
      return prisma.aPIKeyMapping.findMany({
        orderBy: [{ pluginName: 'asc' }, { integrationType: 'asc' }],
      });
    },

    /**
     * Delete a key mapping
     */
    async deleteKeyMapping(pluginName: string, integrationType: string): Promise<boolean> {
      try {
        await prisma.aPIKeyMapping.delete({
          where: {
            pluginName_integrationType: {
              pluginName,
              integrationType,
            },
          },
        });
        return true;
      } catch {
        return false;
      }
    },

    /**
     * Get the secret for a plugin's integration
     */
    async getIntegrationSecret(pluginName: string, integrationType: string): Promise<string | null> {
      const mapping = await prisma.aPIKeyMapping.findUnique({
        where: {
          pluginName_integrationType: {
            pluginName,
            integrationType,
          },
        },
      });

      if (!mapping || !mapping.enabled) return null;

      return this.getSecret(mapping.secretKey);
    },

    /**
     * Get the global secret for an integration type
     */
    async getGlobalIntegrationSecret(integrationType: string): Promise<string | null> {
      // Convention: global secrets are named like "openai_api_key", "aws_access_key", etc.
      const secretKey = `${integrationType.replace('-', '_')}_api_key`;
      return this.getSecret(secretKey, 'global');
    },
  };
}

// Singleton
let secretVaultService: ReturnType<typeof createSecretVaultService> | null = null;

export function getSecretVaultService(prisma: PrismaClient) {
  if (!secretVaultService) {
    secretVaultService = createSecretVaultService(prisma);
  }
  return secretVaultService;
}
