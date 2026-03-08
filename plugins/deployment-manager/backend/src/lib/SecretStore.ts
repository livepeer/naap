export interface SecretStore {
  getSecrets(userId: string, providerSlug: string): Promise<Record<string, string>>;
  setSecrets(userId: string, providerSlug: string, secrets: Record<string, string>): Promise<void>;
  hasSecrets(userId: string, providerSlug: string, secretNames: string[]): Promise<{ name: string; configured: boolean; maskedValue?: string }[]>;
  deleteSecrets(userId: string, providerSlug: string): Promise<void>;
}

function maskSecret(value: string): string {
  if (value.length <= 8) return '••••••••';
  return value.slice(0, 4) + '••••' + value.slice(-4);
}

// ─── In-Memory (fallback when no database) ───────────────────────────

export class InMemorySecretStore implements SecretStore {
  private store = new Map<string, Record<string, string>>();

  private key(userId: string, providerSlug: string): string {
    return `${userId}:${providerSlug}`;
  }

  async getSecrets(userId: string, providerSlug: string): Promise<Record<string, string>> {
    return this.store.get(this.key(userId, providerSlug)) || {};
  }

  async setSecrets(userId: string, providerSlug: string, secrets: Record<string, string>): Promise<void> {
    const k = this.key(userId, providerSlug);
    const existing = this.store.get(k) || {};
    this.store.set(k, { ...existing, ...secrets });
  }

  async hasSecrets(
    userId: string,
    providerSlug: string,
    secretNames: string[],
  ): Promise<{ name: string; configured: boolean; maskedValue?: string }[]> {
    const secrets = this.store.get(this.key(userId, providerSlug)) || {};
    return secretNames.map((name) => ({
      name,
      configured: !!secrets[name],
      maskedValue: secrets[name] ? maskSecret(secrets[name]) : undefined,
    }));
  }

  async deleteSecrets(userId: string, providerSlug: string): Promise<void> {
    this.store.delete(this.key(userId, providerSlug));
  }
}

// ─── Prisma (persistent, uses DmProviderAuthConfig table) ────────────

let prismaClient: any = null;

async function getPrisma() {
  if (!prismaClient) {
    const db = await import('@naap/database');
    prismaClient = db.prisma;
  }
  return prismaClient;
}

export class PrismaSecretStore implements SecretStore {
  async getSecrets(userId: string, providerSlug: string): Promise<Record<string, string>> {
    try {
      const prisma = await getPrisma();
      const record = await prisma.dmProviderAuthConfig.findUnique({
        where: { ownerUserId_providerSlug: { ownerUserId: userId, providerSlug } },
      });
      return (record?.credentials as Record<string, string>) || {};
    } catch (err: any) {
      console.error(`[secret-store] getSecrets failed for ${providerSlug}: ${err.message}`);
      return {};
    }
  }

  async setSecrets(userId: string, providerSlug: string, secrets: Record<string, string>): Promise<void> {
    try {
      const prisma = await getPrisma();
      const existing = await this.getSecrets(userId, providerSlug);
      const merged = { ...existing, ...secrets };

      await prisma.dmProviderAuthConfig.upsert({
        where: { ownerUserId_providerSlug: { ownerUserId: userId, providerSlug } },
        create: {
          ownerUserId: userId,
          providerSlug,
          authType: 'api-key',
          credentials: merged,
        },
        update: {
          credentials: merged,
          updatedAt: new Date(),
        },
      });
    } catch (err: any) {
      console.error(`[secret-store] setSecrets failed for ${providerSlug}: ${err.message}`);
      throw err;
    }
  }

  async hasSecrets(
    userId: string,
    providerSlug: string,
    secretNames: string[],
  ): Promise<{ name: string; configured: boolean; maskedValue?: string }[]> {
    const secrets = await this.getSecrets(userId, providerSlug);
    return secretNames.map((name) => ({
      name,
      configured: !!secrets[name],
      maskedValue: secrets[name] ? maskSecret(secrets[name]) : undefined,
    }));
  }

  async deleteSecrets(userId: string, providerSlug: string): Promise<void> {
    const prisma = await getPrisma();
    await prisma.dmProviderAuthConfig.deleteMany({
      where: { ownerUserId: userId, providerSlug },
    });
  }
}

// ─── Default export: try Prisma, fall back to in-memory ──────────────

let _secretStore: SecretStore | null = null;

export function getSecretStore(): SecretStore {
  if (!_secretStore) {
    try {
      _secretStore = new PrismaSecretStore();
      // Test the connection synchronously by returning — actual DB call happens lazily
      console.log('[secret-store] Using Prisma persistent storage');
    } catch {
      _secretStore = new InMemorySecretStore();
      console.log('[secret-store] Using in-memory storage (no database)');
    }
  }
  return _secretStore;
}

export const secretStore: SecretStore = new PrismaSecretStore();
