/**
 * Plugin Registry API
 * GET /api/v1/plugins - List all plugins
 * POST /api/v1/plugins - Register a new plugin
 */

import {NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken, success } from '@/lib/api/response';
import { getPluginRegistry } from '@/lib/plugins/registry';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Validate session
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const registry = getPluginRegistry();
    const plugins = await registry.listPlugins();

    // Filter by enabled status if requested
    const { searchParams } = new URL(request.url);
    const enabledOnly = searchParams.get('enabled') === 'true';

    const filteredPlugins = enabledOnly
      ? plugins.filter(p => p.enabled)
      : plugins;

    return success({
      plugins: filteredPlugins.map(p => ({
        name: p.manifest.name,
        displayName: p.manifest.displayName,
        version: p.currentVersion,
        description: p.manifest.description,
        author: p.manifest.author,
        icon: p.manifest.icon,
        routes: p.manifest.routes,
        bundleUrl: p.bundleUrl,
        enabled: p.enabled,
        order: p.manifest.order,
        installedAt: p.installedAt,
        updatedAt: p.updatedAt,
      })),
    });
  } catch (err) {
    console.error('List plugins error:', err);
    return errors.internal('Failed to list plugins');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Validate session
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    // Check admin permission
    const isAdmin = user.roles.includes('admin') || user.roles.includes('system:admin');
    if (!isAdmin) {
      return errors.forbidden('Admin permission required');
    }

    // Parse multipart form data
    const formData = await request.formData();
    const manifestJson = formData.get('manifest') as string;
    const bundleFile = formData.get('bundle') as File;
    const checksum = formData.get('checksum') as string;

    if (!manifestJson || !bundleFile) {
      return errors.badRequest('Missing manifest or bundle file');
    }

    let manifest;
    try {
      manifest = JSON.parse(manifestJson);
    } catch {
      return errors.badRequest('Invalid manifest JSON');
    }

    // Validate manifest
    if (!manifest.name || !manifest.version || !manifest.displayName) {
      return errors.badRequest('Manifest must include name, version, and displayName');
    }

    const registry = getPluginRegistry();
    const bundleBuffer = Buffer.from(await bundleFile.arrayBuffer());

    const entry = await registry.register({
      manifest,
      bundleFile: bundleBuffer,
      checksum: checksum || '',
    });

    return success({
      name: entry.manifest.name,
      version: entry.currentVersion,
      bundleUrl: entry.bundleUrl,
      installedAt: entry.installedAt,
    });
  } catch (err) {
    console.error('Register plugin error:', err);
    return errors.internal('Failed to register plugin');
  }
}
