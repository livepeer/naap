/**
 * Metadata Routes - Contract Tests
 *
 * Verifies all metadata endpoints return correct status codes and
 * response shapes. Uses mocked services to isolate route logic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createMetadataRoutes } from '../../routes/metadata';
import {
  createTestApp,
  createMockDb,
  createMockPublishMetrics,
  createMockArtifactHealth,
  createMockManifestValidator,
  createMockVersionManager,
} from '../helpers';

describe('Metadata Routes', () => {
  let app: ReturnType<typeof createTestApp>;
  let db: ReturnType<typeof createMockDb>;
  let publishMetrics: ReturnType<typeof createMockPublishMetrics>;
  let artifactHealth: ReturnType<typeof createMockArtifactHealth>;
  let manifestValidator: ReturnType<typeof createMockManifestValidator>;
  let versionManager: ReturnType<typeof createMockVersionManager>;

  beforeEach(() => {
    db = createMockDb();
    publishMetrics = createMockPublishMetrics();
    artifactHealth = createMockArtifactHealth();
    manifestValidator = createMockManifestValidator();
    versionManager = createMockVersionManager();

    app = createTestApp();
    const router = createMetadataRoutes({
      db,
      publishMetrics,
      artifactHealth,
      manifestValidator,
      versionManager,
    });
    app.use('/api/v1', router);
  });

  // --------------------------------------------------------------------------
  // Personal Plugin Config
  // --------------------------------------------------------------------------

  describe('GET /api/v1/plugins/:pluginName/config', () => {
    it('returns 401 without user header', async () => {
      const res = await request(app).get('/api/v1/plugins/my-plugin/config');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Authentication required');
    });

    it('returns empty object when no config exists', async () => {
      db.pluginConfig.findUnique.mockResolvedValue(null);
      const res = await request(app)
        .get('/api/v1/plugins/my-plugin/config')
        .set('x-user-id', 'user-1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });

    it('returns parsed config when record exists', async () => {
      db.pluginConfig.findUnique.mockResolvedValue({
        key: 'user_plugin_config:user-1:my-plugin',
        value: JSON.stringify({ theme: 'dark' }),
      });
      const res = await request(app)
        .get('/api/v1/plugins/my-plugin/config')
        .set('x-user-id', 'user-1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ theme: 'dark' });
    });

    it('returns empty object for invalid JSON in config value', async () => {
      db.pluginConfig.findUnique.mockResolvedValue({
        key: 'user_plugin_config:user-1:my-plugin',
        value: 'not-json',
      });
      const res = await request(app)
        .get('/api/v1/plugins/my-plugin/config')
        .set('x-user-id', 'user-1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });
  });

  describe('PUT /api/v1/plugins/:pluginName/config', () => {
    it('returns 401 without user header', async () => {
      const res = await request(app)
        .put('/api/v1/plugins/my-plugin/config')
        .send({ theme: 'light' });
      expect(res.status).toBe(401);
    });

    it('upserts config and returns the body', async () => {
      const body = { theme: 'light', fontSize: 14 };
      const res = await request(app)
        .put('/api/v1/plugins/my-plugin/config')
        .set('x-user-id', 'user-1')
        .send(body);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(body);
      expect(db.pluginConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'user_plugin_config:user-1:my-plugin' },
        })
      );
    });
  });

  // --------------------------------------------------------------------------
  // Publish Metrics
  // --------------------------------------------------------------------------

  describe('GET /api/v1/metrics/summary', () => {
    it('returns metrics summary with default period', async () => {
      const res = await request(app).get('/api/v1/metrics/summary');
      expect(res.status).toBe(200);
      expect(publishMetrics.getSummary).toHaveBeenCalledWith('7d');
    });

    it('passes period query parameter', async () => {
      await request(app).get('/api/v1/metrics/summary?period=24h');
      expect(publishMetrics.getSummary).toHaveBeenCalledWith('24h');
    });
  });

  describe('GET /api/v1/metrics/packages/:name', () => {
    it('returns package-specific metrics', async () => {
      const res = await request(app).get('/api/v1/metrics/packages/my-plugin');
      expect(res.status).toBe(200);
      expect(publishMetrics.getPackageMetrics).toHaveBeenCalledWith('my-plugin', '7d');
    });
  });

  // --------------------------------------------------------------------------
  // Artifact Health
  // --------------------------------------------------------------------------

  describe('GET /api/v1/health/artifacts', () => {
    it('returns health summary', async () => {
      const res = await request(app).get('/api/v1/health/artifacts');
      expect(res.status).toBe(200);
      expect(artifactHealth.getHealthSummary).toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/health/artifacts/:name/:version', () => {
    it('checks specific artifact health', async () => {
      const res = await request(app).get('/api/v1/health/artifacts/my-plugin/1.0.0');
      expect(res.status).toBe(200);
      expect(artifactHealth.checkArtifact).toHaveBeenCalledWith('my-plugin', '1.0.0');
    });
  });

  describe('POST /api/v1/health/check-all', () => {
    it('returns aggregated health check results', async () => {
      artifactHealth.checkAllInstalled.mockResolvedValue([
        { issues: [] },
        { issues: ['stale'] },
      ]);
      const res = await request(app).post('/api/v1/health/check-all');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        checked: 2,
        healthy: 1,
        unhealthy: 1,
        results: [{ issues: [] }, { issues: ['stale'] }],
      });
    });
  });

  // --------------------------------------------------------------------------
  // Manifest Validation
  // --------------------------------------------------------------------------

  describe('POST /api/v1/validate/manifest', () => {
    it('validates a manifest and returns result', async () => {
      const manifest = { name: 'test', version: '1.0.0' };
      manifestValidator.validate.mockReturnValue({ valid: true, errors: [] });
      const res = await request(app)
        .post('/api/v1/validate/manifest')
        .send(manifest);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ valid: true, errors: [] });
      expect(manifestValidator.validate).toHaveBeenCalledWith(manifest);
    });
  });

  // --------------------------------------------------------------------------
  // Version Management
  // --------------------------------------------------------------------------

  describe('GET /api/v1/versions/:packageId/check/:version', () => {
    it('returns 400 for invalid version format', async () => {
      versionManager.validateVersion.mockReturnValue({ valid: false, error: 'Invalid semver' });
      const res = await request(app).get('/api/v1/versions/pkg-1/check/not-a-version');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ valid: false, error: 'Invalid semver' });
    });

    it('returns valid: true when no conflict', async () => {
      versionManager.validateVersion.mockReturnValue({ valid: true });
      versionManager.checkVersionConflict.mockResolvedValue(null);
      const res = await request(app).get('/api/v1/versions/pkg-1/check/1.0.0');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ valid: true, conflict: null });
    });

    it('returns valid: false with conflict details', async () => {
      versionManager.validateVersion.mockReturnValue({ valid: true });
      versionManager.checkVersionConflict.mockResolvedValue({ existing: '1.0.0' });
      const res = await request(app).get('/api/v1/versions/pkg-1/check/1.0.0');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ valid: false, conflict: { existing: '1.0.0' } });
    });
  });

  describe('GET /api/v1/versions/:packageId/history', () => {
    it('returns version history', async () => {
      versionManager.getVersionHistory.mockResolvedValue(['1.0.0', '1.1.0']);
      const res = await request(app).get('/api/v1/versions/pkg-1/history');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ versions: ['1.0.0', '1.1.0'] });
    });
  });

  describe('GET /api/v1/versions/:packageId/latest', () => {
    it('returns latest version without prerelease by default', async () => {
      versionManager.getLatestVersion.mockResolvedValue('2.0.0');
      const res = await request(app).get('/api/v1/versions/pkg-1/latest');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ latest: '2.0.0' });
      expect(versionManager.getLatestVersion).toHaveBeenCalledWith('pkg-1', false);
    });

    it('includes prerelease when query param set', async () => {
      await request(app).get('/api/v1/versions/pkg-1/latest?prerelease=true');
      expect(versionManager.getLatestVersion).toHaveBeenCalledWith('pkg-1', true);
    });
  });

  describe('GET /api/v1/versions/:packageId/upgrade/:currentVersion', () => {
    it('checks for upgrade availability', async () => {
      versionManager.checkForUpgrade.mockResolvedValue({ available: true, version: '2.0.0' });
      const res = await request(app).get('/api/v1/versions/pkg-1/upgrade/1.0.0');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ available: true, version: '2.0.0' });
      expect(versionManager.checkForUpgrade).toHaveBeenCalledWith('pkg-1', '1.0.0', false);
    });
  });
});
