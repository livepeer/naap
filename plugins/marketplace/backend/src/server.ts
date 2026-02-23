import express from 'express';
import cors from 'cors';
import { readFileSync } from 'node:fs';
import { createAuthMiddleware } from '@naap/plugin-server-sdk';

const pluginConfig = JSON.parse(
  readFileSync(new URL('../../plugin.json', import.meta.url), 'utf8')
);
const app = express();
const PORT = process.env.PORT || pluginConfig.backend?.devPort || 4005;

app.use(cors());
app.use(express.json());
app.use(createAuthMiddleware({
  publicPaths: ['/healthz'],
}));

const assets = [
  { id: 'asset-1', name: 'Flux.1 Pipeline', category: 'Pipeline', author: 'Black Forest Labs', status: 'Active' },
  { id: 'asset-2', name: 'Llama 3.1 70B', category: 'Pipeline', author: 'Meta AI', status: 'Active' },
  { id: 'asset-3', name: 'Whisper Large v3', category: 'Pipeline', author: 'OpenAI', status: 'Active' },
];

app.get('/healthz', (_req, res) => res.json({ status: 'healthy', service: 'marketplace-svc', version: '1.0.0' }));
app.get('/api/v1/marketplace/assets', (_req, res) => res.json(assets));
app.get('/api/v1/marketplace/assets/:id', (req, res) => {
  const a = assets.find(a => a.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  res.json(a);
});

app.listen(PORT, () => console.log(`🚀 marketplace-svc running on http://localhost:${PORT}`));
