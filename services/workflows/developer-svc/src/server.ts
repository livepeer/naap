import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { createCsrfMiddleware } from '@naap/utils';
import type { RequestHandler } from 'express';
import { 
  models, 
  gatewayOffers, 
  apiKeys, 
  usageRecords, 
  invoices,
  generateApiKey,
  hashApiKey
} from './store/inMemory.js';

const app = express();
const PORT = process.env.PORT || 4007;

app.use(cors());
app.use(express.json());

// Phase 0: CSRF Protection
// Using logOnly mode initially for gradual rollout
// Set CSRF_ENFORCE=true to enable enforcement
const csrfEnforce = process.env.CSRF_ENFORCE === 'true';
app.use('/api', createCsrfMiddleware({
  skipPaths: ['/healthz', '/health'],
  logOnly: !csrfEnforce,
  logger: (msg, data) => console.log(`[developer-svc] ${msg}`, data),
}) as unknown as RequestHandler);

// Health check
app.get('/healthz', (_req, res) => {
  res.json({ 
    status: 'healthy',
    service: 'developer-svc', 
    version: '0.0.1', 
    timestamp: new Date().toISOString(),
  });
});

// ============ Models Endpoints ============

// List all models
app.get('/api/v1/developer/models', (req, res) => {
  const { type, featured, realtime } = req.query;
  
  let filtered = [...models];
  
  if (type) {
    filtered = filtered.filter(m => m.type === type);
  }
  if (featured === 'true') {
    filtered = filtered.filter(m => m.featured);
  }
  if (realtime === 'true') {
    filtered = filtered.filter(m => m.realtime);
  }
  
  res.json({ models: filtered, total: filtered.length });
});

// Get model by ID
app.get('/api/v1/developer/models/:id', (req, res) => {
  const model = models.find(m => m.id === req.params.id);
  
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }
  
  res.json(model);
});

// Get gateways offering a model
app.get('/api/v1/developer/models/:id/gateways', (req, res) => {
  const model = models.find(m => m.id === req.params.id);
  
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }
  
  const offers = gatewayOffers[req.params.id] || [];
  res.json({ modelId: req.params.id, gateways: offers });
});

// ============ API Keys Endpoints ============

// List all API keys
app.get('/api/v1/developer/keys', (_req, res) => {
  res.json({ keys: apiKeys, total: apiKeys.length });
});

// Get API key by ID
app.get('/api/v1/developer/keys/:id', (req, res) => {
  const key = apiKeys.find(k => k.id === req.params.id);
  
  if (!key) {
    return res.status(404).json({ error: 'API key not found' });
  }
  
  res.json(key);
});

// Create new API key
app.post('/api/v1/developer/keys', (req, res) => {
  const { projectName, modelId, gatewayId } = req.body;
  
  if (!projectName || !modelId || !gatewayId) {
    return res.status(400).json({ error: 'projectName, modelId, and gatewayId are required' });
  }
  
  const model = models.find(m => m.id === modelId);
  if (!model) {
    return res.status(400).json({ error: 'Invalid modelId' });
  }
  
  const gatewayOffersForModel = gatewayOffers[modelId] || [];
  const gateway = gatewayOffersForModel.find(g => g.gatewayId === gatewayId);
  if (!gateway) {
    return res.status(400).json({ error: 'Gateway does not offer this model' });
  }
  
  const rawKey = generateApiKey();
  const newKey = {
    id: `key-${uuidv4().slice(0, 8)}`,
    projectName,
    modelId,
    modelName: model.name,
    gatewayId,
    gatewayName: gateway.gatewayName,
    keyHash: hashApiKey(rawKey),
    status: 'active' as const,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  
  apiKeys.push(newKey);
  
  // Return the raw key ONCE - client must store it
  res.status(201).json({ 
    key: newKey,
    rawApiKey: rawKey,
    warning: 'Store this key securely. It will not be shown again.'
  });
});

// Update API key (rename project)
app.patch('/api/v1/developer/keys/:id', (req, res) => {
  const keyIndex = apiKeys.findIndex(k => k.id === req.params.id);
  
  if (keyIndex === -1) {
    return res.status(404).json({ error: 'API key not found' });
  }
  
  const { projectName } = req.body;
  if (projectName) {
    apiKeys[keyIndex].projectName = projectName;
  }
  
  res.json(apiKeys[keyIndex]);
});

// Rotate API key
app.post('/api/v1/developer/keys/:id/rotate', (req, res) => {
  const keyIndex = apiKeys.findIndex(k => k.id === req.params.id);
  
  if (keyIndex === -1) {
    return res.status(404).json({ error: 'API key not found' });
  }
  
  const rawKey = generateApiKey();
  apiKeys[keyIndex].keyHash = hashApiKey(rawKey);
  
  res.json({ 
    key: apiKeys[keyIndex],
    rawApiKey: rawKey,
    warning: 'Store this key securely. It will not be shown again.'
  });
});

// Revoke/Delete API key
app.delete('/api/v1/developer/keys/:id', (req, res) => {
  const keyIndex = apiKeys.findIndex(k => k.id === req.params.id);
  
  if (keyIndex === -1) {
    return res.status(404).json({ error: 'API key not found' });
  }
  
  // Soft delete - mark as revoked
  apiKeys[keyIndex].status = 'revoked';
  
  res.json({ message: 'API key revoked', key: apiKeys[keyIndex] });
});

// ============ Usage Endpoints ============

// Get usage for a specific key
app.get('/api/v1/developer/keys/:id/usage', (req, res) => {
  const key = apiKeys.find(k => k.id === req.params.id);
  
  if (!key) {
    return res.status(404).json({ error: 'API key not found' });
  }
  
  const { days = '7' } = req.query;
  const daysNum = parseInt(days as string, 10);
  
  const keyUsage = usageRecords
    .filter(r => r.keyId === req.params.id)
    .slice(-daysNum);
  
  const totals = keyUsage.reduce(
    (acc, r) => ({
      sessions: acc.sessions + r.sessions,
      outputMinutes: acc.outputMinutes + r.outputMinutes,
      estimatedCost: acc.estimatedCost + r.estimatedCost,
    }),
    { sessions: 0, outputMinutes: 0, estimatedCost: 0 }
  );
  
  res.json({ 
    keyId: req.params.id,
    records: keyUsage,
    totals,
  });
});

// Get aggregate usage (all keys)
app.get('/api/v1/developer/usage', (req, res) => {
  const { keyId, days = '7' } = req.query;
  const daysNum = parseInt(days as string, 10);
  
  let filtered = [...usageRecords];
  
  if (keyId) {
    filtered = filtered.filter(r => r.keyId === keyId);
  }
  
  // Group by date
  const byDate = filtered.reduce((acc, r) => {
    if (!acc[r.date]) {
      acc[r.date] = { date: r.date, sessions: 0, outputMinutes: 0, estimatedCost: 0 };
    }
    acc[r.date].sessions += r.sessions;
    acc[r.date].outputMinutes += r.outputMinutes;
    acc[r.date].estimatedCost += r.estimatedCost;
    return acc;
  }, {} as Record<string, { date: string; sessions: number; outputMinutes: number; estimatedCost: number }>);
  
  const records = Object.values(byDate).slice(-daysNum);
  
  const totals = records.reduce(
    (acc, r) => ({
      sessions: acc.sessions + r.sessions,
      outputMinutes: acc.outputMinutes + r.outputMinutes,
      estimatedCost: acc.estimatedCost + r.estimatedCost,
    }),
    { sessions: 0, outputMinutes: 0, estimatedCost: 0 }
  );
  
  res.json({ records, totals, invoices });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 developer-svc running on http://localhost:${PORT}`);
});
