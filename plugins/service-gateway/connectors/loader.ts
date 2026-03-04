/**
 * Connector Template Loader
 *
 * Reads all *.json connector template files from this directory,
 * validates them, and returns typed ConnectorTemplate objects.
 *
 * Single source of truth — used by both the seed script and the
 * templates API route.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';

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
}

export interface ConnectorTemplateConnector {
  slug: string;
  displayName: string;
  description?: string;
  category?: string;
  upstreamBaseUrl: string;
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
  envKey?: string;
}

const CONNECTORS_DIR = __dirname;

let _cache: ConnectorTemplate[] | null = null;

export function loadConnectorTemplates(): ConnectorTemplate[] {
  if (_cache) return _cache;

  const files = readdirSync(CONNECTORS_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'connector-template.schema.json')
    .sort();

  const templates: ConnectorTemplate[] = [];

  for (const file of files) {
    const filePath = join(CONNECTORS_DIR, file);
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as ConnectorTemplate;

      if (!data.id || !data.connector?.slug || !data.endpoints?.length) {
        console.warn(`[loader] Skipping ${file}: missing required fields (id, connector.slug, endpoints)`);
        continue;
      }

      templates.push(data);
    } catch (err) {
      console.warn(`[loader] Failed to parse ${file}:`, (err as Error).message);
    }
  }

  _cache = templates;
  return templates;
}

export function getTemplateById(id: string): ConnectorTemplate | undefined {
  return loadConnectorTemplates().find((t) => t.id === id);
}

export function getTemplatesByCategory(category: string): ConnectorTemplate[] {
  return loadConnectorTemplates().filter((t) => t.category === category);
}

export function clearTemplateCache(): void {
  _cache = null;
}
