import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 4003;

app.use(cors());
app.use(express.json());

const requests = [
  {
    id: 'req-1',
    requesterName: 'Livepeer Studio - AI Video Team',
    requesterAccount: '0x7a3b...f29c',
    gpuModel: 'RTX 4090',
    vram: 24,
    osVersion: 'Ubuntu 22.04',
    cudaVersion: '12.2',
    count: 10,
    pipeline: 'text-to-image',
    startDate: '2026-02-15',
    endDate: '2026-04-15',
    validUntil: '2026-02-28',
    hourlyRate: 1.20,
    reason: 'Scaling Flux.1 model inference for growing demand',
    riskLevel: 5,
    softCommits: [],
    comments: [],
    createdAt: '2026-01-15T08:00:00Z',
    status: 'active',
  },
  {
    id: 'req-2',
    requesterName: 'Decentralized AI Labs',
    requesterAccount: '0x3f91...a84e',
    gpuModel: 'A100 80GB',
    vram: 80,
    osVersion: 'Ubuntu 22.04',
    cudaVersion: '12.1',
    count: 5,
    pipeline: 'llm',
    startDate: '2026-03-01',
    endDate: '2026-06-01',
    validUntil: '2026-02-20',
    hourlyRate: 2.50,
    reason: 'LLM inference capacity expansion',
    riskLevel: 4,
    softCommits: [],
    comments: [],
    createdAt: '2026-01-12T14:00:00Z',
    status: 'active',
  },
];

app.get('/healthz', (_req, res) => res.json({ status: 'healthy', service: 'capacity-planner-svc', version: '2.0.0' }));
app.get('/api/v1/capacity-planner/requests', (_req, res) => res.json({ success: true, data: requests }));
app.get('/api/v1/capacity-planner/requests/:id', (req, res) => {
  const r = requests.find(r => r.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true, data: r });
});

app.listen(PORT, () => console.log(`🚀 capacity-planner-svc running on http://localhost:${PORT}`));
