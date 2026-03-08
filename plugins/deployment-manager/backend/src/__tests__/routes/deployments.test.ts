import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createDeploymentsRouter } from '../../routes/deployments.js';

function createMockOrchestrator() {
  return {
    list: vi.fn(),
    get: vi.fn(),
    getStatusHistory: vi.fn(),
    create: vi.fn(),
    deploy: vi.fn(),
    validate: vi.fn(),
    retry: vi.fn(),
    updateDeployment: vi.fn(),
    destroy: vi.fn(),
  };
}

function createApp() {
  const mockOrchestrator = createMockOrchestrator();
  const app = express();
  app.use(express.json());
  app.use('/', createDeploymentsRouter(mockOrchestrator as any));
  return { app, mockOrchestrator };
}

const VALID_BODY = {
  name: 'test-deploy',
  providerSlug: 'mock',
  gpuModel: 'A100',
  gpuVramGb: 80,
  gpuCount: 1,
  artifactType: 'ai-runner',
  artifactVersion: 'v1',
  dockerImage: 'test:v1',
};

describe('Deployments Router', () => {
  let app: express.Express;
  let mockOrchestrator: ReturnType<typeof createMockOrchestrator>;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ app, mockOrchestrator } = createApp());
  });

  describe('GET /', () => {
    it('returns list of deployments', async () => {
      const deployments = [
        { id: 'd1', name: 'dep-1', status: 'running' },
        { id: 'd2', name: 'dep-2', status: 'stopped' },
      ];
      mockOrchestrator.list.mockResolvedValue(deployments);

      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(deployments);
      expect(res.body.total).toBe(2);
    });
  });

  describe('GET /:id', () => {
    it('returns 404 when deployment not found', async () => {
      mockOrchestrator.get.mockResolvedValue(undefined);

      const res = await request(app).get('/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Deployment not found');
    });

    it('returns deployment when found', async () => {
      const deployment = { id: 'd1', name: 'dep-1', status: 'running' };
      mockOrchestrator.get.mockResolvedValue(deployment);

      const res = await request(app).get('/d1');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(deployment);
    });
  });

  describe('GET /:id/history', () => {
    it('returns status history', async () => {
      const history = [
        { status: 'created', timestamp: '2025-01-01T00:00:00Z' },
        { status: 'running', timestamp: '2025-01-01T00:01:00Z' },
      ];
      mockOrchestrator.getStatusHistory.mockResolvedValue(history);

      const res = await request(app).get('/d1/history');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(history);
      expect(mockOrchestrator.getStatusHistory).toHaveBeenCalledWith('d1');
    });
  });

  describe('POST /', () => {
    it('creates deployment with valid body (201)', async () => {
      const created = { id: 'new-1', ...VALID_BODY, status: 'created' };
      mockOrchestrator.create.mockResolvedValue(created);

      const res = await request(app).post('/').send(VALID_BODY);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(created);
    });

    it('returns 400 with invalid body (missing name)', async () => {
      const { name: _, ...bodyWithoutName } = VALID_BODY;

      const res = await request(app).post('/').send(bodyWithoutName);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Validation failed');
    });

    it('returns 400 when name has invalid characters', async () => {
      const res = await request(app)
        .post('/')
        .send({ ...VALID_BODY, name: '-invalid' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when gpuVramGb is less than 1', async () => {
      const res = await request(app)
        .post('/')
        .send({ ...VALID_BODY, gpuVramGb: 0 });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 429 when write rate limit is exceeded', async () => {
      const rlApp = express();
      rlApp.use(express.json());
      rlApp.use((req, _res, next) => {
        (req as any).user = { id: 'rate-limit-test-user' };
        next();
      });
      rlApp.use('/', createDeploymentsRouter(mockOrchestrator as any));
      mockOrchestrator.create.mockResolvedValue({ id: 'x', status: 'created' });

      const promises = [];
      for (let i = 0; i < 31; i++) {
        promises.push(
          request(rlApp)
            .post('/')
            .send({ ...VALID_BODY, name: `deploy${i}` }),
        );
      }
      const results = await Promise.all(promises);
      const rateLimited = results.filter((r) => r.status === 429);
      expect(rateLimited.length).toBeGreaterThan(0);
      expect(rateLimited[0].body.success).toBe(false);
      expect(rateLimited[0].body.retryAfterMs).toBeDefined();
    });
  });

  describe('POST /:id/deploy', () => {
    it('triggers deploy', async () => {
      const deployment = { id: 'd1', status: 'deploying' };
      mockOrchestrator.deploy.mockResolvedValue(deployment);

      const res = await request(app).post('/d1/deploy');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(deployment);
      expect(mockOrchestrator.deploy).toHaveBeenCalledWith('d1', 'anonymous');
    });
  });

  describe('POST /:id/retry', () => {
    it('triggers retry', async () => {
      const deployment = { id: 'd1', status: 'retrying' };
      mockOrchestrator.retry.mockResolvedValue(deployment);

      const res = await request(app).post('/d1/retry');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(deployment);
      expect(mockOrchestrator.retry).toHaveBeenCalledWith('d1', 'anonymous');
    });
  });

  describe('DELETE /:id', () => {
    it('destroys deployment', async () => {
      const deployment = { id: 'd1', status: 'destroyed' };
      mockOrchestrator.destroy.mockResolvedValue({ record: deployment, destroyResult: undefined });

      const res = await request(app).delete('/d1');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(deployment);
      expect(mockOrchestrator.destroy).toHaveBeenCalledWith('d1', 'anonymous');
    });
  });

  describe('PUT /:id', () => {
    it('updates deployment with valid body', async () => {
      const updated = { id: 'd1', artifactVersion: 'v2' };
      mockOrchestrator.updateDeployment.mockResolvedValue(updated);

      const res = await request(app)
        .put('/d1')
        .send({ artifactVersion: 'v2' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(updated);
    });
  });
});
