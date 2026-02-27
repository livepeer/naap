/**
 * Connector Template Loader — DB-backed
 *
 * Loads connector templates from the GatewayConnectorTemplate table.
 * Templates are synced to the DB during build/deploy by sync-plugin-registry.ts,
 * so this works identically on Vercel (serverless) and local dev.
 */

import { prisma } from '@/lib/db';

export interface ConnectorTemplateEndpoint {
  name: string;
  description?: string;
  method: string;
  path: string;
  upstreamPath: string;
  upstreamContentType?: string;
  bodyTransform?: string;
  rateLimit?: number;
  timeout?: number;
  cacheTtl?: number;
  retries?: number;
  bodyBlacklist?: string[];
  bodyPattern?: string;
  bodySchema?: unknown;
}

export interface ConnectorTemplateConnector {
  slug: string;
  displayName: string;
  description?: string;
  category?: string;
  upstreamBaseUrl?: string;
  allowedHosts?: string[];
  defaultTimeout?: number;
  healthCheckPath?: string;
  authType: string;
  authConfig?: Record<string, unknown>;
  secretRefs: string[];
  streamingEnabled?: boolean;
  responseWrapper?: boolean;
  tags?: string[];
}

export interface ConnectorTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  connector: ConnectorTemplateConnector;
  endpoints: ConnectorTemplateEndpoint[];
}

export async function loadConnectorTemplates(): Promise<ConnectorTemplate[]> {
  try {
    const rows = await prisma.gatewayConnectorTemplate.findMany({
      orderBy: { name: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      icon: row.icon,
      category: row.category,
      connector: row.connector as unknown as ConnectorTemplateConnector,
      endpoints: row.endpoints as unknown as ConnectorTemplateEndpoint[],
    }));
  } catch (err) {
    console.warn('[connector-templates] Failed to load from DB:', err);
    return [];
  }
}

export async function getTemplateById(id: string): Promise<ConnectorTemplate | undefined> {
  try {
    const row = await prisma.gatewayConnectorTemplate.findUnique({ where: { id } });
    if (!row) return undefined;

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      icon: row.icon,
      category: row.category,
      connector: row.connector as unknown as ConnectorTemplateConnector,
      endpoints: row.endpoints as unknown as ConnectorTemplateEndpoint[],
    };
  } catch (err) {
    console.warn(`[connector-templates] Failed to load template "${id}":`, err);
    return undefined;
  }
}
