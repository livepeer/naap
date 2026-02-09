/**
 * Tokens & Webhooks Routes - Contract Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createTokensWebhooksRoutes } from '../../routes/tokens-webhooks';
import { createTestApp, createMockDb, createMockLifecycleService } from '../helpers';

describe('Tokens & Webhooks Routes', () => {
  let app: ReturnType<typeof createTestApp>;
  let db: ReturnType<typeof createMockDb>;
  let lifecycleService: ReturnType<typeof createMockLifecycleService>;
  const mockGetUserId = vi.fn().mockResolvedValue('user-1');
  const mockGenerateApiToken = vi.fn().mockReturnValue({ token: 'tok_123', hash: 'h', prefix: 'np_' });
  const mockHashToken = vi.fn().mockReturnValue('hashed');
  const mockRequireToken = (_scope?: string) => (req: any, _res: any, next: any) => {
    req.publisher = { id: 'pub-1' };
    req.token = { id: 'tok-current' };
    next();
  };
  const mockVerifyGitHubWebhook = () => (req: any, _res: any, next: any) => {
    req.githubEvent = 'push';
    req.package = { id: 'pkg-1', name: 'test' };
    req.githubDelivery = 'd-1';
    next();
  };

  beforeEach(() => {
    db = createMockDb();
    lifecycleService = createMockLifecycleService();
    mockGetUserId.mockResolvedValue('user-1');

    app = createTestApp();
    const router = createTokensWebhooksRoutes({
      db, lifecycleService, getUserIdFromRequest: mockGetUserId,
      generateApiToken: mockGenerateApiToken, hashToken: mockHashToken,
      requireToken: mockRequireToken, verifyGitHubWebhook: mockVerifyGitHubWebhook,
    });
    app.use('/api/v1', router);
  });

  // --------------------------------------------------------------------------
  // API Token Management
  // --------------------------------------------------------------------------

  describe('POST /api/v1/registry/tokens', () => {
    it('returns 400 without name', async () => {
      const res = await request(app).post('/api/v1/registry/tokens').send({});
      expect(res.status).toBe(400);
    });

    it('creates token', async () => {
      db.apiToken.create.mockResolvedValue({
        id: 't-1', name: 'My Token', tokenPrefix: 'np_',
        scopes: ['read'], expiresAt: null,
      });
      const res = await request(app).post('/api/v1/registry/tokens').send({ name: 'My Token' });
      expect(res.status).toBe(201);
      expect(res.body.token).toBe('tok_123');
    });
  });

  describe('GET /api/v1/registry/tokens', () => {
    it('lists tokens', async () => {
      db.apiToken.findMany.mockResolvedValue([]);
      const res = await request(app).get('/api/v1/registry/tokens');
      expect(res.status).toBe(200);
      expect(res.body.tokens).toEqual([]);
    });
  });

  describe('DELETE /api/v1/registry/tokens/:id', () => {
    it('returns 404 when not found', async () => {
      db.apiToken.findUnique.mockResolvedValue(null);
      const res = await request(app).delete('/api/v1/registry/tokens/t-1');
      expect(res.status).toBe(404);
    });

    it('returns 400 when revoking current token', async () => {
      db.apiToken.findUnique.mockResolvedValue({ id: 'tok-current', publisherId: 'pub-1' });
      const res = await request(app).delete('/api/v1/registry/tokens/tok-current');
      expect(res.status).toBe(400);
    });
  });

  // --------------------------------------------------------------------------
  // JWT-based Token Management
  // --------------------------------------------------------------------------

  describe('POST /api/v1/registry/user/tokens', () => {
    it('returns 401 without auth', async () => {
      mockGetUserId.mockResolvedValue(null);
      const res = await request(app).post('/api/v1/registry/user/tokens').send({ name: 'test' });
      expect(res.status).toBe(401);
    });

    it('creates token for user', async () => {
      db.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
      db.publisher.findFirst.mockResolvedValue({ id: 'pub-1' });
      db.apiToken.create.mockResolvedValue({
        id: 't-1', name: 'test', tokenPrefix: 'np_',
        scopes: ['read'], expiresAt: null, createdAt: new Date(),
      });
      const res = await request(app).post('/api/v1/registry/user/tokens').send({ name: 'test' });
      expect(res.status).toBe(201);
    });
  });

  describe('GET /api/v1/registry/user/tokens', () => {
    it('returns 401 without auth', async () => {
      mockGetUserId.mockResolvedValue(null);
      const res = await request(app).get('/api/v1/registry/user/tokens');
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/v1/registry/user/tokens/:id', () => {
    it('returns 401 without auth', async () => {
      mockGetUserId.mockResolvedValue(null);
      const res = await request(app).delete('/api/v1/registry/user/tokens/t-1');
      expect(res.status).toBe(401);
    });
  });

  // --------------------------------------------------------------------------
  // Webhooks
  // --------------------------------------------------------------------------

  describe('POST /api/v1/registry/webhooks/github/configure', () => {
    it('returns 400 with short secret', async () => {
      const res = await request(app).post('/api/v1/registry/webhooks/github/configure').send({ secret: 'short' });
      expect(res.status).toBe(400);
    });

    it('configures webhook secret', async () => {
      db.webhookSecret = { upsert: vi.fn().mockResolvedValue({}) };
      const res = await request(app)
        .post('/api/v1/registry/webhooks/github/configure')
        .send({ secret: 'a-very-long-secret-key-12345' });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/v1/registry/webhooks/github', () => {
    it('processes webhook events', async () => {
      const res = await request(app).post('/api/v1/registry/webhooks/github').send({ ref: 'refs/heads/main' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
