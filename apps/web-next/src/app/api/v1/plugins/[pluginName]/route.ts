/**
 * Plugin Detail API
 * GET /api/v1/plugins/:pluginName - Get plugin details
 * PUT /api/v1/plugins/:pluginName - Update plugin version
 * DELETE /api/v1/plugins/:pluginName - Unregister plugin
 */

import { NextRequest } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken, success, successNoContent } from '@/lib/api/response';
import { getPluginRegistry } from '@/lib/plugins/registry';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pluginName: string }> }
) {
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

    const { pluginName } = await params;
    const registry = getPluginRegistry();
    const plugin = await registry.getPlugin(pluginName);

    if (!plugin) {
      return errors.notFound(`Plugin ${pluginName} not found`);
    }

    return success({
      name: plugin.manifest.name,
      displayName: plugin.manifest.displayName,
      description: plugin.manifest.description,
      version: plugin.currentVersion,
      versions: plugin.versions,
      author: plugin.manifest.author,
      homepage: plugin.manifest.homepage,
      repository: plugin.manifest.repository,
      license: plugin.manifest.license,
      icon: plugin.manifest.icon,
      routes: plugin.manifest.routes,
      permissions: plugin.manifest.permissions,
      dependencies: plugin.manifest.dependencies,
      bundleUrl: plugin.bundleUrl,
      enabled: plugin.enabled,
      order: plugin.manifest.order,
      installedAt: plugin.installedAt,
      updatedAt: plugin.updatedAt,
    });
  } catch (err) {
    console.error('Get plugin error:', err);
    return errors.internal('Failed to get plugin');
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ pluginName: string }> }
) {
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

    const { pluginName } = await params;
    const registry = getPluginRegistry();

    // Check content type
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      // Simple update (enable/disable)
      const body = await request.json();

      if (typeof body.enabled === 'boolean') {
        if (body.enabled) {
          await registry.enable(pluginName);
        } else {
          await registry.disable(pluginName);
        }
      }

      const plugin = await registry.getPlugin(pluginName);
      if (!plugin) {
        return errors.notFound(`Plugin ${pluginName} not found`);
      }

      return success({
        name: plugin.manifest.name,
        enabled: plugin.enabled,
        updatedAt: plugin.updatedAt,
      });
    }

    // Full version update with new bundle
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

    // Ensure plugin name matches
    if (manifest.name !== pluginName) {
      return errors.badRequest('Manifest name must match plugin name');
    }

    const bundleBuffer = Buffer.from(await bundleFile.arrayBuffer());
    const entry = await registry.updateVersion(pluginName, {
      manifest,
      bundleFile: bundleBuffer,
      checksum: checksum || '',
    });

    return success({
      name: entry.manifest.name,
      version: entry.currentVersion,
      bundleUrl: entry.bundleUrl,
      updatedAt: entry.updatedAt,
    });
  } catch (err) {
    console.error('Update plugin error:', err);
    return errors.internal('Failed to update plugin');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ pluginName: string }> }
) {
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

    const { pluginName } = await params;
    const registry = getPluginRegistry();

    // Check if plugin exists
    const plugin = await registry.getPlugin(pluginName);
    if (!plugin) {
      return errors.notFound(`Plugin ${pluginName} not found`);
    }

    await registry.unregister(pluginName);
    return successNoContent();
  } catch (err) {
    console.error('Delete plugin error:', err);
    return errors.internal('Failed to delete plugin');
  }
}
