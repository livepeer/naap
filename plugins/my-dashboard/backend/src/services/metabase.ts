/**
 * Metabase JWT Signing Service
 * 
 * Generates signed JWT tokens for Metabase interactive embedding
 */

import jwt from 'jsonwebtoken';
import { prisma } from '../db/client.js';

export interface EmbedPayload {
  resource: {
    dashboard: number;
  };
  params?: Record<string, string | number>;
  exp?: number;
}

/**
 * Get plugin configuration from database
 */
export async function getConfig() {
  const configs = await prisma.pluginConfig.findMany();
  const configMap: Record<string, string> = {};
  
  for (const c of configs) {
    configMap[c.key] = c.value;
  }
  
  return {
    metabaseUrl: configMap['metabaseUrl'] || '',
    metabaseSecretKey: configMap['metabaseSecretKey'] || '',
    tokenExpiry: parseInt(configMap['tokenExpiry'] || '600'),
    enableInteractive: configMap['enableInteractive'] !== 'false',
  };
}

/**
 * Save plugin configuration to database
 */
export async function saveConfig(config: Record<string, string | number | boolean>) {
  for (const [key, value] of Object.entries(config)) {
    await prisma.pluginConfig.upsert({
      where: { key },
      update: { value: String(value) },
      create: { key, value: String(value) },
    });
  }
}

/**
 * Generate a signed embed URL for a Metabase dashboard
 * @param dashboardId - Numeric dashboard ID (required for JWT embedding)
 */
export async function generateEmbedUrl(
  dashboardId: number,
  params?: Record<string, string | number>,
  userId?: string
): Promise<{ embedUrl: string; expiresAt: string }> {
  const config = await getConfig();
  
  if (!config.metabaseUrl || !config.metabaseSecretKey) {
    throw new Error('Metabase is not configured');
  }

  const expSeconds = config.tokenExpiry || 600;
  const exp = Math.floor(Date.now() / 1000) + expSeconds;

  const payload: EmbedPayload = {
    resource: { dashboard: dashboardId },
    params: params || {},
    exp,
  };

  // Add user context for row-level security if available
  if (userId) {
    payload.params = {
      ...payload.params,
      user_id: userId,
    };
  }

  const token = jwt.sign(payload, config.metabaseSecretKey);

  // Construct embed URL (remove trailing slash from URL to avoid double slashes)
  const baseUrl = config.metabaseUrl.replace(/\/+$/, '');
  const embedUrl = config.enableInteractive
    ? `${baseUrl}/embed/dashboard/${token}#bordered=false&titled=false`
    : `${baseUrl}/embed/dashboard/${token}`;

  return {
    embedUrl,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

/**
 * Verify that Metabase is properly configured
 */
export async function verifyConfig(): Promise<{ valid: boolean; error?: string }> {
  const config = await getConfig();
  
  if (!config.metabaseUrl) {
    return { valid: false, error: 'Metabase URL is not configured' };
  }
  
  if (!config.metabaseSecretKey) {
    return { valid: false, error: 'Metabase secret key is not configured' };
  }

  // Validate URL format
  try {
    new URL(config.metabaseUrl);
  } catch {
    return { valid: false, error: 'Invalid Metabase URL format' };
  }

  return { valid: true };
}

export default {
  getConfig,
  saveConfig,
  generateEmbedUrl,
  verifyConfig,
};
