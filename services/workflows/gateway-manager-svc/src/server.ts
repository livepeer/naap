import express from 'express';
import cors from 'cors';
import { db } from './db/client';
import { createCsrfMiddleware } from '@naap/utils';

const app = express();
const PORT = process.env.PORT || 4001;

app.use(cors());
app.use(express.json());

// Phase 0: CSRF Protection
// Using logOnly mode initially for gradual rollout
// Set CSRF_ENFORCE=true to enable enforcement
const csrfEnforce = process.env.CSRF_ENFORCE === 'true';
app.use('/api', createCsrfMiddleware({
  skipPaths: ['/healthz', '/health'],
  logOnly: !csrfEnforce,
  logger: (msg, data) => console.log(`[gateway-manager-svc] ${msg}`, data),
}));

// Health check
app.get('/healthz', async (_req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.json({ 
      status: 'healthy',
      service: 'gateway-manager-svc', 
      version: '0.0.1', 
      timestamp: new Date().toISOString(),
      database: { status: 'connected' }
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'unhealthy',
      service: 'gateway-manager-svc', 
      version: '0.0.1', 
      timestamp: new Date().toISOString(),
      database: { status: 'disconnected', error: error instanceof Error ? error.message : 'Unknown error' }
    });
  }
});

// Gateway endpoints
app.get('/api/v1/gateway-manager/gateways', async (req, res) => {
  try {
    const { status, region, limit = '100', offset = '0' } = req.query;
    
    const where: any = {};
    if (status) where.status = status as string;
    if (region) where.region = region as string;

    const [gateways, total] = await Promise.all([
      db.gateway.findMany({
        where,
        include: {
          orchestratorConnections: {
            take: 10, // Limit connections in list view
          },
          configurations: true,
        },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit as string),
        skip: parseInt(offset as string),
      }),
      db.gateway.count({ where }),
    ]);

    res.json({
      gateways,
      total,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });
  } catch (error) {
    console.error('Gateways list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/v1/gateway-manager/gateways/:id', async (req, res) => {
  try {
    const gateway = await db.gateway.findUnique({
      where: { id: req.params.id },
      include: {
        orchestratorConnections: true,
        performanceMetrics: {
          orderBy: { timestamp: 'desc' },
          take: 100,
        },
        configurations: true,
      },
    });

    if (!gateway) {
      return res.status(404).json({ error: 'Gateway not found' });
    }

    res.json(gateway);
  } catch (error) {
    console.error('Gateway detail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/v1/gateway-manager/gateways/:id/orchestrators', async (req, res) => {
  try {
    const gateway = await db.gateway.findUnique({
      where: { id: req.params.id },
    });

    if (!gateway) {
      return res.status(404).json({ error: 'Gateway not found' });
    }

    const connections = await db.orchestratorConnection.findMany({
      where: { gatewayId: gateway.id },
      orderBy: { latencyScore: 'desc' },
    });

    res.json(connections);
  } catch (error) {
    console.error('Orchestrator connections error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create gateway endpoint
app.post('/api/v1/gateway-manager/gateways', async (req, res) => {
  try {
    const gateway = await db.gateway.create({
      data: req.body,
      include: {
        configurations: true,
      },
    });

    res.status(201).json(gateway);
  } catch (error) {
    console.error('Create gateway error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update gateway endpoint
app.patch('/api/v1/gateway-manager/gateways/:id', async (req, res) => {
  try {
    const gateway = await db.gateway.update({
      where: { id: req.params.id },
      data: req.body,
      include: {
        configurations: true,
      },
    });

    res.json(gateway);
  } catch (error) {
    console.error('Update gateway error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await db.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await db.$disconnect();
  process.exit(0);
});

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 gateway-manager-svc running on http://localhost:${PORT}`);
  
  // Test database connection
  try {
    await db.$connect();
    console.log(`   Database: Connected`);
  } catch (error) {
    console.error(`   Database: Connection failed - ${error}`);
  }
});
