import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { readFileSync } from 'node:fs';
import { config } from 'dotenv';
import { createAuthMiddleware } from '@naap/plugin-server-sdk';

config();

function sanitizeForLog(value: unknown): string {
  return String(value).replace(/[\n\r\t\x00-\x1f\x7f-\x9f\u2028\u2029]/g, '');
}

const pluginConfig = JSON.parse(
  readFileSync(new URL('../../plugin.json', import.meta.url), 'utf8')
);
const app = express();
const PORT = process.env.PORT || pluginConfig.backend?.devPort || 4007;

app.use((req, res, next) => {
  const incoming = req.header('x-request-id');
  const requestId =
    typeof incoming === 'string' && incoming.trim().length > 0
      ? incoming.trim()
      : crypto.randomUUID();

  (req as any).requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
});
app.use(cors());
app.use(express.json());
app.use(createAuthMiddleware({
  publicPaths: ['/healthz'],
}));

// ============================================
// Database Connection
// ============================================

// Dynamic import for Prisma client (generated)
let prisma: any = null;
let resolveDevApiProjectId: any = null;
let DevApiProjectResolutionError: any = null;

async function initDatabase() {
  try {
    const db = await import('@naap/database');
    prisma = db.prisma;
    resolveDevApiProjectId = db.resolveDevApiProjectId;
    DevApiProjectResolutionError = db.DevApiProjectResolutionError;
    if (db.deriveKeyLookupId) deriveKeyLookupId = db.deriveKeyLookupId;
    if (db.getKeyPrefix) getKeyPrefix = db.getKeyPrefix;
    if (db.hashApiKey) hashApiKey = db.hashApiKey;
    await prisma.$connect();
    console.log('✅ Database connected');
    return true;
  } catch (error) {
    console.log('⚠️ Database not available, using in-memory fallback');
    return false;
  }
}

// In-memory fallback data
const inMemoryModels = [
  { id: 'model-sd15', name: 'Stable Diffusion 1.5', tagline: 'Fast, lightweight image generation', type: 'text-to-video', featured: false, realtime: true, costPerMinMin: 0.02, costPerMinMax: 0.05, latencyP50: 120, coldStart: 2000, fps: 24, useCases: ['Live streaming', 'Prototyping'], badges: ['Realtime'] },
  { id: 'model-sdxl', name: 'SDXL Turbo', tagline: 'High-quality video generation', type: 'text-to-video', featured: true, realtime: true, costPerMinMin: 0.08, costPerMinMax: 0.15, latencyP50: 180, coldStart: 3500, fps: 30, useCases: ['Content creation', 'Marketing'], badges: ['Featured', 'Best Quality'] },
  { id: 'model-krea', name: 'Krea AI', tagline: 'Creative AI for unique visuals', type: 'text-to-video', featured: true, realtime: true, costPerMinMin: 0.15, costPerMinMax: 0.30, latencyP50: 150, coldStart: 2500, fps: 30, useCases: ['Creative projects', 'Artistic content'], badges: ['Featured', 'Realtime'] },
];

const inMemoryApiKeys: any[] = [];
const inMemoryProjects: any[] = [];
const inMemoryBillingProviders = [
  { id: 'bp-daydream', slug: 'daydream', displayName: 'Daydream', description: 'AI-powered billing via Daydream', icon: 'cloud', authType: 'oauth' },
  { id: 'bp-pymthouse', slug: 'pymthouse', displayName: 'pymthouse', description: 'Livepeer payment clearinghouse', icon: 'wallet', authType: 'oauth' },
];

// ============================================
// Utility Functions
// ============================================

let deriveKeyLookupId: (rawKey: string) => string = (_key: string) => crypto.randomBytes(8).toString('hex');
let getKeyPrefix: (lookupId: string) => string = (id: string) => `naap_${id}...`;
let hashApiKey: (key: string) => string = (key: string) => crypto.scryptSync(key, 'naap-api-key-v1', 32).toString('hex');

function getRequestUserId(req: express.Request): string {
  const user = (req as any).user;
  if (!user?.id) {
    throw new Error('Unauthenticated request reached user-scoped route');
  }
  return user.id;
}

// ============================================
// Health Check
// ============================================

app.get('/healthz', async (_req, res) => {
  const dbStatus = prisma ? 'connected' : 'fallback';
  res.json({ status: 'healthy', service: 'developer-svc', version: '2.0.0', database: dbStatus });
});

// ============================================
// Models API
// ============================================

app.get('/api/v1/developer/models', async (req, res) => {
  try {
    const { type, featured, realtime } = req.query;

    if (prisma) {
      const where: any = {};
      if (type) where.type = type;
      if (featured === 'true') where.featured = true;
      if (realtime === 'true') where.realtime = true;

      const models = await prisma.devApiAIModel.findMany({ where, orderBy: { name: 'asc' } });
      const formatted = models.map((m: any) => ({
        ...m,
        costPerMin: { min: m.costPerMinMin, max: m.costPerMinMax },
      }));
      return res.json({ models: formatted, total: formatted.length });
    }

    // Fallback to in-memory
    let filtered = [...inMemoryModels];
    if (type) filtered = filtered.filter(m => m.type === type);
    if (featured === 'true') filtered = filtered.filter(m => m.featured);
    if (realtime === 'true') filtered = filtered.filter(m => m.realtime);

    const formatted = filtered.map(m => ({
      ...m,
      costPerMin: { min: m.costPerMinMin, max: m.costPerMinMax },
    }));
    res.json({ models: formatted, total: formatted.length });
  } catch (error) {
    console.error('Error fetching models:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/v1/developer/models/:id', async (req, res) => {
  try {
    if (prisma) {
      const model = await prisma.devApiAIModel.findUnique({ where: { id: req.params.id } });
      if (!model) return res.status(404).json({ error: 'Model not found' });
      return res.json({
        ...model,
        costPerMin: { min: model.costPerMinMin, max: model.costPerMinMax },
      });
    }

    const model = inMemoryModels.find(m => m.id === req.params.id);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    res.json({
      ...model,
      costPerMin: { min: model.costPerMinMin, max: model.costPerMinMax },
    });
  } catch (error) {
    console.error('Error fetching model:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// Projects
// ============================================

app.get('/api/v1/developer/projects', async (req, res) => {
  try {
    const userId = getRequestUserId(req);

    if (prisma) {
      const projects = await prisma.devApiProject.findMany({
        where: { userId },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          isDefault: true,
          createdAt: true,
          _count: { select: { apiKeys: true } },
        },
      });
      return res.json({ projects });
    }

    const projects = inMemoryProjects
      .filter((p: any) => p.userId === userId)
      .map((p: any) => ({
        ...p,
        _count: {
          apiKeys: inMemoryApiKeys.filter(
            (k: any) => k.userId === userId && k.project?.id === p.id
          ).length,
        },
      }));
    res.json({ projects });
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/v1/developer/projects', async (req, res) => {
  try {
    const userId = getRequestUserId(req);
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    const trimmedName = name.trim();

    if (prisma) {
      const existing = await prisma.devApiProject.findUnique({
        where: { userId_name: { userId, name: trimmedName } },
      });
      if (existing) {
        return res.status(400).json({ error: 'A project with this name already exists' });
      }

      const project = await prisma.devApiProject.create({
        data: {
          userId,
          name: trimmedName,
          isDefault: false,
        },
        select: {
          id: true,
          name: true,
          isDefault: true,
          createdAt: true,
        },
      });
      return res.status(201).json({ project });
    }

    if (inMemoryProjects.find((p: any) => p.userId === userId && p.name === trimmedName)) {
      return res.status(400).json({ error: 'A project with this name already exists' });
    }
    const project = {
      id: `proj-${Date.now()}`,
      userId,
      name: trimmedName,
      isDefault: false,
      createdAt: new Date().toISOString(),
    };
    inMemoryProjects.push(project);
    res.status(201).json({ project });
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// Billing Providers
// ============================================

app.get('/api/v1/developer/billing-providers', async (_req, res) => {
  try {
    if (prisma) {
      const providers = await prisma.billingProvider.findMany({
        where: { enabled: true },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          slug: true,
          displayName: true,
          description: true,
          icon: true,
          authType: true,
        },
      });
      return res.json({ providers });
    }

    res.json({ providers: inMemoryBillingProviders });
  } catch (error) {
    console.error('Error fetching billing providers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// API Keys
// ============================================

app.get('/api/v1/developer/keys', async (req, res) => {
  try {
    const userId = getRequestUserId(req);

    if (prisma) {
      const keys = await prisma.devApiKey.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: {
          project: { select: { id: true, name: true, isDefault: true } },
          billingProvider: {
            select: { id: true, slug: true, displayName: true },
          },
          model: { select: { id: true, name: true } },
        },
      });
      const formatted = keys.map((k: any) => ({
        id: k.id,
        project: k.project,
        billingProvider: k.billingProvider,
        label: k.label ?? null,
        providerDisplayName: k.billingProvider?.displayName || 'Unknown',
        keyPrefix: k.keyPrefix,
        status: k.status,
        createdAt: k.createdAt.toISOString(),
        lastUsedAt: k.lastUsedAt?.toISOString() || null,
      }));
      return res.json({ keys: formatted, total: formatted.length });
    }

    const keys = inMemoryApiKeys.filter((k: any) => k.userId === userId);
    res.json({ keys, total: keys.length });
  } catch (error) {
    console.error('Error fetching keys:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/v1/developer/keys/:id', async (req, res) => {
  try {
    const userId = getRequestUserId(req);

    if (prisma) {
      const key = await prisma.devApiKey.findFirst({
        where: {
          id: req.params.id,
          userId,
        },
        include: {
          project: { select: { id: true, name: true, isDefault: true } },
          billingProvider: {
            select: { id: true, slug: true, displayName: true },
          },
          model: { select: { id: true, name: true } },
        },
      });
      if (!key) return res.status(404).json({ error: 'API key not found' });
      return res.json({
        id: key.id,
        project: key.project,
        billingProvider: key.billingProvider,
        label: key.label ?? null,
        providerDisplayName: key.billingProvider?.displayName || 'Unknown',
        keyPrefix: key.keyPrefix,
        status: key.status,
        createdAt: key.createdAt.toISOString(),
        lastUsedAt: key.lastUsedAt?.toISOString() || null,
      });
    }

    const key = inMemoryApiKeys.find((k: any) => k.id === req.params.id && k.userId === userId);
    if (!key) return res.status(404).json({ error: 'API key not found' });
    res.json(key);
  } catch (error) {
    console.error('Error fetching key:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/v1/developer/keys', async (req, res) => {
  try {
    const { billingProviderId, rawApiKey, projectId, projectName, modelId, label } = req.body;
    const userId = getRequestUserId(req);

    if (!billingProviderId) {
      return res.status(400).json({ error: 'billingProviderId is required' });
    }
    if (!rawApiKey || typeof rawApiKey !== 'string') {
      return res.status(400).json({ error: 'rawApiKey is required' });
    }

    const keyLookupId = deriveKeyLookupId(rawApiKey);
    const keyPrefix = getKeyPrefix(keyLookupId);

    if (prisma) {
      const provider = await prisma.billingProvider.findUnique({
        where: { id: billingProviderId },
        select: { id: true, enabled: true },
      });
      if (!provider || !provider.enabled) {
        return res.status(400).json({ error: 'Invalid or disabled billing provider' });
      }

      let resolvedModelId: string | undefined;
      if (modelId && typeof modelId === 'string' && modelId.trim() !== '') {
        const model = await prisma.devApiAIModel.findUnique({ where: { id: modelId } });
        if (!model) return res.status(400).json({ error: 'Invalid modelId' });
        resolvedModelId = model.id;
      }

      let resolvedProjectId: string;
      try {
        resolvedProjectId = await resolveDevApiProjectId({
          prisma,
          userId,
          projectId,
          projectName,
        });
      } catch (err: unknown) {
        if (DevApiProjectResolutionError && err instanceof DevApiProjectResolutionError) {
          return res.status(400).json({ error: (err as Error).message });
        }
        throw err;
      }

      const resolvedLabel = label && typeof label === 'string' && label.trim() ? label.trim() : null;
      const keyHash = hashApiKey(rawApiKey);

      const newKey = await prisma.devApiKey.create({
        data: {
          userId,
          projectId: resolvedProjectId,
          billingProviderId,
          modelId: resolvedModelId || null,
          keyLookupId,
          keyPrefix,
          keyHash,
          label: resolvedLabel,
          status: 'ACTIVE',
        },
        include: {
          project: { select: { id: true, name: true, isDefault: true } },
          billingProvider: {
            select: { id: true, slug: true, displayName: true },
          },
        },
      });

      return res.status(201).json({
        key: {
          id: newKey.id,
          project: newKey.project,
          billingProvider: newKey.billingProvider,
          keyPrefix: newKey.keyPrefix,
          label: newKey.label,
          status: newKey.status,
          createdAt: newKey.createdAt.toISOString(),
        },
        rawApiKey,
        warning: 'Store this key securely. It will not be shown again.',
      });
    }

    const fallbackProject = inMemoryProjects.find((p: any) => p.id === projectId) || { id: 'proj-default', name: 'Default', isDefault: true };
    const fallbackProvider = inMemoryBillingProviders.find(p => p.id === billingProviderId) || inMemoryBillingProviders[0];
    const fallbackLabel = label && typeof label === 'string' && label.trim() ? label.trim() : null;

    const newKey = {
      id: `key-${Date.now()}`,
      userId,
      project: { id: fallbackProject.id, name: fallbackProject.name, isDefault: fallbackProject.isDefault },
      billingProvider: { id: fallbackProvider.id, slug: fallbackProvider.slug, displayName: fallbackProvider.displayName },
      keyPrefix,
      keyLookupId,
      label: fallbackLabel,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    inMemoryApiKeys.push(newKey);

    res.status(201).json({
      key: newKey,
      rawApiKey,
      warning: 'Store this key securely. It will not be shown again.',
    });
  } catch (error) {
    console.error('Error creating key:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/v1/developer/keys/:id', async (req, res) => {
  try {
    const userId = getRequestUserId(req);

    if (prisma) {
      const key = await prisma.devApiKey.findUnique({ where: { id: req.params.id } });
      if (!key || key.userId !== userId) {
        return res.status(404).json({ error: 'API key not found' });
      }
      await prisma.devApiKey.update({
        where: { id: req.params.id },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });

      return res.json({ message: 'API key revoked' });
    }

    const keyIndex = inMemoryApiKeys.findIndex((k: any) => k.id === req.params.id && k.userId === userId);
    if (keyIndex === -1) return res.status(404).json({ error: 'API key not found' });
    inMemoryApiKeys[keyIndex].status = 'REVOKED';
    res.json({ message: 'API key revoked', key: inMemoryApiKeys[keyIndex] });
  } catch (error) {
    console.error('Error revoking key:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// Usage Stats
// ============================================

app.get('/api/v1/developer/usage', async (req, res) => {
  try {
    const userId = getRequestUserId(req);

    if (prisma) {
      const keys = await prisma.devApiKey.findMany({
        where: { userId },
        include: { usageLogs: true },
      });

      const totalRequests = keys.reduce((sum: number, k: any) =>
        sum + k.usageLogs.reduce((s: number, l: any) => s + l.requestCount, 0), 0);
      const totalCost = keys.reduce((sum: number, k: any) =>
        sum + k.usageLogs.reduce((s: number, l: any) => s + l.costIncurred, 0), 0);

      return res.json({
        totalKeys: keys.length,
        activeKeys: keys.filter((k: any) => k.status === 'ACTIVE').length,
        totalRequests,
        totalCost: totalCost.toFixed(4),
      });
    }

    // Fallback
    res.json({
      totalKeys: inMemoryApiKeys.length,
      activeKeys: inMemoryApiKeys.filter(k => k.status?.toUpperCase?.() === 'ACTIVE').length,
      totalRequests: 0,
      totalCost: '0.0000',
    });
  } catch (error) {
    console.error('Error fetching usage:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// Error Handling
// ============================================

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const req = _req as any;
  const requestId = req.requestId || req.headers?.['x-request-id'] || 'unknown';
  const method = req.method || 'UNKNOWN';
  const path = req.originalUrl || req.url || 'unknown';

  console.error(
    '[developer-api][%s] Unhandled error on %s %s:',
    sanitizeForLog(requestId),
    sanitizeForLog(method),
    sanitizeForLog(path),
    err
  );
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
      requestId: sanitizeForLog(requestId),
      method: sanitizeForLog(method),
      path: sanitizeForLog(path),
    },
  });
});

// ============================================
// Start Server
// ============================================

async function start() {
  await initDatabase();
  app.listen(PORT, () => console.log(`🚀 developer-svc running on http://localhost:${PORT}`));
}

start();