import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 4004;

app.use(cors());
app.use(express.json());

const stats = { healthScore: 98.5, activeJobsNow: 1247, gatewaysOnline: 24, orchestratorsOnline: 156, feesThisRound: 12500, currentRound: 3247 };

app.get('/healthz', (_req, res) => res.json({ status: 'healthy', service: 'network-analytics-svc', version: '1.0.0' }));
app.get('/api/v1/network-analytics/stats', (_req, res) => res.json(stats));
app.get('/api/v1/network-analytics/capabilities', (_req, res) => res.json([
  { pipeline: 'text-to-image', displayName: 'Text to Image', orchestratorCount: 45, demandLevel: 'high' },
  { pipeline: 'llm', displayName: 'LLM Inference', orchestratorCount: 32, demandLevel: 'high' },
  { pipeline: 'audio-to-text', displayName: 'Audio to Text', orchestratorCount: 28, demandLevel: 'medium' },
]));
app.get('/api/v1/network-analytics/jobs', (_req, res) => res.json(Array.from({ length: 20 }, (_, i) => ({
  id: `job-${i + 1}`, type: 'text-to-image', status: 'completed', latencyMs: Math.floor(Math.random() * 100) + 30
}))));

app.listen(PORT, () => console.log(`🚀 network-analytics-svc running on http://localhost:${PORT}`));
