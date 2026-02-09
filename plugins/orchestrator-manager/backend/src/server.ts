import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 4002;

app.use(cors());
app.use(express.json());

const orchestrators = [
  { id: 'orch-1', operatorName: 'GPU Fleet Alpha', gpuType: 'RTX 4090', gpuCount: 8, status: 'active', currentLoad: 75, successRate: 99.2, earningsToday: 245.50 },
  { id: 'orch-2', operatorName: 'Neural Compute Co', gpuType: 'A100', gpuCount: 4, status: 'active', currentLoad: 60, successRate: 99.8, earningsToday: 389.20 },
  { id: 'orch-3', operatorName: 'Decentralized AI', gpuType: 'H100', gpuCount: 2, status: 'suspended', currentLoad: 0, successRate: 98.5, earningsToday: 0 },
];

app.get('/healthz', (_req, res) => res.json({ status: 'healthy', service: 'orchestrator-manager-svc', version: '1.0.0' }));
app.get('/api/v1/orchestrator-manager/orchestrators', (_req, res) => res.json(orchestrators));
app.get('/api/v1/orchestrator-manager/orchestrators/:id', (req, res) => {
  const orch = orchestrators.find(o => o.id === req.params.id);
  if (!orch) return res.status(404).json({ error: 'Not found' });
  res.json(orch);
});

app.listen(PORT, () => console.log(`🚀 orchestrator-manager-svc running on http://localhost:${PORT}`));
