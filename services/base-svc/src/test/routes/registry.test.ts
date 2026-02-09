/**
 * Registry Routes - Contract Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createRegistryRoutes } from '../../routes/registry';
import { createTestApp, createMockDb, createMockLifecycleService } from '../helpers';

describe('Registry Routes', () => {
  let app: ReturnType<typeof createTestApp>;
  let db: ReturnType<typeof createMockDb>;
  let lifecycleService: ReturnType<typeof createMockLifecycleService>;
  const mockGetUserId = vi.fn().mockResolvedValue('user-1');
  const mockAuthService = { validateSession: vi.fn().mockResolvedValue(null) };
  const mockRequireToken = (_scope?: string) => (_req: any, _res: any, next: any) => next();
  const mockGenerateApiToken = vi.fn().mockReturnValue({ token: 'tok_123', hash: 'h', prefix: 'np_' });
  const mockVerifyPublish = vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: [], checks: [] });

  beforeEach(() => {
    db = createMockDb();
    lifecycleService = createMockLifecycleService();
    mockGetUserId.mockResolvedValue('user-1');

    app = createTestApp();
    const router = createRegistryRoutes({
      db, getUserIdFromRequest: mockGetUserId, lifecycleService,
      authService: mockAuthService, requireToken: mockRequireToken,
      generateApiToken: mockGenerateApiToken, verifyPublish: mockVerifyPublish,
    });
    app.use('/api/v1', router);
  });

  describe('GET /api/v1/registry/packages', () => {
    it('returns packages list', async () => {
      db.pluginPackage.findMany.mockResolvedValue([]);
      db.pluginPackage.count.mockResolvedValue(0);
      const res = await request(app).get('/api/v1/registry/packages');
      expect(res.status).toBe(200);
      expect(res.body.packages).toEqual([]);
    });
  });

  describe('GET /api/v1/registry/packages/:name', () => {
    it('returns 404 when not found', async () => {
      db.pluginPackage.findUnique.mockResolvedValue(null);
      const res = await request(app).get('/api/v1/registry/packages/nope');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/registry/packages/:name/reviews', () => {
    it('returns 404 when package not found', async () => {
      db.pluginPackage.findUnique.mockResolvedValue(null);
      const res = await request(app).get('/api/v1/registry/packages/nope/reviews');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/registry/packages/:name/reviews', () => {
    it('returns 401 without auth', async () => {
      mockGetUserId.mockResolvedValue(null);
      const res = await request(app).post('/api/v1/registry/packages/p/reviews').send({ rating: 5 });
      expect(res.status).toBe(401);
    });

    it('returns 400 for invalid rating', async () => {
      const res = await request(app).post('/api/v1/registry/packages/p/reviews').send({ rating: 6 });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/registry/packages', () => {
    it('returns 400 without manifest', async () => {
      const res = await request(app).post('/api/v1/registry/packages').send({});
      expect(res.status).toBe(400);
    });

    it('publishes a package', async () => {
      db.pluginPackage.upsert.mockResolvedValue({ id: 'pkg-1', name: 'test' });
      db.pluginVersion.create.mockResolvedValue({ id: 'v-1', version: '1.0.0' });
      const res = await request(app).post('/api/v1/registry/packages').send({
        manifest: { name: 'test', version: '1.0.0' },
      });
      expect(res.status).toBe(201);
    });
  });

  describe('POST /api/v1/registry/publishers', () => {
    it('returns 400 without name', async () => {
      const res = await request(app).post('/api/v1/registry/publishers').send({});
      expect(res.status).toBe(400);
    });

    it('returns 409 when publisher exists', async () => {
      db.publisher.findUnique.mockResolvedValue({ id: '1', name: 'existing' });
      const res = await request(app).post('/api/v1/registry/publishers').send({ name: 'existing' });
      expect(res.status).toBe(409);
    });

    it('creates publisher with initial token', async () => {
      db.publisher.findUnique.mockResolvedValue(null);
      db.publisher.create.mockResolvedValue({ id: '1', name: 'new-pub' });
      db.apiToken.create.mockResolvedValue({});
      const res = await request(app).post('/api/v1/registry/publishers').send({ name: 'new-pub' });
      expect(res.status).toBe(201);
      expect(res.body.token).toBeTruthy();
    });
  });

  describe('GET /api/v1/registry/publishers/:name', () => {
    it('returns 404 when not found', async () => {
      db.publisher.findUnique.mockResolvedValue(null);
      const res = await request(app).get('/api/v1/registry/publishers/nope');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/registry/publish', () => {
    it('returns 400 without manifest', async () => {
      const res = await request(app).post('/api/v1/registry/publish').send({});
      expect(res.status).toBe(400);
    });

    it('returns 401 without auth', async () => {
      mockGetUserId.mockResolvedValue(null);
      const res = await request(app).post('/api/v1/registry/publish').send({
        manifest: { name: 'test', version: '1.0.0' }, skipVerification: true,
      });
      expect(res.status).toBe(401);
    });
  });
});
