import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 4006;

app.use(cors());
app.use(express.json());

const posts = [
  { id: 'post-1', author: 'lp_operator.eth', title: 'Best practices for multi-GPU setup', upvotes: 42, commentCount: 15, category: 'Infrastructure' },
  { id: 'post-2', author: 'ai_dev.lens', title: 'Flux.1 performance benchmarks', upvotes: 38, commentCount: 22, category: 'AI Workloads' },
];

app.get('/healthz', (_req, res) => res.json({ status: 'healthy', service: 'community-svc', version: '0.0.1' }));
app.get('/api/v1/community/posts', (_req, res) => res.json(posts));
app.get('/api/v1/community/posts/:id', (req, res) => {
  const p = posts.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

app.listen(PORT, () => console.log(`🚀 community-svc running on http://localhost:${PORT}`));
