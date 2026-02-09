/**
 * Base Routes – Contract Tests
 *
 * Covers CSP reporting, legacy auth (wallet-based), feature flags,
 * job feeds, historical stats, plugin management, user preferences,
 * debug console access control, and personalized plugins.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createTestApp, createMockDb } from '../helpers';
import { createBaseRoutes } from '../../routes/base';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

let db: ReturnType<typeof createMockDb>;
let app: ReturnType<typeof createTestApp>;

const mockRequireToken = (req: any, _res: any, next: any) => {
  req.user = { id: 'user-1', role: 'ADMIN' };
  next();
};

const mockGetCacheStats = () => ({ backend: 'memory', redisConnected: false, memorySize: 0 });

beforeEach(() => {
  db = createMockDb();
  app = createTestApp();

  const baseRoutes = createBaseRoutes({ db, requireToken: mockRequireToken, getCacheStats: mockGetCacheStats });
  app.use('/api/v1', baseRoutes);
});

// ---------------------------------------------------------------------------
// CSP Report
// ---------------------------------------------------------------------------

describe('CSP Report', () => {
  it('POST /api/v1/csp-report returns 204', async () => {
    const res = await request(app)
      .post('/api/v1/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send(JSON.stringify({ 'csp-report': { 'document-uri': 'https://example.com', 'violated-directive': 'script-src' } }));
    expect(res.status).toBe(204);
  });

  it('GET /api/v1/csp-report requires ADMIN role', async () => {
    // Override to non-admin
    const nonAdminToken = (req: any, _res: any, next: any) => { req.user = { id: 'u', role: 'USER' }; next(); };
    const app2 = createTestApp();
    app2.use('/api/v1', createBaseRoutes({ db, requireToken: nonAdminToken, getCacheStats: mockGetCacheStats }));

    const res = await request(app2).get('/api/v1/csp-report');
    expect(res.status).toBe(403);
  });

  it('GET /api/v1/csp-report returns violations for admin', async () => {
    const res = await request(app).get('/api/v1/csp-report');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body.data).toHaveProperty('total');
  });
});

// ---------------------------------------------------------------------------
// Legacy Auth
// ---------------------------------------------------------------------------

describe('Legacy Auth', () => {
  it('GET /api/v1/base/auth/session returns 401 without token', async () => {
    const res = await request(app).get('/api/v1/base/auth/session');
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/base/auth/session returns session for valid token', async () => {
    const mockSession = {
      id: 's-1',
      token: 'tok-123',
      expiresAt: new Date(Date.now() + 86400000),
      user: { address: '0xABC', displayName: 'Test', config: {} },
    };
    db.session.findUnique.mockResolvedValue(mockSession);
    db.session.update.mockResolvedValue(mockSession);

    const res = await request(app)
      .get('/api/v1/base/auth/session')
      .set('Authorization', 'Bearer tok-123');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.address).toBe('0xABC');
  });

  it('POST /api/v1/base/auth/connect requires address', async () => {
    const res = await request(app).post('/api/v1/base/auth/connect').send({});
    expect(res.status).toBe(400);
  });

  it('POST /api/v1/base/auth/connect creates session', async () => {
    const mockUser = { id: 'u-1', address: '0xABC12345', displayName: 'User 0xABC123', config: {} };
    db.user.upsert.mockResolvedValue(mockUser);
    db.session.create.mockResolvedValue({ token: 'jwt-0xABC12345-123' });

    const res = await request(app).post('/api/v1/base/auth/connect').send({ address: '0xABC12345' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('token');
  });

  it('POST /api/v1/base/auth/disconnect succeeds', async () => {
    const res = await request(app)
      .post('/api/v1/base/auth/disconnect')
      .set('Authorization', 'Bearer tok-123');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Feature Flags
// ---------------------------------------------------------------------------

describe('Feature Flags', () => {
  it('GET /api/v1/base/config/features returns flags', async () => {
    db.featureFlag.findMany.mockResolvedValue([{ key: 'enableAuth', enabled: true }]);
    const res = await request(app).get('/api/v1/base/config/features');
    expect(res.status).toBe(200);
    expect(res.body.features.enableAuth).toBe(true);
  });

  it('GET /api/v1/base/config/features returns defaults on error', async () => {
    db.featureFlag.findMany.mockRejectedValue(new Error('DB down'));
    const res = await request(app).get('/api/v1/base/config/features');
    expect(res.status).toBe(200);
    expect(res.body.features).toHaveProperty('enableMockData');
  });
});

// ---------------------------------------------------------------------------
// Job Feeds
// ---------------------------------------------------------------------------

describe('Job Feeds', () => {
  it('GET /api/v1/base/job-feeds returns feeds', async () => {
    db.jobFeed.findMany.mockResolvedValue([{ id: 'j1' }]);
    db.jobFeed.count.mockResolvedValue(1);
    const res = await request(app).get('/api/v1/base/job-feeds');
    expect(res.status).toBe(200);
    expect(res.body.feeds).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it('GET /api/v1/base/job-feeds/stats returns stats', async () => {
    db.jobFeed.count.mockResolvedValue(5);
    db.jobFeed.groupBy.mockResolvedValue([]);
    const res = await request(app).get('/api/v1/base/job-feeds/stats');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Historical Stats
// ---------------------------------------------------------------------------

describe('Historical Stats', () => {
  it('GET /api/v1/base/stats/historical returns stats', async () => {
    db.historicalStat.findMany.mockResolvedValue([{ id: 'hs1' }]);
    const res = await request(app).get('/api/v1/base/stats/historical');
    expect(res.status).toBe(200);
    expect(res.body.stats).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Plugin Management
// ---------------------------------------------------------------------------

describe('Plugin Management', () => {
  it('GET /api/v1/base/plugins returns enabled plugins', async () => {
    db.workflowPlugin.findMany.mockResolvedValue([{ name: 'p1', enabled: true }]);
    const res = await request(app).get('/api/v1/base/plugins');
    expect(res.status).toBe(200);
    expect(res.body.plugins).toHaveLength(1);
  });

  it('POST /api/v1/base/plugins upserts plugin', async () => {
    db.workflowPlugin.upsert.mockResolvedValue({ name: 'p1' });
    const res = await request(app).post('/api/v1/base/plugins').send({ name: 'p1', displayName: 'Plugin 1' });
    expect(res.status).toBe(200);
    expect(res.body.plugin.name).toBe('p1');
  });

  it('DELETE /api/v1/base/plugins/:name deletes plugin', async () => {
    db.workflowPlugin.delete.mockResolvedValue({});
    const res = await request(app).delete('/api/v1/base/plugins/p1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// User Preferences
// ---------------------------------------------------------------------------

describe('User Preferences', () => {
  it('GET /api/v1/base/user/preferences requires userId', async () => {
    const res = await request(app).get('/api/v1/base/user/preferences');
    expect(res.status).toBe(400);
  });

  it('GET /api/v1/base/user/preferences returns empty for unknown user', async () => {
    const res = await request(app).get('/api/v1/base/user/preferences?userId=unknown');
    expect(res.status).toBe(200);
    expect(res.body.preferences).toEqual([]);
  });

  it('POST /api/v1/base/user/preferences saves preference', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'u-1' });
    db.userPluginPreference.upsert.mockResolvedValue({ pluginName: 'p1', enabled: true });
    const res = await request(app).post('/api/v1/base/user/preferences').send({ userId: 'u-1', pluginName: 'p1', enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.preference.pluginName).toBe('p1');
  });
});

// ---------------------------------------------------------------------------
// Debug Console Access Control
// ---------------------------------------------------------------------------

describe('Debug Console', () => {
  it('GET /api/v1/base/user/debug-settings returns settings', async () => {
    db.userConfig.findUnique.mockResolvedValue({ debugEnabled: true, debugDisabledBy: null, debugDisabledAt: null });
    const res = await request(app).get('/api/v1/base/user/debug-settings');
    expect(res.status).toBe(200);
    expect(res.body.debugEnabled).toBe(true);
  });

  it('PUT /api/v1/admin/users/:id/debug toggles debug', async () => {
    db.userRole.findMany.mockResolvedValue([{ role: { name: 'admin' } }]);
    db.userConfig.upsert.mockResolvedValue({ debugEnabled: false, debugDisabledBy: 'user-1', debugDisabledAt: new Date() });

    const res = await request(app).put('/api/v1/admin/users/u-2/debug').send({ debugEnabled: false });
    expect(res.status).toBe(200);
    expect(res.body.debugEnabled).toBe(false);
  });

  it('GET /api/v1/admin/users/debug-access returns user list', async () => {
    db.userRole.findMany.mockResolvedValue([{ role: { name: 'admin' } }]);
    db.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'a@b.c', displayName: 'A', config: { debugEnabled: true } }]);

    const res = await request(app).get('/api/v1/admin/users/debug-access');
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Personalized Plugins
// ---------------------------------------------------------------------------

describe('Personalized Plugins', () => {
  it('GET /api/v1/base/plugins/personalized returns global when no userId', async () => {
    db.workflowPlugin.findMany.mockResolvedValue([{ name: 'p1', enabled: true, order: 0 }]);
    const res = await request(app).get('/api/v1/base/plugins/personalized');
    expect(res.status).toBe(200);
    expect(res.body.plugins).toHaveLength(1);
  });

  it('GET /api/v1/base/plugins/personalized merges with preferences', async () => {
    db.workflowPlugin.findMany.mockResolvedValue([
      { name: 'p1', enabled: true, order: 1 },
      { name: 'p2', enabled: true, order: 2 },
    ]);
    db.user.findUnique.mockResolvedValue({ id: 'u-1' });
    db.userPluginPreference.findMany.mockResolvedValue([{ pluginName: 'p2', enabled: true, pinned: true, order: 0 }]);

    const res = await request(app).get('/api/v1/base/plugins/personalized?userId=u-1');
    expect(res.status).toBe(200);
    expect(res.body.plugins[0].name).toBe('p2'); // pinned first
  });
});
