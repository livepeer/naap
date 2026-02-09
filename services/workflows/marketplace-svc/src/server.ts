import express from 'express';
import cors from 'cors';
import { createCsrfMiddleware } from '@naap/utils';

const app = express();
const PORT = process.env.PORT || 4005;

app.use(cors());
app.use(express.json());

// Phase 0: CSRF Protection
// Using logOnly mode initially for gradual rollout
// Set CSRF_ENFORCE=true to enable enforcement
const csrfEnforce = process.env.CSRF_ENFORCE === 'true';
app.use('/api', createCsrfMiddleware({
  skipPaths: ['/healthz', '/health'],
  logOnly: !csrfEnforce,
  logger: (msg, data) => console.log(`[marketplace-svc] ${msg}`, data),
}));

const assets = [
  { id: 'asset-1', name: 'Flux.1 Pipeline', category: 'Pipeline', author: 'Black Forest Labs', status: 'Active' },
  { id: 'asset-2', name: 'Llama 3.1 70B', category: 'Pipeline', author: 'Meta AI', status: 'Active' },
];

app.get('/healthz', (_req, res) => res.json({ status: 'healthy', service: 'marketplace-svc', version: '0.0.1' }));
app.get('/api/v1/marketplace/assets', (_req, res) => res.json(assets));
app.get('/api/v1/marketplace/assets/:id', (req, res) => {
  const a = assets.find(a => a.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  res.json(a);
});

app.listen(PORT, () => console.log(`🚀 marketplace-svc running on http://localhost:${PORT}`));
