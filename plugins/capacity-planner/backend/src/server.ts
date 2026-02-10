import express from 'express';
import cors from 'cors';
import { readFileSync } from 'node:fs';
import { config } from 'dotenv';

config();

const pluginConfig = JSON.parse(
  readFileSync(new URL('../../plugin.json', import.meta.url), 'utf8')
);
const app = express();
const PORT = process.env.PORT || pluginConfig.backend?.devPort || 4003;

app.use(cors());
app.use(express.json());

// ============================================
// Database Connection
// ============================================

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

// ============================================
// In-memory Fallback Data
// ============================================

interface SoftCommit {
  id: string;
  userId: string;
  userName: string;
  timestamp: string;
}

interface RequestComment {
  id: string;
  author: string;
  text: string;
  timestamp: string;
}

interface CapacityRequest {
  id: string;
  requesterName: string;
  requesterAccount: string;
  gpuModel: string;
  vram: number;
  osVersion: string;
  cudaVersion: string;
  count: number;
  pipeline: string;
  startDate: string;
  endDate: string;
  validUntil: string;
  hourlyRate: number;
  reason: string;
  riskLevel: 1 | 2 | 3 | 4 | 5;
  softCommits: SoftCommit[];
  comments: RequestComment[];
  createdAt: string;
  status: 'active' | 'expired' | 'fulfilled';
}

const inMemoryRequests: CapacityRequest[] = [
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
    reason: 'Scaling Flux.1 model inference to meet growing demand for high-quality text-to-image generation.',
    riskLevel: 5,
    softCommits: [
      { id: 'sc-1', userId: 'u-1', userName: 'NodeRunner Pro', timestamp: '2026-01-20T10:00:00Z' },
      { id: 'sc-2', userId: 'u-2', userName: 'GPU Capital', timestamp: '2026-01-21T14:30:00Z' },
    ],
    comments: [
      { id: 'c-1', author: 'NodeRunner Pro', text: 'We have 4x RTX 4090 ready to deploy.', timestamp: '2026-01-20T10:05:00Z' },
    ],
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
    reason: 'Deploying Llama-3 70B for inference at scale.',
    riskLevel: 4,
    softCommits: [],
    comments: [],
    createdAt: '2026-01-12T14:00:00Z',
    status: 'active',
  },
];

// ============================================
// Health Check
// ============================================

app.get('/healthz', (_req, res) => {
  const dbStatus = prisma ? 'connected' : 'fallback';
  res.json({ status: 'healthy', service: 'capacity-planner-svc', version: '2.0.0', database: dbStatus });
});

// ============================================
// Requests API
// ============================================

app.get('/api/v1/capacity-planner/requests', async (req, res) => {
  try {
    const { gpuModel, pipeline, vramMin, search, sort } = req.query;

    if (prisma) {
      const where: any = { status: 'ACTIVE' };
      if (gpuModel) where.gpuModel = gpuModel;
      if (pipeline) where.pipeline = pipeline;
      if (vramMin) where.vram = { gte: parseInt(vramMin as string) };
      if (search) {
        const q = search as string;
        where.OR = [
          { requesterName: { contains: q, mode: 'insensitive' } },
          { gpuModel: { contains: q, mode: 'insensitive' } },
          { pipeline: { contains: q, mode: 'insensitive' } },
          { reason: { contains: q, mode: 'insensitive' } },
        ];
      }

      let orderBy: any = { createdAt: 'desc' };
      if (sort === 'gpuCount') orderBy = { count: 'desc' };
      if (sort === 'hourlyRate') orderBy = { hourlyRate: 'desc' };
      if (sort === 'riskLevel') orderBy = { riskLevel: 'desc' };

      const requests = await prisma.capacityRequest.findMany({
        where,
        include: { softCommits: true, comments: true },
        orderBy,
      });

      const formatted = requests.map((r: any) => ({
        ...r,
        startDate: r.startDate.toISOString().split('T')[0],
        endDate: r.endDate.toISOString().split('T')[0],
        validUntil: r.validUntil.toISOString().split('T')[0],
        createdAt: r.createdAt.toISOString(),
        status: r.status.toLowerCase(),
        softCommits: r.softCommits.map((sc: any) => ({
          id: sc.id,
          userId: sc.userId,
          userName: sc.userName,
          timestamp: sc.createdAt.toISOString(),
        })),
        comments: r.comments.map((c: any) => ({
          id: c.id,
          author: c.author,
          text: c.text,
          timestamp: c.createdAt.toISOString(),
        })),
      }));

      return res.json({ success: true, data: formatted, total: formatted.length });
    }

    // In-memory fallback
    let result = [...inMemoryRequests];

    if (search) {
      const q = (search as string).toLowerCase();
      result = result.filter(
        (r) =>
          r.requesterName.toLowerCase().includes(q) ||
          r.gpuModel.toLowerCase().includes(q) ||
          r.pipeline.toLowerCase().includes(q) ||
          r.reason.toLowerCase().includes(q)
      );
    }
    if (gpuModel) result = result.filter((r) => r.gpuModel === gpuModel);
    if (pipeline) result = result.filter((r) => r.pipeline === pipeline);
    if (vramMin) result = result.filter((r) => r.vram >= parseInt(vramMin as string));

    switch (sort) {
      case 'newest':
        result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case 'gpuCount':
        result.sort((a, b) => b.count - a.count);
        break;
      case 'hourlyRate':
        result.sort((a, b) => b.hourlyRate - a.hourlyRate);
        break;
      case 'riskLevel':
        result.sort((a, b) => b.riskLevel - a.riskLevel);
        break;
      default:
        result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    res.json({ success: true, data: result, total: result.length });
  } catch (error) {
    console.error('Error fetching requests:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/api/v1/capacity-planner/requests/:id', async (req, res) => {
  try {
    if (prisma) {
      const r = await prisma.capacityRequest.findUnique({
        where: { id: req.params.id },
        include: { softCommits: true, comments: true },
      });
      if (!r) return res.status(404).json({ success: false, error: 'Not found' });

      return res.json({
        success: true,
        data: {
          ...r,
          startDate: r.startDate.toISOString().split('T')[0],
          endDate: r.endDate.toISOString().split('T')[0],
          validUntil: r.validUntil.toISOString().split('T')[0],
          createdAt: r.createdAt.toISOString(),
          status: r.status.toLowerCase(),
          softCommits: r.softCommits.map((sc: any) => ({
            id: sc.id,
            userId: sc.userId,
            userName: sc.userName,
            timestamp: sc.createdAt.toISOString(),
          })),
          comments: r.comments.map((c: any) => ({
            id: c.id,
            author: c.author,
            text: c.text,
            timestamp: c.createdAt.toISOString(),
          })),
        },
      });
    }

    const r = inMemoryRequests.find((r) => r.id === req.params.id);
    if (!r) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: r });
  } catch (error) {
    console.error('Error fetching request:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.post('/api/v1/capacity-planner/requests', async (req, res) => {
  try {
    const body = req.body;

    if (prisma) {
      const newReq = await prisma.capacityRequest.create({
        data: {
          requesterName: body.requesterName || 'Anonymous',
          requesterAccount: body.requesterAccount || '0x0000...0000',
          gpuModel: body.gpuModel,
          vram: body.vram,
          osVersion: body.osVersion || 'Any',
          cudaVersion: body.cudaVersion || 'Any',
          count: body.count,
          pipeline: body.pipeline,
          startDate: new Date(body.startDate),
          endDate: new Date(body.endDate),
          validUntil: new Date(body.validUntil),
          hourlyRate: body.hourlyRate,
          reason: body.reason,
          riskLevel: body.riskLevel || 3,
          status: 'ACTIVE',
        },
        include: { softCommits: true, comments: true },
      });

      return res.status(201).json({
        success: true,
        data: {
          ...newReq,
          startDate: newReq.startDate.toISOString().split('T')[0],
          endDate: newReq.endDate.toISOString().split('T')[0],
          validUntil: newReq.validUntil.toISOString().split('T')[0],
          createdAt: newReq.createdAt.toISOString(),
          status: 'active',
          softCommits: [],
          comments: [],
        },
      });
    }

    // In-memory fallback
    const newReq: CapacityRequest = {
      id: `req-${Date.now()}`,
      requesterName: body.requesterName || 'Anonymous',
      requesterAccount: body.requesterAccount || '0x0000...0000',
      gpuModel: body.gpuModel,
      vram: body.vram,
      osVersion: body.osVersion || 'Any',
      cudaVersion: body.cudaVersion || 'Any',
      count: body.count,
      pipeline: body.pipeline,
      startDate: body.startDate,
      endDate: body.endDate,
      validUntil: body.validUntil,
      hourlyRate: body.hourlyRate,
      reason: body.reason,
      riskLevel: body.riskLevel || 3,
      softCommits: [],
      comments: [],
      createdAt: new Date().toISOString(),
      status: 'active',
    };
    inMemoryRequests.unshift(newReq);
    res.status(201).json({ success: true, data: newReq });
  } catch (error) {
    console.error('Error creating request:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Soft commit (toggle)
app.post('/api/v1/capacity-planner/requests/:id/commit', async (req, res) => {
  try {
    const { userId, userName } = req.body;

    if (prisma) {
      const request = await prisma.capacityRequest.findUnique({
        where: { id: req.params.id },
        include: { softCommits: true },
      });
      if (!request) return res.status(404).json({ success: false, error: 'Not found' });

      const existing = request.softCommits.find((sc: any) => sc.userId === userId);
      if (existing) {
        // Remove commitment
        await prisma.capacitySoftCommit.delete({ where: { id: existing.id } });
        return res.json({ success: true, data: { action: 'removed' } });
      }

      // Add commitment
      await prisma.capacitySoftCommit.create({
        data: { requestId: req.params.id, userId, userName },
      });
      return res.json({ success: true, data: { action: 'added' } });
    }

    // In-memory fallback
    const r = inMemoryRequests.find((r) => r.id === req.params.id);
    if (!r) return res.status(404).json({ success: false, error: 'Not found' });

    const existing = r.softCommits.find((sc) => sc.userId === userId);
    if (existing) {
      r.softCommits = r.softCommits.filter((sc) => sc.userId !== userId);
      return res.json({ success: true, data: r, action: 'removed' });
    }

    r.softCommits.push({
      id: `sc-${Date.now()}`,
      userId,
      userName,
      timestamp: new Date().toISOString(),
    });
    res.json({ success: true, data: r, action: 'added' });
  } catch (error) {
    console.error('Error toggling commit:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Add comment
app.post('/api/v1/capacity-planner/requests/:id/comments', async (req, res) => {
  try {
    const { author, text } = req.body;

    if (prisma) {
      const request = await prisma.capacityRequest.findUnique({ where: { id: req.params.id } });
      if (!request) return res.status(404).json({ success: false, error: 'Not found' });

      const comment = await prisma.capacityRequestComment.create({
        data: { requestId: req.params.id, author: author || 'Anonymous', text },
      });

      return res.status(201).json({
        success: true,
        data: {
          id: comment.id,
          author: comment.author,
          text: comment.text,
          timestamp: comment.createdAt.toISOString(),
        },
      });
    }

    // In-memory fallback
    const r = inMemoryRequests.find((r) => r.id === req.params.id);
    if (!r) return res.status(404).json({ success: false, error: 'Not found' });

    const comment: RequestComment = {
      id: `cmt-${Date.now()}`,
      author: author || 'Anonymous',
      text,
      timestamp: new Date().toISOString(),
    };
    r.comments.push(comment);
    res.status(201).json({ success: true, data: comment });
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Summary/analytics
app.get('/api/v1/capacity-planner/summary', async (_req, res) => {
  try {
    let requests: any[];

    if (prisma) {
      requests = await prisma.capacityRequest.findMany({ where: { status: 'ACTIVE' } });
    } else {
      requests = inMemoryRequests;
    }

    const totalGPUs = requests.reduce((sum, r) => sum + r.count, 0);
    const gpuCounts: Record<string, number> = {};
    const pipelineCounts: Record<string, number> = {};

    requests.forEach((r) => {
      gpuCounts[r.gpuModel] = (gpuCounts[r.gpuModel] || 0) + r.count;
      pipelineCounts[r.pipeline] = (pipelineCounts[r.pipeline] || 0) + 1;
    });

    const topGPU = Object.entries(gpuCounts).sort((a, b) => b[1] - a[1])[0];
    const topPipeline = Object.entries(pipelineCounts).sort((a, b) => b[1] - a[1])[0];

    res.json({
      success: true,
      data: {
        totalRequests: requests.length,
        totalGPUsNeeded: totalGPUs,
        avgHourlyRate: requests.length > 0 ? requests.reduce((s, r) => s + r.hourlyRate, 0) / requests.length : 0,
        mostDesiredGPU: topGPU ? { model: topGPU[0], count: topGPU[1] } : null,
        mostPopularPipeline: topPipeline ? { name: topPipeline[0], count: topPipeline[1] } : null,
      },
    });
  } catch (error) {
    console.error('Error fetching summary:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// Error Handling
// ============================================

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ============================================
// Start Server
// ============================================

async function start() {
  await initDatabase();
  app.listen(PORT, () => console.log(`🚀 capacity-planner-svc running on http://localhost:${PORT}`));
}

start();
