/**
 * Connector Template Loader (web-next side)
 *
 * Reads connector template JSON files from the service-gateway plugin's
 * connectors/ directory. Provides the same interface as the plugin's
 * loader.ts but resolves the path relative to the monorepo root.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

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

function resolveConnectorsDir(): string {
  const cwd = process.cwd();
  if (cwd.endsWith('apps/web-next')) {
    return resolve(cwd, '../../plugins/service-gateway/connectors');
  }
  return resolve(cwd, 'plugins/service-gateway/connectors');
}

let _cache: ConnectorTemplate[] | null = null;

export function loadConnectorTemplates(): ConnectorTemplate[] {
  if (_cache) return _cache;

  const dir = resolveConnectorsDir();
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith('.json') && f !== 'connector-template.schema.json')
      .sort();
  } catch {
    console.warn(`[connector-templates] Directory not found: ${dir}`);
    return [];
  }

  const templates: ConnectorTemplate[] = [];

  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), 'utf-8');
      const data = JSON.parse(raw) as ConnectorTemplate;

      if (!data.id || !data.connector?.slug || !data.endpoints?.length) {
        console.warn(`[connector-templates] Skipping ${file}: missing required fields`);
        continue;
      }

      templates.push(data);
    } catch (err) {
      console.warn(`[connector-templates] Failed to parse ${file}:`, (err as Error).message);
    }
  }

  _cache = templates;
  return templates;
}

export function getTemplateById(id: string): ConnectorTemplate | undefined {
  return loadConnectorTemplates().find((t) => t.id === id);
}

export function clearTemplateCache(): void {
  _cache = null;
}
