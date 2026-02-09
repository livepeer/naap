/**
 * Secrets Routes - Contract Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createSecretsRoutes } from '../../routes/secrets';
import { createTestApp, createMockSecretVaultService, createMockLifecycleService } from '../helpers';

describe('Secrets Routes', () => {
  let app: ReturnType<typeof createTestApp>;
  let secretVaultService: ReturnType<typeof createMockSecretVaultService>;
  let lifecycleService: ReturnType<typeof createMockLifecycleService>;

  beforeEach(() => {
    secretVaultService = createMockSecretVaultService();
    lifecycleService = createMockLifecycleService();

    app = createTestApp();
    const router = createSecretsRoutes({ secretVaultService, lifecycleService });
    app.use('/api/v1', router);
  });

  // --------------------------------------------------------------------------
  // Secret Vault
  // --------------------------------------------------------------------------

  describe('POST /api/v1/secrets', () => {
    it('returns 400 when key or value missing', async () => {
      const res = await request(app).post('/api/v1/secrets').send({ key: 'k' });
      expect(res.status).toBe(400);
    });

    it('stores a secret and audits', async () => {
      secretVaultService.storeSecret.mockResolvedValue({ key: 'my-key' });
      const res = await request(app)
        .post('/api/v1/secrets')
        .set('x-user-id', 'user-1')
        .send({ key: 'my-key', value: 'secret-val', scope: 'global' });
      expect(res.status).toBe(200);
      expect(secretVaultService.storeSecret).toHaveBeenCalled();
      expect(lifecycleService.audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'secret.create', resourceId: 'my-key' })
      );
    });
  });

  describe('GET /api/v1/secrets', () => {
    it('lists secrets', async () => {
      secretVaultService.listSecrets.mockResolvedValue([{ key: 'a' }]);
      const res = await request(app).get('/api/v1/secrets');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ key: 'a' }]);
    });

    it('passes scope query param', async () => {
      await request(app).get('/api/v1/secrets?scope=plugin');
      expect(secretVaultService.listSecrets).toHaveBeenCalledWith('plugin');
    });
  });

  describe('DELETE /api/v1/secrets/:key', () => {
    it('returns 404 when secret not found', async () => {
      secretVaultService.deleteSecret.mockResolvedValue(false);
      const res = await request(app).delete('/api/v1/secrets/missing-key');
      expect(res.status).toBe(404);
    });

    it('deletes and audits', async () => {
      secretVaultService.deleteSecret.mockResolvedValue(true);
      const res = await request(app)
        .delete('/api/v1/secrets/my-key')
        .set('x-user-id', 'user-1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(lifecycleService.audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'secret.delete' })
      );
    });
  });

  describe('POST /api/v1/secrets/:key/rotate', () => {
    it('returns 400 when value missing', async () => {
      const res = await request(app).post('/api/v1/secrets/k/rotate').send({});
      expect(res.status).toBe(400);
    });

    it('returns 404 when secret not found', async () => {
      secretVaultService.rotateSecret.mockResolvedValue(null);
      const res = await request(app)
        .post('/api/v1/secrets/k/rotate')
        .send({ value: 'new' });
      expect(res.status).toBe(404);
    });

    it('rotates and audits', async () => {
      secretVaultService.rotateSecret.mockResolvedValue({ key: 'k', rotated: true });
      const res = await request(app)
        .post('/api/v1/secrets/k/rotate')
        .set('x-user-id', 'user-1')
        .send({ value: 'new-val' });
      expect(res.status).toBe(200);
      expect(lifecycleService.audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'secret.rotate' })
      );
    });
  });

  // --------------------------------------------------------------------------
  // API Key Mappings
  // --------------------------------------------------------------------------

  describe('GET /api/v1/key-mappings', () => {
    it('lists all key mappings', async () => {
      secretVaultService.getAllKeyMappings.mockResolvedValue([{ pluginName: 'p' }]);
      const res = await request(app).get('/api/v1/key-mappings');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/v1/key-mappings/:pluginName', () => {
    it('returns mappings for a plugin', async () => {
      secretVaultService.getPluginKeyMappings.mockResolvedValue([]);
      const res = await request(app).get('/api/v1/key-mappings/my-plugin');
      expect(res.status).toBe(200);
      expect(secretVaultService.getPluginKeyMappings).toHaveBeenCalledWith('my-plugin');
    });
  });

  describe('POST /api/v1/key-mappings', () => {
    it('returns 400 when required fields missing', async () => {
      const res = await request(app).post('/api/v1/key-mappings').send({ pluginName: 'p' });
      expect(res.status).toBe(400);
    });

    it('creates mapping and audits', async () => {
      const body = { pluginName: 'p', integrationType: 'openai', secretKey: 'sk' };
      const res = await request(app)
        .post('/api/v1/key-mappings')
        .set('x-user-id', 'user-1')
        .send(body);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(lifecycleService.audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'keyMapping.create' })
      );
    });
  });

  describe('DELETE /api/v1/key-mappings/:pluginName/:integrationType', () => {
    it('returns 404 when not found', async () => {
      secretVaultService.deleteKeyMapping.mockResolvedValue(false);
      const res = await request(app).delete('/api/v1/key-mappings/p/openai');
      expect(res.status).toBe(404);
    });

    it('deletes and audits', async () => {
      secretVaultService.deleteKeyMapping.mockResolvedValue(true);
      const res = await request(app)
        .delete('/api/v1/key-mappings/p/openai')
        .set('x-user-id', 'user-1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    });
  });
});
