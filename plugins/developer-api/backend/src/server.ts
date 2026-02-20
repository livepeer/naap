import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { readFileSync } from 'node:fs';
import { config } from 'dotenv';
import { createAuthMiddleware } from '@naap/plugin-server-sdk';

config();

const pluginConfig = JSON.parse(
  readFileSync(new URL('../../plugin.json', import.meta.url), 'utf8')
);
const app = express();
const PORT = process.env.PORT || pluginConfig.backend?.devPort || 4007;

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

async function initDatabase() {
  try {
    const { prisma: dbClient } = await import('@naap/database');
    prisma = dbClient;
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

const inMemoryGatewayOffers: Record<string, any[]> = {
  'model-sd15': [
    { id: 'go-1', gatewayId: 'gw-1', gatewayName: 'Gateway Alpha', price: 0.02, latency: 120, availability: 99.9 },
    { id: 'go-2', gatewayId: 'gw-2', gatewayName: 'Gateway Beta', price: 0.03, latency: 100, availability: 99.5 },
  ],
  'model-sdxl': [
    { id: 'go-3', gatewayId: 'gw-1', gatewayName: 'Gateway Alpha', price: 0.08, latency: 180, availability: 99.9 },
    { id: 'go-4', gatewayId: 'gw-3', gatewayName: 'Gateway Gamma', price: 0.10, latency: 160, availability: 99.8 },
  ],
  'model-krea': [
    { id: 'go-5', gatewayId: 'gw-1', gatewayName: 'Gateway Alpha', price: 0.15, latency: 150, availability: 99.9 },
  ],
};

const inMemoryApiKeys: any[] = [];
const inMemoryProjects: any[] = [];
const inMemoryBillingProviders = [
  { id: 'bp-daydream', slug: 'daydream', displayName: 'Daydream', description: 'AI-powered billing via Daydream', icon: 'cloud', authType: 'oauth' },
];
// ============================================
// Utility Functions
// ============================================

function parseApiKey(key: string): { lookupId: string; secret: string } | null {
  const m = key.match(/^naap_([0-9a-f]{16})_([0-9a-f]{48})$/);
  return m ? { lookupId: m[1], secret: m[2] } : null;
}

function generateApiKey(): string {
  const lookupId = crypto.randomBytes(8).toString('hex');  // 16 hex chars
  const secret   = crypto.randomBytes(24).toString('hex'); // 48 hex chars
  return `naap_${lookupId}_${secret}`;
}

function generateKeyLookupId(): string {
  return crypto.randomBytes(8).toString('hex');
}

function getKeyPrefix(key: string): string {
  const parsed = parseApiKey(key);
  if (parsed) return `naap_${parsed.lookupId}...`;
  return key.substring(0, 12) + '...';
}

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
        gatewayCount: 0, // Would need a count query
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
      gatewayCount: (inMemoryGatewayOffers[m.id] || []).length,
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

app.get('/api/v1/developer/models/:id/gateways', async (req, res) => {
  try {
    const modelId = req.params.id;

    if (prisma) {
      const model = await prisma.devApiAIModel.findUnique({ where: { id: modelId } });
      if (!model) return res.status(404).json({ error: 'Model not found' });

      const gateways = await prisma.devApiGatewayOffer.findMany({ where: { modelId } });
      return res.json({ modelId, gateways });
    }

    const model = inMemoryModels.find(m => m.id === modelId);
    if (!model) return res.status(404).json({ error: 'Model not found' });

    const offers = inMemoryGatewayOffers[modelId] || [];
    res.json({ modelId, gateways: offers });
  } catch (error) {
    console.error('Error fetching gateways:', error);
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

    res.json({ projects: inMemoryProjects.filter(p => p.userId === userId) });
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

    // In-memory fallback
    if (inMemoryProjects.find(p => p.userId === userId && p.name === trimmedName)) {
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
          gatewayOffer: { select: { id: true, gatewayId: true, gatewayName: true } },
        },
      });
      const formatted = keys.map((k: any) => ({
        id: k.id,
        project: k.project,
        billingProvider: k.billingProvider,
        modelName: k.model?.name || 'Unknown',
        gatewayName: k.gatewayOffer?.gatewayName || 'Unknown',
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
          gatewayOffer: { select: { id: true, gatewayId: true, gatewayName: true } },
        },
      });
      if (!key) return res.status(404).json({ error: 'API key not found' });
      return res.json({
        id: key.id,
        project: key.project,
        billingProvider: key.billingProvider,
        modelName: key.model?.name || 'Unknown',
        gatewayName: key.gatewayOffer?.gatewayName || 'Unknown',
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
    const { billingProviderId, rawApiKey, projectId, projectName, modelId, gatewayId } = req.body;
    const userId = getRequestUserId(req);

    if (!billingProviderId) {
      return res.status(400).json({ error: 'billingProviderId is required' });
    }
    if (!rawApiKey || typeof rawApiKey !== 'string') {
      return res.status(400).json({ error: 'rawApiKey is required' });
    }

    const keyLookupId = parseApiKey(rawApiKey)?.lookupId ?? generateKeyLookupId();
    const keyPrefix = getKeyPrefix(rawApiKey);

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

      let resolvedGatewayOfferId: string | undefined;
      if (resolvedModelId && gatewayId && typeof gatewayId === 'string' && gatewayId.trim() !== '') {
        const gatewayOffer = await prisma.devApiGatewayOffer.findFirst({
          where: { modelId: resolvedModelId, gatewayId },
        });
        if (!gatewayOffer) return res.status(400).json({ error: 'Gateway does not offer this model' });
        resolvedGatewayOfferId = gatewayOffer.id;
      }

      let resolvedProjectId: string;
      if (projectId) {
        const project = await prisma.devApiProject.findUnique({
          where: { id: projectId },
          select: { id: true, userId: true },
        });
        if (!project || project.userId !== userId) {
          return res.status(400).json({ error: 'Invalid projectId' });
        }
        resolvedProjectId = project.id;
      } else {
        let defaultProject = await prisma.devApiProject.findFirst({
          where: { userId, isDefault: true },
          select: { id: true },
        });
        if (!defaultProject) {
          const name = projectName?.trim() || 'Default';
          try {
            defaultProject = await prisma.devApiProject.create({
              data: { userId, name, isDefault: true },
            });
          } catch (err: unknown) {
            if ((err as { code?: string })?.code === 'P2002') {
              defaultProject = await prisma.devApiProject.findFirstOrThrow({
                where: { userId, isDefault: true },
                select: { id: true },
              });
            } else {
              throw err;
            }
          }
        }
        resolvedProjectId = defaultProject.id;
      }

      const newKey = await prisma.devApiKey.create({
        data: {
          userId,
          projectId: resolvedProjectId,
          billingProviderId,
          modelId: resolvedModelId || null,
          gatewayOfferId: resolvedGatewayOfferId || null,
          keyLookupId,
          keyPrefix,
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
          status: newKey.status,
          createdAt: newKey.createdAt.toISOString(),
        },
        rawApiKey,
        warning: 'Store this key securely. It will not be shown again.',
      });
    }

    const fallbackProject = inMemoryProjects.find((p: any) => p.id === projectId) || { id: 'proj-default', name: 'Default', isDefault: true };
    const fallbackProvider = inMemoryBillingProviders.find(p => p.id === billingProviderId) || inMemoryBillingProviders[0];

    const newKey = {
      id: `key-${Date.now()}`,
      userId,
      project: { id: fallbackProject.id, name: fallbackProject.name, isDefault: fallbackProject.isDefault },
      billingProvider: { id: fallbackProvider.id, slug: fallbackProvider.slug, displayName: fallbackProvider.displayName },
      keyPrefix,
      keyLookupId,
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
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================
// Start Server
// ============================================

async function start() {
  await initDatabase();
  app.listen(PORT, () => console.log(`🚀 developer-svc running on http://localhost:${PORT}`));
}

start();
